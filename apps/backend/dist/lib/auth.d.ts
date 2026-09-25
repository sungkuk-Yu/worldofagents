import type { FastifyRequest } from 'fastify';
import { DbClient } from './supabase.js';
declare module 'fastify' {
    interface FastifyRequest {
        /** JWT 검증 후 사용자 ID (payload.sub) */
        userId: string;
        /** 사용자 컨텍스트 DB 클라이언트 */
        db: DbClient;
    }
}
export interface JwtPayload {
    sub: string;
    email?: string;
}
/**
 * 인증 preHandler — Authorization: Bearer <token> 검증.
 * - 프로덕션: Supabase JWT도 수용 (서명 검증은 Fastify JWT secret)
 * - DEV_MODE: 자체 발급 JWT 수용
 */
export declare function requireAuth(request: FastifyRequest): Promise<void>;
/** 선택적 인증 — 비로그인 허용 엔드포인트용 (현재는 사용하지 않음) */
export declare function optionalAuth(request: FastifyRequest): Promise<void>;
//# sourceMappingURL=auth.d.ts.map