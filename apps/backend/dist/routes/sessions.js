"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionRoutes = sessionRoutes;
const auth_1 = require("../lib/auth");
const errors_1 = require("../lib/errors");
const helpers_1 = require("../lib/helpers");
const graph_1 = require("../neurons/graph");
const registry_1 = require("../neurons/registry");
const contextSync_1 = require("../lib/contextSync");
const tasks_1 = require("./tasks");
const SESSION_STATUSES = ['active', 'suspended', 'archived'];
async function sessionRoutes(app) {
    // POST /api/sessions/ensure — 세션 조회(또는 자동 생성) (api-design.md §3.4)
    app.post('/ensure', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const { agent_id } = request.body;
        if (!agent_id)
            throw (0, errors_1.badRequest)('agent_id는 필수입니다.');
        const session = await (0, helpers_1.ensureSession)(request.db, request.userId, agent_id);
        return reply.status(201).send((0, errors_1.ok)(session));
    });
    // GET /api/sessions — 세션 목록
    app.get('/', { preHandler: auth_1.requireAuth }, async (request) => {
        const { limit = '50' } = request.query;
        const { data } = await request.db
            .from('sessions')
            .select('*')
            .eq('user_id', request.userId)
            .order('last_activity_at', { ascending: false })
            .limit(Math.min(parseInt(limit, 10) || 50, 200));
        return (0, errors_1.ok)(data || []);
    });
    // GET /api/sessions/:id — 세션 상세
    app.get('/:id', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const { data: messages } = await request.db
            .from('messages')
            .select('*')
            .eq('session_id', session.id)
            .order('turn_index', { ascending: true })
            .limit(200);
        return (0, errors_1.ok)({ ...session, messages: messages || [] });
    });
    // PATCH /api/sessions/:id — 세션 상태 변경
    app.patch('/:id', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const { status } = request.body;
        if (!status || !SESSION_STATUSES.includes(status)) {
            throw (0, errors_1.badRequest)(`status는 ${SESSION_STATUSES.join('/')} 중 하나여야 합니다.`);
        }
        const { data, error } = await request.db.from('sessions').update({ status }).eq('id', session.id).select().single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        return (0, errors_1.ok)(data);
    });
    // POST /api/sessions/:id/archive — 세션 아카이브
    app.post('/:id/archive', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const { data, error } = await request.db.from('sessions').update({ status: 'archived' }).eq('id', session.id).select().single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        return (0, errors_1.ok)(data);
    });
    // GET /api/sessions/:id/messages — 메시지 히스토리 (cursor는 turn_index 기반)
    app.get('/:id/messages', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const { before, after, role, limit = '50' } = request.query;
        const max = Math.min(parseInt(limit, 10) || 50, 200);
        let query = request.db.from('messages').select('*').eq('session_id', session.id);
        if (role && ['user', 'agent', 'system'].includes(role))
            query = query.eq('role', role);
        if (after)
            query = query.gt('turn_index', parseInt(after, 10) || 0 - 1);
        if (before)
            query = query.lt('turn_index', parseInt(before, 10) || 0);
        query = query.order('turn_index', { ascending: false }).limit(max);
        const { data } = await query;
        const rows = (data || []).sort((a, b) => a.turn_index - b.turn_index);
        return (0, errors_1.ok)(rows, { has_more: rows.length === max, total: rows.length });
    });
    // POST /api/sessions/:id/messages — 텍스트 메시지 전송 (뉴런 파이프라인 실행)
    app.post('/:id/messages', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        if (session.status === 'archived')
            throw new errors_1.ApiError(errors_1.ERROR_CODES.SESSION_ARCHIVED, '아카이브된 세션에는 메시지를 보낼 수 없습니다.');
        const body = request.body;
        const content = (body.content || '').trim();
        if (!content)
            throw (0, errors_1.badRequest)('메시지 내용(content)은 필수입니다.');
        // 활성 페르소나 로드
        const { data: persona } = await request.db.from('personas').select('*').eq('id', session.persona_id).maybeSingle();
        const { rowToPersonaConfig } = await import('../lib/persona.js');
        const personaConfig = persona ? rowToPersonaConfig(persona) : null;
        const result = await (0, graph_1.processTurn)(request.db, session.id, request.userId, session.agent_id, personaConfig, content, {
            sttMetadata: body.stt_metadata || null,
        });
        return reply.status(201).send((0, errors_1.ok)({
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
        }));
    });
    // POST /api/sessions/:id/messages/:messageId/feedback — 메시지 피드백
    app.post('/:id/messages/:messageId/feedback', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const { feedback, reason } = request.body;
        if (!feedback || !['like', 'dislike'].includes(feedback))
            throw (0, errors_1.badRequest)('feedback은 like/dislike 중 하나여야 합니다.');
        const { data: msg } = await request.db.from('messages').select('*').eq('id', request.params.messageId).eq('session_id', session.id).maybeSingle();
        if (!msg)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.NOT_FOUND, '메시지를 찾을 수 없습니다.');
        const { data, error } = await request.db.from('messages').update({ user_feedback: feedback }).eq('id', request.params.messageId).select().single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        return (0, errors_1.ok)({ ...data, reason: reason || null });
    });
    // ── 세션 내 뉴런 인스턴스 (api-design.md §3.5) ──
    // GET /api/sessions/:id/neurons — 활성 뉴런 인스턴스
    app.get('/:id/neurons', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const instances = await (0, registry_1.listActiveInstances)(request.db, session.id);
        return (0, errors_1.ok)(instances);
    });
    // POST /api/sessions/:id/neurons/:neuronId/activate — 뉴런 수동 활성화 (디버그용)
    app.post('/:id/neurons/:neuronId/activate', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        try {
            const instance = await (0, registry_1.activateNeuronInstance)(request.db, session.id, request.params.neuronId);
            return reply.status(201).send((0, errors_1.ok)(instance));
        }
        catch (err) {
            if (err instanceof errors_1.ApiError)
                throw err;
            throw new errors_1.ApiError(errors_1.ERROR_CODES.NEURON_ACTIVATION_FAILED, '뉴런 활성화에 실패했습니다.');
        }
    });
    // DELETE /api/sessions/:id/neurons/:instanceId — 뉴런 비활성화
    app.delete('/:id/neurons/:instanceId', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        await (0, registry_1.deactivateNeuronInstance)(request.db, session.id, request.params.instanceId, 'manual_deactivate');
        return (0, errors_1.ok)({ success: true });
    });
    // GET /api/sessions/:id/neurons/history — 뉴런 연결 이력
    app.get('/:id/neurons/history', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const { limit = '100', event_type } = request.query;
        let query = request.db.from('neuron_connections').select('*').eq('session_id', session.id).order('created_at', { ascending: false }).limit(Math.min(parseInt(limit, 10) || 100, 500));
        if (event_type)
            query = query.eq('event_type', event_type);
        const { data } = await query;
        return (0, errors_1.ok)(data || []);
    });
    // ── 기억/컨텍스트 (api-design.md §3.8) ──
    // GET /api/sessions/:id/memories — 압축 기억 목록
    app.get('/:id/memories', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const { min_importance, tag, limit = '50' } = request.query;
        let query = request.db.from('compressed_memories').select('*').eq('session_id', session.id).order('importance_score', { ascending: false }).limit(Math.min(parseInt(limit, 10) || 50, 200));
        if (min_importance)
            query = query.gte('importance_score', parseFloat(min_importance));
        const { data: memories } = await query;
        const rows = (memories || []);
        const filtered = tag ? rows.filter((m) => (m.tags || []).includes(tag)) : rows;
        return (0, errors_1.ok)(filtered);
    });
    // POST /api/sessions/:id/memories/compact — 수동 압축 트리거
    app.post('/:id/memories/compact', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        // 마지막 압축 턴 이후 메시지를 배치로 묶어 요약 생성 (Phase 1: 템플릿 요약)
        const { data: lastMem } = await request.db.from('compressed_memories').select('*').eq('session_id', session.id).order('importance_score', { ascending: false }).limit(1).maybeSingle();
        const lastTurn = lastMem?.source_turn_range?.upper ?? -1;
        const { data: messages } = await request.db.from('messages').select('*').eq('session_id', session.id).gt('turn_index', lastTurn).order('turn_index', { ascending: true });
        const batch = messages || [];
        if (batch.length === 0)
            return (0, errors_1.ok)({ compacted: false, reason: '압축할 새 메시지가 없습니다.' });
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
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        // 원본 트랜스크립트 배치 보존 (1단계 메모리)
        await request.db.from('raw_transcripts').insert({
            session_id: session.id,
            batch_id: mem.source_batch_id,
            turn_range: { lower: lastTurn + 1, upper: Math.max(...batch.map((m) => m.turn_index)) },
            content: batch.map((m) => ({ role: m.role, content: m.content, turn_index: m.turn_index })),
            is_compacted: true,
            compacted_at: new Date().toISOString(),
        });
        return reply.status(201).send((0, errors_1.ok)({ compacted: true, memory: mem, batch_size: batch.length }));
    });
    // GET /api/sessions/:id/context — 컨텍스트 스냅샷
    app.get('/:id/context', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const context = await (0, contextSync_1.readFullContext)(request.db, session.id);
        return (0, errors_1.ok)(context);
    });
    // GET /api/sessions/:id/context/:key — 특정 키 조회
    app.get('/:id/context/:key', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const value = await (0, contextSync_1.readContextValue)(request.db, session.id, request.params.key);
        return (0, errors_1.ok)({ key: request.params.key, value });
    });
    // DELETE /api/sessions/:id/context/:key — 컨텍스트 키 삭제 (개인정보 대응)
    app.delete('/:id/context/:key', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        try {
            await (0, contextSync_1.clearContextKey)(request.db, session.id, request.params.key);
        }
        catch (err) {
            throw (0, errors_1.badRequest)(err.message);
        }
        return (0, errors_1.ok)({ success: true });
    });
    // GET /api/sessions/:id/transcripts — 원본 트랜스크립트 (압축 후에도 유지)
    app.get('/:id/transcripts', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const { format = 'json' } = request.query;
        const { data: rawBatches } = await request.db.from('raw_transcripts').select('*').eq('session_id', session.id).order('created_at', { ascending: true });
        const transcripts = (rawBatches || []).map((b) => ({
            batch_id: b.batch_id,
            turn_range: b.turn_range,
            content: b.content,
            is_compacted: b.is_compacted,
            created_at: b.created_at,
        }));
        if (format === 'text') {
            const lines = transcripts.flatMap((t) => t.content.map((m) => `[${m.role}] ${m.content}`));
            return (0, errors_1.ok)(lines.join('\n'));
        }
        return (0, errors_1.ok)(transcripts);
    });
    // ── 세션 내 작업 (api-design.md §3.6 — 일부 서브라우트) ──
    app.get('/:id/tasks', { preHandler: auth_1.requireAuth }, async (request) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        return (0, errors_1.ok)(await (0, tasks_1.listTasksBySession)(request.db, session.id, request.query.status));
    });
    app.post('/:id/tasks', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const session = await (0, helpers_1.getOwnedSession)(request.db, request.userId, request.params.id);
        const task = await (0, tasks_1.createTaskInSession)(request.db, session.id, request.body);
        return reply.status(201).send((0, errors_1.ok)(task));
    });
}
//# sourceMappingURL=sessions.js.map