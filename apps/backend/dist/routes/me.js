"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meRoutes = meRoutes;
const helpers_1 = require("../lib/helpers");
const turnLock_1 = require("../lib/turnLock");
const eventlog_1 = require("../websocket/eventlog");
const handler_1 = require("../websocket/handler");
const supabase_1 = require("../lib/supabase");
const storage_1 = require("../lib/storage");
const auth_1 = require("../lib/auth");
const prefs_1 = require("../lib/prefs");
const errors_1 = require("../lib/errors");
const skills_1 = require("./skills");
/**
 * /api/me — 내 프로필/리소스 (api-design.md §3.1, §3.7)
 * 프로필 자체는 auth 라우트의 /me와 중복되지 않게 여기서는 확장 리소스만.
 */
async function meRoutes(app) {
    // SDK 기본값은 완전 삭제이며 DEV 클라이언트도 동일한 cascade 계약을 구현한다.
    app.delete('/', { preHandler: auth_1.requireAuth }, async (request) => {
        try {
            const sessions = await (0, helpers_1.selectAllRows)(supabase_1.supabaseAdmin, 'sessions', { user_id: request.userId });
            for (const session of sessions)
                (0, eventlog_1.cancelSessionRuns)(session.id);
            // 실행 중인 턴이 마무리된 뒤 삭제하여 늦게 도착한 응답도 함께 파기한다.
            await Promise.all(sessions.map(session => (0, turnLock_1.withSessionLock)(session.id, async () => undefined)));
            // 첨부 (t_401c5bd1): 행은 uploader_id FK CASCADE로 지워지지만 Storage 바이트는 DB cascade로
            // 사라지지 않는다 — 탈퇴=개인정보 즉시 파기 원칙에 따라 deleteUser 전에 먼저 찍는다.
            // Storage 파기가 실패해도 계정 삭제는 막지 않는다(경고 후 속행 — 잔존분은 파기 크론이 수거).
            try {
                const { data: attRows } = await supabase_1.supabaseAdmin.from('messages_attachments')
                    .select('object_path').eq('uploader_id', request.userId);
                const paths = (attRows || []).map(r => r.object_path);
                if (paths.length)
                    await (0, storage_1.deleteFromAttachmentsBucket)(paths);
            }
            catch (err) {
                request.log.warn(`탈퇴 첨부 Storage 파기 실패(계정 삭제는 속행, 크론 수거): ${err.message}`);
            }
            if (!supabase_1.supabaseAdmin.auth.admin.deleteUser)
                throw new Error('관리자 삭제 API 없음');
            const { error } = await supabase_1.supabaseAdmin.auth.admin.deleteUser(request.userId);
            if (error)
                throw error;
            for (const session of sessions) {
                (0, eventlog_1.clearSessionEvents)(session.id);
                (0, handler_1.closeSessionConnections)(session.id);
            }
        }
        catch {
            throw new errors_1.ApiError('INTERNAL_ERROR', '회원탈퇴 처리에 실패했습니다.');
        }
        return (0, errors_1.ok)({ deleted: true });
    });
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
        for (const key of ['display_name', 'avatar_url', 'phone', 'timezone', 'language', 'profile']) {
            if (body[key] !== undefined)
                patch[key] = body[key];
        }
        // preferences는 /api/auth/me와 동일하게 키 단위 딥 머지 (t_d75ca81c) —
        // 두 PATCH 경로가 한 컬럼을 통째 replace하면 기기별 설정이 서로를 지운다.
        if (body.preferences !== undefined) {
            const { data: current } = await request.db.from('users').select('preferences').eq('id', request.userId).maybeSingle();
            patch.preferences = (0, prefs_1.deepMergePreferences)(current?.preferences, body.preferences);
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