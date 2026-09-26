import { serializeMessage } from '../lib/helpers';
import { parseAcceptLanguage } from '../lib/locale';
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ApiError, ERROR_CODES, badRequest, ok } from '../lib/errors';
import { getOwnedMessage, selectAllRows } from '../lib/helpers';
import { runTextTurn, textTurnResponse } from '../lib/chatTurn';
import { broadcastToSession } from '../websocket/handler';
import { DbClient } from '../lib/supabase';
import { MessagesRow } from '../types/db';

/** 답글 ID로 조회해도 같은 루트와 전체 답글을 반환한다. */
async function readThread(db: DbClient, message: MessagesRow) {
  const rootId = message.root_message_id || message.id;
  const { data: root, error } = await db.from('messages').select('*')
    .eq('session_id', message.session_id).eq('id', rootId).maybeSingle();
  if (error || !root) throw new ApiError('NOT_FOUND', '스레드를 찾을 수 없습니다.');
  const replies = await selectAllRows(db, 'messages', { session_id: message.session_id, root_message_id: rootId });
  replies.sort((a, b) => a.turn_index - b.turn_index);
  return { root: serializeMessage(root), replies: replies.map(serializeMessage), reply_count: replies.length };
}

export async function messageRoutes(app: FastifyInstance) {
  app.get('/:id', { preHandler: requireAuth }, async request => {
    const { message } = await getOwnedMessage(request.db, request.userId, (request.params as { id: string }).id);
    const thread = await readThread(request.db, message);
    return ok({ ...serializeMessage(message), dialogue_type: message.dialogue_type ?? null, structured_payload: message.structured_payload ?? {},
      thread_summary: { reply_count: thread.reply_count, last_reply_at: thread.replies.at(-1)?.created_at ?? null } });
  });

  app.get('/:id/thread', { preHandler: requireAuth }, async request => {
    const { message } = await getOwnedMessage(request.db, request.userId, (request.params as { id: string }).id);
    return ok(await readThread(request.db, message));
  });

  // PATCH /:id/favorite — 즐겨찾기 등록/해제 (마이그레이션 003, api-design.md 즐겨찾기 절)
  // 소유권 검증: getOwnedMessage — 내 세션 메시지가 아니면 404 (존재 자체를 숨김).
  // WS 브로드캐스트 없음: 즐겨찾기는 개인 상태이며 다른 디바이스는 재접속 시 GET /api/favorites로 동기화 (MVP).
  app.patch('/:id/favorite', { preHandler: requireAuth }, async request => {
    const { message } = await getOwnedMessage(request.db, request.userId, (request.params as { id: string }).id);
    const body = request.body as { favorite?: unknown } | null;
    if (typeof body?.favorite !== 'boolean') throw badRequest('favorite은 boolean(true/false)이어야 합니다.');
    const { data, error } = await request.db.from('messages')
      .update({ favorite: body.favorite }).eq('id', message.id).select().single();
    if (error || !data) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error?.message || '즐겨찾기 갱신에 실패했습니다.');
    return ok(serializeMessage(data as MessagesRow));
  });

  app.post('/:id/replies', { preHandler: requireAuth }, async (request, reply) => {
    const { message, session } = await getOwnedMessage(request.db, request.userId, (request.params as { id: string }).id);
    if (session.status === 'archived') throw new ApiError('SESSION_ARCHIVED', '아카이브된 세션에는 메시지를 보낼 수 없습니다.');
    const body = request.body as { content?: unknown } | null;
    if (typeof body?.content !== 'string' || !body.content.trim()) throw badRequest('메시지 내용(content)은 필수입니다.');
    const rootId = message.root_message_id || message.id;
    const result = await runTextTurn(request.db, session, request.userId, body.content.trim(), {
      locale: parseAcceptLanguage(request.headers['accept-language']),
      thread: { parentMessageId: message.id, rootMessageId: rootId },
      emit: e => broadcastToSession(session.id, e),
    });
    const thread = await readThread(request.db, message);
    return reply.status(201).send(ok({ ...textTurnResponse(result),
      thread: { root_message_id: rootId, parent_message_id: message.id, reply_count: thread.reply_count } }));
  });
}
