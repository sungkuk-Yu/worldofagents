import type { ChatMessage, ForkOrigin } from '../types';
import { isRecord, mergeIncoming, normalizeServerMessages } from './chatLogic';
// t_710b5d28 — fork 판별 로직은 forkLogic.ts(부트 안전, chatLogic 비의존)로 이동. 재export로
// 이 모듈의 기존 소비자(Chat/useCardActions/ForkDialog/테스트) import 경로는 그대로다.
export { parseForkOrigin, parseForkSession, forkTitle, canForkAgent } from './forkLogic';

export function parseThread(value: unknown, rootId: string) {
  const body = isRecord(value) && 'data' in value ? value.data : value;
  if (!isRecord(body) || !Array.isArray(body.replies)) throw new Error('errors.thread');
  const root = normalizeServerMessages([body.root])[0];
  if (!root || root.id !== rootId) throw new Error('errors.thread');
  const replies = normalizeServerMessages(body.replies).filter((m) => m.id !== rootId &&
    (!m.parentMessageId || m.parentMessageId === rootId)).map((m) => ({ ...m, parentMessageId: rootId }));
  return { root, replies };
}
export function mergeThread(existing: ChatMessage[], incoming: ChatMessage[], rootId: string) {
  return mergeIncoming(existing, incoming.filter((m) => m.parentMessageId === rootId && m.id !== rootId));
}
export function toggleTaskOverride(message: ChatMessage, index: number, done: boolean): ChatMessage {
  return { ...message, taskOverrides: { ...message.taskOverrides, [index]: !done } };
}
