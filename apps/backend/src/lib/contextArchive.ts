/**
 * context_patches 콜드 아카이브 파이프라인 (t_848d0c3b — 설계 정본: 볼트
 * [[2026-10-01-백개발-context_patches-Storage콜드아카이브-설계]] §1~§3).
 *
 * hot 테이블 팽창 방지 목적의 이관 잡. 파기(TTL) 없음 — '전생 기억'(대표님 9/26):
 * cold 객체 무기한 보존, 원본 DELETE는 read-back 검증(sha256+행수+delta 대조)을
 * 통과한 배치에만 허용된다 (검증 실패 = 삭제 금지, 인덱스 verified_at이 안전문).
 *
 * 대상(§2): created_at < now()-HOT_WINDOW(기본 90일) ∧ < now()-SAFETY_LAG(24h).
 *   보전 예외: conversation.summary·persona.state·user.preferences의 최근 1행은
 *   무슨 일이 있어도 hot 잔류(현재 스냅샷 재구성 필수). secretary.bridge는
 *   set-only 이력이라 예외 없이 cold 우대(추가 예외 없음 — 기본 규칙 그대로).
 *
 * 라이브 게이트: config.contextArchive.enabled **기본 false**. 꺼져 있으면
 * runArchiveJob은 선택 카운트만 보고하고 아무 것도 쓰지 않는다(dry-run과 동일).
 * 실DB 원본 삭제는 systemd timer + env 켬 + 김비서 첫 배치 결재(카드 ④) 후에만.
 *
 * DEV_MODE: 스토리지 경로는 devstore.blobs(격리 프리픽스 __context-archive__/)로
 * 분기 — 파이프라인 로직(선출·NDJSON+gzip·sha·read-back·DELETE 게이트)은 프로덕션과
 * 100% 동일 코드로 단위 테스트된다. storage.ts의 private 버킷 함수는 prod 전용.
 */
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { config } from '../config';
import { DbClient } from './supabase';
import { getStore } from './devstore';
import { archiveBlobKey, downloadFromArchiveBucket, uploadToArchiveBucket } from './storage';
import { logger } from '../utils/logger';

/** context_patches 1행의 아카이브 직렬화 스키마 — 원본 컬럼 1:1 (설계 §1 포맷 규칙). */
export interface PatchRow {
  id: number | string;
  session_id: string;
  key: string;
  operation: string;
  delta: unknown;
  source_neuron: string | null;
  created_at: string;
}

export interface ArchiveIndexRow {
  id?: string;
  session_id: string;
  period: string;
  bucket: string;
  object_path: string;
  patch_count: number;
  min_created_at: string;
  max_created_at: string;
  bytes_compressed: number;
  checksum_sha256: string;
  archived_at?: string;
  verified_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** hot에 반드시 남길 키의 최근 1행 (설계 §2 보전 예외 — 90일 경과와 무관). */
const PRESERVE_RECENT_KEYS = ['conversation.summary', 'persona.state', 'user.preferences'] as const;

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 절충 커트오프: 두 창(HOT_WINDOW, SAFETY_LAG)을 모두 만족하는 가장 오래된 경계. */
export function archiveCutoffIso(nowMs: number = Date.now()): string {
  const hot = nowMs - config.contextArchive.hotWindowDays * 86_400_000;
  const lag = nowMs - config.contextArchive.safetyLagHours * 3_600_000;
  return new Date(Math.min(hot, lag)).toISOString();
}

/** 세션×월 파티션 키와 객체 경로 (설계 §1: {year}/{month}/session={uuid}.ndjson.gz). */
export function periodOf(createdAt: string): string {
  return createdAt.slice(0, 7); // ISO 'YYYY-MM-…' (UTC — created_at은 TIMESTAMPTZ → PostgREST ISO 문자열)
}
export function objectPathOf(sessionId: string, period: string): string {
  return `${period.slice(0, 4)}/${period.slice(5, 7)}/session=${sessionId}.ndjson.gz`;
}

/** NDJSON 직렬화 — 1행=1패치, 키 순서 고정(재시도 시 바이트 안정성 → sha 재현 가능). */
export function toNdjson(rows: PatchRow[]): Buffer {
  return Buffer.from(
    rows
      .map((r) => JSON.stringify({
        id: r.id,
        session_id: r.session_id,
        key: r.key,
        operation: r.operation,
        delta: r.delta,
        source_neuron: r.source_neuron ?? null,
        created_at: r.created_at,
      }))
      .join('\n') + (rows.length ? '\n' : ''),
    'utf8',
  );
}

export function fromNdjson(buf: Buffer): PatchRow[] {
  const text = buf.toString('utf8');
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as PatchRow);
}

