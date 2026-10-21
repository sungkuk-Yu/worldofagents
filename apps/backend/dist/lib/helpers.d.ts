/**
 * 라우트 공용 도우미 — 소유권 검증, 페르소나 자동 생성, 세션 ensure.
 */
import { AgentsRow, SessionsRow, PersonasRow, MessagesRow } from '../types/db';
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
/**
 * turn_index 오염 가드 (t_e1334cee P1-1, 볼트 numbers-boundary-감사 §1):
 * max+1 시퀀스 계산의 외부 소스(DB JSONB 타입 드리프트) 수치 경계.
 * - null/undefined(빈 세션) → 0 (기존 `-1 + 1` 의미 그대로)
 * - 문자열 숫자("5") → Number() 복원 (6) — additive, 정상 동작 불변
 * - 그 외 가비지("banana"/NaN/객체) → ApiError로 insert 차단 (침투 시 정렬/커서 연쇄 파괴)
 */
export declare function nextTurnFromLast(raw: unknown): number;
/** 다음 turn_index 계산 */
export declare function nextTurnIndex(db: DbClient, sessionId: string): Promise<number>;
/**
 * stt_metadata 수치 필드 정화 (t_e1334cee P1-4, 볼트 numbers-boundary-감사 §4):
 * REST body·resume 저널 등 외부 소스의 JSONB를 영속하기 직전에 스캔 —
 * confidence/duration_ms는 Number 복원(불가 시 기본값), language는 문자열만 허용.
 * 정상(서버 계산) 값은 그대로 통과 — 동작 불변. 비객체 입력('banana' 문자열 등)은 null.
 * 멱등: 재스캔해도 같은 결과 (WS early-persist → runTextTurn 이중 호출 안전).
 */
export declare function sanitizeSttMetadata(m: Record<string, unknown> | null | undefined): Record<string, unknown> | null;
/** ID 커서로 전체 행을 읽어 PostgREST의 응답 행 제한을 피한다. */
export declare function selectAllRows(db: DbClient, table: string, filters: Record<string, string>): Promise<any[]>;
/** 메시지와 소속 세션의 소유권을 확인하며 실패 이유는 모두 404로 숨긴다. */
export declare function getOwnedMessage(db: DbClient, userId: string, messageId: string, sessionId?: string): Promise<{
    message: MessagesRow;
    session: SessionsRow;
}>;
/** 이전 메시지도 기본 로케일/AI 표시/즐겨찾기 필드를 포함해 직렬화한다. */
export declare function serializeMessage(row: MessagesRow): MessagesRow;
//# sourceMappingURL=helpers.d.ts.map