/**
 * 부팅 resume 스캐너 (t_7182aa8f③, 자비스 오케스트레이션 [4])
 *
 * 크래시로 미완('running' 스탬프)인 run을 graph_runs에서 주워 runTextTurn으로 이어
 * 실행한다. 재구성 레시피는 카드 [3] 결정 그대로 — **run map(graph_runs)만 영속**,
 * presence/eventlog 등 연결 상태는 휘발 유지(부팅 시 재구축).
 *
 * 동작:
 * - flag(LANGGRAPH_CHECKPOINT) off 또는 014 래치 → listOpenRuns가 [] 반환 = 무실행(1:1 현행).
 * - 세션 아카이브/소멸 → abandoned 처리 후 스킵(유실 표시는 다음 접속 시 큐/히스토리 기준).
 * - resume 실행도 runTextTurn 단일 결절점 통과 → 이벤트(ack/delta/completed)는
 *   broadcastToSession으로 나간다(재접속 프론트는 subscribe last_seq/diff-sync로 주운다).
 * - 동시 실행 세션은 withSessionLock이 직렬화한다(기존 세션 락과 같은 열).
 * - 라운드캡 maxResumePerBoot: 폭주 방패 — 잔량은 다음 재기동/다음 발화 드레인이 이어받지
 *   못하므로 abandoned로 마감하지 않고 그대로 둔다(다음 부팅에서 재시도).
 */
import { supabaseAdmin } from './supabase';
import type { DbClient } from './supabase';
import { listOpenRuns, journalStamp, checkpointEnabled, isJournalKnownUnavailable } from './runCheckpoint';
import { runTextTurn } from './chatTurn';
import { broadcastToSession } from '../websocket/handler';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { SessionsRow } from '../types/db';

/** 미완 run을 이어 실행한다. 실행당 예외는 잡고 다음으로 — 부팅을 막지 않는다. */
export async function resumeOpenRuns(db: DbClient = supabaseAdmin, opts: { minAgeMs?: number } = {}): Promise<number> {
  if (!checkpointEnabled() || isJournalKnownUnavailable()) return 0;
  const minAge = opts.minAgeMs ?? config.runCheckpoint.resumeMinAgeMs;
  let rows;
  try {
    rows = await listOpenRuns(db);
  } catch (err) {
    logger.warn(`resume 스캔 실패(서버는 계속): ${(err as Error).message}`);
    return 0;
  }
  const now = Date.now();
  let resumed = 0;
  for (const row of rows.slice(0, config.runCheckpoint.maxResumePerBoot)) {
    try {
      const age = now - new Date(row.created_at).getTime();
      if (age < minAge) continue; // 동기동 프로세스가 막 시작한 run — 이번 부팅 대상 아님
      const { data: session } = await db.from('sessions').select('*').eq('id', row.session_id).maybeSingle();
      if (!session || (session as SessionsRow).status === 'archived') {
        await journalStamp.finish(db, row.run_id, 'abandoned', 'SESSION_GONE');
        continue;
      }
      logger.info(`♻️ resume: 미완 run 이어 실행 (run=${row.run_id} session=${row.session_id} engine=${row.engine ?? '?'} age=${Math.round(age / 1000)}s)`);
      // runTextTurn 내부: 저널 가드(user/empathy/answer/tail) + 체크포인터 invoke(null).
      // 실패는 내부에서 journal.finish('failed')로 마감 — 재resume 루프가 되지 않는다.
      await runTextTurn(db, session as SessionsRow, row.user_id, row.content, {
        locale: row.locale,
        thread: row.thread ?? undefined,
        sttMetadata: row.stt_metadata ?? undefined,
        attachmentIds: row.attachment_ids ?? undefined,
        replyToId: row.reply_to_id ?? undefined,
        resume: row,
        emit: e => broadcastToSession(row.session_id, e),
      });
      resumed += 1;
    } catch (err: any) {
      //journalStamp.finish는 processTurn 내부에서 이미 수행 — 여기는 로깅만 (RUN_CANCELLED 포함 삼킴).
      logger.warn(`resume 실패(continued): run=${row.run_id} code=${err?.code} ${err?.message}`);
    }
  }
  return resumed;
}