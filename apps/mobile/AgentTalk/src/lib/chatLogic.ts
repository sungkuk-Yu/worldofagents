// 채팅 MVP 순수 로직 — 서버 행 ↔ UI 메시지 정규화, 페이지네이션, 낙관적 업데이트 머지
// (React/네트워크 의존 없음 → 단위 테스트 대상)
// 백엔드 스펙: apps/backend/docs/api-design.md §3.4
//   GET  /api/sessions/:id/messages → data[]: { id, turn_index, role, content, source_neuron, created_at }
//   POST /api/sessions/:id/messages → data: { user_message_id, empathy_response, answer_response, ... }
import type { ChatMessage as BaseChatMessage } from '../types';

export type ChatMessage = BaseChatMessage & { status?: 'pending' | 'sent' | 'failed' };

/** 서버 messages 행 (최소 필드 — ApiEnvelope data[] 항목) */
export interface ServerMessageRow {
  id: string;
  turn_index: number;
  role: 'user' | 'agent' | 'system';
  content: string;
  source_neuron?: string | null;
  created_at?: string;
}

/** 서버 행 → UI 메시지 정규화 */
export function normalizeServerMessages(rows: ServerMessageRow[]): ChatMessage[] {
  return (rows || [])
    .filter((r) => r && typeof r.content === 'string' && r.content.length > 0)
    .map((r): ChatMessage => ({
      id: String(r.id),
      role: r.role === 'user' ? 'user' : r.role === 'system' ? 'system' : 'agent',
      content: r.content,
      turnIndex: Number(r.turn_index) || 0,
      sourceNeuron: r.source_neuron ?? null,
      createdAt: r.created_at,
      status: 'sent',
    }))
    .sort((a, b) => a.turnIndex - b.turnIndex);
}

/**
 * 기존 목록에 새 페이지(이전 히스토리)를 prepend — id 중복 제거.
 * 서버는 turn_index 내림차순으로 limit만큼 반환하므로 오름차순 재정렬 후 합친다.
 */
export function prependPage(existing: ChatMessage[], olderPage: ChatMessage[]): ChatMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const fresh = olderPage.filter((m) => !seen.has(m.id));
  return [...fresh, ...existing].sort((a, b) => a.turnIndex - b.turnIndex);
}

/**
 * 낙관적 사용자 메시지 + 전송 실패 플래그 처리.
 * - appendOptimistic: pending 사용자 메시지를 목록 끝에 붙인다.
 * - confirmOptimistic: 서버 응답에서 확정된 행들을 pending 메시지 대신 교체/추가한다.
 */
export function appendOptimistic(existing: ChatMessage[], draft: ChatMessage): ChatMessage[] {
  return [...existing.filter((m) => m.id !== draft.id), draft];
}

/** POST 응답 → 확정 메시지 목록 (공감/답변 각각 별도 카드) */
export interface TurnConfirm {
  user_message_id: string;
  empathy_message_id?: string | null;
  answer_message_id?: string | null;
  empathy_response?: string | null;
  answer_response?: string | null;
  dialogue_type?: string;
}

export function confirmTurn(
  existing: ChatMessage[],
  optimisticId: string,
  confirm: TurnConfirm,
  userContent: string,
  baseTurnIndex: number
): ChatMessage[] {
  const withoutPending = existing.filter((m) => m.id !== optimisticId && m.id !== confirm.user_message_id);
  const confirmedUser: ChatMessage = {
    id: confirm.user_message_id || optimisticId,
    role: 'user',
    content: userContent,
    turnIndex: baseTurnIndex,
    pending: false,
    status: 'sent',
  };
  const out: ChatMessage[] = [...withoutPending, confirmedUser];
  let offset = 1;
  if (confirm.empathy_response) {
    out.push({
      id: confirm.empathy_message_id || `empathy-${baseTurnIndex}`,
      role: 'agent',
      content: confirm.empathy_response,
      turnIndex: baseTurnIndex + offset,
      sourceNeuron: 'empathy',
    });
    offset += 1;
  }
  if (confirm.answer_response) {
    out.push({
      id: confirm.answer_message_id || `answer-${baseTurnIndex}`,
      role: 'agent',
      content: confirm.answer_response,
      turnIndex: baseTurnIndex + offset,
      sourceNeuron: 'answer',
    });
  }
  // id 중복 방어 (WS가 먼저 같은 메시지를 뿌린 경우)
  const seen = new Set<string>();
  return out
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => a.turnIndex - b.turnIndex || (a.role === 'user' ? -1 : 1));
}

