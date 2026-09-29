import { ServerMessage } from './protocol';

type StampedMessage = ServerMessage & { seq: number };
const sequences = new Map<string, number>();
const buffers = new Map<string, StampedMessage[]>();
const recordedTypes = new Set([
  'message.new', 'run.started', 'run.progress', 'run.completed', 'run.failed', 'run.cancelled',
  'answer.delta', 'answer.done', 'neuron.status', 'transcript.partial', 'transcript.final', 'queue.update',
  'queue.updated', 'relay.updated',
  'reply.pending.updated',
  'persona.line', // t_5cba9ebb — 재접속 재생 시 마지막 진행 줄 복원 (휘발성 연출, 메시지 아님)
]);

/** 연결 유무와 무관하게 세션별 최근 500개 이벤트를 기록한다. */
export function recordEvent(sessionId: string, message: ServerMessage): ServerMessage {
  if (!recordedTypes.has(message.type)) return message;
  const seq = currentSeq(sessionId) + 1;
  sequences.set(sessionId, seq);
  const stamped = { ...message, seq };
  const buffer = buffers.get(sessionId) || [];
  buffer.push(stamped);
  if (buffer.length > 500) buffer.shift();
  buffers.set(sessionId, buffer);
  return stamped;
}

export function currentSeq(sessionId: string): number {
  return sequences.get(sessionId) || 0;
}

export function replaySince(sessionId: string, lastSeq: number): StampedMessage[] {
  return (buffers.get(sessionId) || []).filter(event => event.seq > lastSeq);
}

interface ActiveRun {
  runId: string;
  abort: AbortController;
  partial: () => string;
}
const activeRuns = new Map<string, ActiveRun[]>();

export function registerRun(sessionId: string, run: ActiveRun): () => void {
  const runs = activeRuns.get(sessionId) || [];
  runs.push(run);
  activeRuns.set(sessionId, runs);
  return () => {
    const index = runs.indexOf(run);
    if (index >= 0) runs.splice(index, 1);
    if (!runs.length) activeRuns.delete(sessionId);
  };
}

/** 세션에 실행 중인 턴이 있는지 (t_344e047a 질문 큐 — 실행 중 끼어들기 판정). */
export function hasActiveRun(sessionId: string): boolean {
  return (activeRuns.get(sessionId)?.length ?? 0) > 0;
}

/**
 * 진입 중복 억제 (t_c31e3f45 요구①, 9/29 재현): Enter+전송 버튼 동시 탭 등 짧은 창
 * 동일 content 재발송은 **실행 중인 턴이 있을 때** 큐→드레인으로 user 행 2개로 영속된다
 * (재현 실측: POST#1 201 + POST#2 202 queued → 드레인 후 user 2행). 이 경우만 accident로
 * 보고 드롭한다. 실행이 끝난 뒤 동일 발화 재전송(실수정/재요청)은 통과 — 그쪽은
 * repeatUtterance 에코 게이트가 담당 (의미 있는 재요청은 답변 진행으로 답한다).
 */
const ingressSeen = new Map<string, { content: string; at: number }>();
export const INGRESS_DEDUP_WINDOW_MS = 3000;
export function isDuplicateIngress(sessionId: string, content: string, now = Date.now()): boolean {
  const prev = ingressSeen.get(sessionId);
  ingressSeen.set(sessionId, { content, at: now }); // 모든 접수가 기록 — 다음 판정 시드
  return !!prev && prev.content === content && now - prev.at < INGRESS_DEDUP_WINDOW_MS && hasActiveRun(sessionId);
}

export function cancelRun(sessionId: string, runId?: string): boolean {
  const runs = activeRuns.get(sessionId);
  const run = runId === undefined ? runs?.at(-1) : runs?.find(entry => entry.runId === runId);
  if (!run) return false;
  run.abort.abort();
  return true;
}


/** 탈퇴 시 실행을 중단하고, 실행 종료 후 재생 버퍼까지 파기한다. */
export function cancelSessionRuns(sessionId: string): void {
  for (const run of activeRuns.get(sessionId) || []) run.abort.abort();
}
export function clearSessionEvents(sessionId: string): void {
  buffers.delete(sessionId);
  sequences.delete(sessionId);
}
