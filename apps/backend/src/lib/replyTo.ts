/**
 * 답글/인용 (t_02f58030, 백로그④ — 마이그레이션 012) — messages.reply_to_id 계약.
 *
 * 텔레그램 관습: 답글은 원문 1줄 인용을 동반하고, 원문 삭제 시 인용 연결만 소멸한다
 * (답글 행과 발행 시점 요약 structured_payload.reply_to는 남는다 — FK ON DELETE SET NULL).
 *
 * 검증 정책 (카드 확정): **invalid는 무시하고 발화는 통과**시킨다 (throw 없음, 강등 only).
 *   - 대상 존재 + 같은 세션 → 인용 유지.
 *   - 그 외(없는 ID/다른 세션/자기 참조/012 미적용) → reply_to_id=null 강등, 발화·답변 정상 실행.
 *     DB 조회 오류도 같은 취급 — 인용은 장식 정보라 턴을 죽이지 않는다 (queue/011 강등 관례).
 *   - 참조 무결성 2차 방패: 012 트리거(CROSS_SESSION DENY, ERRCODE 23503)와 FK.
 *     인서트에서 23503이 나면(경쟁: 검증 후 원문 삭제) '무시 후 무인용 재시도'로 회수.
 *   - 012 미적용 실DB 안전판: insert 실패(PGRST204/42703) 시 래치(on)로 컬럼 생략 1회 재시도
 *     — 011 awaiting_reply 관례 동일. 재시작 시 자동 복구. 요약 스냅샷은 컬럼과 무관하게
 *     structured_payload.reply_to에 남는다(프론트 인용바는 012 이전에도 요약으로 동작).
 *
 * 요약(인용 바 표시용)은 발행 시점 스냅샷: { message_id, by, text } —
 *   by=발행자 표시 이름(원문 role=user→본인 display_name 폴백 '사용자', agent/system→에이전트 이름
 *   폴백 '에이전트'), text=80자 마크다운 스트리핑 발췌. 원문이 지워져도 남는다.
 */
import { DbClient } from './supabase';

/** 인용 요약 텍스트 캡 (카드 확정: 원문 first 80자). */
export const REPLY_SNIPPET_MAX = 80;

export interface ReplyToSummary {
  message_id: string;
  /** 발행자 표시 이름. */
  by: string;
  text: string;
}

export interface ReplyContext {
  /** 유효 검증된 인용 대상 ID (invalid/미지정 → null). */
  replyToId: string | null;
  /** 발행 시점 요약 스냅샷 (replyToId가 null이면 반드시 null). */
  summary: ReplyToSummary | null;
}

/**
 * 마크다운 기호 스트리핑 (카드 확정) — 프론트가 평문 1줄로 렌더하는 값.
 * 코드펜스는 통째 제거(블록 내용이 인용바에 흘러넘치는 것 방지), 링크는 [text](url)→text,
 * 헤더/인용/목록 마커·인라인 강조 기호 제거. 임의 마크다운 파서를 도입하지 않는다
 * (저비용 결정론 규칙 — detectReplyRequest/photoEditCard 관례).
 */
export function stripMarkdown(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>+\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~\s][^*_~]*[^*_~\s])[*_~]{1,3}/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function replySnippet(text: string): string {
  return stripMarkdown(text).slice(0, REPLY_SNIPPET_MAX);
}

/** 참조 무결성 위반 판정 — FK(23503)/012 트리거 거부와 동일 취급: 무시 후 발화 통과. */
export function isReplyRefViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '23503' || /foreign key|CROSS_SESSION_REPLY_TO/i.test(String(e?.message || ''));
}

// ── 012 미적용 실DB 래치 (008/011 관례) ─────────────────────────

let replyColumnMissing = false;
export function isReplyToKnownUnavailable(): boolean { return replyColumnMissing; }
/** 테스트/진단용 래치 리셋. */
export function __resetReplyToProbe(): void { replyColumnMissing = false; }
/** 테스트/진단용 — 래치를 강제로 켠다 (insert 강등 경로 검증). */
export function __setReplyToColumnMissing(v: boolean): void { replyColumnMissing = v; }

export function isMissingReplyToColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'PGRST204' || e?.code === '42703'
    || /reply_to_id/i.test(String(e?.message || ''));
}

export function markReplyToColumnMissing(): void { replyColumnMissing = true; }

/**
 * user 행 insert에 병합할 컬럼. null/래치(on)면 빈 객체 — 012 미적용 실DB의 평범한
 * 발화 경로가 래치를 건드리지 않는다 (replyRequestColumns 대칭).
 */
export function replyToColumn(id: string | null): Record<string, unknown> {
  if (id === null || replyColumnMissing) return {};
  return { reply_to_id: id };
}

/**
 * user 행 insert 실패의 인용 강등 분기 (순수 판정 — 재시도 수행은 호출부 graph.processTurn).
 * usedReplyCols=false(무인용 발화)면 null — 기존 오류 경로와 1:1 동일하게 던진다.
 * column-drop 우선: 래치 후 컬럼 생략 재시도(요약 payload는 유지).
 * ref-drop: 23503/트리거 거부 → 인용 정보 전부 탈락한 무인용 재시도(발화 통과).
 */
export type ReplyInsertRetry = 'column-drop' | 'ref-drop' | null;
export function classifyReplyInsertError(err: unknown, usedReplyCols: boolean): ReplyInsertRetry {
  if (!usedReplyCols) return null;
  if (isMissingReplyToColumn(err)) return 'column-drop';
  if (isReplyRefViolation(err)) return 'ref-drop';
  return null;
}

/**
 * WS/REST 수신 인용의 존재+세션 검증과 요약 구성을 한 번에 (invalid → null 강등, throw 없음).
 * 대상 조회 1회 + 표시 이름 조회 1회(인용 턴에서만). self-reference는 구조상 불가
 * (대상은 이번 발화보다 먼저 존재해야 하므로 신생 행 ID를 알 수 없다) — 012 트리거가 방패.
 */
export async function resolveReplyContext(
  db: DbClient, sessionId: string, rawReplyToId: unknown, userId: string, agentId: string | null,
): Promise<ReplyContext> {
  if (typeof rawReplyToId !== 'string' || !rawReplyToId.trim()) return { replyToId: null, summary: null };
  const id = rawReplyToId.trim();
  const { data: target, error } = await db.from('messages')
    .select('id,session_id,role,content').eq('id', id).maybeSingle();
  if (error || !target) return { replyToId: null, summary: null };
  const row = target as { id: string; session_id: string; role: string; content: string };
  if (row.session_id !== sessionId) return { replyToId: null, summary: null };
  let by = row.role === 'user' ? '사용자' : '에이전트';
  if (row.role === 'user') {
    const { data: u } = await db.from('users').select('display_name').eq('id', userId).maybeSingle();
    by = (u as { display_name?: string } | null)?.display_name?.trim() || '사용자';
  } else if (agentId) {
    const { data: a } = await db.from('agents').select('name').eq('id', agentId).maybeSingle();
    by = (a as { name?: string } | null)?.name?.trim() || '에이전트';
  }
  return { replyToId: id, summary: { message_id: row.id, by, text: replySnippet(row.content) } };
}
