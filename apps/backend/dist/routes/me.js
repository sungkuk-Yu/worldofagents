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