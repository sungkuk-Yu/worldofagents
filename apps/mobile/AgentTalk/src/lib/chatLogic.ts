import { formatDayLabel } from '../i18n/format';
// 채팅 MVP 순수 로직 — 서버 행 ↔ UI 메시지 정규화, 페이지네이션, 낙관적 업데이트 머지
// (React/네트워크 의존 없음 → 단위 테스트 대상)
// 백엔드 스펙: apps/backend/docs/api-design.md §3.4
//   GET  /api/sessions/:id/messages → data[]: { id, turn_index, role, content, source_neuron, created_at }
//   POST /api/sessions/:id/messages → data: { user_message_id, empathy_response, answer_response, ... }
import type { ChatMessage as BaseChatMessage } from '../types';

export type ChatMessage = BaseChatMessage & { status?: 'pending' | 'sent' | 'failed'; dialogueType?: string | null; runId?: string; draft?: string };

/** 서버 messages 행 (최소 필드 — ApiEnvelope data[] 항목) */
export interface ServerMessageRow {
  id: string;
  turn_index: number;
  role: 'user' | 'agent' | 'system';
  content: string;
  source_neuron?: string | null;
  created_at?: string;
  dialogue_type?: string | null;
  structured_payload?: unknown;
  parent_message_id?: unknown;
  thread_reply_count?: unknown;
  run_id?: string;
}

/** 서버 행 → UI 메시지 정규화 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function normalizeServerMessages(rows: unknown): ChatMessage[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isRecord).filter((r) =>
    typeof r.id === 'string' && !!r.id &&
    (typeof r.content === 'string' && r.content.length > 0 || isRecord(r.structured_payload))
  ).map((r): ChatMessage => ({
    id: r.id as string,
    role: r.role === 'user' ? 'user' : r.role === 'system' ? 'system' : 'agent',
    content: typeof r.content === 'string' ? r.content : '',
    turnIndex: typeof r.turn_index === 'number' && Number.isFinite(r.turn_index) ? r.turn_index : 0,
    sourceNeuron: typeof r.source_neuron === 'string' ? r.source_neuron : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : undefined,
    dialogueType: typeof r.dialogue_type === 'string' ? r.dialogue_type : null,
    payload: isRecord(r.structured_payload) ? r.structured_payload : undefined,
    parentMessageId: typeof r.parent_message_id === 'string' ? r.parent_message_id : undefined,
    threadReplyCount: typeof r.thread_reply_count === 'number' && Number.isInteger(r.thread_reply_count) && r.thread_reply_count >= 0 ? r.thread_reply_count : undefined,
    runId: typeof r.run_id === 'string' ? r.run_id : undefined,
    status: 'sent',
  })).sort((a, b) => a.turnIndex - b.turnIndex);
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
  run_id?: string;
  messages?: { user: ServerMessageRow | null; empathy: ServerMessageRow | null; answer: ServerMessageRow | null };
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
  if (confirm.messages) {
    const rows = Object.values(confirm.messages).filter((row): row is ServerMessageRow => row !== null);
    return mergeIncoming(existing.filter((m) => m.id !== optimisticId),
      normalizeServerMessages(rows.map((row) => ({ ...row, run_id: confirm.run_id }))));
  }
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
      runId: confirm.run_id,
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
      dialogueType: confirm.dialogue_type,
      runId: confirm.run_id,
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

export const DEFAULT_QUIP = 'quip.default';
export function quipKeyForStage(stage?: string): string {
  return stage && ['thinking', 'organizing', 'finalizing', 'rendering'].includes(stage) ? `quip.${stage}` : DEFAULT_QUIP;
}

export type ExecutionStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface TypingTracker {
  reserve(execId: string): void;
  begin(execId: string, quip?: string | null): void;
  complete(execId: string): void;
  fail(execId: string): void;
  cancel(execId: string): void;
  bind(execId: string, turnId: string): void;
  finishTurn(turnId: string, failed?: boolean | ExecutionStatus): void;
  /** 레거시 호출 호환 */
  end(execId: string): void;
  endAll(): void;
  readonly active: boolean;
  readonly activeCount: number;
}

