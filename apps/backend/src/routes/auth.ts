import { FastifyInstance } from 'fastify';
import { config } from '../config';
import { supabaseAdmin, DbClient } from '../lib/supabase';
import { requireAuth } from '../lib/auth';
import { ok, ApiError, ERROR_CODES, badRequest } from '../lib/errors';

interface SignupBody {
  email: string;
  password: string;
  display_name?: string;
  timezone?: string;
  language?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

/** 프로필 행을 users 테이블에 upsert */
async function upsertUserProfile(db: DbClient, user: { id: string; email?: string | null }, body?: Partial<SignupBody>) {
  await db.from('users').upsert({
    id: user.id,
    display_name: body?.display_name || user.email?.split('@')[0] || '사용자',
    timezone: body?.timezone || 'Asia/Seoul',
    language: body?.language || 'ko',
  });
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/signup — 회원가입 (api-design.md §3.1)
  app.post('/signup', async (request, reply) => {
    const body = request.body as SignupBody;
    if (!body?.email || !body?.password) {
      throw badRequest('email과 password는 필수입니다.');
    }
    if (body.password.length < 6) {
      throw badRequest('비밀번호는 6자 이상이어야 합니다.');
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      user_metadata: { name: body.display_name },
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, error?.message || '회원가입에 실패했습니다.');
    }

    await upsertUserProfile(request.db || supabaseAdmin, data.user, body);

    // 자체 JWT 발급 (빠른 인증 + 차후 OAuth 계정과 호환)
    const token = app.jwt.sign(
      { sub: data.user.id, email: body.email },
      { expiresIn: config.jwt.expiresIn }
    );

    return reply.status(201).send(
      ok({
        user: { id: data.user.id, email: data.user.email, display_name: body.display_name },
        token,
      })
    );
  });

