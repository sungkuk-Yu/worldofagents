// 채팅 MVP 순수 로직 테스트 (src/lib/chatLogic.ts) — Phase 2
// 서버 행 정규화 / 페이지 prepend / 낙관적 업데이트+확정 / WS 머지 / 커서 산출
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServerMessages,
  prependPage,
  appendOptimistic,
  confirmTurn,
  mergeIncoming,
  nextTurnIndex,
  oldestCursor,
  createTypingTracker,
  DEFAULT_QUIP,
  ServerMessageRow,
} from '../../src/lib/chatLogic';
import type { ChatMessage } from '../../src/types';

function row(id: string, turn: number, role: 'user' | 'agent', content: string): ServerMessageRow {
  return { id, turn_index: turn, role, content };
}

test('normalizeServerMessages — 행 정규화 + turn_index 오름차순 정렬', () => {
  const rows: ServerMessageRow[] = [
    row('b', 2, 'agent', '답변'),
    row('a', 1, 'user', '질문'),
    row('c', 3, 'agent', '추가'),
  ];
  const out = normalizeServerMessages(rows);
  assert.deepEqual(out.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(out[0].role, 'user');
  assert.equal(out[1].role, 'agent');
  assert.equal(out[1].turnIndex, 2);
});

test('normalizeServerMessages — 빈 content 행은 제외', () => {
  const rows: ServerMessageRow[] = [row('a', 0, 'user', ''), row('b', 1, 'agent', 'ok')];
  const out = normalizeServerMessages(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'b');
});

test('prependPage — 이전 페이지를 앞에 합치고 중복 id 제거', () => {
  const existing = normalizeServerMessages([row('c', 4, 'user', '최신')]);
  const older = normalizeServerMessages([row('a', 1, 'user', '옛날'), row('c', 4, 'user', '최신')]);
  const merged = prependPage(existing, older);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'c']);
});

test('appendOptimistic — pending 메시지 추가, 같은 id 재전송 시 대체', () => {
  const base: ChatMessage[] = [{ id: 'x', role: 'user', content: 'hi', turnIndex: 0 }];
  const draft: ChatMessage = { id: 'local-1', role: 'user', content: 'new', turnIndex: 1, pending: true };
  const withPending = appendOptimistic(base, draft);
  assert.equal(withPending.length, 2);
  assert.equal(withPending[1].pending, true);
  const replaced = appendOptimistic(withPending, { ...draft, content: 'edited' });
  assert.equal(replaced.length, 2);
  assert.equal(replaced[1].content, 'edited');
});

test('confirmTurn — pending 제거 후 user/empathy/answer 확정 카드 생성', () => {
  const draft: ChatMessage = { id: 'local-1', role: 'user', content: '정리해줘', turnIndex: 5, pending: true };
  const confirmed = confirmTurn(
    [draft],
    'local-1',
    {
      user_message_id: 'srv-user-1',
      empathy_message_id: 'srv-emp-1',
      answer_message_id: 'srv-ans-1',
      empathy_response: '바로 해드릴게요',
      answer_response: '정리 완료했습니다',
    },
    '정리해줘',
    5
  );
  assert.equal(confirmed.length, 3);
  assert.deepEqual(confirmed.map((m) => m.id), ['srv-user-1', 'srv-emp-1', 'srv-ans-1']);
  assert.ok(!confirmed[0].pending, '확정된 메시지는 pending 아님');
  assert.equal(confirmed[1].sourceNeuron, 'empathy');
  assert.equal(confirmed[2].sourceNeuron, 'answer');
  assert.deepEqual(confirmed.map((m) => m.turnIndex), [5, 6, 7]);
});

test('confirmTurn — 공감 없이 답변만 있는 턴', () => {
  const out = confirmTurn(
    [],
    'local-2',
    { user_message_id: 'u2', empathy_response: null, answer_message_id: 'a2', answer_response: '답변만' },
    '질문',
    0
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((m) => m.id), ['u2', 'a2']);
  assert.deepEqual(out.map((m) => m.turnIndex), [0, 1]);
});

