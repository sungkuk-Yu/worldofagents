/**
 * context_patches 콜드 아카이브 단위 테스트 (t_848d0c3b, DEV_MODE 인메모리).
 *
 * 커버 (카드 ⑤ 검증 항목):
 *   - 파이프라인: 선출(cutoff) → NDJSON+gzip → sha256 → 업로드 → read-back 검증 →
 *     verified_at → 원본 DELETE. 보전 예외(conversation.summary/persona.state/
 *     user.preferences 최근 1행) hot 잔류, secretary.bridge cold 우대(예외 없음).
 *   - 실패 경로: read-back 변조 = 검증 실패 → DELETE 0건, verified_at NULL, 인덱스만 남음.
 *   - 게이트: config.enabled=false(기본)이면 무쓰기(dry-run) — 봉인된 vitest env에서 확인.
 *   - readFullContext 콜드 폴백: 이관 후에도 현재 값 재구성 동일, hot 우선 중복 없음.
 *   - 라우트: GET archives(미검증 숨김), POST restore(멱등·UNVERIFIED 400·타 세션 404).
 * 프로덕션 private 버킷(lib/storage.ts archive 함수) 실버킷 read-back은 후속 카드 ④에서
 * smoke로 수행한다(첫 배치 김비서 결재 게이트).
 * helpers.createTestApp은 build 시 resetStore() — 라우트 테스트의 DB는 supabaseAdmin
 * (DEV에서 getStore() 싱글턴을 보는 클라이언트)과 동일 스토어를 공유한다.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { config } from '../../src/config';
import { getStore, resetStore, createDevClient } from '../../src/lib/devstore';
import { supabaseAdmin } from '../../src/lib/supabase';
import {
  runArchiveJob, archiveCutoffIso, objectPathOf, sha256Hex, verifyArchiveBytes,
  toNdjson, fromNdjson, preserveExceptions,
  type PatchRow,
} from '../../src/lib/contextArchive';
import { writeContextPatch, readContextValue, readFullContext } from '../../src/lib/contextSync';
import { createTestApp, signup, createFullStack, bearer, closeTestApp, TestApp } from '../helpers';

const SID = '00000000-0000-4000-8000-000000000001';
const DAY = 86_400_000;

const ARCHIVE_BLOB_PREFIX = '__context-archive__/';

function setEnabled(v: boolean) {
  Object.defineProperty(config.contextArchive, 'enabled', { value: v, configurable: true });
}
function setHotDays(v: number) {
  Object.defineProperty(config.contextArchive, 'hotWindowDays', { value: v, configurable: true });
}

async function makeDb() {
  resetStore();
  return createDevClient(getStore());
}

/** 오래된(created_at 커스텀) 패치를 hot에 직접 삽입 (writeContextPatch는 now()만 쓴다).
 *  시퀀스도 함께 전진 — 이후 자동 id(writeContextPatch)가 이 id들과 충돌해
 *  devstore insert의 Object.assign 상書き가 되지 않게. */
function seedOldPatch(db: any, id: number, key: string, operation: string, value: unknown, ageDays: number, source = 'answer') {
  const store = getStore();
  store.sequences.context_patches = Math.max(store.sequences.context_patches || 0, id);
  const created_at = new Date(Date.now() - ageDays * DAY).toISOString();
  return db.from('context_patches').insert({
    id, session_id: SID, key, operation, delta: { value }, source_neuron: source, created_at,
  });
}

/** 업로드 바이트를 말통으로 오염(read-back 실패 = private 버킷 교손 대리). */
function tamperOnWrite() {
  const store = getStore();
  const orig = store.blobs.set.bind(store.blobs);
  vi.spyOn(store.blobs, 'set').mockImplementation((k: any, v: any) => {
    const bytes: Buffer = v.bytes;
    const t = Buffer.from(bytes);
    t[t.length - 1] ^= 0xff;
    orig(k, { ...v, bytes: t });
    return store.blobs;
  });
}

afterEach(() => {
  setEnabled(false);
  setHotDays(90);
  vi.restoreAllMocks();
});