/** WS로 수신한 에이전트 응답(브로드캐스트) 머지 — id 중복이면 스킵 */
export function mergeIncoming(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const fresh = incoming.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort((a, b) => a.turnIndex - b.turnIndex);
}

/** 다음 낙관적 turn_index 추정 — 목록 최대값 + 1 */
export function nextTurnIndex(existing: ChatMessage[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map((m) => m.turnIndex)) + 1;
}

/** 페이지네이션 커서 — 다음 "이전 페이지" 요청용 before 값 */
export function oldestCursor(messages: ChatMessage[]): number | null {
  if (messages.length === 0) return null;
  return messages[0].turnIndex;
}

// ── 처리중 상태 트래커 ─────────────────────────────
// 정체성 규칙: 처리중 표시는 100% 신뢰 가능해야 한다. REST pending 과 WS neuron.status 가
// 겹쳐 들어와도 "활성 소스 ≥ 1개"인 동안 상태가 소실되면 안 된다 (텔레그램식 깜빡임 금지).

export const DEFAULT_QUIP = '잠깐만요, 생각 중이에요…';

export type ExecutionStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface TypingTracker {
  begin(execId: string, quip?: string | null): void;
  complete(execId: string): void;
  fail(execId: string): void;
  cancel(execId: string): void;
  bind(execId: string, turnId: string): void;
  finishTurn(turnId: string, failed?: boolean): void;
  /** 레거시 호출 호환 */
  end(execId: string): void;
  endAll(): void;
  readonly active: boolean;
  readonly activeCount: number;
}

/** 사람↔에이전트 대화의 처리중 상태는 실행 수로 결정한다. 종료된 실행은 늦은 begin으로 부활하지 않는다. */
export function createTypingTracker(onChange: (active: boolean, quip: string | null) => void): TypingTracker {
  const executions = new Map<string, { status: ExecutionStatus; quip: string }>();
  const turns = new Map<string, Set<string>>();
  const endedTurns = new Map<string, ExecutionStatus>();
  let lastActive = false;
  let lastQuip: string | null = null;
  const activeEntries = () => [...executions.values()].filter((e) => e.status === 'active');
  function emit() {
    const entries = activeEntries();
    const active = entries.length > 0;
    const quip = entries.length ? entries[entries.length - 1].quip : null;
    if (active !== lastActive || quip !== lastQuip) {
      lastActive = active;
      lastQuip = quip;
      onChange(active, quip);
    }
  }
  function finish(id: string, status: ExecutionStatus) {
    const entry = executions.get(id);
    if (!entry || entry.status === 'active') executions.set(id, { status, quip: DEFAULT_QUIP });
    emit();
  }
  return {
    begin(id, quip) {
      const entry = executions.get(id);
      if (entry && entry.status !== 'active') return;
      executions.set(id, { status: 'active', quip: quip || DEFAULT_QUIP });
      emit();
    },
    complete: (id) => finish(id, 'completed'),
    fail: (id) => finish(id, 'failed'),
    cancel: (id) => finish(id, 'cancelled'),
    end: (id) => finish(id, 'completed'),
    bind(id, turn) {
      const members = turns.get(turn) ?? new Set<string>();
      members.add(id);
      turns.set(turn, members);
      const ended = endedTurns.get(turn);
      if (ended) finish(id, ended);
    },
    finishTurn(turn, failed = false) {
      const status = failed ? 'failed' : 'completed';
      endedTurns.set(turn, status);
      // 모든 실행의 상태를 먼저 바꾸어 중간 quip/typing 깜빡임을 방지한다.
      for (const id of turns.get(turn) ?? []) {
        const entry = executions.get(id);
        if (!entry || entry.status === 'active') executions.set(id, { status, quip: DEFAULT_QUIP });
      }
      emit();
    },
    endAll() {
      for (const entry of executions.values()) if (entry.status === 'active') entry.status = 'cancelled';
      emit();
    },
    get active() { return activeEntries().length > 0; },
    get activeCount() { return activeEntries().length; },
  };
}

/** attempt=0부터 1s, 2s, 4s…; 최종 지연도 30s 이하, ±20% jitter. */
export function nextBackoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(30000, 1000 * 2 ** Math.min(30, Math.max(0, Math.floor(attempt))));
  return Math.round(Math.min(30000, base * (0.8 + 0.4 * Math.max(0, Math.min(1, rand())))));
}

