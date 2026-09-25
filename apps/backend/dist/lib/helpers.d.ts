/**
 * 라우트 공용 도우미 — 소유권 검증, 페르소나 자동 생성, 세션 ensure.
 */
import { AgentsRow, SessionsRow, PersonasRow } from '../types/db';
import { DbClient } from './supabase';
/** 에이전트가 특정 사용자 소유인지 확인하고 반환 (없으면 404) */
export declare function getOwnedAgent(db: DbClient, userId: string, agentId: string): Promise<AgentsRow>;
/** 에이전트가 존재하는지(소유권 무관) 확인 */
export declare function agentExists(db: DbClient, agentId: string): Promise<boolean>;
/** 에이전트 기본 페르소나 자동 생성 (api-design.md §3.2 — 에이전트 생성 시) */
export declare function createDefaultPersona(db: DbClient, agentId: string, agentName: string): Promise<PersonasRow>;
/** 세션 ensure — (user_id, agent_id) 기존 세션 반환 or 신규 생성 (api-design.md §3.4) */
export declare function ensureSession(db: DbClient, userId: string, agentId: string): Promise<SessionsRow>;
/** 세션 소유권 확인 + 반환 */
export declare function getOwnedSession(db: DbClient, userId: string, sessionId: string): Promise<SessionsRow>;
/** 다음 turn_index 계산 */
export declare function nextTurnIndex(db: DbClient, sessionId: string): Promise<number>;
//# sourceMappingURL=helpers.d.ts.map