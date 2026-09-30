/**
 * context_patches 읽기 전용 실상태 조사 (t_77500991, 실패로그 A6/D1 잔여).
 *
 * 목적: 콜드 아카이브 설계의 근거 데이터 — 행 수·바이트·최신/최old 시각·세션별 분포.
 * 원칙: SELECT/HEAD count만. 쓰기·삭제·DDL 일절 없음 (카드 3항 실행 금지).
 *
 * 실행 (apps/backend):
 *   DEV_MODE=false ./node_modules/.bin/tsx scripts/context_patches_state.ts
 *
 * 출력만 남긴다 — 이 스크립트는 어떤 상태도 변경하지 않는다.
 */
import { supabaseAdmin } from '../src/lib/supabase';

const PAGE = 1000;
/** 안전상한: 이 이상이면 잘리고 truncate=true로 보고 (실DB 무부하 원칙). */
const MAX_ROWS = Number(process.env.CP_STATE_MAX_ROWS || 50000);

interface PatchRow {
  id: number;
  session_id: string;
  key: string;
  operation: string;
  delta: unknown;
  source_neuron: string | null;
  created_at: string;
}

function bytesOf(row: PatchRow): number {
  // 디스크 근사치: 재직렬화 바이트 + 고정 오버헤드(jsonb 헤더·인덱스 토스트 제외 추정)
  return Buffer.byteLength(JSON.stringify(row));
}

async function main() {
  const t0 = Date.now();

  // 1) 총 행 수 — head:true count (본문 전송 없음)
  const { count, error: cntErr } = await supabaseAdmin
    .from('context_patches')
    .select('id', { count: 'exact', head: true });
  if (cntErr) { console.error('count 실패:', cntErr); process.exit(1); }
  console.log(`=== context_patches 실상태 조사 (read-only, ${new Date().toISOString()}) ===`);
  console.log(`총 행 수: ${count}`);

  // 2) 최신/최old 시각 — 인덱스 (session_id,key,created_at DESC) 와 무관한 전역 order는
  //    created_at 단독이라 순走 but limit 1: PostgREST는 정렬 인덱스 강제 없이도 동작(소규모 기준 허용).
  const [newest, oldest] = await Promise.all([
    supabaseAdmin.from('context_patches').select('id,created_at').order('created_at', { ascending: false }).limit(1).single(),
    supabaseAdmin.from('context_patches').select('id,created_at').order('created_at', { ascending: true }).limit(1).single(),
  ]);
  if (newest.error) console.warn('최신 조회 실패:', newest.error.message);
  else console.log(`최신 시점: ${newest.data.created_at} (id=${newest.data.id})`);
  if (oldest.error) console.warn('최old 조회 실패:', oldest.error.message);
  else console.log(`최old 시점: ${oldest.data.created_at} (id=${oldest.data.id})`);

  // 3) 전량 페이지네이션 수집 — 세션별 분포·바이트 합산·키 분포용.
  //    (pg_size_*는 관리형 PostgREST 경로로 불가 → 페이로드 재직렬화 합으로 근사.)
  const rows: PatchRow[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    if (rows.length >= MAX_ROWS) { truncated = true; break; }
    const { data, error } = await supabaseAdmin
      .from('context_patches')
      .select('id,session_id,key,operation,delta,source_neuron,created_at')
      .order('id', { ascending: true })
      .range(from, Math.min(from + PAGE - 1, MAX_ROWS - 1));
    if (error) { console.error(`페이지 ${from} 실패:`, error.message); process.exit(1); }
    const chunk = (data as PatchRow[]) || [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }

  // 4) 집계
  let totalBytes = 0;
  const bySession = new Map<string, { n: number; bytes: number; first: string; last: string }>();
  const byKey = new Map<string, number>();
  const byOp = new Map<string, number>();
  let oldestTs = ''; let newestTs = '';
  for (const r of rows) {
    const b = bytesOf(r);
    totalBytes += b;
    const s = bySession.get(r.session_id) || { n: 0, bytes: 0, first: r.created_at, last: r.created_at };
    s.n += 1; s.bytes += b;
    if (r.created_at < s.first) s.first = r.created_at;
    if (r.created_at > s.last) s.last = r.created_at;
    bySession.set(r.session_id, s);
    byKey.set(r.key, (byKey.get(r.key) || 0) + 1);
    byOp.set(r.operation, (byOp.get(r.operation) || 0) + 1);
    if (!oldestTs || r.created_at < oldestTs) oldestTs = r.created_at;
    if (!newestTs || r.created_at > newestTs) newestTs = r.created_at;
  }

  console.log(`\n수집 행: ${rows.length}${truncated ? ` (상한 ${MAX_ROWS}에서 절단 — truncate=true)` : ' (전량)'} / ${Date.now() - t0}ms`);
  console.log(`페이자체 합(근사 bytes, 재직렬화): ${totalBytes.toLocaleString()} (~${(totalBytes / 1024).toFixed(1)} KiB; 평균 ${(rows.length ? totalBytes / rows.length : 0).toFixed(1)} B/행)`);
  console.log(`실측 기간(수집 범위): ${oldestTs} → ${newestTs}`);

  console.log(`\n--- 세션별 분포 (총 ${bySession.size}세션, 상위 15) ---`);
  const top = [...bySession.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  for (const [sid, s] of top) {
    console.log(`  ${sid}  n=${s.n}  bytes≈${s.bytes.toLocaleString()}  ${s.first} → ${s.last}`);
  }
  const ages = [...bySession.values()].map((s) => (Date.now() - Date.parse(s.last)) / 86400_000);
  if (ages.length) {
    const over90 = [...bySession.entries()].filter(([, s]) => (Date.now() - Date.parse(s.last)) / 86400_000 > 90);
    console.log(`  90일 이상 미활동 세션: ${over90.length}/${bySession.size}`);
  }

  console.log('\n--- 키별 행 분포 ---');
  for (const [k, n] of [...byKey.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
  console.log('\n--- operation 분포 ---');
  for (const [o, n] of [...byOp.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${o}: ${n}`);

  // 아카이브 대상 추정: HOT_WINDOW=90일 + SAFETY_LAG 기준 미달 행 수 (설계 §3.1 선출식 그대로, 읽기만)
  const cutoff = Date.now() - 90 * 86400_000;
  const agedOut = rows.filter((r) => Date.parse(r.created_at) < cutoff).length;
  console.log(`\n90일 경과 행(콜드 후보 상한, 키 보전 예외 미적용): ${agedOut} / ${rows.length} (${rows.length ? (100 * agedOut / rows.length).toFixed(1) : 0}%)`);
  console.log('=== 조사 종료 (쓰기 0건) ===');
}

main().catch((e) => { console.error('조사 실패:', e); process.exit(1); });