export interface TurnIdentity {
  session_id?: string;
  turn_id?: string;
  execution_id?: string;
  run_id?: string;
  client_exec_id?: string;
  turn_index?: number;
}

/** 서버 ID가 없을 때만 session + turn_index를 사용한다. */
export function turnKey(event: TurnIdentity, sessionId: string): string | null {
  const id = event.turn_id ?? event.execution_id ?? event.run_id;
  if (id) return `${sessionId}:turn:${id}`;
  return event.turn_index !== undefined ? `${sessionId}:index:${event.turn_index}` : null;
}

export interface TurnEvent extends TurnIdentity {
  type: string;
  status?: string;
  quip?: string;
  stage?: string;
}

/** REST와 WS의 실행 연결 및 종료를 공유한다. 식별자 없는 레거시 이벤트는 당시 REST 실행들이 끝나면 정리한다. */
export function createTurnCoordinator(tracker: TypingTracker) {
  const pending = new Set<string>();
  const watches = new Map<string, Set<string>>();
  const executionTurns = new Map<string, Set<string>>();
  const turnExecution = new Map<string, string>();
  let legacyCounter = 0;
  let legacyKey: string | null = null;
  function bindIdentity(execId: string, event: TurnIdentity, sid: string) {
    // 여러 ID가 함께 올 때 어느 별칭으로 종료되더라도 같은 실행을 찾는다.
    const keys = [event.turn_id, event.execution_id, event.run_id]
      .filter((id): id is string => Boolean(id)).map((id) => `${sid}:turn:${id}`);
    if (event.turn_index !== undefined) keys.push(`${sid}:index:${event.turn_index}`);
    const turns = executionTurns.get(execId) ?? new Set<string>();
    for (const key of keys) {
      tracker.bind(execId, key);
      turns.add(key);
      turnExecution.set(key, execId);
    }
    executionTurns.set(execId, turns);
  }
  return {
    start(execId: string) { pending.add(execId); tracker.begin(execId); },
    observe(event: TurnEvent, sid: string) {
      const key = turnKey(event, sid);
      const clientId = event.client_exec_id ?? [event.execution_id, event.run_id, event.turn_id]
        .find((id) => id !== undefined && pending.has(id));
      const knownExec = key ? turnExecution.get(key) : undefined;
      const execId = clientId ?? knownExec ?? key ?? (legacyKey ??= `${sid}:legacy:${++legacyCounter}`);
      if (clientId && knownExec && knownExec !== clientId && !pending.has(knownExec)) {
        // 뒤늦게 client_exec_id가 도착하면 WS 임시 실행을 실제 REST 실행으로 합친다.
        tracker.cancel(knownExec);
        watches.delete(knownExec);
      }
      bindIdentity(execId, event, sid);
      if (clientId && key) {
        tracker.bind(key, key);
        tracker.bind(clientId, key);
      }
      const status = event.status?.toLowerCase() ?? '';
      const failed = ['failed', 'error', 'failure', 'cancelled', 'canceled'].includes(status);
      const ended = failed || ['completed', 'complete', 'done', 'idle', 'success', 'finished'].includes(status) || event.type === 'answer.done';
      if (ended) {
        if (key) tracker.finishTurn(key, failed);
        if (failed) tracker.fail(execId); else tracker.complete(execId);
        if (!key && !clientId) legacyKey = null;
      } else {
        if (!clientId && pending.size && !watches.has(execId)) watches.set(execId, new Set(pending));
        tracker.begin(execId, event.quip || event.stage || DEFAULT_QUIP);
      }
      return execId;
    },
    finish(execId: string, sid: string, identity?: TurnIdentity, failed = false) {
      if (identity) {
        bindIdentity(execId, identity, sid);
        const key = turnKey(identity, sid);
        if (key) tracker.finishTurn(key, failed);
      }
      // REST 본문이 ID를 생략해도 앞서 WS에서 알게 된 턴을 종료한다.
      for (const key of executionTurns.get(execId) ?? []) tracker.finishTurn(key, failed);
      if (failed) tracker.fail(execId); else tracker.complete(execId);
      pending.delete(execId);
      for (const [wsId, owners] of watches) {
        owners.delete(execId);
        if (!owners.size) {
          for (const key of executionTurns.get(wsId) ?? []) tracker.finishTurn(key, failed);
          tracker.complete(wsId);
          watches.delete(wsId);
          if (legacyKey === wsId) legacyKey = null;
        }
      }
    },
  };
}
