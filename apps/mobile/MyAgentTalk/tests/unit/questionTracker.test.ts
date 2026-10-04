// 내 질문 트래커 파생 로직 단위 테스트 (t_fd869e5b, 대표님 10/4 확정 레이아웃)
// ① 접수 확인(서버 확정 vs 낙관) ② 4단계(접수됨→이해 확인 중→답변 준비 중→완료) + 확인 필요/오류
// ③ 답글 수(슬랙식) ④ 24h 지난 완료 자동 축약 — 전부 기존 messages/pending/streams/queue 스냅샷만으로 판정(신규 API 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestionTracker, TRACKER_STAGE_COUNT, TRACKER_MAX_ROWS } from '../../src/lib/questionTracker';
import type { ChatMessage } from '../../src/lib/chatLogic';
import type { PendingReplyItem, QueueItem } from '../../src/lib/chatLogic';

const NOW = Date.UTC(2026, 9, 4, 12);
const H = 60 * 60 * 1000;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const user = (id: string, turn: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'user', content: `질문 ${id}`, turnIndex: turn, createdAt: at(30 * 1000), ...over }) as ChatMessage;
const agent = (id: string, turn: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'agent', content: `답 ${id}`, turnIndex: turn, createdAt: at(20 * 1000), ...over }) as ChatMessage;
const empathy = (id: string, turn: number, over: Partial<ChatMessage> = {}): ChatMessage =>
  agent(id, turn, { sourceNeuron: 'empathy', content: `재질문 ${id}`, ...over });

test('트래커 — 완료/진행/낙관/실패 4단계 + 접수 구분', () => {
  const messages: ChatMessage[] = [
    user('u1', 0), agent('a1', 1),                       // 답변 행 있음 → 완료
    user('u2', 2), empathy('e2', 3),                     // 재질문 미해소 → 이해 확인 중 + 확인 필요
    user('u3', 4), agent('s3', 5, { status: 'streaming' }), // 스트리밍 → 답변 준비 중
    user('u4', 6, { pending: true }),                    // 낙관 행 → 접수 안 됨(confirmed=false), stage 0
    user('u5', 7, { status: 'failed' }),                 // 실패 → failed 플래그
  ];
  const pending: PendingReplyItem[] = [{ messageId: 'e2', turnIndex: 3, excerpt: '재질문 e2', replyKind: 'yesno' }];
  const { rows, collapsedDone } = buildQuestionTracker(messages, pending, [], { now: NOW });
  assert.equal(collapsedDone, 0);
  assert.deepEqual(rows.map((r) => r.messageId), ['u1', 'u2', 'u3', 'u4', 'u5']);
  const [r1, r2, r3, r4, r5] = rows;
  assert.equal(r1.stage, 3); assert.ok(r1.confirmed && !r1.failed && !r1.needsConfirm);
  assert.equal(r2.stage, 1); assert.ok(r2.needsConfirm, '예/아니오 재질문 대기 = 확인 필요 강조');
  assert.equal(r3.stage, 2); assert.ok(r3.confirmed);
  assert.equal(r4.stage, 0); assert.equal(r4.confirmed, false, '낙관 카드는 서버 확정과 구분');
  assert.equal(r5.failed, true);
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4, 5], '질문 순번 = 상단 스트립과 동일 체계');
  assert.equal(TRACKER_STAGE_COUNT, 4);
});

test('트래커 — 확인응답(예)은 顶级 질문이 아니다: 질문 수 불변 + 원 질문 stage2 전진 (t_0e03e405)', () => {
  const messages: ChatMessage[] = [user('u1', 0), empathy('e1', 1), user('ack1', 2, { content: '예' })];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.equal(rows.length, 1, "'예' 발화는 원 질문의 하위 이벤트 — 새 행 NOT (질문 수 = 顶级 질문 수 불변식)");
  assert.equal(rows[0].messageId, 'u1');
  assert.equal(rows[0].needsConfirm, false, '확인 발화(예)로 재질문 해소 — 확인 필요 배지 소멸');
  assert.equal(rows[0].stage, 2, '해소된 재질문 → 답변 준비 중 (ackChips와 동일 전제: 확인 후 answer 직결)');
});

