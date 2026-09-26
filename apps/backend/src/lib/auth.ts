import type { FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';
import { DbClient, supabaseAdmin } from './supabase.js';

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
 * 자체 발급 JWT를 검증하고 백엔드 서비스 롤로 DB에 접근한다.
 */
export async function requireAuth(request: FastifyRequest) {
  try {
    await request.jwtVerify();
  } catch {
    throw new ApiError('AUTH_REQUIRED', '인증 토큰이 필요합니다.');
  }

  const payload = request.user as JwtPayload | undefined;
  if (!payload?.sub) {
    throw new ApiError('AUTH_REQUIRED', '인증 토큰이 올바르지 않습니다.');
  }

  request.userId = payload.sub;
  // 소유권 검증은 라우트 수준에서 수행(getOwnedSession/getOwnedAgent/owner_id 필터).
  // 사용자별 RLS 클라이언트(own JWT → Supabase access token 교환)는 Phase 3 과제.
  request.db = supabaseAdmin;
}

/** 선택적 인증 — 비로그인 허용 엔드포인트용 (현재는 사용하지 않음) */
export async function optionalAuth(request: FastifyRequest) {
  try {
    await request.jwtVerify();
    const payload = request.user as JwtPayload | undefined;
    request.userId = payload?.sub || '';
  } catch {
    request.userId = '';
  }
  request.db = supabaseAdmin;
}