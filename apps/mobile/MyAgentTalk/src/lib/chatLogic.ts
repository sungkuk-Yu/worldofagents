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
  ai_generated?: boolean;
  id: string;
  turn_index: number;
  role: 'user' | 'agent' | 'system';
  content: string;
  source_neuron?: string | null;
  created_at?: string;
  dialogue_type?: string | null;
  structured_payload?: unknown;
  parent_message_id?: unknown;
  root_message_id?: unknown;
  thread_reply_count?: unknown;
  run_id?: string;
  attachments?: unknown;
}

/** 서버 행 → UI 메시지 정규화 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function normalizeServerMessages(rows: unknown): ChatMessage[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isRecord).filter((r) =>
    typeof r.id === 'string' && !!r.id &&
    (typeof r.content === 'string' && r.content.length > 0 || isRecord(r.structured_payload) || (Array.isArray(r.attachments) && r.attachments.length > 0))
  ).map((r): ChatMessage => ({
    id: r.id as string,
    aiGenerated: typeof r.ai_generated === 'boolean' ? r.ai_generated : undefined,
    role: r.role === 'user' ? 'user' : r.role === 'system' ? 'system' : 'agent',
    content: typeof r.content === 'string' ? r.content : '',
    turnIndex: typeof r.turn_index === 'number' && Number.isFinite(r.turn_index) ? r.turn_index : 0,
    sourceNeuron: typeof r.source_neuron === 'string' ? r.source_neuron : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : undefined,
    dialogueType: typeof r.dialogue_type === 'string' ? r.dialogue_type : null,
    payload: isRecord(r.structured_payload) ? r.structured_payload : undefined,
    parentMessageId: typeof r.parent_message_id === 'string' ? r.parent_message_id : undefined,
    rootMessageId: typeof r.root_message_id === 'string' ? r.root_message_id : undefined,
    threadReplyCount: typeof r.thread_reply_count === 'number' && Number.isInteger(r.thread_reply_count) && r.thread_reply_count >= 0 ? r.thread_reply_count : undefined,
    // 즐겨찾기 영속화 (백엔드 t_219c4d36) — GET messages 응답의 favorite 보존. 결측 시 undefined(로컬 상태 우선).
    favorite: typeof r.favorite === 'boolean' ? r.favorite : undefined,
    // 첨부 요약 (t_4497cfce) — messages.attachments JSONB {id,url,mime,size,name}[] (백엔드 독해 위임 코멘트)
    attachments: Array.isArray(r.attachments) ? r.attachments : undefined,
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

// ── 질문 큐 체크포인트 (t_1797f432 ② / 백엔드 t_344e047a 계약) ──────────
// 답변 실행 중 추가 발화가 유실되지 않고 서버 세션 큐(message_queue)에 적재된다.
// WS `queue.updated`(전체 스냅샷) / GET messages 응답의 queue 배열로 수신 →
// 사용자 발화 카드 하단에 상태 마커로 렌더한다 (대기=빈 원, 답변됨=초록 체크, 스킵=회색 대시).
// 이벤트 미배포(백엔드 running) 환경에서는 배열이 항상 비어 있어 아무것도 렌더하지 않는다.
export type QueueStatus = 'pending' | 'answered' | 'skipped';
export interface QueueItem {
  id: string;
  content: string;
  status: QueueStatus;
  position: number;
  /** 매칭된 user 메시지 id — 서버가 보내주면 우선, 없으면 content 정규화 대조 */
  messageId?: string;
}
const QUEUE_STATUSES: QueueStatus[] = ['pending', 'answered', 'skipped'];
const normalizeQueueContent = (s: string) => s.trim().replace(/\s+/g, ' ');

/** 서버 배열(스냅샷) → 큐 항목 정규화. 형태가 아니면 조용히 빈 배열 (계약 미확정 방어). */
export function normalizeQueueItems(raw: unknown): QueueItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QueueItem[] = [];
  for (const r of raw) {
    if (!isRecord(r) || typeof r.id !== 'string') continue;
    const status = QUEUE_STATUSES.includes(r.status as QueueStatus) ? (r.status as QueueStatus) : 'pending';
    out.push({
      id: r.id,
      content: typeof r.content === 'string' ? r.content : '',
      status,
      position: typeof r.position === 'number' ? r.position : out.length,
      messageId: typeof r.message_id === 'string' ? r.message_id : undefined,
    });
  }
  return out.sort((a, b) => a.position - b.position);
}

