// 사이드체인 아카이브 스토어 단위 테스트 (t_00fe9b0f — 닫기=아카이브 시맨틱, 물리 삭제 없음).
// node --test 환경에 localStorage가 없으므로 인메모리 스텁을 주입한다(draftStore 미사용 경로의 안전도 겸함:
// 스토어 부재 시 memoryFallback으로 동작해야 한다 — 그 케이스는 스텁 제거 후 별도 검증).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainArchive } from '../../src/lib/chainArchive';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
}

test('bind/close/reopen — 세션 스코프 영속 + 상태 회복(영구 아카이브 아님)', () => {
  const ls = memoryStorage();
  (globalThis as { localStorage?: Storage }).localStorage = ls;
  try {
    chainArchive.bind('s1');
    assert.equal(chainArchive.isClosed('a'), false);
    chainArchive.close('a');
    assert.equal(chainArchive.isClosed('a'), true);
    assert.ok(JSON.parse(ls.getItem('at-chain-archive-s1') ?? '{}').a, 'close 시각이 직렬화 저장');
    chainArchive.reopen('a');
    assert.equal(chainArchive.isClosed('a'), false);
    assert.equal(ls.getItem('at-chain-archive-s1'), null, '전부 재개방하면 키 삭제');
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test('세션 전환 — 이전 세션 닫힘이 새 세션에 붙지 않는다(스위치 격리)', () => {
  const ls = memoryStorage();
  (globalThis as { localStorage?: Storage }).localStorage = ls;
  try {
    chainArchive.bind('sA');
    chainArchive.close('x');
    chainArchive.bind('sB');
    assert.equal(chainArchive.isClosed('x'), false, 'sB는 빈 아카이브');
    chainArchive.bind('sA');
    assert.equal(chainArchive.isClosed('x'), true, 'sA 복귀 시 복구(물리 삭제 없음)');
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test('closeMany/undo — 일괄 닫기 스냅샷 복원(3s undo 계약의 저장측)', () => {
  const ls = memoryStorage();
  (globalThis as { localStorage?: Storage }).localStorage = ls;
  try {
    chainArchive.bind('s1');
    chainArchive.reopen('nothing'); // 없는 키 reopen은 no-op 안전
    const snap = chainArchive.closeMany(['a', 'b']);
    assert.deepEqual(Object.keys(chainArchive.get()).sort(), ['a', 'b']);
    chainArchive.undo(snap);
    assert.deepEqual(chainArchive.get(), {});
  } finally {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test('스토어 부재(네이티브) — 조용히 메모리 폴백, 바인딩 해제 시 초기화', () => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  chainArchive.bind('sM');
  chainArchive.close('q');
  assert.equal(chainArchive.isClosed('q'), true, 'memoryFallback으로 상태 유지');
  chainArchive.bind('sM2');
  assert.equal(chainArchive.isClosed('q'), false, '다른 세션 메모리는 격리');
  chainArchive.bind(null);
  assert.deepEqual(chainArchive.get(), {}, 'null 바인딩 = 빈 지도(데모 격리)');
});