  // POST /api/auth/login — 로그인
  app.post('/login', async (_request, reply) => {
    const body = _request.body as LoginBody;
    if (!body?.email || !body?.password) throw badRequest('email과 password는 필수입니다.');

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email: body.email, password: body.password });
    if (error || !data.session || !data.user) {
      throw new ApiError(ERROR_CODES.AUTH_INVALID, '이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const token = app.jwt.sign(
      { sub: data.user.id, email: data.user.email },
      { expiresIn: config.jwt.expiresIn }
    );

    return reply.send(
      ok({
        token,
        user: { id: data.user.id, email: data.user.email },
        supabase_session: data.session,
      })
    );
  });

  // POST /api/auth/refresh — 토큰 갱신
  app.post('/refresh', async (_request, reply) => {
    const { refresh_token } = _request.body as { refresh_token?: string };
    if (!refresh_token) throw badRequest('refresh_token은 필수입니다.');

    if (!config.devMode && refresh_token.startsWith('dev-refresh-')) {
      throw new ApiError(ERROR_CODES.AUTH_INVALID, '개발용 refresh 토큰은 운영 모드에서 사용할 수 없습니다.');
    }

    // DEV_MODE: dev-refresh-<userId> 형식에서 사용자 복원
    if (config.devMode) {
      const userId = refresh_token.startsWith('dev-refresh-') ? refresh_token.replace('dev-refresh-', '') : null;
      if (!userId) throw new ApiError(ERROR_CODES.AUTH_INVALID, '유효하지 않은 refresh token입니다.');
      const { data } = await supabaseAdmin.from('users').select('*').eq('id', userId).maybeSingle();
      if (!data) throw new ApiError(ERROR_CODES.AUTH_INVALID, '사용자를 찾을 수 없습니다.');
      const token = app.jwt.sign({ sub: userId, email: (data as { email?: string }).email || '' }, { expiresIn: config.jwt.expiresIn });
      return reply.send(ok({ token }));
    }

    throw new ApiError(ERROR_CODES.TEMPORAL_UNAVAILABLE, '프로덕션 refresh는 Supabase Auth 세션을 사용해 구현됩니다 (곧 지원).', { hint: 'dev 모드에서는 dev-refresh-<userId> 토큰으로 갱신됩니다.' });
  });

  // POST /api/auth/logout — 로그아웃
  app.post('/logout', async (_request, reply) => {
    try {
      await supabaseAdmin.auth.signOut?.();
    } catch {
      // 무시 — 토큰 폐기 정책은 클라이언트에서
    }
    return reply.send(ok({ success: true }));
  });

  // GET /api/auth/me — 내 프로필
  app.get('/me', { preHandler: requireAuth }, async (request) => {
    const { data, error } = await request.db.from('users').select('*').eq('id', request.userId).maybeSingle();
    if (error || !data) throw new ApiError(ERROR_CODES.AUTH_REQUIRED, '프로필을 찾을 수 없습니다.');
    return ok(data);
  });

  // PATCH /api/auth/me — 프로필 수정
  app.patch('/me', { preHandler: requireAuth }, async (request) => {
    const body = request.body as { display_name?: string; avatar_url?: string; phone?: string; timezone?: string; language?: string; preferences?: Record<string, unknown>; profile?: Record<string, unknown> };
    const patch: Record<string, unknown> = {};
    for (const key of ['display_name', 'avatar_url', 'phone', 'timezone', 'language', 'preferences', 'profile'] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (!Object.keys(patch).length) return ok((await request.db.from('users').select('*').eq('id', request.userId).maybeSingle()).data);

    const { data, error } = await request.db.from('users').update(patch).eq('id', request.userId).select().single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '프로필 수정에 실패했습니다.', { detail: error.message });
    return ok(data);
  });

  // ── OAuth (api-design.md §3.1 — Google/GitHub/Kakao) ──
  const OAUTH_PROVIDERS = ['google', 'github', 'kakao'] as const;

  function oauthRedirectUrl(provider: (typeof OAUTH_PROVIDERS)[number]): string {
    const base = process.env[`OAUTH_${provider.toUpperCase()}_REDIRECT`] || '';
    return base || `${config.cors.origin[0]}/oauth/${provider}/callback`;
  }

  // 사전 설정된 리다이렉트 URL 조회
  app.get('/oauth/:provider/url', async (request) => {
    const { provider } = request.params as { provider: string };
    const providerName = provider as (typeof OAUTH_PROVIDERS)[number];
    if (!(OAUTH_PROVIDERS as readonly string[]).includes(providerName)) {
      throw badRequest(`지원하지 않는 OAuth provider: ${provider} (지원: ${OAUTH_PROVIDERS.join(', ')})`);
    }
    const clientId = process.env[`OAUTH_${providerName.toUpperCase()}_CLIENT_ID`] || '';
    return ok({
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
    const { provider } = request.params as { provider: string };
    const { code, email } = request.body as { code?: string; email?: string };
    if (!(OAUTH_PROVIDERS as readonly string[]).includes(provider)) throw badRequest('지원하지 않는 OAuth provider.');

    const clientId = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_SECRET`];

    if (!clientId || !clientSecret) {
      throw new ApiError(ERROR_CODES.AUTH_INVALID, `OAuth provider(${provider})가 서버에 설정되지 않았습니다.`, {
        setup: `OAUTH_${provider.toUpperCase()}_CLIENT_ID / OAUTH_${provider.toUpperCase()}_CLIENT_SECRET 환경변수를 설정하세요.`,
      });
    }

    // DEV_MODE: 외부 OAuth 흐름 대신 email을 받아 세션 발급
    if (config.devMode && email) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password: 'oauth-dev-password', user_metadata: { oauth_provider: provider }, email_confirm: true });
      if (error && !data?.user) throw new ApiError(ERROR_CODES.AUTH_INVALID, error.message);
      await upsertUserProfile(supabaseAdmin, data.user!, { display_name: email.split('@')[0] });
      const token = app.jwt.sign({ sub: data.user!.id, email }, { expiresIn: config.jwt.expiresIn });
      return reply.send(ok({ provider, token, user: { id: data.user!.id, email } }));
    }

    throw new ApiError(ERROR_CODES.AUTH_INVALID, 'OAuth 코드 교환은 프로덕션 배포에서 활성화됩니다.', { code: code ? '수신됨' : '없음' });
  });
}