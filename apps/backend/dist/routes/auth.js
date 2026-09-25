"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const config_1 = require("../config");
const supabase_1 = require("../lib/supabase");
const auth_1 = require("../lib/auth");
const errors_1 = require("../lib/errors");
/** 프로필 행을 users 테이블에 upsert */
async function upsertUserProfile(db, user, body) {
    await db.from('users').upsert({
        id: user.id,
        display_name: body?.display_name || user.email?.split('@')[0] || '사용자',
        timezone: body?.timezone || 'Asia/Seoul',
        language: body?.language || 'ko',
    });
}
async function authRoutes(app) {
    // POST /api/auth/signup — 회원가입 (api-design.md §3.1)
    app.post('/signup', async (request, reply) => {
        const body = request.body;
        if (!body?.email || !body?.password) {
            throw (0, errors_1.badRequest)('email과 password는 필수입니다.');
        }
        if (body.password.length < 6) {
            throw (0, errors_1.badRequest)('비밀번호는 6자 이상이어야 합니다.');
        }
        const { data, error } = await supabase_1.supabaseAdmin.auth.admin.createUser({
            email: body.email,
            password: body.password,
            user_metadata: { name: body.display_name },
            email_confirm: true,
        });
        if (error || !data.user) {
            throw new errors_1.ApiError(errors_1.ERROR_CODES.VALIDATION_ERROR, error?.message || '회원가입에 실패했습니다.');
        }
        await upsertUserProfile(request.db || supabase_1.supabaseAdmin, data.user, body);
        // 자체 JWT 발급 (빠른 인증 + 차후 OAuth 계정과 호환)
        const token = app.jwt.sign({ sub: data.user.id, email: body.email }, { expiresIn: config_1.config.jwt.expiresIn });
        return reply.status(201).send((0, errors_1.ok)({
            user: { id: data.user.id, email: data.user.email, display_name: body.display_name },
            token,
        }));
    });
    // POST /api/auth/login — 로그인
    app.post('/login', async (_request, reply) => {
        const body = _request.body;
        if (!body?.email || !body?.password)
            throw (0, errors_1.badRequest)('email과 password는 필수입니다.');
        const { data, error } = await supabase_1.supabaseAdmin.auth.signInWithPassword({ email: body.email, password: body.password });
        if (error || !data.session || !data.user) {
            throw new errors_1.ApiError(errors_1.ERROR_CODES.AUTH_INVALID, '이메일 또는 비밀번호가 올바르지 않습니다.');
        }
        const token = app.jwt.sign({ sub: data.user.id, email: data.user.email }, { expiresIn: config_1.config.jwt.expiresIn });
        return reply.send((0, errors_1.ok)({
            token,
            user: { id: data.user.id, email: data.user.email },
            supabase_session: data.session,
        }));
    });
    // POST /api/auth/refresh — 토큰 갱신
    app.post('/refresh', async (_request, reply) => {
        const { refresh_token } = _request.body;
        if (!refresh_token)
            throw (0, errors_1.badRequest)('refresh_token은 필수입니다.');
        // DEV_MODE: dev-refresh-<userId> 형식에서 사용자 복원
        if (config_1.config.devMode) {
            const userId = refresh_token.startsWith('dev-refresh-') ? refresh_token.replace('dev-refresh-', '') : null;
            if (!userId)
                throw new errors_1.ApiError(errors_1.ERROR_CODES.AUTH_INVALID, '유효하지 않은 refresh token입니다.');
            const { data } = await supabase_1.supabaseAdmin.from('users').select('*').eq('id', userId).maybeSingle();
            if (!data)
                throw new errors_1.ApiError(errors_1.ERROR_CODES.AUTH_INVALID, '사용자를 찾을 수 없습니다.');
            const token = app.jwt.sign({ sub: userId, email: data.email || '' }, { expiresIn: config_1.config.jwt.expiresIn });
            return reply.send((0, errors_1.ok)({ token }));
        }
        throw new errors_1.ApiError(errors_1.ERROR_CODES.TEMPORAL_UNAVAILABLE, '프로덕션 refresh는 Supabase Auth 세션을 사용해 구현됩니다 (곧 지원).', { hint: 'dev 모드에서는 dev-refresh-<userId> 토큰으로 갱신됩니다.' });
    });
    // POST /api/auth/logout — 로그아웃
    app.post('/logout', async (_request, reply) => {
        try {
            await supabase_1.supabaseAdmin.auth.signOut?.();
        }
        catch {
            // 무시 — 토큰 폐기 정책은 클라이언트에서
        }
        return reply.send((0, errors_1.ok)({ success: true }));
    });
    // GET /api/auth/me — 내 프로필
    app.get('/me', { preHandler: auth_1.requireAuth }, async (request) => {
        const { data, error } = await request.db.from('users').select('*').eq('id', request.userId).maybeSingle();
        if (error || !data)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.AUTH_REQUIRED, '프로필을 찾을 수 없습니다.');
        return (0, errors_1.ok)(data);
    });
    // PATCH /api/auth/me — 프로필 수정
    app.patch('/me', { preHandler: auth_1.requireAuth }, async (request) => {
        const body = request.body;
        const patch = {};
        for (const key of ['display_name', 'avatar_url', 'phone', 'timezone', 'language', 'preferences', 'profile']) {
            if (body[key] !== undefined)
                patch[key] = body[key];
        }
        if (!Object.keys(patch).length)
            return (0, errors_1.ok)((await request.db.from('users').select('*').eq('id', request.userId).maybeSingle()).data);
        const { data, error } = await request.db.from('users').update(patch).eq('id', request.userId).select().single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, '프로필 수정에 실패했습니다.', { detail: error.message });
        return (0, errors_1.ok)(data);
    });
    // ── OAuth (api-design.md §3.1 — Google/GitHub/Kakao) ──
    const OAUTH_PROVIDERS = ['google', 'github', 'kakao'];
    function oauthRedirectUrl(provider) {
        const base = process.env[`OAUTH_${provider.toUpperCase()}_REDIRECT`] || '';
        return base || `${config_1.config.cors.origin[0]}/oauth/${provider}/callback`;
    }
    // 사전 설정된 리다이렉트 URL 조회
    app.get('/oauth/:provider/url', async (request) => {
        const { provider } = request.params;
        const providerName = provider;
        if (!OAUTH_PROVIDERS.includes(providerName)) {
            throw (0, errors_1.badRequest)(`지원하지 않는 OAuth provider: ${provider} (지원: ${OAUTH_PROVIDERS.join(', ')})`);
        }
        const clientId = process.env[`OAUTH_${providerName.toUpperCase()}_CLIENT_ID`] || '';
        return (0, errors_1.ok)({
            provider,
            redirect_url: oauthRedirectUrl(providerName),
            auth_url: clientId
                ? `https://account.${providerName === 'kakao' ? 'kakao.com/login' : providerName === 'google' ? 'google.com/o/oauth2/v2/auth' : 'github.com/login/oauth/authorize'}?client_id=${clientId}&redirect_uri=${encodeURIComponent(oauthRedirectUrl(providerName))}&response_type=code`
                : null,
            configured: Boolean(clientId && process.env[`OAUTH_${providerName.toUpperCase()}_CLIENT_SECRET`]),
        });
    });
    // OAuth 콜백 — DEV_MODE에서는 임시 토큰 발급, 프로덕션은 provider 미설정 시 401
    app.post('/oauth/:provider/callback', async (request, reply) => {
        const { provider } = request.params;
        const { code, email } = request.body;
        if (!OAUTH_PROVIDERS.includes(provider))
            throw (0, errors_1.badRequest)('지원하지 않는 OAuth provider.');
        const clientId = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`];
        const clientSecret = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`];
        if (!clientId || !clientSecret) {
            throw new errors_1.ApiError(errors_1.ERROR_CODES.AUTH_INVALID, `OAuth provider(${provider})가 서버에 설정되지 않았습니다.`, {
                setup: `OAUTH_${provider.toUpperCase()}_CLIENT_ID / OAUTH_${provider.toUpperCase()}_CLIENT_SECRET 환경변수를 설정하세요.`,
            });
        }
        // DEV_MODE: 외부 OAuth 흐름 대신 email을 받아 세션 발급
        if (config_1.config.devMode && email) {
            const { data, error } = await supabase_1.supabaseAdmin.auth.admin.createUser({ email, password: 'oauth-dev-password', user_metadata: { oauth_provider: provider }, email_confirm: true });
            if (error && !data?.user)
                throw new errors_1.ApiError(errors_1.ERROR_CODES.AUTH_INVALID, error.message);
            await upsertUserProfile(supabase_1.supabaseAdmin, data.user, { display_name: email.split('@')[0] });
            const token = app.jwt.sign({ sub: data.user.id, email }, { expiresIn: config_1.config.jwt.expiresIn });
            return reply.send((0, errors_1.ok)({ provider, token, user: { id: data.user.id, email } }));
        }
        throw new errors_1.ApiError(errors_1.ERROR_CODES.AUTH_INVALID, 'OAuth 코드 교환은 프로덕션 배포에서 활성화됩니다.', { code: code ? '수신됨' : '없음' });
    });
}
//# sourceMappingURL=auth.js.map