/** user 메시지 → 큐 항목 매칭. message_id 우선, 없으면 공백 정규화 content 대조(미전송 낙관 행 포함). */
export function queueItemForMessage(queue: QueueItem[], message: ChatMessage): QueueItem | undefined {
  const byId = queue.find((q) => q.messageId === message.id);
  if (byId) return byId;
  if (!message.content) return undefined;
  const key = normalizeQueueContent(message.content);
  return queue.find((q) => normalizeQueueContent(q.content) === key);
}

// ── 상단 질문 큐 스트립 (t_2f45ccb1) ────────────────────────────────────
// 데이터원 2계층: ① 서버 큐(t_344e047a message_queue → queue.updated WS / GET queue 폴링 / messages 스냅샷)
//                ② 로컬 유도(메시지 목록에서 질문↔답변 페어링) — 서버 미착지 구간 기본값.
// 서버 항목이 매칭되면 상태를 우선시(skipped는 서버 전용 정보), 없으면 로컬 페어링으로 추정.
// 교체 지점: 백엔드 라우트/이벤트 확정 후에도 이 함수 형태(서버 우선+로컬 폴백) 그대로 유효.
export interface QueueStripItem {
  /** React key — 서버 큐 행 id 우선, 없으면 질문 메시지 id */
  id: string;
  text: string;
  status: QueueStatus;
  /** 탭 점프 대상: answered=답변 카드, 그 외 질문 카드. 서버 전용 행은 message_id 있을 때만. */
  jumpMessageId?: string;
  /** 질문(루트 user) 메시지 id — 답글/갈라내기 액션의 기준. 서버 전용 행(아직 messages 밖)이면 undefined. */
  questionMessageId?: string;
  /** 답글 수 (threadReplyCount) — 칩 액션 배지/스레드 목록 정렬용 */
  replyCount: number;
  createdAt?: string;
  /** 세션 내 질문 순번 (1부터) — 칩 접두 표시 (대표님 9/28 확장 1) */
  seq: number;
}

