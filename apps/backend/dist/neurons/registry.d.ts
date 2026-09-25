/**
 * 뉴런 레지스트리 & 인스턴스 관리 — neuron-architecture-spec §3, §7
 * - 기본 뉴런 4종 보장 (empathy/answer/queue/visual — seed와 동일)
 * - 세션별 뉴런 인스턴스 활성/비활성 (상태 머신: idle→active→processing→degraded)
 * - 뉴런 연결/해제 이력 기록 (neuron_connections append-only)
 * - 사용량 집계 (increment_neuron_usage)
 */
import { NeuronInstancesRow, NeuronsRow, NeuronInstanceStatus } from '../types/db';
import { DbClient } from '../lib/supabase';
export declare const CORE_NEURONS: {
    slug: string;
    alwaysActive: boolean;
}[];
/** 기본 뉴런이 부족하면 시드 (로컬/테스트 환경 안전망) */
export declare function ensureDefaultNeurons(db: DbClient): Promise<void>;
export declare function getNeuronBySlug(db: DbClient, slug: string): Promise<NeuronsRow | null>;
export declare function getNeuronById(db: DbClient, id: string): Promise<NeuronsRow | null>;
export type NeuronEventType = 'activate' | 'deactivate' | 'connect' | 'disconnect' | 'error' | 'status_change';
/** 연결/해제 이벤트 기록 (append-only) */
export declare function recordConnectionEvent(db: DbClient, sessionId: string, neuronId: string, eventType: NeuronEventType, opts?: {
    instanceId?: string;
    prevStatus?: string | null;
    newStatus?: string | null;
    reason?: string;
    metadata?: Record<string, unknown>;
    sourceInstanceId?: string;
    targetInstanceId?: string;
}): Promise<void>;
/** 뉴런 인스턴스 활성화 — (session_id, neuron_id) 유일성 보장 */
export declare function activateNeuronInstance(db: DbClient, sessionId: string, neuronSlug: string): Promise<NeuronInstancesRow>;
/** 뉴런 인스턴스 비활성화 */
export declare function deactivateNeuronInstance(db: DbClient, sessionId: string, instanceId: string, reason?: string): Promise<void>;
/** 인스턴스 상태 전이 + 이벤트 기록 */
export declare function setInstanceStatus(db: DbClient, instanceId: string, status: NeuronInstanceStatus, sessionId?: string, reason?: string): Promise<void>;
/** 세션 활성 인스턴스 목록 (뉴런 메타 포함) */
export declare function listActiveInstances(db: DbClient, sessionId: string): Promise<(NeuronInstancesRow & {
    neuron: NeuronsRow;
})[]>;
/** 뉴런 사용량 집계 */
export declare function recordNeuronUsage(db: DbClient, neuronId: string, success: boolean): Promise<void>;
/** 에이전트에 설치된 커스텀 뉴런 슬러그 목록 (스킬 마켓 연동) */
export declare function listInstalledCustomNeuronSlugs(db: DbClient, userId: string): Promise<string[]>;
//# sourceMappingURL=registry.d.ts.map