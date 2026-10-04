import type { FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';
import { DbClient, supabaseAdmin } from './supabase.js';
import { getStore } from './devstore.js';
import { config } from '../config.js';

/**
 * Supabase access token 판별 (t_7e25c65b — 카드 요구: "requireAuth가 Supabase JWT 검증을
 * 받아쓰도록 확장(additive), 기존 email/password 세션 호환 유지 필수"):
 * ours = @fastify/jwt가 서명하는 HS256 토큰은 헤더 세그먼트가 항상
 * b64url(`{"alg":"HS256","typ":"JWT"}`)=36자 + '.' + b64url(payload)이고, payload는
 * 어떤 키 순서든 `{"`로 시작 → b64url 선두 3자 항시 'eyJ'. 따라서 선두 40자
 * (36자 헤더 + '.' + 3자)가 ours 정적 접두사와 일치하면 무조건 우리 토큰이다.
 * theirs = Supabase GoTrue RS256 — 헤더의 alg 문자열 자체가 RS256라 25번째 문자에서 갈린다.
 * 실패 방향이 안전: ours 접두사가 아니면(그리고 3세그먼트 JWT의 alg가 HS256가 아니면)
 * getUser '검증 시도'로 넘어가고, Supabase가 서명+만료를 인정해야만 신원이 통과한다.
 * 우리 만료/서명오류 토큰은 ours 접두사라 폴백을 타지 않고 jwtVerify 실패 → AUTH_REQUIRED
 * 유지(기존 계약 불변). 오폐허 없음.
 */
const OURS_JWT_PREFIX_40 =
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + // 36자 (정적 헤더)
  '.' +
  Buffer.from('{"').toString('base64url'); // '{"' → b64url 'eyJ' (3자) = 총 40자

export function isSupabaseAccessToken(token: string): boolean {
  if (typeof token !== 'string' || !token) return false;
  // devstore 접근 토큰(dev-access-<uid>) — Supabase 세션의 dev 매칭 포맷.
  if (token.startsWith('dev-access-')) return true;
  // 폴백은 getUser 네트워크 라운드트립을 부른다 — 임의 문자열이 인증 서비스에 중계되는
  // DoS 증폭을 막기 위해 "3세그먼트 JWT + 헤더 alg가 HS256 아님"만 통과시킨다.
  // ours(HS256)는 접두사 검사에서 이미 탈락하므로 이 검사까지 오는 ours 토큰은 없다.
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[2]) return false;
  if (token.startsWith(OURS_JWT_PREFIX_40)) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string };
    return typeof header?.alg === 'string' && header.alg !== 'HS256';
  } catch {
    return false;
  }
}

/** Authorization 헤더의 Bearer 스킴 토큰 원문 추출 (없으면 ''). */
export function extractBearer(request: FastifyRequest): string {
  const header = request.headers.authorization || '';
  const match = /^Bearer (.+)$/i.exec(header);
  return match ? match[1] : '';
}

/** getUser 라운드트립 상한 — 인증 서비스 지연에 요청 핸들이 매달리지 않게. */
const GET_USER_TIMEOUT_MS = 5000;

/**
 * Supabase GoTrue access token → 사용자 신원 (sub).
 * 서명+만료 검증은 GoTrue(userinfo 엔드포인트)가 수행하므로 위조/만료 토큰은 401로 떨어진다.
 * 에러 분리: 401/403 → AUTH_INVALID(세션 무효 확정),
 * 네트워크/타임아웃/5xx → AUTH_SERVICE_UNAVAILABLE(503 — 인증 소스 장애, 재시도 가능).
 * DEV_MODE: devstore 발급 dev-access-<uid>를 동일 시맨틱으로 해석한다(users 행 실존
 * 검증 — dev-refresh-<uid> 취급 관례(t_486cf23b refresh 라우트)와 대칭).
 */
