import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok, ApiError, ERROR_CODES, badRequest } from '../lib/errors';
import { ensureSession, getOwnedSession, nextTurnIndex } from '../lib/helpers';
import { processTurn } from '../neurons/graph';
import { activateNeuronInstance, deactivateNeuronInstance, listActiveInstances, recordConnectionEvent } from '../neurons/registry';
import { readFullContext, readContextValue, clearContextKey } from '../lib/contextSync';
import { listTasksBySession, createTaskInSession } from './tasks';

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
    if (after) query = query.gt('turn_index', parseInt(after, 10) || 0 - 1);
    if (before) query = query.lt('turn_index', parseInt(before, 10) || 0);
    query = query.order('turn_index', { ascending: false }).limit(max);
    const { data } = await query;

    const rows = ((data as any[]) || []).sort((a, b) => a.turn_index - b.turn_index);
    return ok(rows, { has_more: rows.length === max, total: rows.length });
  });

  // POST /api/sessions/:id/messages — 텍스트 메시지 전송 (뉴런 파이프라인 실행)
  app.post('/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    const session = await getOwnedSession(request.db, request.userId, (request.params as Record<string, string>).id);
    if (session.status === 'archived') throw new ApiError(ERROR_CODES.SESSION_ARCHIVED, '아카이브된 세션에는 메시지를 보낼 수 없습니다.');

    const body = request.body as { content?: string; message_type?: string; attachments?: unknown[]; stt_metadata?: Record<string, unknown> };
    const content = (body.content || '').trim();
    if (!content) throw badRequest('메시지 내용(content)은 필수입니다.');

    // 활성 페르소나 로드
    const { data: persona } = await request.db.from('personas').select('*').eq('id', session.persona_id).maybeSingle();
    const { rowToPersonaConfig } = await import('../lib/persona');
    const personaConfig = persona ? rowToPersonaConfig(persona) : null;

    const result = await processTurn(request.db, session.id, request.userId, session.agent_id, personaConfig, content, {
      sttMetadata: body.stt_metadata || null,
    });

    return reply.status(201).send(
      ok({
        user_message_id: result.userMessageId,
        empathy_message_id: result.empathyMessageId,
        answer_message_id: result.answerMessageId,
        empathy_response: result.empathyResponse,
        answer_response: result.answerResponse,
        dialogue_type: result.dialogueType,
        activation_plan: result.activationPlan,
        neuron_events: result.events,
        persona_guard_passed: result.guardPassed,
        engine: result.engine,
      })
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
    const { data: lastMem } = await request.db.from('compressed_memories').select('*').eq('session_id', session.id).order('importance_score', { ascending: false }).limit(1).maybeSingle();
    const lastTurn = (lastMem as { source_turn_range?: { upper: number } } | null)?.source_turn_range?.upper ?? -1;

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
        source_turn_range: { lower: lastTurn + 1, upper: Math.max(...batch.map((m) => m.turn_index)) },
      })
      .select()
      .single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);

    // 원본 트랜스크립트 배치 보존 (1단계 메모리)
    await request.db.from('raw_transcripts').insert({
      session_id: session.id,
      batch_id: (mem as { source_batch_id: number }).source_batch_id,
      turn_range: { lower: lastTurn + 1, upper: Math.max(...batch.map((m) => m.turn_index)) },
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