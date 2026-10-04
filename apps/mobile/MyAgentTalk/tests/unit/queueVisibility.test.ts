// 진행 중 질문 전역 큐 파생 (t_140ecc15) — queueVisibility 순수 로직 계약 테스트.
// 대표님 10/4: "밀려 있는 질문이 있는지 배지 0으로 확인" — pending/stop 수, 대기 순번, 앞 질문 상태,
// 서버 큐 우선, 정체(stopped) 판정 창이 배지·리스트의 진실인지 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveQueueView, queueBadgeTone, queueBadgeCount, queueAheadKey, queueWaitDurationUnit,
  QUEUE_STOPPED_MS,
} from '../../src/lib/queueVisibility';
import type { ChatMessage, QueueItem, StreamingAnswer } from '../../src/lib/chatLogic';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const user = (id: string, turn: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'user', content: `Q-${id}`, turnIndex: turn, createdAt: ago(60_000), status: 'sent', ...over } as ChatMessage);
const agent = (id: string, turn: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'agent', content: `A-${id}`, turnIndex: turn, createdAt: ago(30_000), sourceNeuron: 'answer', ...over } as ChatMessage);
const streamMsg = (runId: string, turn: number): ChatMessage =>
  ({ id: `stream-${runId}`, role: 'agent', content: '', turnIndex: turn, status: 'streaming', sourceNeuron: 'answer', runId, createdAt: ago(10_000) } as unknown as ChatMessage);
const liveStream = (runId: string): StreamingAnswer => ({ runId, text: '중...', index: 0, quip: 'quip.default', done: false });
const qItem = (id: string, msgId: string, status: QueueItem['status'], position: number): QueueItem =>
  ({ id, content: `Q-${msgId}`, status, position, messageId: msgId });

test('빈 상태 — 밀린 0건: 배지 none, 카운트 0', () => {
  const v = deriveQueueView([user('u1', 0), agent('a1', 1)], [], [], { now: NOW });
  assert.equal(v.backlogCount, 0);
  assert.equal(v.pendingCount, 0);
  assert.equal(v.stoppedCount, 0);
  assert.equal(queueBadgeTone(v), 'none');
});

test('답변 중+대기 2 · 멈춤 1 — 주황 수 실측과 빨강 승격', () => {
  // u1(멈춤: 실패) / u2(답변 중: 스트림 소유) / u3(대기)
  const messages = [
    user('u1', 0, { status: 'failed', pending: false }),
    user('u2', 2), streamMsg('r2', 3),
    user('u3', 4),
  ];
  const v = deriveQueueView(messages, [liveStream('r2')], [], { now: NOW });
  assert.equal(v.backlogCount, 3);
  assert.equal(v.pendingCount, 2); // u2 answering + u3 waiting (failed는 stop 전용)
  assert.equal(v.stoppedCount, 1);
  assert.equal(queueBadgeTone(v), 'stop'); // stop≥1 = 빨강
  assert.deepEqual(v.items.map((i) => i.status), ['stopped', 'answering', 'waiting']);
  assert.deepEqual(v.items.map((i) => i.position), [1, 2, 3]);
  // u3의 앞 = answering → '앞 질문 답변 중'
  assert.equal(queueAheadKey(v, v.items[2]), 'queueView.aheadAnswering');
  assert.equal(queueAheadKey(v, v.items[0]), undefined); // stopped 선두는 ahead 문구 없음
});

test('서버 큐 우선: answered 스냅샷 = 해소(백로그에서 제거)', () => {
  const messages = [user('u1', 0), user('u2', 2)];
  const queue = [qItem('s1', 'u1', 'answered', 0), qItem('s2', 'u2', 'pending', 1)];
  const v = deriveQueueView(messages, [], queue, { now: NOW });
  assert.equal(v.backlogCount, 1);
  assert.equal(v.items[0].id, 'u2');
  assert.equal(v.items[0].fromServerQueue, true);
  assert.equal(v.items[0].queueId, 's2');
  // 스트림 없이 선두 = answering (라우팅/처리 진행 중 연출)
  assert.equal(v.items[0].status, 'answering');
});

test('정체 판정: 서버 pending이 stoppedMs 넘으면 멈춤(빨강), 창 이내면 유지(주황)', () => {
  const old = [user('u1', 0, { createdAt: new Date(NOW - QUEUE_STOPPED_MS - 1000).toISOString() })];
  const queue = [qItem('s1', 'u1', 'pending', 0)];
  const stuck = deriveQueueView(old, [], queue, { now: NOW });
  assert.equal(stuck.stoppedCount, 1);
  assert.equal(queueBadgeTone(stuck), 'stop');
  const fresh = deriveQueueView([user('u1', 0, { createdAt: new Date(NOW - 60_000).toISOString() })], [], queue, { now: NOW });
  assert.equal(fresh.stoppedCount, 0);
  assert.equal(fresh.pendingCount, 1);
  assert.equal(queueBadgeTone(fresh), 'warn'); // 주황 = 답변 중+대기
  // 활성 스트림이 붙으면 정체 판정 무시(살아있는 일)
  const live = deriveQueueView([...old, streamMsg('r1', 1)], [liveStream('r1')], queue, { now: NOW });
  assert.equal(live.items[0].status, 'answering');
});