test('confirmTurn — id 중복 방어 (WS가 먼저 도착한 경우)', () => {
  const pre: ChatMessage = { id: 'srv-ans-1', role: 'agent', content: 'WS로 먼저 옴', turnIndex: 7, sourceNeuron: 'answer' };
  const out = confirmTurn(
    [pre],
    'local-3',
    {
      user_message_id: 'u3',
      empathy_message_id: null,
      empathy_response: null,
      answer_message_id: 'srv-ans-1',
      answer_response: 'REST 확정 응답',
    },
    '질문3',
    5
  );
  const ids = out.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, '중복 id 없음');
});

test('mergeIncoming — 새 메시지만 추가, 기존 id는 스킵', () => {
  const base: ChatMessage[] = [{ id: 'a', role: 'user', content: 'hi', turnIndex: 0 }];
  const same = mergeIncoming(base, [{ id: 'a', role: 'user', content: 'hi', turnIndex: 0 }]);
  assert.equal(same, base); // 변화 없으면 동일 참조
  const merged = mergeIncoming(base, [{ id: 'b', role: 'agent', content: 'yo', turnIndex: 1 }]);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b']);
});

test('nextTurnIndex — 비었으면 0, 아니면 최대+1', () => {
  assert.equal(nextTurnIndex([]), 0);
  const msgs: ChatMessage[] = [
    { id: 'a', role: 'user', content: '', turnIndex: 3 },
    { id: 'b', role: 'agent', content: '', turnIndex: 9 },
    { id: 'c', role: 'agent', content: '', turnIndex: 5 },
  ];
  assert.equal(nextTurnIndex(msgs), 10);
});

test('oldestCursor — 페이지네이션 before 커서', () => {
  assert.equal(oldestCursor([]), null);
  const msgs: ChatMessage[] = [
    { id: 'a', role: 'user', content: '', turnIndex: 7 },
    { id: 'b', role: 'agent', content: '', turnIndex: 8 },
  ];
  assert.equal(oldestCursor(msgs), 7);
});

// ── typing 트래커 (처리중 상태 100% 신뢰 규칙) ──

test('typingTracker — 소스 활성화 시 active=true, quip 전달', () => {
  const events: { active: boolean; quip: string | null }[] = [];
  const t = createTypingTracker((active, quip) => events.push({ active, quip }));
  t.begin('rest:send', '생각 중…');
  assert.equal(t.active, true);
  assert.deepEqual(events[0], { active: true, quip: '생각 중…' });
});

test('typingTracker — 한 소스가 먼저 끝나도 다른 활성 소스가 있으면 상태 유지 (깜빡임 방지)', () => {
  const events: { active: boolean; quip: string | null }[] = [];
  const t = createTypingTracker((active, quip) => events.push({ active, quip }));
  // REST 전송 시작 + WS 뉴런 상태가 겹치는 상황
  t.begin('rest:send', DEFAULT_QUIP);
  t.begin('ws:answer', '자료를 찾고 있어요...');
  // WS 뉴런이 먼저 idle로 끝나도 → REST pending이 남았으므로 active 유지
  t.end('ws:answer');
  assert.equal(t.active, true, 'rest 소스 남아있으면 active 유지');
  // REST까지 끝나야 비로소 해제
  t.end('rest:send');
  assert.equal(t.active, false);
  // active=false는 정확히 한 번만 emit
  const offEvents = events.filter((e) => !e.active);
  assert.equal(offEvents.length, 1);
});

test('typingTracker — quip 없는 소스는 기본 자연어 문구', () => {
  let lastQuip: string | null = null;
  const t = createTypingTracker((_active, quip) => (lastQuip = quip));
  t.begin('ws:empathy');
  assert.equal(lastQuip, DEFAULT_QUIP);
  t.end('ws:empathy');
  assert.equal(lastQuip, null);
});

test('typingTracker — 동일 상태 중복 emit 없음 (렌더 낭비 방지)', () => {
  const events: boolean[] = [];
  const t = createTypingTracker((active) => events.push(active));
  t.begin('a', 'q1');
  t.begin('b', 'q1'); // quip 변화 없음 → active 변화 없음
  assert.deepEqual(events, [true]);
  t.endAll();
  assert.deepEqual(events, [true, false]);
});
