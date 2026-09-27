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
/**
 * 갈라내기(fork) 노출 게이트 — 대표님 지시 9/27 (t_55f9ed57): 김비서(비서실장) room에서만 제공.
 * 식별 계약(카드 본문 고정): name '김비서' 또는 preset titleKey 'agent.chief.title' 또는
 * presetCategory/config.role 'chief_of_staff'. role 컬럼 부하는 마이그레이션 불요(프론트 판별).
 * 다른 room에서도 답글(thread)·즐겨찾기·선택 이어가기는 그대로 동작 — 기존 fork 세션/데이터는 보존(숨김만).
 */
export function canForkAgent(agent: { name?: string | null; titleKey?: string | null; category?: string | null; role?: string | null }): boolean {
  // i18n-exempt: 데이터 식별자(서버 agents.name 값) — 사용자 노출 문구 아님
  return agent.name === '김비서' || agent.titleKey === 'agent.chief.title'
    || agent.category === 'chief_of_staff' || agent.role === 'chief_of_staff';
}
export function parseForkOrigin(value: unknown): ForkOrigin | undefined {
  if (!isRecord(value) || typeof value.session_id !== 'string' || !value.session_id) return undefined;
  return { session_id: value.session_id, message_id: typeof value.message_id === 'string' ? value.message_id : undefined,
    title: typeof value.title === 'string' ? value.title : typeof value.session_title === 'string' ? value.session_title : undefined };
}
export function parseForkSession(value: unknown, oldId: string) {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || value.id === oldId) throw new Error('errors.fork');
  return { id: value.id, title: typeof value.title === 'string' ? value.title : undefined, forked_from: parseForkOrigin(value.forked_from) };
}