test('트래커 — 재질문 생성 후에도 질문 수 1 유지 (복명복창/재질문 행 자체는 비계수)', () => {
  const messages: ChatMessage[] = [user('u1', 0), empathy('e1', 1), empathy('e2', 2), empathy('e3', 3)];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.equal(rows.length, 1, '에파시 3행이 생겨도 질문 행은 원 질문 1개');
  assert.equal(rows[0].stage, 1);
  assert.equal(rows[0].needsConfirm, true, '미해소 재질문 = 확인 필요 (원 질문에 흡수)');
});

test('트래커 — 오탐 금지: empathy 없는 맨 발화 예/아니요·' + "'예를 들어…'류는 顶级 유지", () => {
  const messages: ChatMessage[] = [
    user('u1', 0, { content: '예' }),                       // 공감 윈도우 없는 단독 '예' → 링크 안 됨 (질문으로 남음)
    user('u2', 1, { content: '예를 들어 아침 루틴 정리법 알려줘' }), // '예' 시작 진짜 질문 → 顶级
    user('u3', 2, { content: '아니요 그거 말고 어젯밤 통화 내용' }), // 부분 일치(정확-일치 아님) → 顶级
  ];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.deepEqual(rows.map((r) => r.messageId), ['u1', 'u2', 'u3'], '3종 모두 질문 행 유지 (구조 신호 없으면 흡수 금지)');
});

test('트래커 — 답변이 확인응답 뒤 도착하면 원 질문 완료 전파 (11/12 부풀림·윈도우 절단 봉인)', () => {
  const messages: ChatMessage[] = [
    user('u1', 0), empathy('e1', 1), user('ack1', 2, { content: '예' }), agent('ans1', 3),
    user('u2', 4), empathy('e2', 5), user('ack2', 6, { content: '아니요', replyToId: 'e2' }), agent('ans2', 7),
  ];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.equal(rows.length, 2, 'ack 행 2건 흡수 → 질문 2개만');
  assert.equal(rows[0].stage, 3, 'ans1이 u1 윈도우에 귀속 (구현 전: ack1이 창을 끊어 stage2 고착 실측)');
  assert.equal(rows[1].stage, 3, 'replyToId 구조 신호 ack2 흡수 + ans2 귀속');
  assert.equal(rows[1].needsConfirm, false, '강등 pending 스냅샷이 있어도 확인응답 발화가 우선');
});

test('트래커 — 구조 신호 우선: reply_to가 empathy면 본문 길이 무관 흡수', () => {
  const messages: ChatMessage[] = [
    user('u1', 0), empathy('e1', 1),
    user('ack1', 2, { content: '예를 들어도 되는 건 아니고, 그냥 맞다는 뜻이에요', replyToId: 'e1' }),
  ];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.equal(rows.length, 1, "리플라이 칩을 단 장문 확인은 확인으로 취급 (대표님 오탐 금지 조항과 정합)");
  assert.equal(rows[0].stage, 2);
});

test('트래커 — 연속 확인 체인 [empathy][예][네]는 새 질문 NOT (백엔드 previousTurnWasConfirmation 미러)', () => {
  const messages: ChatMessage[] = [user('u1', 0), empathy('e1', 1), user('a1', 2, { content: '예' }), user('a2', 3, { content: '네' })];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, 2);
});

test('트래커 — 확인응답 흡수 후에도 낙관/실패/상한 채번은 顶级 기준', () => {
  const messages: ChatMessage[] = [
    user('u1', 0), empathy('e1', 1), user('ack1', 2, { content: '예' }),
    user('u2', 3, { pending: true }),
    user('u3', 4, { status: 'failed' }),
  ];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3], 'ack 흡수 후 재채번 — 노이즈 없음 (14번 예 계열 원천 차단)');
  assert.deepEqual(rows.map((r) => r.messageId), ['u1', 'u2', 'u3']);
});

test('트래커 — 활성 stream은 마지막 질문에만 귀속, answer.done 행이면 그걸로 완료', () => {
  const messages: ChatMessage[] = [user('u1', 0), user('u2', 1)];
  const streams = [{ runId: 'r1', text: '...', index: 0, quip: 'quip.thinking', done: false }];
  const { rows } = buildQuestionTracker(messages, [], streams, { now: NOW });
  assert.equal(rows[0].stage, 0, '이전 질문은 스트림과 무관');
  assert.equal(rows[1].stage, 2, '마지막 질문 = 지금 실행 중');
});

