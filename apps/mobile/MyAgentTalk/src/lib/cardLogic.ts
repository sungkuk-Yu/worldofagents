import type { ChatMessage, ForkOrigin } from '../types';
import { isRecord, mergeIncoming, normalizeServerMessages } from './chatLogic';

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
export const forkTitle = (t: (key: string, params: { title: string }) => string, title: string) =>
  t('fork.defaultTitle', { title });
export function parseForkOrigin(value: unknown): ForkOrigin | undefined {
  if (!isRecord(value) || typeof value.session_id !== 'string' || !value.session_id) return undefined;
  return { session_id: value.session_id, message_id: typeof value.message_id === 'string' ? value.message_id : undefined,
    title: typeof value.title === 'string' ? value.title : typeof value.session_title === 'string' ? value.session_title : undefined };
}
export function parseForkSession(value: unknown, oldId: string) {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || value.id === oldId) throw new Error('errors.fork');
  return { id: value.id, title: typeof value.title === 'string' ? value.title : undefined, forked_from: parseForkOrigin(value.forked_from) };
}
