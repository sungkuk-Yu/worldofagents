/**
 * 통합 페르소나 (neuron-architecture-spec §4)
 * - 페르소나 설정 로드 (personas 테이블 → PersonaConfig)
 * - 페르소나 시스템 프롬프트 빌더 (모든 뉴런이 동일 프롬프트 수신)
 * - Persona Guard: 응답 검증 (금지 표현, 잘못된 자기 참조, 톤 일관성)
 */
import { PersonasRow, PersonaConfig } from '../types/db';
import { DbClient } from './supabase';
export declare function rowToPersonaConfig(row: PersonasRow, overrides?: Partial<PersonaConfig>): PersonaConfig;
/** 에이전트의 현재 활성 페르소나 로드 */
export declare function getActivePersona(db: DbClient, agentId: string): Promise<PersonaConfig | null>;
/**
 * 뉴런 유형별 페르소나 시스템 프롬프트 생성.
 * 모든 뉴런이 동일한 페르소나 베이스를 받고, 뉴런별 오버라이드(정도 조절)만 다르다.
 */
export declare function buildPersonaPrompt(config: PersonaConfig, neuronType: string): string;
export interface GuardResult {
    passed: boolean;
    response: string;
    checks: GuardCheck[];
}
export interface GuardCheck {
    passed: boolean;
    reason: string;
    fix: 'replace' | 'rewrite' | 'none';
}
/**
 * Persona Guard — 뉴런이 생성한 응답이 통합 페르소나를 따르는지 사후 검증.
 * 1단계(Phase 1): 규칙 기반 검사 (금지 표현, 잘못된 자기 참조)
 * 2단계(Phase 3 계획): LLM 기반 톤 일관성 검사 — 인터페이스에 시그니처만 준비
 */
export declare class PersonaGuard {
    private config;
    constructor(config: PersonaConfig);
    validate(response: string, _neuronType?: string, _recentResponses?: string[]): Promise<GuardResult>;
}
/** 시스템 프롬프트에 주입할 대화 히스토리 구성 */
export declare function buildConversationHistory(history: {
    role: string;
    content: string;
}[], maxTurns?: number): {
    role: string;
    content: string;
}[];
//# sourceMappingURL=persona.d.ts.map