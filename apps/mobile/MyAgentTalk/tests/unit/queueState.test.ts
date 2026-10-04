// 질문 큐 상태 정규화 — 스트립 폐기(t_3c882443) 후 살아남는 경계만 검증 (buildQueueStrip 테스트는 제거)
// 마커/트래커가 Consuming하는 normalizeQueueItems/queueItemForMessage 계약이 여기걸린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQueueItems } from '../../src/lib/chatLogic';

test('normalizeQueueItems — 수치경계(t_f70bc767): NaN position은 배열 순서로 강등, 정렬 왜곡 없음', () => {
  // typeof 단독 게이트는 NaN을 통과시켜 sort 비교자(a.position - b.position)를 NaN화 → 순서 침묵 왜곡.
  // 유한값만 인정: NaN 행은 배열 인덱스로 강등되어도 나머지 유한 position 순서와 일관되게 정렬된다.
  const queue = normalizeQueueItems([
    { id: 'qNaN', content: '고장 행', status: 'pending', position: NaN },
    { id: 'q1', content: '첫 끼어들기', status: 'pending', position: 1 },
    { id: 'q3', content: '세 번째 끼어들기', status: 'pending', position: 3 },
  ]);
  assert.ok(queue.every((q) => Number.isFinite(q.position)), 'position은 전부 유한값');
  assert.deepEqual(queue.map((q) => q.id), ['qNaN', 'q1', 'q3'], 'NaN→인덱스 0 강등 후 안정 정렬(유한값 순서 보존)');
  // Infinity/문자열/누락도 유한값이 아니면 모두 배열 순서로 강등
  const rough = normalizeQueueItems([
    { id: 'r1', content: 'a', status: 'pending', position: Infinity },
    { id: 'r2', content: 'b', status: 'pending', position: '2' },
    { id: 'r3', content: 'c', status: 'pending' },
    { id: 'r4', content: 'd', status: 'pending', position: 0 },
  ]);
  assert.ok(rough.every((q) => Number.isFinite(q.position)));
  assert.deepEqual(rough.map((q) => q.position), [0, 0, 1, 2], 'r4(유한 0) 최우선, 나머지는 배열 순서 강등');
});
