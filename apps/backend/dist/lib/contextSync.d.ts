/**
 * 뉴런 간 컨텍스트 동기화 (neuron-architecture-spec §6)
 * - context_patches append-only 패치로 기록 (감사 추적)
 * - 패치 시퀀스를 재구성해 현재 컨텍스트 값 조회
 * - 컨텍스트 키 체계: conversation.*, task.*, visual.*, persona.state, user.preferences 등
 */
import { DbClient } from './supabase';
export type ContextOperation = 'set' | 'append' | 'replace' | 'delete';
export interface ContextDelta {
    operation: ContextOperation;
    value: unknown;
    source?: string;
}
export declare function assertValidKey(key: string): void;
/** 컨텍스트 패치 기록 */
export declare function writeContextPatch(db: DbClient, sessionId: string, key: string, delta: ContextDelta): Promise<void>;
/** 특정 키의 현재 컨텍스트 값 재구성 (캐시 대신 DB에서 항상 재구성) */
export declare function readContextValue(db: DbClient, sessionId: string, key: string): Promise<unknown>;
/** 세션 전체 컨텍스트 스냅샷 (키별 최신 값) */
export declare function readFullContext(db: DbClient, sessionId: string): Promise<Record<string, unknown>>;
/** 컨텍스트 키 삭제 (사용자 요청 — 개인정보 삭제 대응) */
export declare function clearContextKey(db: DbClient, sessionId: string, key: string): Promise<void>;
/** 세션의 활성 작업 정보를 컨텍스트로 저장 (task.current) */
export declare function updateTaskContext(db: DbClient, sessionId: string, task: {
    id: string;
    title: string;
    status: string;
}): Promise<void>;
//# sourceMappingURL=contextSync.d.ts.map