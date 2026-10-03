/**
 * 질문 큐 (t_344e047a, 대표님 9/28 ②) — "캐치를 못 해도 큐라인에 넣고,
 * 대답했는지 안 했는지 체크포인트처럼 눈에 보이게."
 *
 * 실행 중(running run)에 들어온 메인 발화는 유실 방지용 대기열(message_queue, migration 008)에
 * 적재하고, 현재 턴이 끝난 뒤 워커가 position 순서로 순차 답변한다.
 * 상태 전이 pending → answered|skipped가 체크포인트 UI(대기=빈 원/답변=초록/스킵=회색)의 데이터원.
 *
 * 스레드 답글·첨부 발화는 큐에 넣지 않는다(스레드 컨텍스트/첨부 링크를 잃기 때문) —
 * 기존 세션 락 직렬화 경로 그대로 동작한다. 큐 스키마(카드 확정)는 메인 발화 전용.
 * 이 모듈은 DB 데이터만 다루고 WS 발행은 호출부(chatTurn/handler/routes)가 한다 — 순환 import 방지.
 */
import { config } from '../config';
import { withSessionLock } from './turnLock';
import type { Locale } from './locale';
import type { DbClient } from './supabase';
import { ApiError, ERROR_CODES } from './errors';

export type QueueStatus = 'pending' | 'answered' | 'skipped';

/**
 * 마이그레이션 008 미적용 환경 안전판 (t_344e047a): 실DB에 message_queue가 없으면
 * (PostgREST PGRST205) 큐 경로를 우회하고 기존 직렬 실행 경로로 폴백한다.
 * 김비서의 008 db push 전 main 선행 푸시가 프로덕션을 깨지 않게 한다.
 * 최초 감지 시 래치(on) — 008 적용 후 배포 재시작이 자동 복구한다.
 */
let queueTableMissing = false;
export function isQueueKnownUnavailable(): boolean { return queueTableMissing; }
/** 테스트/진단용 — 래치를 되돌린다. */
export function __resetQueueProbe(): void { queueTableMissing = false; }
export function isQueueUnavailable(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'PGRST205' || /message_queue/i.test(String(e?.message || ''));
}

export interface MessageQueueRow {
  id: string;
  session_id: string;
  user_id: string;
  content: string;
  locale: Locale;
  status: QueueStatus;
  position: number;
  created_at: string;
  answered_at: string | null;
}

/** queue.updated 계약 스냅샷 — 상태 코드는 언어중립, content는 표시용 발화(200자 캡). */
export interface QueueSnapshot {
  pending_count: number;
  items: { id: string; content: string; status: QueueStatus; position: number }[];
}

export async function listQueue(db: DbClient, sessionId: string): Promise<MessageQueueRow[]> {
  const { data, error } = await db.from('message_queue').select('*')
    .eq('session_id', sessionId).order('position', { ascending: true });
  if (error) {
    if (isQueueUnavailable(error)) { queueTableMissing = true; return []; }
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
  }
  return (data as MessageQueueRow[] | null) || [];
}

export function queueSnapshot(items: MessageQueueRow[]): QueueSnapshot {
  return {
    pending_count: items.filter(i => i.status === 'pending').length,
    items: items.map(i => ({ id: i.id, content: i.content.slice(0, 200), status: i.status, position: i.position })),
  };
}

/** 세션 대기 상한 초과 여부 (429 신호). */
async function pendingCount(db: DbClient, sessionId: string): Promise<number> {
  return (await listQueue(db, sessionId)).filter(i => i.status === 'pending').length;
}

/**
 * 끼어든 메인 발화 적재. 위치는 세션 락 안에서 max+1 (유니크 인덱스 방패).
 * 대기 상한 초과 시 null 반환 — 호출부가 RATE_LIMIT_EXCEEDED로 응답한다.
 */
export async function enqueueQuestion(
  db: DbClient, args: { sessionId: string; userId: string; content: string; locale: Locale }
): Promise<MessageQueueRow | null> {
  return withSessionLock(`queue:${args.sessionId}`, async () => {
    if (await pendingCount(db, args.sessionId) >= config.questionQueue.maxPending) return null;
    const rows = await listQueue(db, args.sessionId);
    // position 수치 가드 (t_e1334cee P1-5, 볼트 numbers-boundary-감사 §5): boards.ts:39와 동일 패턴 —
    // r.position이 문자열 가비지/undefined여도 NaN 침투 없이 0 폴백.
    const position = rows.reduce((m, r) => Math.max(m, Number(r.position) || 0), -1) + 1;
    const { data, error } = await db.from('message_queue').insert({
      session_id: args.sessionId,
      user_id: args.userId,
      content: args.content,
      locale: args.locale,
      status: 'pending',
      position,
    }).select().single();
    if (error || !data) {
      if (isQueueUnavailable(error)) { queueTableMissing = true; return null; } // 호출부가 래치 확인 후 직접 실행 폴백
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error?.message || '큐 적재 실패');
    }
    return data as MessageQueueRow;
  });
}

export async function markQueueStatus(db: DbClient, id: string, status: Exclude<QueueStatus, 'pending'>): Promise<void> {
  const { error } = await db.from('message_queue').update(
    status === 'answered' ? { status, answered_at: new Date().toISOString() } : { status }
  ).eq('id', id);
  if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
}

/** 아카이브/유실 정리: 세션의 미처리 pending을 모두 skipped로 마감한다. */
export async function skipAllPending(db: DbClient, sessionId: string): Promise<void> {
  for (const row of (await listQueue(db, sessionId)).filter(r => r.status === 'pending')) {
    await markQueueStatus(db, row.id, 'skipped');
  }
}