/**
 * 보전 예외 계산: 세션별로 PRESERVE_RECENT_KEYS 각 키의 최신 1행 id (created_at,
 * 그다음 id 순 — readContextValue와 동일 정렬). 이관 대상에서 제외할 id 집합을 돌려준다.
 */
export function preserveExceptions(candidates: PatchRow[]): Set<string> {
  const keep = new Set<string>();
  const bySessionKey = new Map<string, PatchRow>();
  for (const r of candidates) {
    if (!PRESERVE_RECENT_KEYS.includes(r.key as (typeof PRESERVE_RECENT_KEYS)[number])) continue;
    const sk = `${r.session_id}\u0000${r.key}`;
    const cur = bySessionKey.get(sk);
    if (!cur || r.created_at > cur.created_at || (r.created_at === cur.created_at && Number(r.id) > Number(cur.id))) {
      bySessionKey.set(sk, r);
    }
  }
  for (const r of bySessionKey.values()) keep.add(String(r.id));
  return keep;
}

/** (session×월) 배치로 그룹 — created_at, id 순 정본 순서 유지. */
export function groupBatches(rows: PatchRow[]): Map<string, { sessionId: string; period: string; rows: PatchRow[] }> {
  const g = new Map<string, { sessionId: string; period: string; rows: PatchRow[] }>();
  const sorted = [...rows].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id));
  for (const r of sorted) {
    const period = periodOf(r.created_at);
    const k = `${r.session_id}\u0000${period}`;
    let b = g.get(k);
    if (!b) { b = { sessionId: r.session_id, period, rows: [] }; g.set(k, b); }
    b.rows.push(r);
  }
  return g;
}

// ── 오브젝트 스토어 (dev: devstore.blobs / prod: private 버킷) ──────────────

export async function putArchiveObject(objectPath: string, bytes: Buffer): Promise<void> {
  if (config.devMode) {
    getStore().blobs.set(archiveBlobKey(objectPath), { bytes, mime: 'application/gzip' });
    return;
  }
  await uploadToArchiveBucket(objectPath, bytes);
}

export async function getArchiveObject(objectPath: string): Promise<Buffer | null> {
  if (config.devMode) {
    return getStore().blobs.get(archiveBlobKey(objectPath))?.bytes ?? null;
  }
  return downloadFromArchiveBucket(objectPath);
}

/**
 * read-back 무결성 검증 (설계 §3 — sha 대조 + 행 수 + delta 전량 대조).
 * originals는 스냅샷(업로드 근거) 행. 한 가지라도 어긋나면 false — 호출부는
 * verified_at을 박지 않고 원본 DELETE도 하지 않는다.
 */
export function verifyArchiveBytes(gz: Buffer | null, checksum: string, originals: PatchRow[]): boolean {
  if (!gz) return false;
  if (sha256Hex(gz) !== checksum) return false;
  let rows: PatchRow[];
  try {
    rows = fromNdjson(gunzipSync(gz));
  } catch {
    return false;
  }
  if (rows.length !== originals.length) return false;
  const byId = new Map(originals.map((r) => [String(r.id), r]));
  for (const r of rows) {
    const o = byId.get(String(r.id));
    if (!o) return false;
    if (r.session_id !== o.session_id || r.key !== o.key || r.operation !== o.operation) return false;
    if (r.created_at !== o.created_at) return false;
    if (JSON.stringify(r.delta) !== JSON.stringify(o.delta)) return false;
    if ((r.source_neuron ?? null) !== (o.source_neuron ?? null)) return false;
  }
  return true;
}

