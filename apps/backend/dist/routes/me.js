"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meRoutes = meRoutes;
const auth_1 = require("../lib/auth");
const errors_1 = require("../lib/errors");
const skills_1 = require("./skills");
/**
 * /api/me — 내 프로필/리소스 (api-design.md §3.1, §3.7)
 * 프로필 자체는 auth 라우트의 /me와 중복되지 않게 여기서는 확장 리소스만.
 */
async function meRoutes(app) {
    // 내 프로필 (api-design.md §3.1 — GET /me)
    app.get('/', { preHandler: auth_1.requireAuth }, async (request) => {
        const { data, error } = await request.db.from('users').select('*').eq('id', request.userId).maybeSingle();
        if (error || !data)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.AUTH_REQUIRED, '프로필을 찾을 수 없습니다.');
        return (0, errors_1.ok)(data);
    });
    // PATCH /me — 프로필 수정
    app.patch('/', { preHandler: auth_1.requireAuth }, async (request) => {
        const body = request.body;
        const patch = {};
        for (const key of ['display_name', 'avatar_url', 'phone', 'timezone', 'language', 'preferences', 'profile']) {
            if (body[key] !== undefined)
                patch[key] = body[key];
        }
        if (!Object.keys(patch).length) {
            const { data } = await request.db.from('users').select('*').eq('id', request.userId).maybeSingle();
            return (0, errors_1.ok)(data);
        }
        const { data, error } = await request.db.from('users').update(patch).eq('id', request.userId).select().single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, '프로필 수정에 실패했습니다.', { detail: error.message });
        return (0, errors_1.ok)(data);
    });
    // 내 에이전트 목록 (빠른 접근용)
    app.get('/agents', { preHandler: auth_1.requireAuth }, async (request) => {
        const { data } = await request.db.from('agents').select('*').eq('owner_id', request.userId).eq('is_active', true).order('created_at', { ascending: false });
        return (0, errors_1.ok)(data || []);
    });
    // 내 세션 목록
    app.get('/sessions', { preHandler: auth_1.requireAuth }, async (request) => {
        const { data } = await request.db.from('sessions').select('*').eq('user_id', request.userId).eq('status', 'active').order('last_activity_at', { ascending: false }).limit(50);
        return (0, errors_1.ok)(data || []);
    });
    // 스킬 (설치/등록) — meSkillRoutes와 통합
    await (0, skills_1.meSkillRoutes)(app);
}
//# sourceMappingURL=me.js.map