export async function verifySupabaseAccessToken(token: string): Promise<{
  uid: string;
  email: string | null;
  provider: string | null;
  provider_user_id: string | null;
}> {
  if (config.devMode) {
    // devstore의 Supabase 세션 대응물은 dev-access-<uid> (login 응답 supabase_session).
    // 검증 소스는 usersByEmail = auth.users 대응(프로필 행과 무관 — 프로덕션 getUser와 동일
    // 레이어드: auth 신원 유효성만 본다). users 테이블 조회는 profile 미생성 첫 로그인을
    // exchange가 자체 프로비저닝하는 경로(t_7e25c65b)를 막지 않도록 쓰지 않는다.
    if (!token.startsWith('dev-access-')) throw new ApiError('AUTH_INVALID', '세션이 유효하지 않습니다.');
    const uid = token.slice('dev-access-'.length);
    const entry = uid
      ? [...getStore().usersByEmail.values()].find(e => e.user.id === uid) || null
      : null;
    if (!entry) throw new ApiError('AUTH_INVALID', '세션이 유효하지 않습니다.');
    const meta = (entry.user.user_metadata || {}) as { oauth_provider?: string; provider_user_id?: string };
    return {
      uid,
      email: (entry.user.email as string | null) ?? null,
      provider: meta.oauth_provider ?? null,
      provider_user_id: meta.provider_user_id ?? null,
    };
  }
  let res: Response;
  const authHeaderValue = 'Bearer' + ' ' + token;
  try {
    res = await fetch(`${config.supabase.url}/auth/v1/user`, {
      headers: {
        authorization: authHeaderValue,
        apikey: config.supabase.anonKey,
      },
      signal: AbortSignal.timeout(GET_USER_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError('AUTH_SERVICE_UNAVAILABLE', '인증 서비스를 확인할 수 없습니다.', {
      reason: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'network',
    });
  }
  if (res.status === 401 || res.status === 403) throw new ApiError('AUTH_INVALID', '세션이 유효하지 않습니다.');
  if (!res.ok) {
    throw new ApiError('AUTH_SERVICE_UNAVAILABLE', '인증 서비스를 확인할 수 없습니다.', { status: res.status });
  }
  const user = (await res.json().catch(() => null)) as {
    id?: string;
    email?: string | null;
    app_metadata?: { provider?: string };
    identities?: { provider?: string; id?: string }[] | null;
  } | null;
  if (!user?.id) throw new ApiError('AUTH_INVALID', '세션이 유효하지 않습니다.');
  const identity = user.identities?.[0];
  return {
    uid: user.id,
    email: user.email ?? null,
    provider: user.app_metadata?.provider ?? identity?.provider ?? null,
    // oauth_identities.provider_user_id의 최우선 소스는 identity id(GoTrue가 provider에서
    // 받아 저장한 값). 없으면 auth uid로 강등 매핑(018 부분 인덱스/ UNIQUE 제약은 그대로 유효).
    provider_user_id: identity?.id ?? null,
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** JWT 검증 후 사용자 ID (payload.sub) */
    userId: string;
    /** 사용자 컨텍스트 DB 클라이언트 */
    db: DbClient;
    /** Supabase 토큰 폴백 경로로 통과한 경우에만 설정 — GoTrue userinfo의 email/provider. */
    supabaseAuth?: { email: string | null; provider: string | null; provider_user_id: string };
  }
}

export interface JwtPayload {
  sub: string;
  email?: string;
}

/**
 * 인증 preHandler — 이중 검증(Supabase 세션 통합, t_7e25c65b). 우선순위 고정:
 *   1) 자체 JWT(jwtVerify) 성공 → 그대로 통과. 기존 email/password 세션은 이 경로에서
 *      종결되므로 Supabase OAuth 세션 도입과 무관하게 무손상(회귀: oauth-session-exchange.test).
 *   2) jwtVerify 실패 + ours 포맷(만료/서명오류/부재) → AUTH_REQUIRED(기존 계약 그대로).
 *   3) ours가 아닌 3세그먼트 비-HS256 JWT(=Supabase GoTrue)만 getUser 검증 → sub를 userId로 수용.
 * OAuth 연동: 프론트가 signInWithOAuth로 얻은 access token을 직접 Bearer로 써도 모든
 * requireAuth 라우트가 동작하고, POST /api/auth/session/exchange로 자체 JWT 전환도 가능하다.
 */
export async function requireAuth(request: FastifyRequest) {
  let ownJwtFailed = false;
  try {
    await request.jwtVerify();
  } catch {
    ownJwtFailed = true;
  }

  if (!ownJwtFailed) {
    const payload = request.user as JwtPayload | undefined;
    if (!payload?.sub) {
      throw new ApiError('AUTH_REQUIRED', '인증 토큰이 올바르지 않습니다.');
    }
    request.userId = payload.sub;
    request.db = supabaseAdmin;
    return;
  }

  // Supabase 폴백 — 형상 검사(네트워크 없음)를 통과한 Bearer만 userinfo 검증에 보낸다(DoS 증폭 방지).
  // 폴백 경로에서 나온 예외(401 AUTH_INVALID / 503 AUTH_SERVICE_UNAVAILABLE)는 그대로 전파:
  // "ours가 아닌데 Supabase도 아니다"는 신원 없음이므로 401 계열이 맞고, 소스 장애는 503이 맞다.
  const bearer = extractBearer(request);
  if (!bearer || !isSupabaseAccessToken(bearer)) {
    throw new ApiError('AUTH_REQUIRED', '인증 토큰이 필요합니다.');
  }
  const { uid, email, provider, provider_user_id } = await verifySupabaseAccessToken(bearer);
  request.userId = uid;
  // GoTrue userinfo의 identities[0].id가 provider_user_id(최우선 소스). devstore 경로는
  // provider가 null이라 exchange의 매핑 블록이 스킵된다(개발 환경에서 018 테이블 불요).
  request.supabaseAuth = { email, provider, provider_user_id: provider_user_id ?? uid };
  // 소유권 검증은 라우트 수준에서 수행(getOwnedSession/getOwnedAgent/owner_id 필터).
  // 사용자별 RLS 클라이언트(own JWT → Supabase access token 교환)는 Phase 3 과제 —
  // Supabase 토큰 직접 통과 시에도 동일하게 service_role 경유(기존과 권한 확대 없음).
  request.db = supabaseAdmin;
}

/** 선택적 인증 — 비로그인 허용 엔드포인트용 (현재는 사용하지 않음) */
export async function optionalAuth(request: FastifyRequest) {
  try {
    await requireAuth(request);
  } catch {
    request.userId = '';
    request.db = supabaseAdmin;
  }
}