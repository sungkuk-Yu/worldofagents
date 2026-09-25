"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRoutes = agentRoutes;
const auth_1 = require("../lib/auth");
const errors_1 = require("../lib/errors");
const helpers_1 = require("../lib/helpers");
const persona_1 = require("../lib/persona");
const registry_1 = require("../neurons/registry");
const AGENT_TYPES = ['shadow', 'assistant', 'custom'];
async function agentRoutes(app) {
    // GET /api/agents — 내 에이전트 목록 (api-design.md §3.2)
    app.get('/', { preHandler: auth_1.requireAuth }, async (request) => {
        const { status, limit = '20' } = request.query;
        let query = request.db.from('agents').select('*').eq('owner_id', request.userId).order('created_at', { ascending: false });
        if (status === 'active')
            query = query.eq('is_active', true);
        if (status === 'inactive')
            query = query.eq('is_active', false);
        query = query.limit(Math.min(parseInt(limit, 10) || 20, 100));
        const { data, error } = await query;
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        return (0, errors_1.ok)(data || []);
    });
    // GET /api/agents/:id — 에이전트 상세
    app.get('/:id', { preHandler: auth_1.requireAuth }, async (request) => {
        const agent = await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const persona = await (0, persona_1.getActivePersona)(request.db, agent.id);
        const { data: personaVersions } = await request.db.from('personas').select('*').eq('agent_id', agent.id).order('version', { ascending: false });
        return (0, errors_1.ok)({ ...agent, active_persona: persona, personas: personaVersions || [] });
    });
    // POST /api/agents — 에이전트 생성 (+ 기본 페르소나 자동 생성)
    app.post('/', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const body = request.body;
        if (!body.name?.trim())
            throw (0, errors_1.badRequest)('에이전트 이름(name)은 필수입니다.');
        if (body.agent_type && !AGENT_TYPES.includes(body.agent_type))
            throw (0, errors_1.badRequest)(`agent_type은 ${AGENT_TYPES.join('/')} 중 하나여야 합니다.`);
        // 무료 계정 에이전트 한도 (api-design.md §6 — 3개) — DEV_MODE에서는 해제
        const { data: countData } = await request.db.from('agents').select('id').eq('owner_id', request.userId).eq('is_active', true);
        if ((countData || []).length >= 3 && !(process.env.DEV_MODE === 'true')) {
            throw new errors_1.ApiError(errors_1.ERROR_CODES.AGENT_LIMIT_EXCEEDED, '에이전트 생성 한도(3개)를 초과했습니다.');
        }
        const { data, error } = await request.db
            .from('agents')
            .insert({
            owner_id: request.userId,
            name: body.name,
            description: body.description || null,
            avatar_url: body.avatar_url || null,
            agent_type: body.agent_type || 'shadow',
            config: body.config || {},
            is_active: true,
        })
            .select()
            .single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, '에이전트 생성 실패', { detail: error.message });
        const persona = await (0, helpers_1.createDefaultPersona)(request.db, data.id, body.name);
        return reply.status(201).send((0, errors_1.ok)({ ...data, active_persona: persona }));
    });
    // PATCH /api/agents/:id — 에이전트 수정
    app.patch('/:id', { preHandler: auth_1.requireAuth }, async (request) => {
        await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const body = request.body;
        const patch = {};
        for (const key of ['name', 'description', 'avatar_url', 'config', 'is_active']) {
            if (body[key] !== undefined)
                patch[key] = body[key];
        }
        const { data, error } = await request.db.from('agents').update(patch).eq('id', request.params.id).select().single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        return (0, errors_1.ok)(data);
    });
    // DELETE /api/agents/:id — 소프트 삭제 (연관 데이터 보존, is_active=false)
    app.delete('/:id', { preHandler: auth_1.requireAuth }, async (request) => {
        await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        await request.db.from('agents').update({ is_active: false }).eq('id', request.params.id);
        return (0, errors_1.ok)({ success: true });
    });
    // POST /api/agents/:id/clone — 에이전트 복제 (페르소나 포함)
    app.post('/:id/clone', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const agent = await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const body = request.body;
        const { data: newAgent, error } = await request.db
            .from('agents')
            .insert({
            owner_id: request.userId,
            name: body?.name || `${agent.name} (복사본)`,
            description: agent.description,
            avatar_url: agent.avatar_url,
            agent_type: agent.agent_type,
            config: agent.config,
            is_active: true,
        })
            .select()
            .single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        // 페르소나 전부 복제
        const { data: personas } = await request.db.from('personas').select('*').eq('agent_id', agent.id);
        let activePersona = null;
        for (const p of personas || []) {
            const { data: copy } = await request.db.from('personas').insert({ ...p, id: undefined, agent_id: newAgent.id }).select().single();
            if (p.is_active)
                activePersona = copy;
        }
        return reply.status(201).send((0, errors_1.ok)({ ...newAgent, active_persona: activePersona }));
    });
    // ── 페르소나 (api-design.md §3.3) ──
    // GET /api/agents/:id/personas — 페르소나 버전 목록
    app.get('/:id/personas', { preHandler: auth_1.requireAuth }, async (request) => {
        await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const { data } = await request.db.from('personas').select('*').eq('agent_id', request.params.id).order('version', { ascending: false });
        return (0, errors_1.ok)(data || []);
    });
    // GET /api/agents/:id/personas/current — 현재 활성 페르소나
    app.get('/:id/personas/current', { preHandler: auth_1.requireAuth }, async (request) => {
        await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const persona = await (0, persona_1.getActivePersona)(request.db, request.params.id);
        if (!persona)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.NOT_FOUND, '활성 페르소나가 없습니다.');
        return (0, errors_1.ok)(persona);
    });
    // POST /api/agents/:id/personas — 새 페르소나 버전 생성
    app.post('/:id/personas', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const agent = await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const body = request.body;
        const { data: maxVersion } = await request.db.from('personas').select('version').eq('agent_id', agent.id).order('version', { ascending: false }).limit(1).maybeSingle();
        const version = body.version ?? (maxVersion?.version ?? 0) + 1;
        // 동일 버전 충돌 검사
        const { data: conflict } = await request.db.from('personas').select('id').eq('agent_id', agent.id).eq('version', version).maybeSingle();
        if (conflict)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.PERSONA_VERSION_CONFLICT, `페르소나 버전 ${version}이 이미 존재합니다. version을 높여주세요.`);
        // 새 버전을 활성으로, 기존 활성은 비활성
        await request.db.from('personas').update({ is_active: false }).eq('agent_id', agent.id);
        const { data, error } = await request.db
            .from('personas')
            .insert({
            agent_id: agent.id,
            version,
            name: body.name || agent.name,
            voice_config: body.voice_config || {},
            tone_config: body.tone_config || {},
            style_guide: body.style_guide || {},
            neuron_overrides: body.neuron_overrides || {},
            relationship_type: body.relationship_type || 'assistant',
            is_active: true,
        })
            .select()
            .single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        return reply.status(201).send((0, errors_1.ok)({ ...data, config: (0, persona_1.rowToPersonaConfig)(data) }));
    });
    // PATCH /api/agents/:id/personas/:personaId — 페르소나 수정(새 버전 생성)
    app.patch('/:id/personas/:personaId', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const agent = await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const { data: current } = await request.db.from('personas').select('*').eq('id', request.params.personaId).eq('agent_id', agent.id).maybeSingle();
        if (!current)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.NOT_FOUND, '페르소나를 찾을 수 없습니다.');
        const body = request.body;
        const { data: maxVersion } = await request.db.from('personas').select('version').eq('agent_id', agent.id).order('version', { ascending: false }).limit(1).maybeSingle();
        const version = (maxVersion?.version ?? 0) + 1;
        await request.db.from('personas').update({ is_active: false }).eq('agent_id', agent.id);
        const { data, error } = await request.db
            .from('personas')
            .insert({ ...current, id: undefined, version, is_active: true, ...body })
            .select()
            .single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        return reply.status(201).send((0, errors_1.ok)({ ...data, config: (0, persona_1.rowToPersonaConfig)(data) }));
    });
    // POST /api/agents/:id/personas/preview — 페르소나 프리뷰 (실제 저장 안 함)
    app.post('/:id/personas/preview', { preHandler: auth_1.requireAuth }, async (request) => {
        const agent = await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const body = request.body;
        const sample = body.sample_input || '안녕!';
        const persona = (0, persona_1.rowToPersonaConfig)({
            id: 'preview',
            agent_id: agent.id,
            version: 0,
            name: body.persona_config?.name || agent.name,
            voice_config: body.persona_config?.voice_config || {},
            tone_config: body.persona_config?.tone_config || {},
            style_guide: body.persona_config?.style_guide || {},
            neuron_overrides: body.persona_config?.neuron_overrides || {},
            relationship_type: body.persona_config?.relationship_type || 'assistant',
            is_active: true,
            created_at: new Date().toISOString(),
        });
        const guard = new persona_1.PersonaGuard(persona);
        const response = `안녕하세요, ${agent.name}입니다! "${sample.trim().slice(0, 40)}" 어떤 부분을 도와드릴까요?`;
        const guardResult = await guard.validate(response, 'answer');
        return (0, errors_1.ok)({ response: guardResult.response, guard_passed: guardResult.passed, persona: { name: persona.name, tone: persona.tone } });
    });
    // GET /api/agents/:id/neurons — 에이전트 사용 가능 뉴런 (기본 4종 + 설치 커스텀)
    app.get('/:id/neurons', { preHandler: auth_1.requireAuth }, async (request) => {
        await (0, helpers_1.getOwnedAgent)(request.db, request.userId, request.params.id);
        const { data: core } = await request.db.from('neurons').select('*').eq('status', 'active').order('created_at', { ascending: true });
        const customSlugs = await (0, registry_1.listInstalledCustomNeuronSlugs)(request.db, request.userId);
        const all = core || [];
        const custom = customSlugs.length
            ? all.filter((n) => customSlugs.includes(n.slug))
            : [];
        return (0, errors_1.ok)({ data: all, custom_installed: custom.map((c) => c.slug) });
    });
}
//# sourceMappingURL=agents.js.map