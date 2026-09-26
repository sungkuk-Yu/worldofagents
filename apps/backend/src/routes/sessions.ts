import { randomUUID } from 'node:crypto';
import { withSessionLock } from '../lib/turnLock';
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok, ApiError, ERROR_CODES, badRequest } from '../lib/errors';
import { ensureSession, getOwnedSession, selectAllRows } from '../lib/helpers';
import { runTextTurn, textTurnResponse } from '../lib/chatTurn';
import { broadcastToSession } from '../websocket/handler';
import { classifyDialogueType } from '../neurons/router';
import { activateNeuronInstance, deactivateNeuronInstance, listActiveInstances } from '../neurons/registry';
import { readFullContext, readContextValue, clearContextKey } from '../lib/contextSync';
import { listTasksBySession, createTaskInSession } from './tasks';

/** INT4RANGE 문자열과 기존 개발 저장소 객체를 함께 읽는다. */
export function parseRangeUpper(v: unknown): number | null {
  const raw = typeof v === 'string' ? /^\[\s*-?\d+\s*,\s*(-?\d+)\s*\)$/.exec(v)?.[1]
    : v && typeof v === 'object' && 'upper' in v ? v.upper : undefined;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const upper = Number(raw);
  return Number.isFinite(upper) ? upper : null;
}

const SESSION_STATUSES = ['active', 'suspended', 'archived'] as const;