/** 사람↔에이전트 대화의 처리중 상태는 실행 수로 결정한다. 종료된 실행은 늦은 begin으로 부활하지 않는다. */
export function createTypingTracker(onChange: (active: boolean, quip: string | null, count: number) => void, notifyCount = false): TypingTracker {
  const executions = new Map<string, { status: ExecutionStatus; quip: string }>();
  const turns = new Map<string, Set<string>>();
  const endedTurns = new Map<string, ExecutionStatus>();
  const reserved = new Set<string>();
  let lastCount = 0;
  let lastActive = false;
  let lastQuip: string | null = null;
  const activeEntries = () => [...executions.values()].filter((e) => e.status === 'active');
  function countActive() {
    let pending = 0;
    let known = 0;
    const grouped = new Set<string>();
    for (const [id, entry] of executions) {
      if (entry.status !== 'active') continue;
      const group = [...turns].find(([, members]) => members.has(id))?.[0];
      if (group) grouped.add(group);
      else if (reserved.has(id)) pending++;
      else known++;
    }
    // 응답 전 식별 불가능한 REST 예약은 WS 실행과 중첩 표시한다. 확정 연결은 run_id로만 한다.
    const paired = [...grouped].filter((group) => [...turns.get(group)!].some((id) => reserved.has(id))).length;
    return paired + Math.max(pending, grouped.size - paired + known);
  }
  function emit() {
    const entries = activeEntries();
    const active = entries.length > 0;
    const quip = entries.length ? entries[entries.length - 1].quip : null;
    const count = countActive();
    if (active !== lastActive || quip !== lastQuip || (notifyCount && count !== lastCount)) {
      lastCount = count;
      lastActive = active;
      lastQuip = quip;
      onChange(active, quip, count);
    }
  }
  function finish(id: string, status: ExecutionStatus) {
    const entry = executions.get(id);
    if (!entry || entry.status === 'active') executions.set(id, { status, quip: DEFAULT_QUIP });
    emit();
  }
  return {
    reserve(id) { reserved.add(id); },
    begin(id, quip) {
      const entry = executions.get(id);
      if (entry && entry.status !== 'active') return;
      executions.delete(id);
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
      const status: ExecutionStatus = typeof failed === 'string' ? failed : failed ? 'failed' : 'completed';
      if (endedTurns.has(turn)) return;
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
    get activeCount() { return countActive(); },
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
  const id = event.run_id ?? event.turn_id ?? event.execution_id;
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
  const runProtocol = new Set<string>();
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
    start(execId: string) { pending.add(execId); tracker.reserve(execId); tracker.begin(execId); },
    observe(event: TurnEvent, sid: string) {
      const key = turnKey(event, sid);
      // 새 프로토콜의 뉴런 이벤트는 실행 식별자가 없으므로 작업을 추가하거나 종료하지 않는다.
      if (!key && event.type === 'neuron.status' && runProtocol.size) return '';
      if (key && event.type.startsWith('run.')) {
        runProtocol.add(key);
        if (legacyKey) { tracker.cancel(legacyKey); watches.delete(legacyKey); legacyKey = null; }
      }
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
      const status = event.type.startsWith('run.') ? event.type.slice(4) : event.status?.toLowerCase() ?? '';
      if (key && runProtocol.has(key) && !event.type.startsWith('run.')) return execId;
      const failed = ['failed', 'error', 'failure', 'cancelled', 'canceled'].includes(status);
      const ended = failed || ['completed', 'complete', 'done', 'idle', 'success', 'finished'].includes(status) || event.type === 'answer.done';
      if (ended) {
        if (key) tracker.finishTurn(key, status === 'cancelled' || status === 'canceled' ? 'cancelled' : failed);
        if (status === 'cancelled' || status === 'canceled') tracker.cancel(execId);
        else if (failed) tracker.fail(execId); else tracker.complete(execId);
        if (!key && !clientId) legacyKey = null;
      } else {
        if (!key && !clientId && pending.size && !watches.has(execId)) watches.set(execId, new Set(pending));
        tracker.begin(execId, quipKeyForStage(event.stage));
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

export function validateMessageInput(content: string): { ok: boolean; errorKey?: string; errorParams?: { limit: number }; normalized?: string } {
  const normalized = content.trim();
  if (!normalized) return { ok: false, errorKey: 'errors.empty' };
  if (normalized.length > 4000) return { ok: false, errorKey: 'errors.tooLong', errorParams: { limit: 4000 } };
  return { ok: true, normalized };
}

/** 연속 5분 이내 메시지는 시간을 생략한다. 잘못된 시간은 라벨 없이 별도 그룹으로 취급한다. */
export function buildTimeGroups(messages: ChatMessage[], locale: string, now = new Date()): { id: string; label: string | null }[] {
  let previous: Date | null = null;
  return messages.map((message) => {
    const date = message.createdAt ? new Date(message.createdAt) : null;
    if (!date || !Number.isFinite(date.getTime())) { previous = null; return { id: message.id, label: null }; }
    const sameDay = previous?.toDateString() === date.toDateString();
    const grouped = previous && sameDay && date.getTime() >= previous.getTime() && date.getTime() - previous.getTime() < 300000;
    previous = date;
    const label = formatDayLabel(date, locale, now);
    return { id: message.id, label: grouped ? null : label };
  });
}

export function createSequenceTracker() {
  let lastSeq = 0;
  return {
    get lastSeq() { return lastSeq; },
    accept(seq: unknown) {
      if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= 0) return seq === undefined;
      if (seq <= lastSeq) return false;
      lastSeq = seq;
      return true;
    },
    subscribed(current: unknown) {
      if (typeof current === 'number' && current >= 0 && current < lastSeq) { lastSeq = 0; return true; }
      return false;
    },
  };
}

export interface StreamingAnswer { runId: string; text: string; messageId?: string; index: number; quip: string; done: boolean }
export function reduceStreams(streams: StreamingAnswer[], event: Record<string, unknown>, messages: ChatMessage[]): StreamingAnswer[] {
  const runId = event.run_id;
  if (typeof runId !== 'string') return streams;
  const old = streams.find((s) => s.runId === runId);
  if (event.type === 'run.failed' || event.type === 'run.cancelled') return streams.filter((s) => s.runId !== runId);
  if (event.type === 'message.new') {
    const row = event.message as ServerMessageRow | undefined;
    if (row?.source_neuron === 'answer' || row?.id === old?.messageId) return streams.filter((s) => s.runId !== runId);
    return streams;
  }
  if (event.type !== 'answer.delta' && event.type !== 'answer.done' && event.type !== 'run.progress') return streams;
  if (messages.some((m) => m.runId === runId && m.sourceNeuron === 'answer')) return streams.filter((s) => s.runId !== runId);
  if (event.type === 'run.progress' && !old) return streams;
  const next = { ...old ?? { runId, text: '', index: -1, quip: DEFAULT_QUIP, done: false } };
  if (event.type === 'answer.delta') {
    if (next.done || (typeof event.index === 'number' && event.index <= next.index)) return streams;
    next.text += typeof event.delta === 'string' ? event.delta : '';
    next.index = typeof event.index === 'number' ? event.index : next.index + 1;
  }
  if (event.type === 'answer.done') {
    next.text = typeof event.text === 'string' ? event.text : '';
    next.messageId = typeof event.message_id === 'string' ? event.message_id : undefined;
    next.done = true;
    if (!next.text || messages.some((m) => m.id === next.messageId)) return streams.filter((s) => s.runId !== runId);
  }
  if (event.type === 'run.progress' || typeof event.stage === 'string') next.quip = quipKeyForStage(typeof event.stage === 'string' ? event.stage : undefined);
  return [...streams.filter((s) => s.runId !== runId), next];
}

/** 새로 작성 중인 초안도 보존하면서 실패한 원문을 입력창으로 돌려준다. */
export function restoreFailedDraft(current: string, failed: string): string {
  return !current || current === failed ? failed : `${current}\n${failed}`;
}