test('트래커 — 답글 체인은 메인 윈도우 제외, replyCount로만 반영', () => {
  const messages: ChatMessage[] = [
    user('u1', 0), agent('a1', 1),
    user('r1', 2, { parentMessageId: 'u1', rootMessageId: 'u1' }),
    agent('r2', 3, { parentMessageId: 'u1', rootMessageId: 'u1' }),
    user('u2', 4),
  ];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.equal(rows[0].stage, 3);
  assert.equal(rows[0].replyCount, 2, '답글 2행 → 슬랙식 답글 수');
  assert.equal(rows[1].stage, 0);
});

test('트래커 — thread_reply_count(서버 배지)만 있어도 답글 수 반영', () => {
  const messages: ChatMessage[] = [user('u1', 0, { threadReplyCount: 5 }), agent('a1', 1)];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.equal(rows[0].replyCount, 5);
});

test('트래커 — 24h 지난 완료는 자동 축약, 미완료/확인 필요는 유지 (목록 폭발 방지)', () => {
  const messages: ChatMessage[] = [
    user('old', 0, { createdAt: at(25 * H) }), agent('olda', 1, { createdAt: at(25 * H) }),
    user('new', 2, { createdAt: at(1 * H) }), agent('newa', 3, { createdAt: at(1 * H) }),
    user('wait', 4, { createdAt: at(30 * H) }), // 완료 아님 — 오래 걸려도 축약 대상 아니다
    empathy('waite', 5, { createdAt: at(30 * H) }),
  ];
  const { rows, collapsedDone } = buildQuestionTracker(messages, [], [], { now: NOW });
  assert.equal(collapsedDone, 1, '24h 지난 u1만 접힘');
  assert.deepEqual(rows.map((r) => r.messageId), ['new', 'wait']);
});

test('트래커 — 상한 초과분은 오래된 것부터 접고 개수 합산', () => {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < 16; i += 1) {
    msgs.push(user(`u${i}`, i * 2, { createdAt: at((16 - i) * 1000) }));
    msgs.push(agent(`a${i}`, i * 2 + 1, { createdAt: at((16 - i) * 1000) }));
  }
  const { rows, collapsedDone } = buildQuestionTracker(msgs, [], [], { now: NOW });
  assert.equal(rows.length, TRACKER_MAX_ROWS);
  assert.equal(collapsedDone, 16 - TRACKER_MAX_ROWS);
  assert.equal(rows[0].messageId, 'u4', '오래된 4건이 접힌 쪽 — 최신 maxRows만 유지');
  assert.equal(rows[rows.length - 1].messageId, 'u15');
});

test('트래커 — 서버 큐 스냅샷 우선: messages에 답변이 없어도 answered 확정이면 완료', () => {
  const messages: ChatMessage[] = [user('u1', 0), user('u2', 1)];
  const queue: QueueItem[] = [
    { id: 'q1', content: '질문 u1', status: 'answered', position: 0, messageId: 'u1' },
    { id: 'q2', content: '질문 u2', status: 'pending', position: 1, messageId: 'u2' },
  ];
  const { rows } = buildQuestionTracker(messages, [], [], { now: NOW, queue });
  assert.equal(rows[0].stage, 3, '서버 큐 answered → 국지 추정 stage 0을 완료로 승격');
  assert.equal(rows[1].stage, 0, '큐 pending은 신뢰 불가 — 강등 근거로 쓰지 않는다');
});

test('트래커 — 빈 messages / 잘못된 시간 경계 (NaN 침투 금지, 수치경계 규율)', () => {
  const { rows, collapsedDone } = buildQuestionTracker([], [], [], { now: NOW });
  assert.deepEqual(rows, []); assert.equal(collapsedDone, 0);
  const broken = [user('u1', 0, { createdAt: 'not-a-date' })] as ChatMessage[];
  const r = buildQuestionTracker(broken, [], [], { now: NOW });
  assert.equal(r.rows[0].lastActivityMs, 0);
  assert.equal(r.collapsedDone, 0, '시각 파싱 실패 항목은 축약 대상 아님(보수적 유지)');
});
