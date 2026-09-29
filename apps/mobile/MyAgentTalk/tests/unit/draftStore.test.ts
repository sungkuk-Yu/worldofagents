import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSaver, readDraft, writeDraft, clearDraft } from '../../src/lib/draftStore';

// localStorage 모의 (draftStore는 globalThis.localStorage 사용 — node 하네스에 없으면 no-op 경로 검증)
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

test('④ 드래프트 roundtrip — room별 키, 빈 텍스트=삭제', () => {
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  g.localStorage = mockStorage();
  try {
    writeDraft('room-a', '미완성 문장');
    assert.equal(readDraft('room-a'), '미완성 문장');
    assert.equal(readDraft('room-b'), '', '다른 room은 격리');
    clearDraft('room-a');
    assert.equal(readDraft('room-a'), '');
    writeDraft('room-a', ''); // 빈 값 쓰기도 삭제 동일
    assert.equal((g.localStorage as unknown as Map<string, string>).has('at-draft-room-a'), false, '키 자체가 제거(원자적 소거)');
  } finally { g.localStorage = prev; }
});

test('④ 드래프트 스토리지 부재 — throw 없이 no-op, read는 빈 문자열', () => {
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  delete g.localStorage;
  try {
    writeDraft('r', '텍스트');
    assert.equal(readDraft('r'), '');
  } finally { g.localStorage = prev; }
});

test('④ 디바운스 saver — 마지막 입력만 저장, clearNow는 대기 저장 폐기(유령 드래프트 금지)', async () => {
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  const store = mockStorage();
  g.localStorage = store;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const saver = createDraftSaver(30);
    saver.schedule('s1', 'a');
    saver.schedule('s1', 'ab');
    saver.schedule('s1', 'abc');
    assert.equal(store.get('at-draft-s1'), undefined, '디바운스 전 즉시 쓰기 없음');
    await sleep(80);
    assert.equal(store.get('at-draft-s1'), 'abc', '마지막 입력만 저장');
    saver.schedule('s1', 'abcdef');
    saver.clearNow('s1'); // 발송: 대기 중인 'abcdef' 저장이 clear 후 재발화하면 안 된다
    await sleep(80);
    assert.equal(store.has('at-draft-s1'), false, 'clearNow 후 낡은 스케줄 유실(원자적)');
    saver.schedule('s1', '재입력');
    saver.flush(); // 화면 떠남: 즉시 flush
    assert.equal(store.get('at-draft-s1'), '재입력');
  } finally { g.localStorage = prev; }
});
