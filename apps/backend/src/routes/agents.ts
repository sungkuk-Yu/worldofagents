import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok, ApiError, ERROR_CODES, badRequest } from '../lib/errors';
import { getOwnedAgent, createDefaultPersona } from '../lib/helpers';
import { getActivePersona, rowToPersonaConfig, PersonaGuard } from '../lib/persona';
import { PersonasRow } from '../types/db';
import { listInstalledCustomNeuronSlugs } from '../neurons/registry';

const AGENT_TYPES = ['shadow', 'assistant', 'custom'] as const;

export async function agentRoutes(app: FastifyInstance) {
  // GET /api/agents — 내 에이전트 목록 (api-design.md §3.2)
  app.get('/', { preHandler: requireAuth }, async (request) => {
    const { status, limit = '20' } = request.query as { status?: string; limit?: string };
    let query = request.db.from('agents').select('*').eq('owner_id', request.userId).order('created_at', { ascending: false });
    if (status === 'active') query = query.eq('is_active', true);
    if (status === 'inactive') query = query.eq('is_active', false);
    query = query.limit(Math.min(parseInt(limit, 10) || 20, 100));
    const { data, error } = await query;
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    return ok(data || []);
  });

  // GET /api/agents/:id — 에이전트 상세
  app.get('/:id', { preHandler: requireAuth }, async (request) => {
    const agent = await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const persona = await getActivePersona(request.db, agent.id);
    const { data: personaVersions } = await request.db.from('personas').select('*').eq('agent_id', agent.id).order('version', { ascending: false });
    return ok({ ...agent, active_persona: persona, personas: personaVersions || [] });
  });

  // POST /api/agents — 에이전트 생성 (+ 기본 페르소나 자동 생성)
  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    const body = request.body as { name?: string; description?: string; avatar_url?: string; agent_type?: string; config?: Record<string, unknown> };
    if (!body.name?.trim()) throw badRequest('에이전트 이름(name)은 필수입니다.');
    if (body.agent_type && !(AGENT_TYPES as readonly string[]).includes(body.agent_type)) throw badRequest(`agent_type은 ${AGENT_TYPES.join('/')} 중 하나여야 합니다.`);

    // 무료 계정 에이전트 한도 (api-design.md §6 — 3개) — DEV_MODE에서는 해제
    const { data: countData } = await request.db.from('agents').select('id').eq('owner_id', request.userId).eq('is_active', true);
    if ((countData as any[] || []).length >= 3 && !(process.env.DEV_MODE === 'true')) {
      throw new ApiError(ERROR_CODES.AGENT_LIMIT_EXCEEDED, '에이전트 생성 한도(3개)를 초과했습니다.');
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
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '에이전트 생성 실패', { detail: error.message });

    const persona = await createDefaultPersona(request.db, data.id, body.name);

    return reply.status(201).send(ok({ ...data, active_persona: persona }));
  });

  // PATCH /api/agents/:id — 에이전트 수정
  app.patch('/:id', { preHandler: requireAuth }, async (request) => {
    await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const body = request.body as { name?: string; description?: string; avatar_url?: string; config?: Record<string, unknown>; is_active?: boolean };
    const patch: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'avatar_url', 'config', 'is_active'] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const { data, error } = await request.db.from('agents').update(patch).eq('id', (request.params as Record<string, string>).id).select().single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    return ok(data);
  });

  // DELETE /api/agents/:id — 소프트 삭제 (연관 데이터 보존, is_active=false)
  app.delete('/:id', { preHandler: requireAuth }, async (request) => {
    await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    await request.db.from('agents').update({ is_active: false }).eq('id', (request.params as Record<string, string>).id);
    return ok({ success: true });
  });

  // POST /api/agents/:id/clone — 에이전트 복제 (페르소나 포함)
  app.post('/:id/clone', { preHandler: requireAuth }, async (request, reply) => {
    const agent = await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const body = request.body as { name?: string };

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
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);

    // 페르소나 전부 복제
    const { data: personas } = await request.db.from('personas').select('*').eq('agent_id', agent.id);
    let activePersona = null;
    for (const p of (personas as PersonasRow[]) || []) {
      const { data: copy } = await request.db.from('personas').insert({ ...p, id: undefined, agent_id: newAgent.id }).select().single();
      if (p.is_active) activePersona = copy;
    }
    return reply.status(201).send(ok({ ...newAgent, active_persona: activePersona }));
  });

  // ── 페르소나 (api-design.md §3.3) ──

  // GET /api/agents/:id/personas — 페르소나 버전 목록
  app.get('/:id/personas', { preHandler: requireAuth }, async (request) => {
    await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const { data } = await request.db.from('personas').select('*').eq('agent_id', (request.params as Record<string, string>).id).order('version', { ascending: false });
    return ok(data || []);
  });

  // GET /api/agents/:id/personas/current — 현재 활성 페르소나
  app.get('/:id/personas/current', { preHandler: requireAuth }, async (request) => {
    await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const persona = await getActivePersona(request.db, (request.params as Record<string, string>).id);
    if (!persona) throw new ApiError(ERROR_CODES.NOT_FOUND, '활성 페르소나가 없습니다.');
    return ok(persona);
  });

  // POST /api/agents/:id/personas — 새 페르소나 버전 생성
  app.post('/:id/personas', { preHandler: requireAuth }, async (request, reply) => {
    const agent = await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const body = request.body as { name?: string; voice_config?: Record<string, unknown>; tone_config?: Record<string, unknown>; style_guide?: Record<string, unknown>; neuron_overrides?: Record<string, unknown>; relationship_type?: string; version?: number };

    const { data: maxVersion } = await request.db.from('personas').select('version').eq('agent_id', agent.id).order('version', { ascending: false }).limit(1).maybeSingle();
    const version = body.version ?? ((maxVersion as { version?: number } | null)?.version ?? 0) + 1;

    // 동일 버전 충돌 검사
    const { data: conflict } = await request.db.from('personas').select('id').eq('agent_id', agent.id).eq('version', version).maybeSingle();
    if (conflict) throw new ApiError(ERROR_CODES.PERSONA_VERSION_CONFLICT, `페르소나 버전 ${version}이 이미 존재합니다. version을 높여주세요.`);

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
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    return reply.status(201).send(ok({ ...data, config: rowToPersonaConfig(data as PersonasRow) }));
  });

  // PATCH /api/agents/:id/personas/:personaId — 페르소나 수정(새 버전 생성)
  app.patch('/:id/personas/:personaId', { preHandler: requireAuth }, async (request, reply) => {
    const agent = await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const { data: current } = await request.db.from('personas').select('*').eq('id', (request.params as Record<string, string>).personaId).eq('agent_id', agent.id).maybeSingle();
    if (!current) throw new ApiError(ERROR_CODES.NOT_FOUND, '페르소나를 찾을 수 없습니다.');

    const body = request.body as Partial<Record<string, unknown>>;
    const { data: maxVersion } = await request.db.from('personas').select('version').eq('agent_id', agent.id).order('version', { ascending: false }).limit(1).maybeSingle();
    const version = ((maxVersion as { version?: number } | null)?.version ?? 0) + 1;

    await request.db.from('personas').update({ is_active: false }).eq('agent_id', agent.id);
    const { data, error } = await request.db
      .from('personas')
      .insert({ ...current, id: undefined, version, is_active: true, ...body })
      .select()
      .single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    return reply.status(201).send(ok({ ...data, config: rowToPersonaConfig(data as PersonasRow) }));
  });

  // POST /api/agents/:id/personas/preview — 페르소나 프리뷰 (실제 저장 안 함)
  app.post('/:id/personas/preview', { preHandler: requireAuth }, async (request) => {
    const agent = await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const body = request.body as { persona_config?: Record<string, unknown>; sample_input?: string };
    const sample = body.sample_input || '안녕!';
    const persona = rowToPersonaConfig({
      id: 'preview',
      agent_id: agent.id,
      version: 0,
      name: (body.persona_config?.name as string) || agent.name,
      voice_config: (body.persona_config?.voice_config as Record<string, unknown>) || {},
      tone_config: (body.persona_config?.tone_config as Record<string, unknown>) || {},
      style_guide: (body.persona_config?.style_guide as Record<string, unknown>) || {},
      neuron_overrides: (body.persona_config?.neuron_overrides as Record<string, unknown>) || {},
      relationship_type: (body.persona_config?.relationship_type as string) || 'assistant',
      is_active: true,
      created_at: new Date().toISOString(),
    });

    const guard = new PersonaGuard(persona);
    const response = `안녕하세요, ${agent.name}입니다! "${sample.trim().slice(0, 40)}" 어떤 부분을 도와드릴까요?`;
    const guardResult = await guard.validate(response, 'answer');
    return ok({ response: guardResult.response, guard_passed: guardResult.passed, persona: { name: persona.name, tone: persona.tone } });
  });

  // GET /api/agents/:id/neurons — 에이전트 사용 가능 뉴런 (기본 4종 + 설치 커스텀)
  app.get('/:id/neurons', { preHandler: requireAuth }, async (request) => {
    await getOwnedAgent(request.db, request.userId, (request.params as Record<string, string>).id);
    const { data: core } = await request.db.from('neurons').select('*').eq('status', 'active').order('created_at', { ascending: true });
    const customSlugs = await listInstalledCustomNeuronSlugs(request.db, request.userId);
    const all = (core as { slug: string }[]) || [];
    const custom = customSlugs.length
      ? all.filter((n) => customSlugs.includes((n as { slug: string }).slug))
      : [];
    return ok({ data: all, custom_installed: custom.map((c) => (c as { slug: string }).slug) });
  });
}