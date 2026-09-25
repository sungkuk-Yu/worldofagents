import type { FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';
import { DbClient, createUserClient } from './supabase.js';

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
  request.db = createUserClient(
    // devstore/서비스 클라이언트는 토큰 불필요 — 프로덕션에서만 사용
    (request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  );
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
  request.db = createUserClient('');
}