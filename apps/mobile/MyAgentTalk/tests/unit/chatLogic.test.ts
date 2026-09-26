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
import type { ChatMessage } from '../../src/lib/chatLogic';

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
  t.begin('rest:send', 'quip.thinking');
  assert.equal(t.active, true);
  assert.deepEqual(events[0], { active: true, quip: 'quip.thinking' });
});

test('typingTracker — 한 소스가 먼저 끝나도 다른 활성 소스가 있으면 상태 유지 (깜빡임 방지)', () => {
  const events: { active: boolean; quip: string | null }[] = [];
  const t = createTypingTracker((active, quip) => events.push({ active, quip }));
  // REST 전송 시작 + WS 뉴런 상태가 겹치는 상황
  t.begin('rest:send', DEFAULT_QUIP);
  t.begin('ws:answer', 'quip.organizing');
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
  t.begin('a', 'quip.organizing');
  t.begin('b', 'quip.organizing'); // quip 변화 없음 → active 변화 없음
  assert.deepEqual(events, [true]);
  t.endAll();
  assert.deepEqual(events, [true, false]);
});

// 실행/턴 계약 회귀 테스트
import { createTurnCoordinator, nextBackoffMs, turnKey } from '../../src/lib/chatLogic';

test('실행 A/B 동시 전송 — A 완료 후에도 B의 처리중 표시 유지', () => {
  const tracker = createTypingTracker(() => {});
  tracker.begin('A'); tracker.begin('B');
  assert.equal(tracker.activeCount, 2);
  tracker.complete('A');
  assert.equal(tracker.active, true);
  assert.equal(tracker.activeCount, 1);
  tracker.complete('B');
  assert.equal(tracker.active, false);
});

test('실행 begin/complete/fail/cancel 멱등성과 늦은 begin 방어', () => {
  const tracker = createTypingTracker(() => {});
  tracker.begin('A'); tracker.begin('A');
  assert.equal(tracker.activeCount, 1);
  tracker.complete('A'); tracker.complete('A'); tracker.fail('A'); tracker.begin('A');
  assert.equal(tracker.activeCount, 0);
  tracker.fail('B'); tracker.begin('B');
  tracker.begin('C'); tracker.cancel('C'); tracker.cancel('C');
  assert.equal(tracker.activeCount, 0);
});

test('turn.status completed — 같은 turn에 연결된 미종료 실행 모두 종료', () => {
  const tracker = createTypingTracker(() => {});
  const turns = createTurnCoordinator(tracker);
  for (const id of ['A', 'B']) {
    turns.start(id);
    turns.observe({ type: 'turn.status', turn_id: 'turn1', client_exec_id: id, status: 'processing' }, 's');
  }
  turns.start('C');
  turns.observe({ type: 'turn.status', turn_id: 'turn1', status: 'completed' }, 's');
  assert.equal(tracker.activeCount, 1);
  turns.finish('C', 's');
  assert.equal(tracker.active, false);
  turns.observe({ type: 'turn.status', turn_id: 'turn1', status: 'processing' }, 's');
  assert.equal(tracker.active, false);
});

test('REST 종료 안전장치 — 식별자 없는 레거시 WS와 동시 요청', () => {
  const tracker = createTypingTracker(() => {});
  const turns = createTurnCoordinator(tracker);
  turns.start('A'); turns.start('B');
  turns.observe({ type: 'neuron.status', status: 'processing' }, 's');
  turns.finish('A', 's');
  assert.equal(tracker.active, true);
  turns.finish('B', 's', undefined, true);
  assert.equal(tracker.active, false);
});

test('서버 ID 별칭과 turn_index 폴백, answer.done 및 실패 종료', () => {
  assert.equal(turnKey({ execution_id: 'e' }, 's'), 's:turn:e');
  assert.equal(turnKey({ run_id: 'r' }, 's'), 's:turn:r');
  assert.equal(turnKey({ turn_index: 0 }, 's'), 's:index:0');
  const tracker = createTypingTracker(() => {});
  const turns = createTurnCoordinator(tracker);
  turns.observe({ type: 'answer.delta', execution_id: 'e', run_id: 'r' }, 's');
  turns.observe({ type: 'answer.done', run_id: 'r' }, 's');
  assert.equal(tracker.active, false);
  turns.observe({ type: 'neuron.status', turn_index: 2, status: 'received' }, 's');
  turns.observe({ type: 'neuron.status', turn_index: 2, status: 'error' }, 's');
  assert.equal(tracker.active, false);
});

test('nextBackoffMs — 지수 증가, 30초 캡, ±20% jitter', () => {
  assert.deepEqual([0, 1, 2, 10].map((n) => nextBackoffMs(n, () => 0.5)), [1000, 2000, 4000, 30000]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const base = Math.min(30000, 1000 * 2 ** attempt);
    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = nextBackoffMs(attempt, () => random);
      assert.ok(delay >= base * 0.8 && delay <= Math.min(30000, base * 1.2));
    }
  }
});