// ── 잡 오케스트레이션 ──────────────────────────────────────────────────────

export interface BatchReport {
  sessionId: string;
  period: string;
  object_path: string;
  patch_count: number;
  verified: boolean;
  deleted: number;
  error?: string;
}

export interface ArchiveJobReport {
  enabled: boolean;
  cutoff: string;
  candidate_count: number;
  preserved_count: number;
  batches: BatchReport[];
  aborted?: string;
}

/** 008/011/013/014 관례 래치: 016 미적용 실DB(테이블 없음)는 잡 전체를 조용히 끈다. */
let indexTableMissing = false;
export function isArchiveIndexKnownUnavailable(): boolean { return indexTableMissing; }
function isMissingTableError(e: any): boolean {
  if (e?.code === 'PGRST205' || e?.code === '42P01') return true;
  const msg = String(e?.message || '');
  return /context_patch_archives/i.test(msg) && /does not exist|relation|Could not find/i.test(msg);
}

/** cutoff 이전 패치를 id 커서로 전량 스캔 (selectAllRows 패턴 변형 — lt 필터 추가). */
export async function scanColdCandidates(db: DbClient, cutoffIso: string): Promise<PatchRow[]> {
  const rows: PatchRow[] = [];
  let cursor: string | number | undefined;
  for (;;) {
    let q = db.from('context_patches').select('*').lt('created_at', cutoffIso);
    if (cursor !== undefined) q = q.gt('id', cursor);
    const { data, error } = await q.order('id', { ascending: true }).limit(500);
    if (error) throw new Error(`context_patches 스캔 실패: ${error.message}`);
    if (!data?.length) return rows;
    rows.push(...(data as PatchRow[]));
    cursor = data[data.length - 1].id;
    if (data.length < 500) return rows;
  }
}

/**
 * 1회 실행: 선출 → 배치별 NDJSON+gzip → sha256 → 인덱스 upsert(verified_at NULL) →
 * 업로드 → read-back → 검증 통과 시에만 verified_at 갱신 + 원본 DELETE.
 * dry-run(--dry-run 또는 enabled=false)은 후보·배치 계산만 보고하고 무쓰기.
 */
