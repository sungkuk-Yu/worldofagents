/**
 * random_id 멱등 전송 (t_3486b1d7 ①, 볼트 리서치 §3 / core.telegram.org/method/messages.sendMessage)
 * — 클라이언트가 send 프레임/REST body에 붙이는 client_req_id로 재전송 중복 생성을 차단한다.
 *
 * 계층:
 * 1) 사전 조회(findExistingByClientReqId) — 같은 (session, client_req_id) user 행이 이미 있으면
 *    턴을 실행하지 않고 기존 행을 돌려준다 (DEDUPED 응답 / WS 조용 드롭).
 * 2) DB 유니크 인덱스 uq_messages_client_req (013) — 인덱스가 마지막 방패. 라운드트립 레이스로
 *    사전 조회를 통과한 재전송이 insert에서 충돌하면 CONFLICT로 마감(중복 턴 실행 금지).
 * 3) 안전판 래치 — 013 미적용 실DB(PGRST204/42703)는 감지 후 컬럼을 만지지 않고 멱등을 끈다
 *    (008 큐/011 awaiting 관례). 롤백 게이트: MESSAGE_IDEMPOTENCY_DISABLED=true 즉시 off.
 */
import { config } from '../config';
import type { DbClient } from './supabase';
import type { MessagesRow } from '../types/db';

let columnMissing = false;
export function isIdempotencyKnownUnavailable(): boolean { return columnMissing; }
/** 테스트/진단용 래치 리셋. */
export function __resetIdempotencyProbe(): void { columnMissing = false; }
/** 테스트/진단용 — 래치 강제 (013 미적용 환경 흉내). */
export function __setIdempotencyColumnMissing(v: boolean): void { columnMissing = v; }

/** 013 미적용 실DB의 컬럼 부재 신호 (011 isMissingReplyColumns 관례). */
export function isMissingClientReqColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'PGRST204' || e?.code === '42703'
    || /client_req_id/i.test(String(e?.message || ''));
}

/** 유니크 인덱스 충돌(uq_messages_client_req) — 재전송이 사전 조회를 뚫고 들어온 레이스 신호. */
export function isClientReqConflict(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const msg = String(e?.message || '');
  return (e?.code === '23505' || /duplicate/i.test(msg)) && /client_req/i.test(msg);
}

/** client_req_id 정규화 — 비문자열/공백/과장은 null(멱등 없음, 기존 동작). */
export function normalizeClientReqId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= 64 ? s : null;
}

/** user 행 insert에 병합할 컬럼. 플래그 off/래치/on-id 없으면 빈 객체(컬럼 미접촉). */
export function clientReqColumns(clientReqId: string | null): Record<string, unknown> {
  if (!clientReqId || !config.protocol.idempotency || columnMissing) return {};
  return { client_req_id: clientReqId };
}

/** 래치 on — graph insert의 013 미적용 폴백 경로에서 호출 (011 markAwaitingReplyColumnsMissing 관례). */
export function markIdempotencyColumnMissing(): void { columnMissing = true; }

/**
 * 같은 client_req_id의 user 행 존재 여부. 조회 실패(013 미적용)는 래치 후 null —
 * 멱등만 조용히 꺼지고 대화 경로는 계속 실행된다.
 */
export async function findExistingByClientReqId(
  db: DbClient, sessionId: string, clientReqId: string | null
): Promise<MessagesRow | null> {
  if (!clientReqId || !config.protocol.idempotency || columnMissing) return null;
  const { data, error } = await db.from('messages').select('*')
    .eq('session_id', sessionId).eq('role', 'user').eq('client_req_id', clientReqId)
    .order('turn_index', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (isMissingClientReqColumn(error)) { columnMissing = true; return null; }
    throw error;
  }
  return (data as MessagesRow | null) ?? null;
}