function hasQueuedAttachments(m: ChatMessage): boolean {
  return (Array.isArray(m.attachments) && m.attachments.length > 0) || !!m.pendingAttachments?.length;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 답글(스레드) 인덱스 행 — 모달 렌더 단위 (대표님 9/28 확장 3·4). */
export interface ThreadIndexEntry {
  rootId: string;
  rootText: string;
  rootSeq: number;
  replyCount: number;
  /** 루트+답글 중 최신 활동 시각 (ISO) */
  lastActivity: string;
  /** 7일 무활동 = 종료 (슬랙 리서치 반영 — 읽기 전용 토글은 백엔드, 프론트는 배지/정렬만) */
  ended: boolean;
}

/**
 * 전체 서버 행(답글 포함)에서 스레드 인덱스를 만든다 — 답글이 딸린 루트만 행이 된다.
 * 정렬: 활성 > 종료, 그룹 내 마지막 활동 최신순.
 */
export function buildThreadIndex(messages: ChatMessage[], now = Date.now()): ThreadIndexEntry[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const rootOf = (m: ChatMessage): ChatMessage | undefined => {
    // 서버가 루트를 명시하면 그대로, 없으면 부모 체인을 역추적 (중간 페이징 유실 시 포기)
    if (m.rootMessageId) return byId.get(m.rootMessageId);
    let cur = m;
    for (let hop = 0; cur.parentMessageId && hop < 20; hop += 1) {
      const next = byId.get(cur.parentMessageId);
      if (!next) return undefined; // 체인 중간이 페이징 밖
      cur = next;
    }
    return cur.parentMessageId ? undefined : cur;
  };
  const seqOf = new Map<string, number>();
  let seq = 0;
  for (const q of messages.filter((m) => m.role === 'user' && !m.parentMessageId).sort((a, b) => a.turnIndex - b.turnIndex)) seqOf.set(q.id, ++seq);
  const byRoot = new Map<string, { replies: ChatMessage[] }>();
  for (const m of messages) {
    if (!m.parentMessageId) continue;
    const root = rootOf(m);
    if (!root) continue;
    const bucket = byRoot.get(root.id) ?? { replies: [] };
    bucket.replies.push(m);
    byRoot.set(root.id, bucket);
  }
  const out: ThreadIndexEntry[] = [];
  // 답글 행이 히스토리에 없는 스레드도 서버 thread_reply_count(>0)가 있으면 인덱스에 선다 (MVP: 행 로드 전에도 배지 정확)
  for (const root of messages) {
    if (root.parentMessageId || byRoot.has(root.id) || !(root.threadReplyCount && root.threadReplyCount > 0)) continue;
    byRoot.set(root.id, { replies: [] });
  }
  for (const [rootId, { replies }] of byRoot) {
    const root = byId.get(rootId) as ChatMessage;
    const sortedTimes = [...replies, root].map((m) => m.createdAt ?? '').sort();
    const last = sortedTimes[sortedTimes.length - 1] ?? '';
    const lastMs = Date.parse(last);
    out.push({
      rootId,
      rootText: root.content.trim(),
      rootSeq: seqOf.get(rootId) ?? 0,
      replyCount: Math.max(replies.length, root.threadReplyCount ?? 0),
      lastActivity: last,
      ended: Number.isFinite(lastMs) ? now - lastMs > WEEK_MS : false,
    });
  }
  return out.sort((a, b) => (a.ended === b.ended ? (b.lastActivity > a.lastActivity ? 1 : -1) : a.ended ? 1 : -1));
}

/** 페이지별 인덱스를 누적 병합 — 같은 root는 최신 활동/답글 수 큰 쪽 우선 (이전 페이지 유실 방지). */
export function mergeThreadIndex(prev: ThreadIndexEntry[], fresh: ThreadIndexEntry[]): ThreadIndexEntry[] {
  const byRoot = new Map(prev.map((e) => [e.rootId, e]));
  for (const e of fresh) {
    const cur = byRoot.get(e.rootId);
    if (!cur || e.lastActivity >= cur.lastActivity) byRoot.set(e.rootId, { ...cur, ...e, replyCount: Math.max(cur?.replyCount ?? 0, e.replyCount) });
  }
  return [...byRoot.values()].sort((a, b) => (a.ended === b.ended ? (b.lastActivity > a.lastActivity ? 1 : -1) : a.ended ? 1 : -1));
}

/** 첨부/본문 질문 목록에서 상단 큐 스트립 행을 만든다 (turn_index 오름, 답글 제외).
 *  seq = 세션 내 질문 순번 (대표님 9/28 확장 1 — user 메시지 시퀀스 재사용, 신규 컬럼 불요). */
export function buildQueueStrip(messages: ChatMessage[], queue: QueueItem[]): QueueStripItem[] {
  const timeline = messages
    .filter((m) => m.role !== 'system' && !m.parentMessageId)
    .sort((a, b) => a.turnIndex - b.turnIndex);
  const items: QueueStripItem[] = [];
  const usedQueue = new Set<string>();
  const seenText = new Set<string>();

  for (let i = 0; i < timeline.length; i += 1) {
    const m = timeline[i];
    if (m.role !== 'user') continue;
    const text = m.content.trim();
    if (!text && !hasQueuedAttachments(m)) continue; // 본문도 첨부도 없는 행은 존재하지 않는 질문
    // 답변 = 이 질문 이후·다음 질문 이전의 첫 agent(공감 제외) 행
    let answer: ChatMessage | undefined;
    for (let j = i + 1; j < timeline.length; j += 1) {
      const n = timeline[j];
      if (n.role === 'user') break;
      if (n.role === 'agent' && n.sourceNeuron !== 'empathy' && (n.content.trim() || hasQueuedAttachments(n))) { answer = n; break; }
    }
    const match = queueItemForMessage(queue, m);
    if (match) usedQueue.add(match.id);
    const status: QueueStatus = match ? match.status : answer ? 'answered' : 'pending';
    if (text) seenText.add(normalizeQueueContent(text));
    items.push({
      id: match?.id ?? m.id,
      text,
      status,
      jumpMessageId: status === 'answered' && answer ? answer.id : m.id,
      questionMessageId: m.id,
      replyCount: m.threadReplyCount ?? 0,
      createdAt: m.createdAt,
      seq: items.length + 1,
    });
  }

  // 서버에만 있는 행(드레인 전 끼어들기 등 — 아직 messages에 없음) → 질문 원문으로 보조 칩
  const serverOnly = queue
    .filter((q) => !usedQueue.has(q.id) && q.content.trim() && !seenText.has(normalizeQueueContent(q.content)))
    .sort((a, b) => a.position - b.position)
    .map((q, k): QueueStripItem => ({ id: q.id, text: q.content.trim(), status: q.status, jumpMessageId: q.messageId, replyCount: 0, seq: items.length + k + 1 }));
  return [...items, ...serverOnly];
}

// ── 답변 대기 (t_363c0faa / 백엔드 t_811e176c 계약) ─────────────────────
// 회신 필요 메시지 스냅샷 — WS reply.pending.updated(queue.updated 관례 동일) + GET /pending.
// 행: {message_id, turn_index, excerpt(에이전트가 요구한 문장), reply_kind: yesno|freeform|both}.
// 발화 해소(백엔드) — 프론트는 스냅샷 적용만 한다. 011 미적용 환경은 빈 스냅샷 → 배지 0 강등.
export type ReplyKind = 'yesno' | 'freeform' | 'both';
export interface PendingReplyItem {
  messageId: string;
  turnIndex: number;
  excerpt: string;
  replyKind: ReplyKind;
}
const REPLY_KINDS: ReplyKind[] = ['yesno', 'freeform', 'both'];
/** kind 형태 검증 — 모른다면 freeform(자유의사 발화로 언제든 해소되는 안전 기본값). */
export function normalizeReplyKind(raw: unknown): ReplyKind {
  return REPLY_KINDS.includes(raw as ReplyKind) ? (raw as ReplyKind) : 'freeform';
}

/** 스냅샷 정규화 — {count, items:[...]} 객체와 raw items 배열 양쪽 수신(queue.updated와 동일 관례).
 *  형태가 아니면 조용히 빈 배열 (계약 미착지/래치 강등 방어). turn_index 오름. */
export function normalizeReplyPending(raw: unknown): PendingReplyItem[] {
  const arr = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.items) ? raw.items : [];
  const out: PendingReplyItem[] = [];
  for (const r of arr) {
    if (!isRecord(r) || typeof r.message_id !== 'string' || !r.message_id) continue;
    out.push({
      messageId: r.message_id,
      turnIndex: typeof r.turn_index === 'number' ? r.turn_index : out.length,
      excerpt: typeof r.excerpt === 'string' ? r.excerpt : '',
      replyKind: normalizeReplyKind(r.reply_kind),
    });
  }
  return out.sort((a, b) => a.turnIndex - b.turnIndex);
}

