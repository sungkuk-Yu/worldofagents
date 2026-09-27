// 질문 큐 체크포인트 / 후속 질문  순수 로직 (t_1797f432 ②③ — 백엔드 t_344e047a 계약)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQueueItems, queueItemForMessage, normalizeSuggestedQuestions, ChatMessage,
} from '../../src/lib/chatLogic';

const msg = (over: Partial<ChatMessage>): ChatMessage =>
  ({ id: 'm1', role: 'user', content: '질문입니다', turnIndex: 1, ...over }) as ChatMessage;

test('normalizeQueueItems — 위치 정렬 + 상태 폴백 + 형태 불량 행 스킵', () => {
  const out = normalizeQueueItems([
    { id: 'b', content: '두 번째', status: 'answered', position: 2 },
    { id: 'a', content: '첫 번째', status: 'weird', position: 1 },
    { id: 'c', content: '세 번째', status: 'skipped', position: 3 },
    { content: 'id 없음' }, 'string', null,
  ]);
  assert.deepEqual(out.map((q) => q.id), ['a', 'b', 'c']);
  assert.equal(out[0].status, 'pending', '미등록 상태는 pending 폴백');
});

test('normalizeQueueItems — 배열 아니면 조용히 빈 배열 (계약 미확정 방어)', () => {
  for (const bad of [undefined, null, {}, 'x', 42]) assert.deepEqual(normalizeQueueItems(bad), []);
});

test('queueItemForMessage — message_id 우선, 없으면 공백 정규화 content 대조', () => {
  const queue = normalizeQueueItems([
    { id: 'q1', content: '캐치 못 한   발화\n부분', status: 'pending', position: 1, message_id: 'm9' },
    { id: 'q2', content: '그냥 텍스트', status: 'answered', position: 2 },
  ]);
  assert.equal(queueItemForMessage(queue, msg({ id: 'm9', content: '완전히 다른 원문' }))?.id, 'q1');
  assert.equal(queueItemForMessage(queue, msg({ id: 'm1', content: '그냥   텍스트 ' }))?.id, 'q2', '공백/트림 정규화로 매칭');
  assert.equal(queueItemForMessage(queue, msg({ id: 'm2', content: '미등록 발화' })), undefined);
  assert.equal(queueItemForMessage([], msg({})), undefined);
});

test('normalizeSuggestedQuestions — 2~3개 계약, text 없는 행 제외, 초과분 절단', () => {
  const out = normalizeSuggestedQuestions([
    { id: 's1', text: ' 후속 1 ', locale: 'ko' },
    { text: 'id 없는 행' },
    { id: 's2', text: '후속 2' },
    { id: 's3', text: '후속 3' },
    { id: 's4', text: '네 번째는 버림' },
    { id: 's5' }, 42, 'x',
  ]);
  assert.deepEqual(out.map((q) => q.text), ['후속 1', 'id 없는 행', '후속 2']);
  assert.equal(out[0].locale, 'ko');
  assert.equal(out[1].id, 'sq-1', 'id 없으면 순번 합성');
});

test('normalizeSuggestedQuestions — 비배열/미배열 payload 모두 [] (생성 실패=체감 0)', () => {
  for (const bad of [undefined, null, {}, 'x']) assert.deepEqual(normalizeSuggestedQuestions(bad), []);
});