describe('게이트·커트오프·경로 규칙', () => {
  it('기본 enabled=false — vitest 봉인 env + dry-run은 무쓰기(원본·인덱스·버킷 모두 불변)', async () => {
    expect(config.contextArchive.enabled).toBe(false);
    const db = await makeDb();
    await seedOldPatch(db, 1, 'conversation.recent', 'append', { content: '옛날 대화' }, 120);
    const rep = await runArchiveJob(db as any, {});
    expect(rep.enabled).toBe(false);
    expect(rep.candidate_count).toBe(1);
    expect(rep.batches).toHaveLength(1); // 계산만
    expect(getStore().tables.context_patch_archives).toHaveLength(0); // DB 쓰기 0
    expect(getStore().blobs.size).toBe(0); // 버킷 쓰기 0
    const { data } = await db.from('context_patches').select('*');
    expect(data).toHaveLength(1); // 원본 불변
  });

  it('cutoff = 절충(HOT_WINDOW ∧ SAFETY_LAG) — 90d가 우세, 창을 줄이면 24h가 우세', () => {
    const now = Date.UTC(2026, 9, 1, 12);
    expect(archiveCutoffIso(now)).toBe(new Date(now - 90 * DAY).toISOString());
    setHotDays(0); // hot 창 소멸 → safety lag(24h)가 경계
    expect(archiveCutoffIso(now)).toBe(new Date(now - DAY).toISOString());
  });

  it('object_path = {year}/{month}/session={id}.ndjson.gz (설계 §1)', () => {
    expect(objectPathOf(SID, '2026-06')).toBe(`2026/06/session=${SID}.ndjson.gz`);
  });
});

describe('라이브 파이프라인 (enabled=true, devstore.blobs = private 버킷 대리)', () => {
  it('이관 여정 전체: gzip+sha 업로드 → read-back 통과 → verified_at → DELETE, hot·보존예외 잔류', async () => {
    const db = await makeDb();
    // cold 후보: 119~120일 전 (세션×월 2개 달 = 2개 배치).
    await seedOldPatch(db, 1, 'conversation.recent', 'append', { content: 'a1' }, 120);
    await seedOldPatch(db, 2, 'conversation.recent', 'append', { content: 'a2' }, 119);
    // secretary.bridge(9/30 갱신: set-only 이력 = cold 우대, 예외 없음) 120일 전.
    await seedOldPatch(db, 3, 'secretary.bridge', 'set', { contextId: 'c' }, 120, 'bridge');
    // 보전 예외: user.preferences 150일+120일 전 — 최신 1행(id5)만 hot 잔류.
    await seedOldPatch(db, 4, 'user.preferences', 'set', { theme: 'old' }, 150);
    await seedOldPatch(db, 5, 'user.preferences', 'set', { theme: 'dark' }, 120);
    // hot: 최신 패치(대상 아님).
    await writeContextPatch(db as any, SID, 'task.current', { operation: 'set', value: { id: 't9' }, source: 'answer' });

    setEnabled(true);
    const rep = await runArchiveJob(db as any, {});
    expect(rep.enabled).toBe(true);
    expect(rep.candidate_count).toBe(5);
    expect(rep.preserved_count).toBe(1);
    // 배치 수=세션×월 경계에 민감(120/119/150일 전의 달 조합) → 합계로 계약.
    expect(rep.batches.every((b) => b.verified && b.deleted > 0)).toBe(true);
    expect(rep.batches.reduce((s, b) => s + b.deleted, 0)).toBe(4);
    expect(rep.batches.reduce((s, b) => s + b.patch_count, 0)).toBe(4);

    // 인덱스: verified_at 박힘, sha/bytes 실측, blob은 gzip+NDFJSON.
    const idx = getStore().tables.context_patch_archives as any[];
    expect(idx).toHaveLength(rep.batches.length);
    for (const a of idx) {
      expect(a.verified_at).toBeTruthy();
      expect(a.bucket).toBe('context-archive');
      expect(a.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.session_id).toBe(SID);
      const blob = getStore().blobs.get(ARCHIVE_BLOB_PREFIX + a.object_path);
      expect(blob).toBeTruthy();
      expect(createHash('sha256').update(blob!.bytes).digest('hex')).toBe(a.checksum_sha256);
      expect(a.bytes_compressed).toBe(blob!.bytes.length);
      const rows = fromNdjson(gunzipSync(blob!.bytes));
      expect(rows).toHaveLength(a.patch_count);
      expect(blob!.mime).toBe('application/gzip');
    }

    // hot: 이관 4행 삭제, 보존 예외(id5)+최신만 잔류.
    const { data: hot } = await db.from('context_patches').select('*').order('id');
    expect(hot.map((r: any) => r.id)).toEqual([5, 6]);

    // 콜드 폴백: 이관 후에도 현재 값 재구성 동일(hot+cold).
    const recent = await readContextValue(db as any, SID, 'conversation.recent');
    expect(recent).toHaveLength(2); // cold 2행 append 누적 복원
    const prefs = await readFullContext(db as any, SID);
    expect(prefs['user.preferences']).toEqual({ theme: 'dark' }); // hot 보존 예외 우선(중복 없음)
    expect(prefs['secretary.bridge']).toEqual({ contextId: 'c' }); // cold에서 복원
    expect(prefs['task.current']).toEqual({ id: 't9' });
  });

  it('read-back 변조 → 검증 실패: DELETE 0·verified_at NULL·원본 hot 그대로', async () => {
    const db = await makeDb();
    await seedOldPatch(db, 1, 'conversation.recent', 'append', { content: 'x' }, 120);
    setEnabled(true);
    tamperOnWrite();
    const rep = await runArchiveJob(db as any, {});
    expect(rep.batches[0].verified).toBe(false);
    expect(rep.batches[0].deleted).toBe(0);
    expect(rep.batches[0].error).toMatch(/read-back 검증 실패/);
    const idx = getStore().tables.context_patch_archives as any[];
    expect(idx).toHaveLength(1);
    expect(idx[0].verified_at).toBeNull(); // 안전문 — 이후 실행이 재검증 전까지 삭제 못 한다
    const { data: hot } = await db.from('context_patches').select('*');
    expect(hot).toHaveLength(1);
  });

  it('재시도 멱등: 성공 후 재실행은 후보 0·인덱스 중복 0', async () => {
    const db = await makeDb();
    await seedOldPatch(db, 1, 'conversation.recent', 'append', { content: 'x' }, 120);
    setEnabled(true);
    const r1 = await runArchiveJob(db as any, {});
    expect(r1.batches[0].verified).toBe(true);
    const r2 = await runArchiveJob(db as any, {});
    expect(r2.candidate_count).toBe(0);
    expect(r2.batches).toHaveLength(0);
    expect(getStore().tables.context_patch_archives).toHaveLength(1);
  });
});

