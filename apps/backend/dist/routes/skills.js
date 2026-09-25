"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillRoutes = skillRoutes;
exports.meSkillRoutes = meSkillRoutes;
const auth_1 = require("../lib/auth");
const errors_1 = require("../lib/errors");
const SKILL_CATEGORIES = ['general', 'productivity', 'creative', 'analysis', 'communication', 'neuron'];
function parseSkillId(idOrSlug) {
    // UUID 정규식과 슬러그 겹침 방지 — UUID는 length 36
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    return isUuid ? { id: idOrSlug, slug: '' } : { id: '', slug: idOrSlug };
}
async function findSkill(db, idOrSlug) {
    const ref = parseSkillId(idOrSlug);
    const { data } = ref.id
        ? await db.from('skills').select('*').eq('id', ref.id).maybeSingle()
        : await db.from('skills').select('*').eq('slug', ref.slug).maybeSingle();
    if (!data)
        throw new errors_1.ApiError(errors_1.ERROR_CODES.SKILL_NOT_FOUND, '스킬을 찾을 수 없습니다.');
    return data;
}
/** 설치 여부 확인 (스킬 not found 처리 포함) */
async function installedSkill(db, userId, skillId) {
    const { data } = await db.from('skill_installations').select('*').eq('user_id', userId).eq('skill_id', skillId).maybeSingle();
    return data || null;
}
function rankingRows(rows, sort) {
    const list = [...rows];
    if (sort === 'rating') {
        list.sort((a, b) => (b.satisfaction_count ? b.satisfaction_sum / b.satisfaction_count : 0) - (a.satisfaction_count ? a.satisfaction_sum / a.satisfaction_count : 0));
    }
    else if (sort === 'new') {
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    else {
        // popular: 설치수 > 사용빈도 > 만족도 순
        list.sort((a, b) => b.install_count - a.install_count || b.usage_count - a.usage_count);
    }
    return list;
}
async function skillRoutes(app) {
    // GET /api/skills — 스킬 목록 (검색/필터/정렬)
    app.get('/', { preHandler: auth_1.requireAuth }, async (request) => {
        const { q, category, sort = 'popular', price, limit = '50' } = request.query;
        const { data } = await request.db.from('skills').select('*').eq('status', 'published');
        let rows = data || [];
        if (category && SKILL_CATEGORIES.includes(category))
            rows = rows.filter((s) => s.category === category);
        if (q) {
            const needle = q.toLowerCase();
            rows = rows.filter((s) => s.name.toLowerCase().includes(needle) || (s.description || '').toLowerCase().includes(needle) || s.slug.includes(needle));
        }
        if (price === 'free')
            rows = rows.filter((s) => s.price === 0);
        if (price === 'paid')
            rows = rows.filter((s) => s.price > 0);
        rows = rankingRows(rows, sort).slice(0, Math.min(parseInt(limit, 10) || 50, 100));
        return (0, errors_1.ok)(rows, { total: rows.length });
    });
    // GET /api/skills/ranking — 스킬 랭킹 (skill_rankings 뷰 기반)
    app.get('/ranking', { preHandler: auth_1.requireAuth }, async (request) => {
        const { category, limit = '20' } = request.query;
        const { data } = await request.db.from('skills').select('*').eq('status', 'published');
        let rows = data || [];
        if (category && SKILL_CATEGORIES.includes(category))
            rows = rows.filter((s) => s.category === category);
        const ranked = rows
            .map((s) => {
            const satisfaction = s.satisfaction_count ? s.satisfaction_sum / s.satisfaction_count / 5 : 0;
            const installScore = Math.min(s.install_count / 1000, 1);
            const usageScore = Math.min(s.usage_count / 5000, 1);
            return { ...s, composite_score: satisfaction * 0.4 + installScore * 0.3 + usageScore * 0.3 };
        })
            .sort((a, b) => b.composite_score - a.composite_score)
            .slice(0, Math.min(parseInt(limit, 10) || 20, 100));
        return (0, errors_1.ok)(ranked);
    });
    // GET /api/skills/:skillIdOrSlug — 스킬 상세
    app.get('/:skillIdOrSlug', { preHandler: auth_1.requireAuth }, async (request) => {
        const { skillIdOrSlug } = request.params;
        const skill = await findSkill(request.db, skillIdOrSlug);
        return (0, errors_1.ok)(skill);
    });
    // POST /api/skills — 스킬 등록 (개발자) — status=pending_review, 보안 심사 큐 등록
    app.post('/', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const body = request.body;
        if (!body.name?.trim())
            throw (0, errors_1.badRequest)('스킬 이름(name)은 필수입니다.');
        if (!body.slug?.trim())
            throw (0, errors_1.badRequest)('스킬 slug는 필수입니다.');
        if (body.category && !SKILL_CATEGORIES.includes(body.category))
            throw (0, errors_1.badRequest)('category 값이 올바르지 않습니다.');
        const { data: dup } = await request.db.from('skills').select('id').eq('slug', body.slug).maybeSingle();
        if (dup)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.CONFLICT, `이미 존재하는 slug입니다: ${body.slug}`);
        const { data: me } = await request.db.from('users').select('display_name').eq('id', request.userId).maybeSingle();
        const { data, error } = await request.db
            .from('skills')
            .insert({
            name: body.name,
            slug: body.slug,
            description: body.description || null,
            category: body.category || 'general',
            version: '1.0.0',
            author_id: request.userId,
            author_name: me?.display_name || '개발자',
            content: body.content || {},
            icon_url: body.icon_url || null,
            price: Math.max(0, body.price || 0),
            status: 'pending_review',
            security_scan: { review_pending: true, reviewed_at: null },
            install_count: 0,
            usage_count: 0,
            satisfaction_sum: 0,
            satisfaction_count: 0,
        })
            .select()
            .single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        return reply.status(201).send((0, errors_1.ok)({ ...data, queue: 'security_review' }));
    });
    // POST /api/skills/:skillId/install — 스킬 설치 (에이전트 바인딩 선택)
    app.post('/:skillId/install', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const { skillId } = request.params;
        const { agent_id } = request.body;
        const skill = await findSkill(request.db, skillId);
        if (skill.status !== 'published') {
            throw new errors_1.ApiError(errors_1.ERROR_CODES.SKILL_IN_REVIEW, '심사 중이거나 게시되지 않은 스킬은 설치할 수 없습니다.');
        }
        if (await installedSkill(request.db, request.userId, skill.id)) {
            throw new errors_1.ApiError(errors_1.ERROR_CODES.SKILL_ALREADY_INSTALLED, '이미 설치된 스킬입니다.');
        }
        const { data, error } = await request.db
            .from('skill_installations')
            .insert({
            user_id: request.userId,
            skill_id: skill.id,
            agent_id: agent_id || null,
            installed_version: skill.version,
            config: {},
            is_enabled: true,
        })
            .select()
            .single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        await request.db.from('skills').update({ install_count: skill.install_count + 1 }).eq('id', skill.id);
        return reply.status(201).send((0, errors_1.ok)(data));
    });
    // DELETE /api/skills/:skillId/install — 스킬 제거
    app.delete('/:skillId/install', { preHandler: auth_1.requireAuth }, async (request) => {
        const { skillId } = request.params;
        const skill = await findSkill(request.db, skillId);
        const inst = await installedSkill(request.db, request.userId, skill.id);
        if (!inst)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.SKILL_NOT_FOUND, '설치된 스킬이 아닙니다.');
        await request.db.from('skill_installations').delete().eq('id', inst.id);
        await request.db.from('skills').update({ install_count: Math.max(0, skill.install_count - 1) }).eq('id', skill.id);
        return (0, errors_1.ok)({ success: true });
    });
    // POST /api/skills/:skillId/rate — 스킬 평가 (1~5)
    app.post('/:skillId/rate', { preHandler: auth_1.requireAuth }, async (request) => {
        const { skillId } = request.params;
        const skill = await findSkill(request.db, skillId);
        const { rating } = request.body;
        if (rating === undefined || !Number.isInteger(rating) || rating < 1 || rating > 5) {
            throw (0, errors_1.badRequest)('rating은 1~5 사이의 정수여야 합니다.');
        }
        await request.db.rpc('record_skill_feedback', { p_skill_id: skill.id, p_rating: rating });
        const { data } = await request.db.from('skills').select('*').eq('id', skill.id).single();
        return (0, errors_1.ok)(data);
    });
}
// ── /api/me 하위 스킬 라우트 (api-design.md §3.7) ──
async function meSkillRoutes(app) {
    // GET /api/me/skills — 내가 설치한 스킬
    app.get('/skills', { preHandler: auth_1.requireAuth }, async (request) => {
        const { data } = await request.db.from('skill_installations').select('*').eq('user_id', request.userId).eq('is_enabled', true).order('installed_at', { ascending: false });
        const rows = data || [];
        const items = [];
        for (const row of rows) {
            const skill = await findSkillSafe(request.db, row.skill_id);
            items.push({ ...row, skill });
        }
        return (0, errors_1.ok)(items);
    });
    // GET /api/me/skills/authored — 내가 등록한 스킬 (개발자)
    app.get('/skills/authored', { preHandler: auth_1.requireAuth }, async (request) => {
        const { data } = await request.db.from('skills').select('*').eq('author_id', request.userId).order('created_at', { ascending: false });
        return (0, errors_1.ok)(data || []);
    });
}
async function findSkillSafe(db, skillId) {
    const { data } = await db.from('skills').select('*').eq('id', skillId).maybeSingle();
    return data || null;
}
//# sourceMappingURL=skills.js.map