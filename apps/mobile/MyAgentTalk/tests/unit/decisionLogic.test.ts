import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDecisionItems } from '../../src/lib/chatLogic';

/** t_2de069f3 결정 인박스 — REST/WS 페이로드 정규화 로직 (snake_case → camelCase) */
test('normalizeDecisionItems: 배열 아님 → 빈 배열', () => {
  assert.deepEqual(normalizeDecisionItems(null), []);
  assert.deepEqual(normalizeDecisionItems('x'), []);
  assert.deepEqual(normalizeDecisionItems(42), []);
});

test('normalizeDecisionItems: id·question 없는 행 제거', () => {
  const out = normalizeDecisionItems([
    { id: 'd1', question: 'A안으로 진행할까요?' },
    { question: 'id 없음' },
    { id: 'd2' },
    'garbage',
    null,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'd1');
  assert.equal(out[0].question, 'A안으로 진행할까요?');
});

test('normalizeDecisionItems: snake_case → camelCase 매핑', () => {
  const out = normalizeDecisionItems([
    {
      id: 'd9',
      thread_id: 't1',
      source_message_id: 'm7',
      agent_id: 'ag1',
      question: '어느 안?',
      options: ['A', 'B', 3],
      status: 'pending',
      created_at: '2026-10-21T12:00:00Z',
    },
  ]);
  assert.equal(out.length, 1);
  const d = out[0];
  assert.equal(d.threadId, 't1');
  assert.equal(d.sourceMessageId, 'm7');
  assert.equal(d.agentId, 'ag1');
  assert.deepEqual(d.options, ['A', 'B']);
  assert.equal(d.createdAt, '2026-10-21T12:00:00Z');
});

test('normalizeDecisionItems: 알 수 없는 status → pending, 유효 status 보존', () => {
  const out = normalizeDecisionItems([
    { id: 'd1', question: 'q1', status: 'weird' },
    { id: 'd2', question: 'q2', status: 'answered', answer: 'A안' },
    { id: 'd3', question: 'q3' },
  ]);
  assert.equal(out[0].status, 'pending');
  assert.equal(out[1].status, 'answered');
  assert.equal(out[1].answer, 'A안');
  assert.equal(out[2].status, 'pending');
});
