/**
 * Supabase 세션 통합 회귀 (t_7e25c65b, DEV_MODE 인메모리).
 *
 * 커버:
 *  (1) requireAuth 이중경로 — 자체 JWT(HS256)는 1단계에서 종결(기존 email/password 세션
 *      무손상), devstore Supabase 세션(dev-access-<uid>)은 폴백 getUser로 종결.
 *  (2) 폴백 형상 게이트 — 임의 문자열/ours 만료 토큰은 getUser 라운드트립 없이
 *      AUTH_REQUIRED(기존 계약). RS256 3-세그먼트만 폴백 진행(운영 분기 fetch 모킹으로 검증).
 *  (3) 운영 폴백 에러 분리 — getUser 401→AUTH_INVALID, 네트워크/타임아웃→
 *      AUTH_SERVICE_UNAVAILABLE(503), 200→sub+provider→oauth_identities 매핑.
 *  (4) POST /api/auth/session/exchange — 자체 JWT/Supabase 세션 양쪽 모두 200+token,
 *      발급 토큰이 /api/auth/me를 통과. 프로필 행이 없으면 자체 프로비저닝.
 *  (5) OAuth 스텁 콜백(t_7e25c65b 확장) → 로그인 → exchange → (provider,provider_user_id)
 *      매핑 read-back. 018 초안 테이블의 devstore 대응.
 *
 * 파일 격리 관례(attachments/isolation 동일): vitest 파일별 워커 — createTestApp 1회.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config';
import { getStore } from '../../src/lib/devstore';
import { createTestApp, signup, bearer, closeTestApp, TestApp } from '../helpers';

let app: TestApp;

beforeAll(async () => { app = await createTestApp(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await closeTestApp(app); });

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Supabase GoTrue가 발급하는 RS256 형태 접근 토큰의 모사(서명은 검증 대상 아님 — getUser가 본다). */
const rs256Jwt = (payload: Record<string, unknown>) =>
  `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u(payload)}.fakesignature`;

/** getUser 모사: fetch 스파이 + devMode 봉인 해제(운영 코드 경로 진입). */
function mockProdUserinfo(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: unknown) =>
    handler(String(input), init as RequestInit | undefined)));
}

async function devSupabaseSession(email: string, password = 'password123') {
  await signup(app, email, password);
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const data = res.json().data;
  return { accessToken: data.supabase_session.access_token as string, ownJwt: data.token as string, userId: data.user.id as string };
}

describe('(1) requireAuth 이중경로 — 자체 JWT 회귀 + Supabase 세션 폴백', () => {
  it('email/password 발급 자체 JWT는 기존대로 /api/auth/me 200 (무손상 회귀)', async () => {
    const { token, userId } = await signup(app, 'legacy-pw@test.io');
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(userId);
  });

  it('로그인 응답의 Supabase 세션(access_token)을 직접 Bearer로 쓰면 폴백 경로로 200', async () => {
    const { accessToken, userId } = await devSupabaseSession('sb-direct@test.io');
    expect(accessToken.startsWith('dev-access-')).toBe(true); // devstore 세션 대응물
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(userId);
  });

  it('존재하지 않는 사용자의 dev-access 토큰 → 401 ( 폴백 검증 실패)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/auth/me',
      headers: bearer('dev-access-00000000-0000-0000-0000-000000000000'),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_INVALID');
  });
});