test('큐 미매칭(local-only) 정체는 선두만 빨강 — 후방 대기 행은 오탐 금지', () => {
  const messages = [
    user('u1', 0, { createdAt: new Date(NOW - QUEUE_STOPPED_MS - 1000).toISOString() }),
    user('u2', 2, { createdAt: new Date(NOW - QUEUE_STOPPED_MS - 1000).toISOString() }),
  ];
  const v = deriveQueueView(messages, [], [], { now: NOW });
  assert.deepEqual(v.items.map((i) => i.status), ['stopped', 'waiting']);
  assert.equal(v.stoppedCount, 1);
  // u2의 앞은 stopped → '앞 질문 멈춤'
  assert.equal(queueAheadKey(v, v.items[1]), 'queueView.aheadStopped');
});

test('대기 순번은 서버 position 기준 재채번 — messages 도착 순과 무관', () => {
  const messages = [user('uA', 0), user('uB', 2)];
  // 서버는 uB가 먼저(0) 접수했다고 통보 → 화면 번호는 uB=1, uA=2
  const queue = [qItem('sB', 'uB', 'pending', 0), qItem('sA', 'uA', 'pending', 1)];
  const v = deriveQueueView(messages, [], queue, { now: NOW });
  assert.deepEqual(v.items.map((i) => [i.id, i.position]), [['uB', 1], ['uA', 2]]);
  assert.equal(queueAheadKey(v, v.items[1]), 'queueView.aheadAnswering'); // 앞(uB)=선두 answering
});

test('스킵도 해소: skipped 스냅샷은 백로그에서 제거 (마커와 동일 진리)', () => {
  const messages = [user('u1', 0)];
  const v = deriveQueueView(messages, [], [qItem('s1', 'u1', 'skipped', 0)], { now: NOW });
  assert.equal(v.backlogCount, 0);
});

test('서버 큐 전용 pending(messages 미도착)은 백로그 합류, 점프 불가 행', () => {
  const v = deriveQueueView([], [], [qItem('s9', 'ghost', 'pending', 0)], { now: NOW });
  assert.equal(v.backlogCount, 1);
  assert.equal(v.items[0].id, 's9');
  assert.equal(v.items[0].arrivalMs, 0);
});

test('waitingCount — 스트리밍 카드 점령 문구(답변 중 · 대기 n건)의 n', () => {
  const messages = [user('u1', 0), streamMsg('r1', 1), user('u2', 2), user('u3', 4)];
  const v = deriveQueueView(messages, [liveStream('r1')], [], { now: NOW });
  assert.equal(v.items[0].status, 'answering');
  assert.equal(v.waitingCount, 2);
});

test('대기시간 단위 — 초/분/시간 경계', () => {
  assert.deepEqual(queueWaitDurationUnit(59_999), { key: 'queueView.unitSec', value: 59 });
  assert.deepEqual(queueWaitDurationUnit(90_000), { key: 'queueView.unitMin', value: 1 });
  assert.deepEqual(queueWaitDurationUnit(2 * 3600_000), { key: 'queueView.unitHr', value: 2 });
});

test('감정/답글 행은 백로그 창에서 제외 — 루트 질문 윈도우만 (트래커 경계 동일)', () => {
  const messages = [
    user('u1', 0),
    agent('e1', 1, { sourceNeuron: 'empathy' }),          // 공감 = 해소 아님
    user('r1', 2, { parentMessageId: 'u1' }),              // 답글 = 루트 아님
    agent('a1', 3),                                        // 확정 답변 = 해소
  ];
  const v = deriveQueueView(messages, [], [], { now: NOW });
  assert.equal(v.backlogCount, 0);
});

test('배지 — tone은 stop 우선, 숫자는 전역 밀린 수(backlog)', () => {
  const stopOnly: QueueViewLike = { items: [], pendingCount: 0, stoppedCount: 2, backlogCount: 2, waitingCount: 0 };
  assert.equal(queueBadgeTone(stopOnly), 'stop');
  assert.equal(queueBadgeCount(stopOnly), 2);
  const mixed: QueueViewLike = { items: [], pendingCount: 3, stoppedCount: 1, backlogCount: 4, waitingCount: 2 };
  assert.equal(queueBadgeTone(mixed), 'stop'); // 멈춤 1 → 빨강 우선
  assert.equal(queueBadgeCount(mixed), 4);
});
type QueueViewLike = import('../../src/lib/queueVisibility').QueueView;