describe('verifyArchiveBytes·preserveExceptions 순수 함수', () => {
  const rows: PatchRow[] = [
    { id: 1, session_id: SID, key: 'k.a', operation: 'set', delta: { value: 1 }, source_neuron: 'answer', created_at: '2026-05-01T00:00:00.000Z' },
    { id: 2, session_id: SID, key: 'k.a', operation: 'append', delta: { value: 2 }, source_neuron: null, created_at: '2026-05-02T00:00:00.000Z' },
  ];
  const gz = gzipSync(toNdjson(rows));
  const sha = sha256Hex(gz);

  it('정상 통과 / null·sha 불일치· gzip 손상·행 수·delta 변조 거부', () => {
    expect(verifyArchiveBytes(gz, sha, rows)).toBe(true);
    expect(verifyArchiveBytes(null, sha, rows)).toBe(false);
    expect(verifyArchiveBytes(gz, '0'.repeat(64), rows)).toBe(false);
    expect(verifyArchiveBytes(Buffer.from('not-gzip'), sha, rows)).toBe(false);
    expect(verifyArchiveBytes(gz, sha, rows.slice(0, 1))).toBe(false); // 행 수
    const tampered = fromNdjson(gunzipSync(gz));
    tampered[1].delta = { value: 999 };
    const tgz = gzipSync(toNdjson(tampered));
    expect(verifyArchiveBytes(tgz, sha256Hex(tgz), rows)).toBe(false); // delta 대조
  });

  it('preserveExceptions는 3키의 세션별 최신 1행만 지킨다 (conversation.recent은 예외 아님)', () => {
    const ex = preserveExceptions([
      ...rows,
      { id: 3, session_id: SID, key: 'user.preferences', operation: 'set', delta: 1, source_neuron: null, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 4, session_id: SID, key: 'user.preferences', operation: 'set', delta: 2, source_neuron: null, created_at: '2026-02-01T00:00:00.000Z' },
      { id: 5, session_id: 'other', key: 'persona.state', operation: 'set', delta: 1, source_neuron: null, created_at: '2026-02-01T00:00:00.000Z' },
    ]);
    expect([...ex].sort()).toEqual(['4', '5']);
  });
});