describe('(2) 폴백 형상 게이트 — getUser 라운드트립을 부르는 건 Supabase 형태뿐', () => {
  it('헤더 없음 / 난수 문자열 → AUTH_REQUIRED(기존 계약 불변, 폴백 미진입)', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error.code).toBe('AUTH_REQUIRED');
    const junk = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer('not-a-jwt-at-all') });
    expect(junk.statusCode).toBe(401);
    expect(junk.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('ours HS256인데 서명 오류/만료인 토큰은 AUTH_REQUIRED — RS256 폴백과 혼동 금지', async () => {
    const { token } = await signup(app, 'tamper@test.io');
    const parts = token.split('.');
    // 서명부만 깨뜨려도 헤더는 ours 접두사 → 폴백 아니라 AUTH_REQUIRED
    const broken = `${parts[0]}.${parts[1]}.AAAA-broken-signature`;
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(broken) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_REQUIRED');
  });

  it('HS256 헤더 위조(alg confusion) 토큰도 ours 접두사 → getUser로 전달되지 않는다', async () => {
    const spoof = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'attacker-uid' })}.zzz`;
    const getUserFetch = vi.fn();
    vi.stubGlobal('fetch', getUserFetch); // 진입하면 카운트됨(실패 처리는 irrelevant — 호출 금지가 계약)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(spoof) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_REQUIRED');
    expect(getUserFetch).not.toHaveBeenCalled();
  });
});

describe('(3) 운영 getUser 경로 — 에러 분리 401/네트워크/200 (fetch 모킹)', () => {
  it('getUser 401 → 401 AUTH_INVALID (세션 무효 확정)', async () => {
    mockProdUserinfo(() => new Response('{"message":"invalid JWT"}', { status: 401 }));
    const res = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: bearer(rs256Jwt({ sub: 'u1', exp: 9e9 })),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_INVALID');
  });

  it('getUser 네트워크 장애 → 503 AUTH_SERVICE_UNAVAILABLE (소스 장애는 401과 구별)', async () => {
    mockProdUserinfo(() => { throw new TypeError('fetch failed'); });
    const res = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: bearer(rs256Jwt({ sub: 'u1', exp: 9e9 })),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('AUTH_SERVICE_UNAVAILABLE');
  });

  it('getUser 200 → sub로 라우트 통과 + Bearer/apikey 헤더 계약', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    mockProdUserinfo((url, init) => {
      seen = { url, init };
      return Response.json({ id: 'sb-user-1', email: 'oauth@google.example',
        app_metadata: { provider: 'google' }, identities: [{ provider: 'google', id: 'g-111' }] });
    });
    const token = rs256Jwt({ sub: 'sb-user-1', exp: 9e9 });
    const res = await app.inject({ method: 'POST', url: '/api/auth/session/exchange', headers: bearer(token), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.id).toBe('sb-user-1');
    const h = (seen as unknown as { init: RequestInit }).init.headers as Record<string, string>;
    expect((seen as unknown as { url: string }).url).toContain('/auth/v1/user');
    expect(h.authorization).toBe(`Bearer ${token}`);
    expect(h.apikey).toBe(config.supabase.anonKey);
  });

  it('프로필 없는 첫 OAuth 세션 exchange → users 행 자체 프로비저닝 + oauth_identities 매핑 (018 초안 대응)', async () => {
    mockProdUserinfo(() => Response.json({
      id: 'sb-first-login', email: 'new@kakao.example',
      app_metadata: { provider: 'kakao' }, identities: [{ provider: 'kakao', id: 'k-777' }],
    }));
    const before = getStore().tables.users.filter(r => r.id === 'sb-first-login').length;
    const res = await app.inject({
      method: 'POST', url: '/api/auth/session/exchange',
      headers: bearer(rs256Jwt({ sub: 'sb-first-login', exp: 9e9 })), payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(before).toBe(0);
    const row = getStore().tables.users.find(r => r.id === 'sb-first-login');
    expect(row).toBeTruthy();
    expect(row!.display_name).toBe('new');
    const mapping = getStore().tables.oauth_identities.find(r => r.provider === 'kakao');
    expect(mapping).toMatchObject({ provider_user_id: 'k-777', user_id: 'sb-first-login', email: 'new@kakao.example' });
  });
});

describe('(4) session/exchange — 양쪽 세션 모두 자체 JWT로 전환, 전환 토큰이 실사용 경로 통과', () => {
  it('자체 JWT로 exchange → 새 토큰 발급(무해 재발급) + /api/auth/me 통과', async () => {
    const { token, userId } = await signup(app, 'exchange-own@test.io');
    const res = await app.inject({ method: 'POST', url: '/api/auth/session/exchange', headers: bearer(token), payload: {} });
    expect(res.statusCode).toBe(200);
    const fresh = res.json().data.token;
    expect(fresh).toBeTruthy();
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(fresh) });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.id).toBe(userId);
  });

  it('Supabase 세션(dev-access)으로 exchange → 발급된 자체 JWT가 이후 폴백 없이 동작', async () => {
    const { accessToken } = await devSupabaseSession('exchange-sb@test.io');
    const res = await app.inject({ method: 'POST', url: '/api/auth/session/exchange', headers: bearer(accessToken), payload: {} });
    expect(res.statusCode).toBe(200);
    const own = res.json().data.token;
    // ours 접두사 확인 = HS256 헤더(폴백이 아니라 1단계 경로로 종결)
    const sessions = await app.inject({ method: 'GET', url: '/api/sessions', headers: bearer(own) });
    expect(sessions.statusCode).toBe(200);
  });

  it('인증 없는 exchange → 401 AUTH_REQUIRED', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/session/exchange', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_REQUIRED');
  });
});

describe('(5) OAuth 스텁 콜백(t_7e25c65b 확장) → 로그인 → exchange → 매핑 read-back', () => {
  it('kakao callback(이메일 스텁) 발급 세션의 provider_user_id가 exchange 매핑으로 살아남는다', async () => {
    // 콜백 라우트는 provider 클라이언트 설정 유무를 먼저 본다 — 스텁 경로(devMode+email)라도
    // 통과하려면 env 트루시가 필요하다. 실 .env 유무와 무관하게 결정적으로 세트한다.
    process.env.OAUTH_KAKAO_CLIENT_ID = 'stub-client';
    process.env.OAUTH_KAKAO_CLIENT_SECRET = '***';
    const cb = await app.inject({
      method: 'POST', url: '/api/auth/oauth/kakao/callback',
      payload: { code: 'stub', email: 'kakao-user@test.io', provider_user_id: 'kakaoid-42' },
    });
    expect(cb.statusCode).toBe(200);
    const own = cb.json().data.token;
    // 스텁 계정으로 로그인 → supabase 세션 확보 → exchange → 018 매핑 확인
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'kakao-user@test.io', password: 'oauth-dev-password' } });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().data.supabase_session.access_token as string;
    const ex = await app.inject({ method: 'POST', url: '/api/auth/session/exchange', headers: bearer(accessToken), payload: {} });
    expect(ex.statusCode).toBe(200);
    const uid = cb.json().data.user.id;
    // devstore 폴백 검증은 user_metadata(t_7e25c65b 스텁 확장)를 provider/provider_user_id로
    // 재현 → exchange가 018 대응 테이블에 매핑을 남긴다. 콜백 발급 자체 JWT도 유효.
    const mapping = getStore().tables.oauth_identities.find(r => r.user_id === uid);
    expect(mapping).toMatchObject({ provider: 'kakao', provider_user_id: 'kakaoid-42' });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(own) });
    expect(me.json().data.id).toBe(uid);
  });
});
