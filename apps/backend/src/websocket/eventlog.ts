import { ServerMessage } from './protocol';

type StampedMessage = ServerMessage & { seq: number };
const sequences = new Map<string, number>();
const buffers = new Map<string, StampedMessage[]>();
const recordedTypes = new Set([
  'message.new', 'run.started', 'run.progress', 'run.completed', 'run.failed', 'run.cancelled',
  'answer.delta', 'answer.done', 'neuron.status', 'transcript.partial', 'transcript.final', 'queue.update',
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

export function cancelRun(sessionId: string, runId?: string): boolean {
  const runs = activeRuns.get(sessionId);
  const run = runId === undefined ? runs?.at(-1) : runs?.find(entry => entry.runId === runId);
  if (!run) return false;
  run.abort.abort();
  return true;
}