export async function sessionRoutes(app: FastifyInstance) {
  // POST /api/sessions/ensure — 세션 조회(또는 자동 생성) (api-design.md §3.4)
  app.post('/ensure', { preHandler: requireAuth }, async (request, reply) => {
    const { agent_id } = request.body as { agent_id?: string };
    if (!agent_id) throw badRequest('agent_id는 필수입니다.');
    const session = await ensureSession(request.db, request.userId, agent_id);
    return reply.status(201).send(ok(session));
  });

  // GET /api/sessions — 세션 목록
  app.get('/', { preHandler: requireAuth }, async (request) => {
    const { limit = '50' } = request.query as { limit?: string };
    const { data } = await request.db
      .from('sessions')
      .select('*')
      .eq('user_id', request.userId)
      .order('last_activity_at', { ascending: false })
      .limit(Math.min(parseInt(limit, 10) || 50, 200));
    return ok(data || []);
  });

  // GET /api/sessions/:id — 세션 상세
  app.get('/:id', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const { data: messages } = await request.db
      .from('messages')
      .select('*')
      .eq('session_id', session.id)
      .order('turn_index', { ascending: true })
      .limit(200);
    return ok({ ...session, messages: messages || [] });
  });

  // POST /api/sessions/:id/fork — 포크 지점까지 복제하고 원본은 유지한다.
  app.post('/:id/fork', { preHandler: requireAuth }, async (request, reply) => {
    const original = await getOwnedSession(request.db, request.userId, (request.params as { id: string }).id);
    const body = request.body as { from_message_id?: unknown; new_session_title?: unknown } | null;
    if (typeof body?.from_message_id !== 'string' || !body.from_message_id.trim()) throw badRequest('from_message_id는 필수입니다.');
    if (body.new_session_title !== undefined && (typeof body.new_session_title !== 'string' || !body.new_session_title.trim())) {
      throw badRequest('new_session_title은 비어 있지 않은 문자열이어야 합니다.');
    }
    const result = await withSessionLock(original.id, async () => {
      const { data: point, error } = await request.db.from('messages').select('*')
        .eq('session_id', original.id).eq('id', body.from_message_id).maybeSingle();
      if (error || !point) throw new ApiError(ERROR_CODES.NOT_FOUND, '포크 지점 메시지를 찾을 수 없습니다.');
      const db = request.db;
      // 원본 턴 실행과 직렬화하고, 쓰기 전에 복제할 스냅샷을 확정한다.
      const messages = (await selectAllRows(db, 'messages', { session_id: original.id }))
        .filter(row => row.turn_index <= point.turn_index).sort((a, b) => a.turn_index - b.turn_index);
      const withinPoint = (value: unknown) => {
        const upper = parseRangeUpper(value);
        return upper !== null && upper <= point.turn_index;
      };
      const memories = (await selectAllRows(db, 'compressed_memories', { session_id: original.id }))
        .filter(row => withinPoint(row.source_turn_range));
      const transcripts = (await selectAllRows(db, 'raw_transcripts', { session_id: original.id }))
        .filter(row => withinPoint(row.turn_range));
      const patches = await selectAllRows(db, 'context_patches', { session_id: original.id });
      const now = new Date().toISOString();
      const { data: session, error: createError } = await db.from('sessions').insert({
        user_id: original.user_id, agent_id: original.agent_id, persona_id: original.persona_id,
        status: 'active', stream_channel_id: null, created_at: now, last_activity_at: now,
        metadata: { ...(original.metadata as Record<string, unknown>),
          ...(body.new_session_title ? { title: (body.new_session_title as string).trim() } : {}) },
        forked_from: { session_id: original.id, message_id: point.id, turn_index: point.turn_index, forked_at: now },
      }).select().single();
      if (createError || !session) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, createError?.message || '포크 세션 생성 실패');
      try {
        const ids = new Map(messages.map(row => [row.id, randomUUID()]));
        const mapped = (id: string | null) => {
          if (!id) return null;
          const target = ids.get(id);
          if (!target) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '복제 범위를 벗어난 메시지 참조입니다.');
          return target;
        };
        const copies = messages.map(row => ({ ...structuredClone(row), id: ids.get(row.id), session_id: session.id,
          parent_message_id: mapped(row.parent_message_id), root_message_id: mapped(row.root_message_id) }));
        // 같은 INSERT 문 안에서 메시지 외래 키를 함께 생성한다.
        if (copies.length) {
          const { error: copyError } = await db.from('messages').insert(copies);
          if (copyError) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, copyError.message);
        }
        for (const [table, rows] of [
          ['compressed_memories', memories], ['raw_transcripts', transcripts], ['context_patches', patches],
        ] as const) {
          for (const row of rows) {
            const copy = { ...structuredClone(row), session_id: session.id };
            // 컨텍스트 패치의 BIGSERIAL을 포함해 각 테이블 기본값으로 새 ID를 발급한다.
            delete copy.id;
            const { error: copyError } = await db.from(table).insert(copy);
            if (copyError) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, copyError.message);
          }
        }
        return { session, copied: { messages: messages.length, memories: memories.length,
          transcripts: transcripts.length, context_patches: patches.length } };
      } catch (err) {
        // devstore도 같은 결과가 되도록 자식 행을 명시적으로 정리한다.
        for (const table of ['messages', 'compressed_memories', 'raw_transcripts', 'context_patches']) {
          const { error: cleanupError } = await db.from(table).delete().eq('session_id', session.id);
          if (cleanupError) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '포크 실패 후 정리에 실패했습니다.');
        }
        const { error: cleanupError } = await db.from('sessions').delete().eq('id', session.id);
        if (cleanupError) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '포크 실패 후 세션 정리에 실패했습니다.');
        throw err;
      }
    });
    return reply.status(201).send(ok(result));
  });

  // GET /api/sessions/:id/lineage — 소유한 조상과 직계 자식만 반환한다.
  app.get('/:id/lineage', { preHandler: requireAuth }, async request => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as { id: string }).id);
    const ancestors: Record<string, unknown>[] = [];
    const visited = new Set<string>([session.id]);
    let current = session;
    for (let depth = 0; depth < 50; depth++) {
      const link = current.forked_from as Record<string, unknown> | null;
      if (!link || typeof link.session_id !== 'string' || visited.has(link.session_id)) break;
      const { data: parent, error } = await request.db.from('sessions').select('*')
        .eq('id', link.session_id).eq('user_id', request.userId).maybeSingle();
      if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
      if (!parent) break;
      ancestors.push({ session_id: link.session_id, message_id: link.message_id, turn_index: link.turn_index, forked_at: link.forked_at });
      visited.add(link.session_id);
      current = parent;
    }
    const rows = await selectAllRows(request.db, 'sessions', { user_id: request.userId });
    return ok({ ancestors, forks: rows.filter(row => row.forked_from?.session_id === session.id) });
  });

  // PATCH /api/sessions/:id — 세션 상태 변경
  app.patch('/:id', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const { status } = request.body as { status?: string };
    if (!status || !(SESSION_STATUSES as readonly string[]).includes(status)) {
      throw badRequest(`status는 ${SESSION_STATUSES.join('/')} 중 하나여야 합니다.`);
    }
    const { data, error } = await request.db.from('sessions').update({ status }).eq('id', session.id).select().single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    return ok(data);
  });

  // POST /api/sessions/:id/archive — 세션 아카이브
  app.post('/:id/archive', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const { data, error } = await request.db.from('sessions').update({ status: 'archived' }).eq('id', session.id).select().single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    return ok(data);
  });

  // GET /api/sessions/:id/messages — 메시지 히스토리 (cursor는 turn_index 기반)
  app.get('/:id/messages', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const { before, after, role, limit = '50' } = request.query as { before?: string; after?: string; role?: string; limit?: string };
    const max = Math.min(parseInt(limit, 10) || 50, 200);

    let query = request.db.from('messages').select('*').eq('session_id', session.id);
    if (role && ['user', 'agent', 'system'].includes(role)) query = query.eq('role', role);
    const afterIdx = Number.parseInt(after || '', 10);
    const beforeIdx = Number.parseInt(before || '', 10);
    if (Number.isFinite(afterIdx)) query = query.gt('turn_index', afterIdx);
    if (Number.isFinite(beforeIdx)) query = query.lt('turn_index', beforeIdx);
    query = query.order('turn_index', { ascending: false }).limit(max);
    const { data } = await query;

    const rows = ((data as any[]) || []).sort((a, b) => a.turn_index - b.turn_index);
    return ok(rows.map(row => ({
      ...row, dialogue_type: row.dialogue_type ?? null,
      router_dialogue_type: row.role === 'user' ? classifyDialogueType(row.content) : null,
      structured_payload: row.structured_payload ?? {},
    })), { has_more: rows.length === max, total: rows.length });
  });

  // POST /api/sessions/:id/messages — 텍스트 메시지 전송 (뉴런 파이프라인 실행)
  app.post('/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    if (session.status === 'archived') throw new ApiError(ERROR_CODES.SESSION_ARCHIVED, '아카이브된 세션에는 메시지를 보낼 수 없습니다.');

    const body = request.body as { content?: string; message_type?: string; attachments?: unknown[]; stt_metadata?: Record<string, unknown> };
    const content = (body.content || '').trim();
    if (!content) throw badRequest('메시지 내용(content)은 필수입니다.');

    const result = await runTextTurn(request.db, session, request.userId, content, {
      sttMetadata: body.stt_metadata || null,
      emit: e => broadcastToSession(session.id, e),
    });

    return reply.status(201).send(
      ok(textTurnResponse(result))
    );
  });

  // POST /api/sessions/:id/messages/:messageId/feedback — 메시지 피드백
  app.post('/:id/messages/:messageId/feedback', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const { feedback, reason } = request.body as { feedback?: string; reason?: string };
    if (!feedback || !['like', 'dislike'].includes(feedback)) throw badRequest('feedback은 like/dislike 중 하나여야 합니다.');

    const { data: msg } = await request.db.from('messages').select('*').eq('id', (request.params as Record<string, string>).messageId).eq('session_id', session.id).maybeSingle();
    if (!msg) throw new ApiError(ERROR_CODES.NOT_FOUND, '메시지를 찾을 수 없습니다.');

    const { data, error } = await request.db.from('messages').update({ user_feedback: feedback }).eq('id', (request.params as Record<string, string>).messageId).select().single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    return ok({ ...data, reason: reason || null });
  });

  // ── 세션 내 뉴런 인스턴스 (api-design.md §3.5) ──

  // GET /api/sessions/:id/neurons — 활성 뉴런 인스턴스
  app.get('/:id/neurons', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const instances = await listActiveInstances(request.db, session.id);
    return ok(instances);
  });

  // POST /api/sessions/:id/neurons/:neuronId/activate — 뉴런 수동 활성화 (디버그용)
  app.post('/:id/neurons/:neuronId/activate', { preHandler: requireAuth }, async (request, reply) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    try {
      const instance = await activateNeuronInstance(request.db, session.id, (request.params as Record<string, string>).neuronId);
      return reply.status(201).send(ok(instance));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(ERROR_CODES.NEURON_ACTIVATION_FAILED, '뉴런 활성화에 실패했습니다.');
    }
  });

  // DELETE /api/sessions/:id/neurons/:instanceId — 뉴런 비활성화
  app.delete('/:id/neurons/:instanceId', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    await deactivateNeuronInstance(request.db, session.id, (request.params as Record<string, string>).instanceId, 'manual_deactivate');
    return ok({ success: true });
  });

  // GET /api/sessions/:id/neurons/history — 뉴런 연결 이력
  app.get('/:id/neurons/history', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const { limit = '100', event_type } = request.query as { limit?: string; event_type?: string };
    let query = request.db.from('neuron_connections').select('*').eq('session_id', session.id).order('created_at', { ascending: false }).limit(Math.min(parseInt(limit, 10) || 100, 500));
    if (event_type) query = query.eq('event_type', event_type);
    const { data } = await query;
    return ok(data || []);
  });

  // ── 기억/컨텍스트 (api-design.md §3.8) ──

  // GET /api/sessions/:id/memories — 압축 기억 목록
  app.get('/:id/memories', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const { min_importance, tag, limit = '50' } = request.query as { min_importance?: string; tag?: string; limit?: string };
    let query = request.db.from('compressed_memories').select('*').eq('session_id', session.id).order('importance_score', { ascending: false }).limit(Math.min(parseInt(limit, 10) || 50, 200));
    if (min_importance) query = query.gte('importance_score', parseFloat(min_importance));
    const { data: memories } = await query;
    const rows = (memories as any[] || []);
    const filtered = tag ? rows.filter((m) => (m.tags || []).includes(tag)) : rows;
    return ok(filtered);
  });

  // POST /api/sessions/:id/memories/compact — 수동 압축 트리거
  app.post('/:id/memories/compact', { preHandler: requireAuth }, async (request, reply) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);

    // 마지막 압축 턴 이후 메시지를 배치로 묶어 요약 생성 (Phase 1: 템플릿 요약)
    const { data: lastMem } = await request.db.from('compressed_memories').select('*').eq('session_id', session.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const upper = parseRangeUpper(lastMem?.source_turn_range);
    // 신규 문자열은 상한 제외, 기존 객체는 마지막 턴 번호를 저장했다.
    const lastTurn = upper === null ? -1 : typeof lastMem.source_turn_range === 'string' ? upper - 1 : upper;

    const { data: messages } = await request.db.from('messages').select('*').eq('session_id', session.id).gt('turn_index', lastTurn).order('turn_index', { ascending: true });
    const batch = (messages as any[]) || [];
    if (batch.length === 0) return ok({ compacted: false, reason: '압축할 새 메시지가 없습니다.' });

    const summary = batch
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n')
      .slice(0, 2000);

    const { data: mem, error } = await request.db
      .from('compressed_memories')
      .insert({
        session_id: session.id,
        source_batch_id: Math.floor(Date.now() / 1000),
        summary: `(자동 압축 요약) ${summary.slice(0, 300)}`,
        tags: ['auto'],
        importance_score: 0.5,
        compaction_criteria: ['automatic'],
        source_turn_range: `[${lastTurn + 1},${Math.max(...batch.map((m) => m.turn_index)) + 1})`,
      })
      .select()
      .single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);

    // 원본 트랜스크립트 배치 보존 (1단계 메모리)
    await request.db.from('raw_transcripts').insert({
      session_id: session.id,
      batch_id: (mem as { source_batch_id: number }).source_batch_id,
      turn_range: `[${lastTurn + 1},${Math.max(...batch.map((m) => m.turn_index)) + 1})`,
      content: batch.map((m) => ({ role: m.role, content: m.content, turn_index: m.turn_index })),
      is_compacted: true,
      compacted_at: new Date().toISOString(),
    });

    return reply.status(201).send(ok({ compacted: true, memory: mem, batch_size: batch.length }));
  });

  // GET /api/sessions/:id/context — 컨텍스트 스냅샷
  app.get('/:id/context', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const context = await readFullContext(request.db, session.id);
    return ok(context);
  });

  // GET /api/sessions/:id/context/:key — 특정 키 조회
  app.get('/:id/context/:key', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const value = await readContextValue(request.db, session.id, (request.params as Record<string, string>).key);
    return ok({ key: (request.params as Record<string, string>).key, value });
  });

  // DELETE /api/sessions/:id/context/:key — 컨텍스트 키 삭제 (개인정보 대응)
  app.delete('/:id/context/:key', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    try {
      await clearContextKey(request.db, session.id, (request.params as Record<string, string>).key);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    return ok({ success: true });
  });

  // GET /api/sessions/:id/transcripts — 원본 트랜스크립트 (압축 후에도 유지)
  app.get('/:id/transcripts', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const { format = 'json' } = request.query as { format?: string };

    const { data: rawBatches } = await request.db.from('raw_transcripts').select('*').eq('session_id', session.id).order('created_at', { ascending: true });
    const transcripts = (rawBatches as any[] || []).map((b) => ({
      batch_id: b.batch_id,
      turn_range: b.turn_range,
      content: b.content,
      is_compacted: b.is_compacted,
      created_at: b.created_at,
    }));

    if (format === 'text') {
      const lines = transcripts.flatMap((t) => (t.content as { role: string; content: string }[]).map((m) => `[${m.role}] ${m.content}`));
      return ok(lines.join('\n'));
    }
    return ok(transcripts);
  });

  // ── 세션 내 작업 (api-design.md §3.6 — 일부 서브라우트) ──
  app.get('/:id/tasks', { preHandler: requireAuth }, async (request) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    return ok(await listTasksBySession(request.db, session.id, (request.query as { status?: string }).status));
  });

  app.post('/:id/tasks', { preHandler: requireAuth }, async (request, reply) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    const task = await createTaskInSession(request.db, session.id, request.body);
    return reply.status(201).send(ok(task));
  });
}