export async function runArchiveJob(db: DbClient, opts: { dryRun?: boolean; nowMs?: number } = {}): Promise<ArchiveJobReport> {
  const enabled = config.contextArchive.enabled;
  const dryRun = opts.dryRun === true || !enabled;
  const cutoff = archiveCutoffIso(opts.nowMs);

  const candidates = await scanColdCandidates(db, cutoff);
  const keep = preserveExceptions(candidates);
  const movable = candidates.filter((r) => !keep.has(String(r.id)));
  const report: ArchiveJobReport = {
    enabled, cutoff,
    candidate_count: candidates.length,
    preserved_count: candidates.length - movable.length,
    batches: [],
  };
  if (dryRun) {
    for (const b of groupBatches(movable).values()) {
      report.batches.push({
        sessionId: b.sessionId, period: b.period,
        object_path: objectPathOf(b.sessionId, b.period),
        patch_count: b.rows.length, verified: false, deleted: 0,
      });
    }
    logger.info(`context-archive ${dryRun ? 'DRY-RUN' : 'DISABLED'}: 후보 ${candidates.length}행(보존 ${report.preserved_count}) 배치 ${report.batches.length} (무쓰기)`);
    return report;
  }

  const batches = [...groupBatches(movable).values()].slice(0, config.contextArchive.maxBatchesPerRun);
  for (const b of batches) {
    const br: BatchReport = {
      sessionId: b.sessionId, period: b.period,
      object_path: objectPathOf(b.sessionId, b.period),
      patch_count: b.rows.length, verified: false, deleted: 0,
    };
    report.batches.push(br);
    try {
      const ndjson = toNdjson(b.rows);
      const gz = gzipSync(ndjson);
      const checksum = sha256Hex(gz);
      const indexRow: ArchiveIndexRow = {
        session_id: b.sessionId,
        period: b.period,
        bucket: config.contextArchive.bucket,
        object_path: br.object_path,
        patch_count: b.rows.length,
        min_created_at: b.rows[0].created_at,
        max_created_at: b.rows[b.rows.length - 1].created_at,
        bytes_compressed: gz.length,
        checksum_sha256: checksum,
        verified_at: null, // 재시도 멱등: 매 실행이 검증부터 다시 (crash-window 안전)
        archived_at: new Date().toISOString(),
      };
      const { error: upErr } = await db.from('context_patch_archives')
        .upsert(indexRow, { onConflict: 'object_path' });
      if (upErr) {
        if (isMissingTableError(upErr)) {
          indexTableMissing = true;
          report.aborted = 'context_patch_archives 테이블 없음(016 미적용) — 잡을 끕니다';
          br.error = report.aborted;
          break;
        }
        br.error = `인덱스 upsert 실패: ${upErr.message}`;
        continue;
      }
      await putArchiveObject(br.object_path, gz);
      const readBack = await getArchiveObject(br.object_path);
      if (!verifyArchiveBytes(readBack, checksum, b.rows)) {
        br.error = 'read-back 검증 실패 — 원본 DELETE 금지 (인덱스 verified_at NULL 유지)';
        logger.error(`context-archive 배치 ${br.object_path}: ${br.error}`);
        continue;
      }
      const { error: vErr } = await db.from('context_patch_archives')
        .update({ verified_at: new Date().toISOString() })
        .eq('object_path', br.object_path);
      if (vErr) { br.error = `verified_at 갱신 실패 — DELETE 금지: ${vErr.message}`; continue; }
      br.verified = true;
      // 검증 통과 배치만 원본 제거 — id 리스트 명시 DELETE(경계 흔들림 무관, 500개 청크).
      const ids = b.rows.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500) {
        const { error: dErr } = await db.from('context_patches').delete().in('id', ids.slice(i, i + 500));
        if (dErr) { br.error = `원본 DELETE 일부 실패(재시도 가능 — 멱등 upsert+검증): ${dErr.message}`; logger.error(`context-archive ${br.object_path}: ${br.error}`); break; }
        br.deleted += Math.min(500, ids.length - i);
      }
    } catch (err) {
      br.error = (err as Error).message;
      logger.error(`context-archive 배치 예외 ${br.object_path}: ${br.error}`);
    }
  }
  return report;
}

// ── 회수 경로 (설계 §d — 라우트가 이 함수들만 호출, Storage 직접 노출 0) ─────

/** 세션의 검증 완료 cold 배치 목록 (미검증 행은 사용자에게 절대 노출하지 않는다).
 *  verified_at 필터는 JS 사이드 — devstore에 PostgREST .not() 빌더가 없어 양쪽 공통. */
export async function listArchives(db: DbClient, sessionId: string): Promise<ArchiveIndexRow[]> {
  const { data, error } = await db
    .from('context_patch_archives')
    .select('*')
    .eq('session_id', sessionId)
    .order('period', { ascending: true });
  if (error) {
    if (isMissingTableError(error)) { indexTableMissing = true; return []; }
    return [];
  }
  return ((data as ArchiveIndexRow[]) || []).filter((a) => a.verified_at != null);
}

/**
 * readFullContext 투명 콜드 폴백용: 검증된 객체 전체를 디코드해 패치 행 리스트로.
 * hot과 id 중복 제거는 호출부(contextSync)가 책임(restore 후 이중 존재 창 대응 —
 * restore가 원본 id를 보존하므로 id 기준 dedup가 정확).
 */