describe('라우트 (GET /:id/context/archives · POST .../restore)', () => {
  let app: TestApp;
  let tokenA: string, sessionA: { id: string };
  let tokenB: string, sessionB: { id: string };

  beforeAll(async () => {
    app = await createTestApp();
    const a = await signup(app, 'archA@test.io');
    tokenA = a.token;
    ({ session: sessionA } = await createFullStack(app, tokenA));
    const b = await signup(app, 'archB@test.io');
    tokenB = b.token;
    ({ session: sessionB } = await createFullStack(app, tokenB));
  });
  afterAll(async () => { await closeTestApp(app); });

  /** 확정 피스처: cold 패치 1행을 '아카이브된 상태'로 직접 구성 —
   *  hot에서 제거 + gzip blob + 인덱스 행(verified_at 선택). 잡 없이 파이프라인
   *  산출물과 동일한 형태(함수 재사용)라 라우트 계약만 격리 검증한다. */
  function fixtureArchived(sessionId: string, opts: { verified: boolean; ageDays?: number; content?: string; keepHot?: boolean } = {}) {
    const store = getStore();
    const created_at = new Date(Date.now() - (opts.ageDays ?? 120) * DAY).toISOString();
    const id = (store.sequences.context_patches = (store.sequences.context_patches || 0) + 1);
    const patch: PatchRow = {
      id, session_id: sessionId, key: 'conversation.recent', operation: 'append',
      delta: { value: { content: opts.content ?? `cold-${id}` } }, source_neuron: 'answer', created_at,
    };
    // keepHot=true = '이관 전(DELETE 미수행)' 형태(원본 hot 잔존), false = '이관 완료' 형태(hot 없음).
    if (opts.keepHot) store.tables.context_patches.push(patch);
    const gz = gzipSync(toNdjson([patch]));
    const period = created_at.slice(0, 7);
    const object_path = objectPathOf(sessionId, period);
    store.blobs.set(ARCHIVE_BLOB_PREFIX + object_path, { bytes: gz, mime: 'application/gzip' });
    store.tables.context_patch_archives.push({
      id: `arch-${id}`, session_id: sessionId, period, bucket: 'context-archive', object_path,
      patch_count: 1, min_created_at: created_at, max_created_at: created_at,
      bytes_compressed: gz.length, checksum_sha256: sha256Hex(gz),
      archived_at: created_at, verified_at: opts.verified ? created_at : null,
    });
    return { id, period, created_at };
  }

  it('아카이브 없는 세션: archives=[] (016 테이블 빈 상태 = 기존 동작 무영향)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/context/archives`, headers: bearer(tokenA) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.archives).toEqual([]);
  });

  it('인증 없이 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/context/archives` });
    expect(res.statusCode).toBe(401);
  });

  it('cold 폴백 + 목록 + restore 멱등 + 이중 계산 없음 + 타 세션 404 + period 400', async () => {
    const f = fixtureArchived(sessionA.id, { verified: true });

    // readFullContext 투명 폴백: hot에 없던 cold 1행으로 conversation.recent 재구성.
    const ctx = await readFullContext(supabaseAdmin, sessionA.id);
    expect(ctx['conversation.recent']).toHaveLength(1);

    const list = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/context/archives`, headers: bearer(tokenA) });
    expect(list.statusCode).toBe(200);
    const arch = list.json().data.archives;
    expect(arch).toHaveLength(1);
    expect(arch[0].verified_at).toBeTruthy();
    expect(arch[0].object_path).toBeUndefined(); // 버킷 내부 구조 비노출
    expect(arch[0].patch_count).toBe(1);

    const r1 = await app.inject({ method: 'POST', url: `/api/sessions/${sessionA.id}/context/archives/restore`, headers: bearer(tokenA), payload: { period: f.period } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().data).toMatchObject({ period: f.period, restored: 1, skipped_existing: 0, patch_count: 1 });
    expect(getStore().tables.context_patches.filter((r) => r.session_id === sessionA.id)).toHaveLength(1);
    const r2 = await app.inject({ method: 'POST', url: `/api/sessions/${sessionA.id}/context/archives/restore`, headers: bearer(tokenA), payload: { period: f.period } });
    expect(r2.json().data).toMatchObject({ restored: 0, skipped_existing: 1 });
    expect(getStore().tables.context_patches.filter((r) => r.session_id === sessionA.id)).toHaveLength(1); // 중복 삽입 없음

    // restore(hot) + cold 병합: id 중복 제거로 conversation.recent는 여전히 1행.
    const ctx2 = await readFullContext(supabaseAdmin, sessionA.id);
    expect(ctx2['conversation.recent']).toHaveLength(1);

    // B 세션으로 A의 period 복원 시도 → 인덱스 session_id 필터로 404.
    const rB = await app.inject({ method: 'POST', url: `/api/sessions/${sessionB.id}/context/archives/restore`, headers: bearer(tokenB), payload: { period: f.period } });
    expect(rB.statusCode).toBe(404);

    const badReq = await app.inject({ method: 'POST', url: `/api/sessions/${sessionA.id}/context/archives/restore`, headers: bearer(tokenA), payload: { period: '2026-1' } });
    expect(badReq.statusCode).toBe(400);
  });

  it('미검증 배치: cold 폴백·목록·restore 전부 배제 (verified_at 안전문) — hot 원본이 진실', async () => {
    // 이관 전 형태: hot 원본 + blob + verified_at NULL 인덱스.
    const f = fixtureArchived(sessionB.id, { verified: false, keepHot: true });

    // 폴백은 cold를 읽지 않는다 → hot 1행으로 재구성(중복 계산도 없음).
    const ctx = await readFullContext(supabaseAdmin, sessionB.id);
    expect(ctx['conversation.recent']).toHaveLength(1);
    expect(getStore().tables.context_patches.filter((r) => r.session_id === sessionB.id)).toHaveLength(1); // 원본 그대로

    const list = await app.inject({ method: 'GET', url: `/api/sessions/${sessionB.id}/context/archives`, headers: bearer(tokenB) });
    expect(list.json().data.archives).toEqual([]);
    const restore = await app.inject({ method: 'POST', url: `/api/sessions/${sessionB.id}/context/archives/restore`, headers: bearer(tokenB), payload: { period: f.period } });
    expect(restore.statusCode).toBe(400); // 검증 미완료 = 복원 불가 (목록에선 숨김, restore은 명시 400)
    expect(getStore().tables.context_patches.filter((r) => r.session_id === sessionB.id)).toHaveLength(1); // 원본 그대로
  });

  it('restore 객체 sha 교손 → INTEGRITY 500, hot 삽입 없음', async () => {
    const f = fixtureArchived(sessionB.id, { verified: true, content: '교손테스트', ageDays: 150 });
    const key = ARCHIVE_BLOB_PREFIX + objectPathOf(sessionB.id, f.period); // 세션 고유 경로에 정확히 조준
    const blob = getStore().blobs.get(key)!;
    const broken = Buffer.from(blob.bytes);
    broken[broken.length - 1] ^= 0xff;
    getStore().blobs.set(key, { ...blob, bytes: broken });
    const hotBefore = getStore().tables.context_patches.filter((r) => r.session_id === sessionB.id).length;
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${sessionB.id}/context/archives/restore`, headers: bearer(tokenB), payload: { period: f.period } });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).toMatch(/무결성/);
    const hotAfter = getStore().tables.context_patches.filter((r) => r.session_id === sessionB.id).length;
    expect(hotAfter).toBe(hotBefore); // 교손 객체에서 hot으로 흘러 들어온 행 0
  });

  it('경로 경합 없음: /context/archives는 static, /context/:key와 공존', async () => {
    await writeContextPatch(supabaseAdmin, sessionA.id, 'task.current', { operation: 'set', value: { id: 'z' } });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/context/task.current`, headers: bearer(tokenA) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.value).toEqual({ id: 'z' });
  });
});
