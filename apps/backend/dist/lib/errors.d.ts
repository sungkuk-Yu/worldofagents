import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiResponse } from '../types/db';
/**
 * API 에러 코드 — api-design.md §6 매핑.
 */
export declare const ERROR_CODES: {
    readonly AUTH_REQUIRED: "AUTH_REQUIRED";
    readonly AUTH_EXPIRED: "AUTH_EXPIRED";
    readonly AUTH_INVALID: "AUTH_INVALID";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly AGENT_NOT_FOUND: "AGENT_NOT_FOUND";
    readonly AGENT_LIMIT_EXCEEDED: "AGENT_LIMIT_EXCEEDED";
    readonly SESSION_NOT_FOUND: "SESSION_NOT_FOUND";
    readonly SESSION_ARCHIVED: "SESSION_ARCHIVED";
    readonly PERSONA_VERSION_CONFLICT: "PERSONA_VERSION_CONFLICT";
    readonly NEURON_NOT_FOUND: "NEURON_NOT_FOUND";
    readonly NEURON_ACTIVATION_FAILED: "NEURON_ACTIVATION_FAILED";
    readonly NEURON_DEGRADED: "NEURON_DEGRADED";
    readonly TASK_NOT_FOUND: "TASK_NOT_FOUND";
    readonly TASK_ALREADY_COMPLETED: "TASK_ALREADY_COMPLETED";
    readonly SKILL_NOT_FOUND: "SKILL_NOT_FOUND";
    readonly SKILL_ALREADY_INSTALLED: "SKILL_ALREADY_INSTALLED";
    readonly SKILL_IN_REVIEW: "SKILL_IN_REVIEW";
    readonly SKILL_SECURITY_FAILED: "SKILL_SECURITY_FAILED";
    readonly STT_SERVICE_UNAVAILABLE: "STT_SERVICE_UNAVAILABLE";
    readonly TEMPORAL_UNAVAILABLE: "TEMPORAL_UNAVAILABLE";
    readonly RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly CONFLICT: "CONFLICT";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
};
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export declare class ApiError extends Error {
    code: ErrorCode;
    statusCode: number;
    details?: Record<string, unknown>;
    constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>);
}
export declare function ok<T>(data: T, meta?: ApiResponse<T>['meta']): ApiResponse<T>;
export declare const badRequest: (message: string, details?: Record<string, unknown>) => ApiError;
export declare const notFound: (message: string) => ApiError;
export declare const conflict: (message: string) => ApiError;
export declare const forbidden: (message: string) => ApiError;
/**
 * Fastify 에러 핸들러 — ApiError → 표준 에러 래퍼 응답.
 */
export declare function errorHandler(err: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply<import("fastify").RawServerDefault, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, import("fastify").RouteGenericInterface, unknown, import("fastify").FastifySchema, import("fastify").FastifyTypeProviderDefault, unknown>;
//# sourceMappingURL=errors.d.ts.map