export async function fetchVerifiedPatches(db: DbClient, sessionId: string): Promise<PatchRow[]> {
  if (indexTableMissing) return [];
  const rows = await listArchives(db, sessionId);
  const out: PatchRow[] = [];
  for (const a of rows) {
    try {
      const gz = await getArchiveObject(a.object_path);
      if (!gz) continue;
      if (sha256Hex(gz) !== a.checksum_sha256) { // 엣지 잔존·교손 = 조용히 스킵(hot만 신뢰)
        logger.warn(`context-archive checksum 불일치 스킵: ${a.object_path}`);
        continue;
      }
      out.push(...fromNdjson(gunzipSync(gz)));
    } catch (err) {
      logger.warn(`context-archive 콜드 읽기 실패(무시, hot만 계속): ${a.object_path} — ${(err as Error).message}`);
    }
  }
  return out;
}

export interface RestoreResult {
  restored: number;
  skipped_existing: number;
  object_path: string;
  patch_count: number;
}

/**
 * POST restore: 검증된 자기 세션 객체를 hot에 되돌린다. 원본 id 보존(이관 전과
 * 동일한 재구성 순서), 이미 hot에 있는 id는 스킵(멱등 — 재호출·부분 실패 안전).
 * 인덱스 행은 유지 — '전생 기억' 무파기 + 이후 재이관 시 동일 경로 upsert로 수렴.
 * 콜드 폴백의 id 중복 제거(fetchVerifiedPatches ∩ hot)와 맞춰 이중 계산이 성립하지 않는다.
 */
export async function restoreArchive(db: DbClient, sessionId: string, objectPath: string): Promise<RestoreResult> {
  const { data: row, error } = await db
    .from('context_patch_archives')
    .select('*')
    .eq('session_id', sessionId)
    .eq('object_path', objectPath)
    .maybeSingle();
  if (error) throw new Error(`아카이브 조회 실패: ${error.message}`);
  const archive = row as ArchiveIndexRow | null;
  if (!archive) throw new Error('NOT_FOUND');
  if (!archive.verified_at) throw new Error('UNVERIFIED');
  const gz = await getArchiveObject(archive.object_path);
  if (!gz || sha256Hex(gz) !== archive.checksum_sha256) throw new Error('INTEGRITY');
  let patches: PatchRow[];
  try {
    patches = fromNdjson(gunzipSync(gz));
  } catch {
    throw new Error('INTEGRITY');
  }
  if (patches.length !== archive.patch_count) throw new Error('INTEGRITY');

  const existing = await scanAllPatchIds(db, sessionId);
  const missing = patches.filter((p) => !existing.has(String(p.id)));
  let restored = 0;
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    const { error: insErr } = await db.from('context_patches').insert(
      chunk.map((p) => ({
        id: p.id,
        session_id: sessionId,
        key: p.key,
        operation: p.operation,
        delta: p.delta,
        source_neuron: p.source_neuron ?? null,
        created_at: p.created_at,
      })),
    );
    if (insErr) throw new Error(`restore 삽입 실패(id 재사용 충돌 가능 — 재시도/수동 확인): ${insErr.message}`);
    restored += chunk.length;
  }
  return { restored, skipped_existing: patches.length - missing.length, object_path: archive.object_path, patch_count: archive.patch_count };
}

async function scanAllPatchIds(db: DbClient, sessionId: string): Promise<Set<string>> {
  const out = new Set<string>();
  let cursor: string | number | undefined;
  for (;;) {
    let q = db.from('context_patches').select('id').eq('session_id', sessionId);
    if (cursor !== undefined) q = q.gt('id', cursor);
    const { data, error } = await q.order('id', { ascending: true }).limit(500);
    if (error) throw new Error(`context_patches id 스캔 실패: ${error.message}`);
    if (!data?.length) return out;
    for (const r of data as { id: number | string }[]) out.add(String(r.id));
    cursor = data[data.length - 1].id;
    if (data.length < 500) return out;
  }
}
