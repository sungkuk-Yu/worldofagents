import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenFingerprint, sessionCacheKey, normalizeSnapshot, writeSessionCache, readSessionCache, clearSessionCache, SESSION_CACHE_MAX_ROWS, SESSION_CACHE_MAX_BYTES } from '../../src/lib/sessionCache';

// localStorage 모의 (draftStore.test와 동일 하네스 — 사모드는 null 스토리지 경로로 검증)
function mockStorage(): Map<string, string> & Storage {
  const map = new Map<string, string>();
  return Object.assign(map, {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  }) as unknown as Map<string, string> & Storage;
}

const sess = (id: string) => ({ id, agent_id: 'a', status: 'active' as const, title: 'T' + id });
const agent = (id: string) => ({ id, name: 'N' + id });

test('t710 ① 토큰 지문 — 계정 격리: 다른 토큰은 다른 키, 동일 토큰은 동일 키', () => {
  const f1 = tokenFingerprint('aaa.bbb.ccc1');
  const f2 = tokenFingerprint('aaa.bbb.ccc2');
  assert.notEqual(f1, f2, '서명 세그먼트 다르면 지문도 달라야 함(계정 격리)');
  assert.equal(sessionCacheKey('aaa.bbb.ccc1'), 'at-sesslist-v1.' + f1, '키 = 프리픽스+지문');
});

test('t710 ①b 세그먼트 없는 토큰도 결정적 지문', () => {
  assert.equal(tokenFingerprint('opaque'), tokenFingerprint('opaque'));
  assert.notEqual(tokenFingerprint('opaquf'), tokenFingerprint('opaque'));
});

test('t710 ② 라운드트립 — write→read 스냅샷 복원, 파손/빈 캐시는 null', () => {
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  g.localStorage = mockStorage();
  try {
    writeSessionCache('t.ok', [sess('s1'), sess('s2')], [agent('a1')]);
    const snap = readSessionCache('t.ok');
    assert.ok(snap);
    assert.equal(snap!.v, 1);
    assert.deepEqual(snap!.sessions.map((s) => s.id), ['s1', 's2']);
    assert.equal(snap!.agents[0].id, 'a1');
    assert.equal(readSessionCache('t.other'), null, '계정 다르면 읽히지 않는다');
    assert.equal(readSessionCache(null), null);
    assert.equal(readSessionCache(''), null);
    (g.localStorage as unknown as Map<string, string>).set(sessionCacheKey('t.bad'), '{trunc');
    assert.equal(readSessionCache('t.bad'), null, 'JSON 파손 = 미스');
  } finally { g.localStorage = prev; }
});

test('t710 ③ 정규화 — 비배열/행 형태 위반 절두, 50행 상한, 20KB 초과 파기', () => {
  assert.equal(normalizeSnapshot(null, []), null);
  assert.equal(normalizeSnapshot([sess('a'), { no_id: 1 }, sess('b')], [agent('x')])!.sessions.length, 2);
  const many = Array.from({ length: 80 }, (_, i) => sess('s' + i));
  assert.equal(normalizeSnapshot(many, many)!.sessions.length, SESSION_CACHE_MAX_ROWS);
  // 20KB 초과 직렬화 → writeSessionCache는 조용히 파기(쓰지 않음)
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  g.localStorage = mockStorage();
  try {
    const huge = Array.from({ length: SESSION_CACHE_MAX_ROWS }, (_, i) => ({ ...sess('s' + i), title: 'x'.repeat(1000) }));
    assert.ok(JSON.stringify(normalizeSnapshot(huge, huge)).length > SESSION_CACHE_MAX_BYTES, '프리조건: 페이로드가 상한 초과');
    writeSessionCache('t.huge', huge, huge);
    assert.equal((g.localStorage as unknown as Map<string, string>).size, 0, '초과 페이로드는 저장되지 않는다');
  } finally { g.localStorage = prev; }
});

test('t710 ④ 스토리지 부재/토큰 없음 — throw 없는 no-op, read 미스', () => {
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  delete g.localStorage;
  try {
    writeSessionCache('t', [sess('s')], [agent('a')]); // no-op
    assert.equal(readSessionCache('t'), null);
    clearSessionCache('t'); // no-op (throw 금지)
  } finally { g.localStorage = prev; }
});

test('t710 ⑤ clearSessionCache — 자기 계정 키만 제거', () => {
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  g.localStorage = mockStorage();
  try {
    writeSessionCache('t.a', [sess('s')], [agent('a')]);
    writeSessionCache('t.b', [sess('s')], [agent('a')]);
    clearSessionCache('t.a');
    assert.equal(readSessionCache('t.a'), null);
    assert.ok(readSessionCache('t.b'), '남의 계정 스냅샷은 건드리지 않는다');
  } finally { g.localStorage = prev; }
});
