"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.optionalAuth = optionalAuth;
const errors_js_1 = require("./errors.js");
const supabase_js_1 = require("./supabase.js");
/**
 * 인증 preHandler — Authorization: Bearer <token> 검증.
 * - 프로덕션: Supabase JWT도 수용 (서명 검증은 Fastify JWT secret)
 * - DEV_MODE: 자체 발급 JWT 수용
 */
async function requireAuth(request) {
    try {
        await request.jwtVerify();
    }
    catch {
        throw new errors_js_1.ApiError('AUTH_REQUIRED', '인증 토큰이 필요합니다.');
    }
    const payload = request.user;
    if (!payload?.sub) {
        throw new errors_js_1.ApiError('AUTH_REQUIRED', '인증 토큰이 올바르지 않습니다.');
    }
    request.userId = payload.sub;
    request.db = (0, supabase_js_1.createUserClient)(
    // devstore/서비스 클라이언트는 토큰 불필요 — 프로덕션에서만 사용
    (request.headers.authorization || '').replace(/^Bearer\s+/i, ''));
}
/** 선택적 인증 — 비로그인 허용 엔드포인트용 (현재는 사용하지 않음) */
async function optionalAuth(request) {
    try {
        await request.jwtVerify();
        const payload = request.user;
        request.userId = payload?.sub || '';
    }
    catch {
        request.userId = '';
    }
    request.db = (0, supabase_js_1.createUserClient)('');
}
//# sourceMappingURL=auth.js.map