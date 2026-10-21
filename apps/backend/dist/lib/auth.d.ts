import type { FastifyRequest } from 'fastify';
import { DbClient } from './supabase.js';
export declare function isSupabaseAccessToken(token: string): boolean;
/** Authorization 헤더의 Bearer 스킴 토큰 원문 추출 (없으면 ''). */
export declare function extractBearer(request: FastifyRequest): string;
/**
 * Supabase GoTrue access token → 사용자 신원 (sub).
 * 서명+만료 검증은 GoTrue(userinfo 엔드포인트)가 수행하므로 위조/만료 토큰은 401로 떨어진다.
 * 에러 분리: 401/403 → AUTH_INVALID(세션 무효 확정),
 * 네트워크/타임아웃/5xx → AUTH_SERVICE_UNAVAILABLE(503 — 인증 소스 장애, 재시도 가능).
 * DEV_MODE: devstore 발급 dev-access-<uid>를 동일 시맨틱으로 해석한다(users 행 실존
 * 검증 — dev-refresh-<uid> 취급 관례(t_486cf23b refresh 라우트)와 대칭).
 */
export declare function verifySupabaseAccessToken(token: string): Promise<{
    uid: string;
    email: string | null;
    provider: string | null;
    provider_user_id: string | null;
}>;
declare module 'fastify' {
    interface FastifyRequest {
        /** JWT 검증 후 사용자 ID (payload.sub) */
        userId: string;
        /** 사용자 컨텍스트 DB 클라이언트 */
        db: DbClient;
        /** Supabase 토큰 폴백 경로로 통과한 경우에만 설정 — GoTrue userinfo의 email/provider. */
        supabaseAuth?: {
            email: string | null;
            provider: string | null;
            provider_user_id: string;
        };
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
export declare function requireAuth(request: FastifyRequest): Promise<void>;
/** 선택적 인증 — 비로그인 허용 엔드포인트용 (현재는 사용하지 않음) */
export declare function optionalAuth(request: FastifyRequest): Promise<void>;
//# sourceMappingURL=auth.d.ts.map