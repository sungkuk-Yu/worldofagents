import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiErrorResponse, ApiResponse } from '../types/db';

/**
 * API 에러 코드 — api-design.md §6 매핑.
 */
export const ERROR_CODES = {
  RUN_CANCELLED: 'RUN_CANCELLED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  AUTH_INVALID: 'AUTH_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  AGENT_LIMIT_EXCEEDED: 'AGENT_LIMIT_EXCEEDED',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_ARCHIVED: 'SESSION_ARCHIVED',
  PERSONA_VERSION_CONFLICT: 'PERSONA_VERSION_CONFLICT',
  NEURON_NOT_FOUND: 'NEURON_NOT_FOUND',
  NEURON_ACTIVATION_FAILED: 'NEURON_ACTIVATION_FAILED',
  NEURON_DEGRADED: 'NEURON_DEGRADED',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_ALREADY_COMPLETED: 'TASK_ALREADY_COMPLETED',
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  SKILL_ALREADY_INSTALLED: 'SKILL_ALREADY_INSTALLED',
  SKILL_IN_REVIEW: 'SKILL_IN_REVIEW',
  SKILL_SECURITY_FAILED: 'SKILL_SECURITY_FAILED',
  STT_SERVICE_UNAVAILABLE: 'STT_SERVICE_UNAVAILABLE',
  TEMPORAL_UNAVAILABLE: 'TEMPORAL_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const HTTP_BY_CODE: Record<string, number> = {
  RUN_CANCELLED: 499,
  AUTH_REQUIRED: 401,
  AUTH_EXPIRED: 401,
  AUTH_INVALID: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  AGENT_NOT_FOUND: 404,
  AGENT_LIMIT_EXCEEDED: 403,
  SESSION_NOT_FOUND: 404,
  SESSION_ARCHIVED: 409,
  PERSONA_VERSION_CONFLICT: 409,
  NEURON_NOT_FOUND: 404,
  NEURON_ACTIVATION_FAILED: 500,
  NEURON_DEGRADED: 503,
  TASK_NOT_FOUND: 404,
  TASK_ALREADY_COMPLETED: 409,
  SKILL_NOT_FOUND: 404,
  SKILL_ALREADY_INSTALLED: 409,
  SKILL_IN_REVIEW: 409,
  SKILL_SECURITY_FAILED: 403,
  STT_SERVICE_UNAVAILABLE: 503,
  TEMPORAL_UNAVAILABLE: 503,
  RATE_LIMIT_EXCEEDED: 429,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  code: ErrorCode;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = HTTP_BY_CODE[code] ?? 500;
    this.details = details;
  }
}

export function ok<T>(data: T, meta?: ApiResponse<T>['meta']): ApiResponse<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new ApiError('VALIDATION_ERROR', message, details);

export const notFound = (message: string) => new ApiError('NOT_FOUND', message);
export const conflict = (message: string) => new ApiError('CONFLICT', message);
export const forbidden = (message: string) => new ApiError('FORBIDDEN', message);

/**
 * Fastify 에러 핸들러 — ApiError → 표준 에러 래퍼 응답.
 */
export function errorHandler(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ApiError) {
    const body: ApiErrorResponse = {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    return reply.status(err.statusCode).send(body);
  }

  // Fastify 내장 요청 검증 에러
  const anyErr = err as { statusCode?: number; validation?: unknown; message?: string };
  if (anyErr?.validation) {
    const body: ApiErrorResponse = {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: anyErr.message || '요청 형식이 올바르지 않습니다.',
      },
    };
    return reply.status(400).send(body);
  }

  const statusCode = anyErr?.statusCode && anyErr.statusCode >= 400 ? anyErr.statusCode : 500;
  const body: ApiErrorResponse = {
    ok: false,
    error: {
      code: statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
      message: statusCode >= 500 ? '서버 내부 오류가 발생했습니다.' : (anyErr?.message || '오류가 발생했습니다.'),
    },
  };
  return reply.status(statusCode).send(body);
}