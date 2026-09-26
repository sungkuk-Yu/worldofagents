import { serializeMessage } from '../lib/helpers';
import { parseAcceptLanguage } from '../lib/locale';
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ApiError, badRequest, ok } from '../lib/errors';
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