/** 예/아니오 칩 발화 — 백엔드 isConfirmationUtterance 집합과 호환되는 사전 문구만 (t_135a19b5 게이트). */
export function replyUtterance(kind: 'yes' | 'no', yesText: string, noText: string): string {
  return kind === 'yes' ? yesText : noText;
}

export const EMPTY_PENDING_REPLIES: PendingReplyItem[] = [];

// ── 후속 질문 칩 (t_1797f432 ③ / 백엔드 t_344e047a §3 계약) ─────────────
// answer 완료 시 run.completed의 structured_payload.suggested_questions: [{id,text,locale}]
// (또는 메시지 payload 동명의 필드) → 마지막 에이전트 카드 아래 칩으로 렌더, 탭 시 전송.
// 백엔드 생성 실패 시 필드 자체가 없다 → normalize 결과 [] → 렌더 없음 (사용자 체감 0).
export interface SuggestedQuestion { id: string; text: string; locale?: string }
export function normalizeSuggestedQuestions(value: unknown): SuggestedQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: SuggestedQuestion[] = [];
  for (const r of value) {
    if (!isRecord(r) || typeof r.text !== 'string' || !r.text.trim()) continue;
    out.push({ id: typeof r.id === 'string' ? r.id : `sq-${out.length}`, text: r.text.trim(), locale: typeof r.locale === 'string' ? r.locale : undefined });
    if (out.length >= 3) break; // 계약: 2~3개 — 초과분은 버린다
  }
  return out;
}
/** 큐/칩 상태가 화면에 남지 않도록 세션 전환 시 함께 초기화할 빈 참조 */
export const EMPTY_QUEUE: QueueItem[] = [];
export const EMPTY_THREADS: ThreadIndexEntry[] = [];

/** 새로 작성 중인 초안도 보존하면서 실패한 원문을 입력창으로 돌려준다. */
export function restoreFailedDraft(current: string, failed: string): string {
  return !current || current === failed ? failed : `${current}\n${failed}`;
}

// ── 턴 그룹핑 (t_70cbbd6b: ChatScreen→lib 순수 추출, 로직 무변경) ──
// 같은 turnIndex 의 연속 에이전트 메시지를 하나의 턴 카드로 그룹
export interface TurnGroup {
  key: string;
  role: 'user' | 'system' | 'agent';
  items: ChatMessage[];
}

export function groupByTurn(messages: ChatMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (m.role === 'agent' && last && last.role === 'agent' && (m.runId ? last.items[0].runId === m.runId : last.items[0].turnIndex === m.turnIndex)) {
      last.items.push(m);
    } else {
      groups.push({ key: m.id, role: m.role, items: [m] });
    }
  }
  return groups;
}
