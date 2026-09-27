// 상단 질문 큐 스트립 순수 로직 (t_2f45ccb1) — 서버 큐 우선 + 메시지 로컬 유도 폴백
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueueStrip, normalizeQueueItems, ChatMessage } from '../../src/lib/chatLogic';

const user = (over: Partial<ChatMessage>): ChatMessage =>
  ({ id: 'u1', role: 'user', content: '질문 A', turnIndex: 0, ...over }) as ChatMessage;
const agent = (over: Partial<ChatMessage>): ChatMessage =>
  ({ id: 'a1', role: 'agent', content: '답변 A', turnIndex: 1, sourceNeuron: 'answer', ...over }) as ChatMessage;

test('buildQueueStrip — 질문↔답변 페어링: 답변 있으면 answered, 없으면 pending', () => {
  const strip = buildQueueStrip([
    user({ id: 'u1', content: '첫 질문', turnIndex: 0 }),
    agent({ id: 'a1', turnIndex: 1 }),
    user({ id: 'u2', content: '두 번째 질문', turnIndex: 2 }),
  ], []);
  assert.deepEqual(strip.map((s) => [s.id, s.status]), [['u1', 'answered'], ['u2', 'pending']]);
  assert.equal(strip[0].jumpMessageId, 'a1', 'answered 칩은 답변 카드로 점프');
  assert.equal(strip[1].jumpMessageId, 'u2', 'pending 칩은 질문 카드로 점프');
});

test('buildQueueStrip — 공감 행은 답변으로 치지 않는다, 답글/시스템은 라인에 서지 않는다', () => {
  const strip = buildQueueStrip([
    user({ id: 'u1', turnIndex: 0 }),
    agent({ id: 'e1', sourceNeuron: 'empathy', content: '공감 발화', turnIndex: 1 }),
    agent({ id: 'a1', turnIndex: 2 }),
    user({ id: 'r1', role: 'user', content: '답글', turnIndex: 3, parentMessageId: 'a1' }),
    { id: 's1', role: 'system', content: '알림', turnIndex: 4 } as ChatMessage,
  ], []);
  assert.deepEqual(strip.map((s) => s.id), ['u1']);
  assert.equal(strip[0].status, 'answered');
  assert.equal(strip[0].jumpMessageId, 'a1', '공감 제외 첫 답변 매칭');
});

test('buildQueueStrip — 낙관(pending) 행과 서버 확정 행 공존 시 서버 행 우선, 본문+첨부 없는 빈 행 제외', () => {
  const strip = buildQueueStrip([
    user({ id: 'u1', turnIndex: 0 }),
    agent({ id: 'a1', turnIndex: 1 }),
    user({ id: 'local-9', content: '방금 보낸 질문', turnIndex: 2, pending: true }),
    user({ id: 'u2', content: '   ', turnIndex: 3 }),
  ], []);
  assert.deepEqual(strip.map((s) => s.id), ['u1', 'local-9'], 'pending user=answered 아님(pending 상태)');
  assert.equal(strip[1].status, 'pending');
});

test('buildQueueStrip — 서버 큐 스냅샷은 상태 우선(skipped는 서버 전용 정보), message_id 매칭', () => {
  const queue = normalizeQueueItems([
    { id: 'q1', content: '질문 A', status: 'skipped', position: 1, message_id: 'u1' },
  ]);
  const strip = buildQueueStrip([user({ id: 'u1' }), agent({ id: 'a1' })], queue);
  assert.deepEqual(strip.map((s) => [s.id, s.status]), [['q1', 'skipped']], '서버 행 id가 칩 key가 된다');
});

test('buildQueueStrip — 서버에만 있는 행(아직 messages 밖)은 원문으로 보조 칩, position 순', () => {
  const queue = normalizeQueueItems([
    { id: 'q2', content: '두 번째 끼어들기', status: 'pending', position: 2 },
    { id: 'q1', content: '첫 끼어들기', status: 'pending', position: 1 },
  ]);
  const strip = buildQueueStrip([user({ id: 'u1', content: '화면의 질문', turnIndex: 0 })], queue);
  assert.deepEqual(strip.map((s) => [s.id, s.text]), [['u1', '화면의 질문'], ['q1', '첫 끼어들기'], ['q2', '두 번째 끼어들기']]);
});

test('buildQueueStrip — 첨부 전용 질문(본문 빈)도 라인에 선다', () => {
  const strip = buildQueueStrip([
    user({ id: 'u1', content: '', turnIndex: 0, pendingAttachments: [{ localId: 'p1', name: 'photo.png', uri: 'file:///p', type: 'image/png', status: 'done' }] }),
  ], []);
  assert.equal(strip.length, 1);
  assert.equal(strip[0].text, '', '본문 없음 → 화면에서 사진 질문 라벨 대체 렌더');
});
