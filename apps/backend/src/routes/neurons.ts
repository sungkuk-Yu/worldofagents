import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok, ApiError, ERROR_CODES, badRequest, forbidden } from '../lib/errors';
import { ensureDefaultNeurons } from '../neurons/registry';

/**
 * 뉴런 유형 레지스트리 (api-design.md §3.5)
 * - 레지스트리 조회: 활성 뉴런 유형 목록 (공개 카탈로그)
 * - 뉴런 유형 등록: 개발자 제출 → pending(심사 큐) 상태로 생성
 */
export async function neuronRoutes(app: FastifyInstance) {
  // GET /api/neurons — 뉴런 유형 목록 (레지스트리)
  app.get('/', { preHandler: requireAuth }, async (request) => {
    await ensureDefaultNeurons(request.db);
    const { status = 'active', category, limit = '100' } = request.query as { status?: string; category?: string; limit?: string };

    let query = request.db.from('neurons').select('*');
    if (status && ['pending', 'active', 'deprecated', 'blocked'].includes(status)) query = query.eq('status', status);
    if (category && ['core', 'custom', 'experimental'].includes(category)) query = query.eq('category', category);
    const { data } = await query
      .order('created_at', { ascending: true })
      .limit(Math.min(parseInt(limit, 10) || 100, 200));

    return ok(data || []);
  });

  // GET /api/neurons/:neuronId — 뉴런 유형 상세
  app.get('/:neuronId', { preHandler: requireAuth }, async (request) => {
    const { neuronId } = request.params as { neuronId: string };
    const { data, error } = await request.db.from('neurons').select('*').eq('id', neuronId).maybeSingle();
    if (error || !data) throw new ApiError(ERROR_CODES.NEURON_NOT_FOUND, '뉴런 유형을 찾을 수 없습니다.');
    return ok(data);
  });

  // POST /api/neurons — 뉴런 유형 등록 (개발자/관리자) → 보안 심사 큐
  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    const body = request.body as {
      name?: string;
      slug?: string;
      description?: string;
      category?: string;
      version?: string;
      capabilities?: string[];
      trigger_conditions?: string[];
      resource_requirements?: Record<string, unknown>;
      dependencies?: string[];
      persona_compatible?: boolean;
    };
    if (!body.name?.trim()) throw badRequest('뉴런 이름(name)은 필수입니다.');
    if (!body.slug?.trim()) throw badRequest('뉴런 slug는 필수입니다.');
    if (!body.persona_compatible) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'persona_compatible이 false인 뉴런은 등록할 수 없습니다 (단일 페르소나 제약).');
    }

    const { data: dup } = await request.db.from('neurons').select('id').eq('slug', body.slug).maybeSingle();
    if (dup) throw new ApiError(ERROR_CODES.CONFLICT, `이미 존재하는 뉴런 slug입니다: ${body.slug}`);

    const { data: me } = await request.db.from('users').select('display_name').eq('id', request.userId).maybeSingle();

    const { data, error } = await request.db
      .from('neurons')
      .insert({
        name: body.name,
        slug: body.slug,
        description: body.description || null,
        category: body.category && ['core', 'custom', 'experimental'].includes(body.category) ? body.category : 'custom',
        version: body.version || '1.0.0',
        author: (me as { display_name?: string } | null)?.display_name || 'unknown',
        capabilities: body.capabilities || [],
        trigger_conditions: body.trigger_conditions || [],
        resource_requirements: body.resource_requirements || {},
        dependencies: body.dependencies || [],
        persona_compatible: true,
        status: 'pending', // 보안 심사 대기
        always_active: false,
        usage_count: 0,
        success_count: 0,
        failure_count: 0,
        satisfaction_sum: 0,
        satisfaction_count: 0,
      })
      .select()
      .single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    return reply.status(201).send(ok({ ...data, queue: 'security_review' }));
  });
}