test('재조회 복구 — 페이지 내부 중복도 제거하고 turn_index 순서 유지', () => {
  const row = (id: string, turnIndex: number): ChatMessage => ({ id, turnIndex, role: 'agent', content: id });
  const merged = mergeIncoming([row('b', 2)], [row('c', 3), row('a', 1), row('b', 2), row('c', 3)]);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(mergeIncoming(merged, merged), merged);
});

test('REST와 WS의 동일 실행은 하나로 추적하고 늦은 진행 이벤트로 부활하지 않는다', () => {
  const tracker = createTypingTracker(() => {});
  const turns = createTurnCoordinator(tracker);
  turns.start('client-A');
  turns.observe({ type: 'turn.status', turn_id: 'server-turn', client_exec_id: 'client-A', status: 'received' }, 's');
  turns.observe({ type: 'turn.status', turn_id: 'server-turn', status: 'processing' }, 's');
  assert.equal(tracker.activeCount, 1);
  turns.finish('client-A', 's'); // REST 응답에는 turn_id가 없어도 WS 연결 기억
  assert.equal(tracker.activeCount, 0);
  turns.observe({ type: 'turn.status', turn_id: 'server-turn', status: 'processing' }, 's');
  assert.equal(tracker.activeCount, 0);
});

test('REST client_exec_id를 execution_id로 반영한 서버도 begin 멱등', () => {
  const tracker = createTypingTracker(() => {});
  const turns = createTurnCoordinator(tracker);
  turns.start('exec-A');
  turns.observe({ type: 'turn.status', execution_id: 'exec-A', status: 'processing' }, 's');
  assert.equal(tracker.activeCount, 1);
  turns.observe({ type: 'turn.status', execution_id: 'exec-A', status: 'failed' }, 's');
  assert.equal(tracker.activeCount, 0);
});

// 새 프로토콜은 식별자 없는 레거시 진행 이벤트와 별도로 검증한다.
import { buildTimeGroups, validateMessageInput, createSequenceTracker, reduceStreams } from '../../src/lib/chatLogic';

test('입력 검증 — 공백, 4000자 경계, 원문 정규화', () => {
  assert.equal(validateMessageInput(' \n ').ok, false);
  assert.deepEqual(validateMessageInput('  안녕하세요 \n'), { ok: true, normalized: '안녕하세요' });
  assert.equal(validateMessageInput('가'.repeat(4000)).ok, true);
  assert.equal(validateMessageInput('가'.repeat(4001)).ok, false);
});

test('시간 그룹 — 연속 5분, 날짜 경계, 잘못된 시간', () => {
  const row = (id: string, createdAt?: string): ChatMessage => ({ id, role: 'user', content: id, turnIndex: 0, createdAt });
  const groups = buildTimeGroups([
    row('a', '2026-09-26T10:00:00'), row('b', '2026-09-26T10:04:00'),
    row('c', '2026-09-26T10:09:00'), row('d', '2026-09-27T00:00:00'), row('e', '오류'),
  ], 'ko', new Date('2026-09-26T12:00:00'));
  assert.deepEqual(groups.map((g) => g.label), ['10:00', null, '10:09', '09월 27일 00:00', null]);
});

test('seq — 중복 및 역순 차단, subscribed는 재생 시작 위치를 앞당기지 않는다', () => {
  const seq = createSequenceTracker();
  assert.equal(seq.accept(4), true);
  assert.equal(seq.accept(4), false);
  assert.equal(seq.accept(3), false);
  assert.equal(seq.subscribed(9), false);
  assert.equal(seq.lastSeq, 4);
  assert.equal(seq.accept(5), true);
  assert.equal(seq.accept(undefined), true);
});

test('seq — 서버 재시작 리셋 후 낮은 번호 이벤트 허용', () => {
  const seq = createSequenceTracker(); seq.accept(20);
  assert.equal(seq.subscribed(2), true);
  assert.equal(seq.lastSeq, 0);
  assert.equal(seq.accept(1), true);
  assert.equal(seq.accept(1), false);
});

for (const terminal of ['completed', 'failed', 'cancelled']) {
  test(`실행 전이 — 시작/진행/${terminal}/중복 종료/늦은 진행`, () => {
    let quip: string | null = null;
    const tracker = createTypingTracker((_active, text) => { quip = text; });
    const runs = createTurnCoordinator(tracker);
    runs.observe({ type: 'run.started', run_id: 'a' }, 's');
    assert.equal(tracker.activeCount, 1);
    runs.observe({ type: 'run.progress', run_id: 'a', stage: 'thinking', quip: '생각을 정리하고 있어요' }, 's');
    assert.equal(quip, 'quip.thinking');
    runs.observe({ type: 'answer.done', run_id: 'a' }, 's');
    assert.equal(tracker.active, true);
    runs.observe({ type: `run.${terminal}`, run_id: 'a' }, 's');
    runs.observe({ type: 'run.completed', run_id: 'a' }, 's');
    runs.observe({ type: 'run.progress', run_id: 'a' }, 's');
    assert.equal(tracker.activeCount, 0);
  });
}

