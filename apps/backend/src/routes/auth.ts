import { validateSignupConsents, SignupConsent } from '../lib/consents';
import { FastifyInstance } from 'fastify';
import { config } from '../config';
import { supabaseAdmin, createEphemeralAuthClient, DbClient } from '../lib/supabase';
import { requireAuth } from '../lib/auth';
import { deepMergePreferences } from '../lib/prefs';
import { ok, ApiError, ERROR_CODES, badRequest } from '../lib/errors';

interface SignupBody {
  consents?: SignupConsent[];
  age_confirmed?: boolean;
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
  const { error } = await db.from('users').upsert({
    id: user.id,
    display_name: body?.display_name || user.email?.split('@')[0] || '사용자',
    timezone: body?.timezone || 'Asia/Seoul',
    language: body?.language || 'ko',
  });
  if (error) throw new ApiError('INTERNAL_ERROR', '프로필 저장에 실패했습니다.');
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

    const consents = validateSignupConsents(body, config.devMode);
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      user_metadata: { name: body.display_name },
      email_confirm: true,
    });
    if (error || !data?.user) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, error?.message || '회원가입에 실패했습니다.');
    }

    try {
      await upsertUserProfile(supabaseAdmin, data.user, body);
      const { error: consentError } = await supabaseAdmin.from('consents').insert(consents.map(c => ({
        user_id: data.user.id, consent_type: c.type, version: c.version,
        consented: c.consented, ip_or_device: request.ip,
      })));
      if (consentError) throw new ApiError('INTERNAL_ERROR', '동의 기록 저장에 실패했습니다.');
    } catch (err) {
      // 동의 기록 없는 계정을 발급하지 않도록 실패한 가입을 정리한다.
      await supabaseAdmin.auth.admin.deleteUser?.(data.user.id);
      throw err;
    }

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

    // P0(t_486cf23b): 사용자 세션이 생기는 signInWithPassword는 절대 공유 supabaseAdmin에서
    // 호출하지 않는다. 공유 클라이언트에 세션이 남으면 이후 서버 전체의 DB 요청이
    // service_role 대신 마지막 로그인 사용자의 JWT로 나가 RLS 쓰기 거부가 발생한다.
    // 요청마다 일회용 클라이언트를 생성해 사용하고 폐기한다.
    const ephemeralAuth = createEphemeralAuthClient();
    const { data, error } = await ephemeralAuth.signInWithPassword({ email: body.email, password: body.password });
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
    // 자체 JWT는 stateless라 서버 측 세션 저장소가 없다 — 클라이언트가 토큰을 폐기한다.
    // 공유 admin 클라이언트의 auth 상태를 건드리지 않는다 (P0 t_486cf23b 오염 방지).
    return reply.send(ok({ success: true }));
  });

  // POST /api/auth/session/exchange — Supabase 세션 → 자체 JWT 전환 (t_7e25c65b)
  // 프론트가 signInWithOAuth로 얻은 access token을 Bearer로 보내면 requireAuth의 폴백
  // 경로(GoTrue getUser 검증)가 신원을 확정하고 이 라우트가 자체 JWT를 발급한다. 이후
  // 요청은 1단계(자체 JWT) 경로를 탄다 — 인증 소스 장애와 무관한 내성 확보.
  // OAuth 첫 로그인 지원: users 프로필 행이 없으면 생성하고(실DB 001~017에 auth.users
  // → users 트리거가 없음 — signup 라우트가 수동 upsert하던 것과 동일 방식),
  // provider가 확인되면 oauth_identities(018 초안)에 (provider, provider_user_id)
  // → user_id 매핑을 upsert한다. 매핑 실패(018 미적용 환경 PGRST42P01 등)는 치명 아니다
  // — 세션 발급은 속행하고 경고만 남긴다(중복가입 방지는 018 적용 후부터 완전).
  app.post('/session/exchange', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId;
    const sb = request.supabaseAuth;
    // 자체 JWT로 온 요청은 기존 email 클레임을 보존하고, Supabase 폴백으로 온 요청은
    // getUser의 email을 클레임에 태운다(프론트가 이후 JWT만 쓰기 때문에 무손상이면 된다).
    const ownEmail = typeof (request.user as { email?: unknown } | undefined)?.email === 'string'
      ? ((request.user as { email: string }).email)
      : '';
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id,display_name')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '프로필 조회에 실패했습니다.');
    if (!profile) {
      const { error: insertError } = await supabaseAdmin.from('users').insert({
        id: userId,
        display_name: (sb?.email || userId).split('@')[0],
        timezone: 'Asia/Seoul',
        language: 'ko',
      });
      // 동시 첫 exchange 레이스에서 2번째 insert는 PK 충돌(409/23505) — 이미 생성된 행을 쓴다.
      if (insertError && !/duplicate|already exists|23505/i.test(insertError.message)) {
        throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '프로필 저장에 실패했습니다.');
      }
    }
    if (sb?.provider) {
      try {
        const { error: mapError } = await supabaseAdmin.from('oauth_identities').upsert(
          {
            provider: sb.provider,
            provider_user_id: sb.provider_user_id,
            user_id: userId,
            email: sb.email,
          },
          { onConflict: 'provider,provider_user_id' }
        );
        if (mapError) request.log.warn(`oauth_identities 매핑 실패(018 미적용 환경?): ${mapError.message}`);
      } catch (err) {
        request.log.warn(`oauth_identities 매핑 예외: ${(err as Error).message}`);
      }
    }
    const token = app.jwt.sign({ sub: userId, email: sb?.email || ownEmail }, { expiresIn: config.jwt.expiresIn });
    return reply.send(ok({ token, user: { id: userId } }));
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
    for (const key of ['display_name', 'avatar_url', 'phone', 'timezone', 'language', 'profile'] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    // preferences는 키 단위 딥 머지 (t_d75ca81c) — 기기별 입력 설정(조이스틱 맵 ↔ PTT 키맵)이
    // 서로의 통째 replace로 유실되는 것을 서버에서 차단한다.
    if (body.preferences !== undefined) {
      const { data: current } = await request.db.from('users').select('preferences').eq('id', request.userId).maybeSingle();
      patch.preferences = deepMergePreferences((current as { preferences?: unknown } | null)?.preferences, body.preferences);
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

    // DEV_MODE: 외부 OAuth 흐름 대신 email을 받아 세션 발급 (t_7e25c65b: provider_user_id를
    // user_metadata에 보존 — 이 계정으로 로그인해 session/exchange 폴백을 타면 018 매핑까지
    // 검증된다. 실프로바이더 미설정 환경의 통합 테스트용 스텁.)
    if (config.devMode && email) {
      const providerUserId = request.body && typeof request.body === 'object'
        ? (request.body as { provider_user_id?: unknown }).provider_user_id
        : undefined;
      const pud = typeof providerUserId === 'string' && providerUserId ? providerUserId : `dev-${provider}-${email}`;
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: 'oauth-dev-password',
        user_metadata: { oauth_provider: provider, provider_user_id: pud },
        email_confirm: true,
      });
      if (error && !data?.user) throw new ApiError(ERROR_CODES.AUTH_INVALID, error.message);
      await upsertUserProfile(supabaseAdmin, data.user!, { display_name: email.split('@')[0] });
      const token = app.jwt.sign({ sub: data.user!.id, email }, { expiresIn: config.jwt.expiresIn });
      return reply.send(ok({ provider, token, user: { id: data.user!.id, email } }));
    }

    throw new ApiError(ERROR_CODES.AUTH_INVALID, 'OAuth 코드 교환은 프로덕션 배포에서 활성화됩니다.', { code: code ? '수신됨' : '없음' });
  });
}