test('동시 두 실행 — WS 선행, REST 역순 완료, 서로 다른 run은 독립 유지', () => {
  const tracker = createTypingTracker(() => {});
  const runs = createTurnCoordinator(tracker);
  runs.start('local-a'); runs.start('local-b');
  runs.observe({ type: 'run.started', run_id: 'server-a' }, 's');
  runs.observe({ type: 'run.started', run_id: 'server-b' }, 's');
  assert.equal(tracker.activeCount, 2);
  runs.finish('local-b', 's', { run_id: 'server-b' });
  assert.equal(tracker.activeCount, 1);
  runs.observe({ type: 'run.completed', run_id: 'server-b' }, 's');
  runs.observe({ type: 'run.progress', run_id: 'server-a', quip: '아직 처리 중이에요' }, 's');
  assert.equal(tracker.activeCount, 1);
  runs.finish('local-a', 's', { run_id: 'server-a' });
  assert.equal(tracker.activeCount, 0);
});

test('REST가 먼저 끝난 뒤 WS 시작 재생도 실행을 부활시키지 않는다', () => {
  const tracker = createTypingTracker(() => {});
  const runs = createTurnCoordinator(tracker);
  runs.start('local'); runs.finish('local', 's', { run_id: 'remote' });
  runs.observe({ type: 'run.started', run_id: 'remote' }, 's');
  assert.equal(tracker.activeCount, 0);
});

test('독립 원격 실행은 관계없는 REST 실패로 종료되지 않는다', () => {
  const tracker = createTypingTracker(() => {}); const runs = createTurnCoordinator(tracker);
  runs.start('local'); runs.observe({ type: 'run.started', run_id: 'remote' }, 's');
  runs.finish('local', 's', undefined, true);
  assert.equal(tracker.activeCount, 1);
});

test('스트리밍 — 중복 index 차단, 최종 본문 교체 및 확정 행 중복 제거', () => {
  let streams = reduceStreams([], { type: 'answer.delta', run_id: 'a', delta: '초안', index: 0 }, []);
  streams = reduceStreams(streams, { type: 'answer.delta', run_id: 'a', delta: '초안', index: 0 }, []);
  assert.equal(streams[0].text, '초안');
  streams = reduceStreams(streams, { type: 'answer.done', run_id: 'a', text: '최종 본문', message_id: 'answer' }, []);
  assert.equal(streams[0].text, '최종 본문');
  streams = reduceStreams(streams, { type: 'message.new', run_id: 'a', message: { id: 'answer' } }, []);
  assert.deepEqual(streams, []);
});

test('스트리밍 — message.new 선행 후 answer.done과 늦은 delta는 중복 카드 없음', () => {
  const messages: ChatMessage[] = [{ id: 'a', role: 'agent', sourceNeuron: 'answer', runId: 'r', content: '최종', turnIndex: 1 }];
  assert.deepEqual(reduceStreams([], { type: 'answer.done', run_id: 'r', message_id: 'a', text: '최종' }, messages), []);
  assert.deepEqual(reduceStreams([], { type: 'answer.delta', run_id: 'r', delta: '이전' }, messages), []);
});

test('REST 저장 행 우선 — 시간/유형/run 연결과 WS 중복 제거', () => {
  const confirmed = confirmTurn([], 'local', { user_message_id: 'u', run_id: 'r', messages: {
    user: { id: 'u', role: 'user', content: '질문', turn_index: 10, created_at: '2026-09-26T12:00:00Z' },
    empathy: null, answer: { id: 'a', role: 'agent', source_neuron: 'answer', content: '응답', turn_index: 11, dialogue_type: 'text' },
  } }, '질문', 1);
  assert.equal(confirmed[0].turnIndex, 10);
  assert.equal(confirmed[1].dialogueType, 'text');
  assert.equal(confirmed[1].runId, 'r');
  assert.equal(mergeIncoming(confirmed, confirmed).length, 2);
});

import { restoreFailedDraft } from '../../src/lib/chatLogic';
test('실패 초안 — 공백 포함 원문 복원, 작성 중인 다른 초안도 보존', () => {
  assert.equal(restoreFailedDraft('', '  원문  '), '  원문  ');
  assert.equal(restoreFailedDraft('작성 중', '실패 원문'), '작성 중\n실패 원문');
  assert.equal(restoreFailedDraft('원문', '원문'), '원문');
});

test('새 run 프로토콜의 뉴런 상태는 이중 작업이나 종료 후 잔여 작업을 만들지 않는다', () => {
  const tracker = createTypingTracker(() => {}); const runs = createTurnCoordinator(tracker);
  runs.observe({ type: 'run.started', run_id: 'a', quip: '살펴보고 있어요' }, 's');
  runs.observe({ type: 'neuron.status', status: 'processing', quip: '내부 처리' }, 's');
  assert.equal(tracker.activeCount, 1);
  runs.observe({ type: 'run.completed', run_id: 'a' }, 's');
  runs.observe({ type: 'neuron.status', status: 'processing' }, 's');
  assert.equal(tracker.active, false);
});
