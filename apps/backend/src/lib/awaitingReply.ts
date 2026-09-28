/**
 * 답변 대기 (t_811e176c, 대표님 9/28 09:07) — "사용자가 답변해야할걸 따로 지정해서
 * 예/아니오 답변 혹은 주관식 답변으로 할수 있도록."
 *
 * 에이전트 답변에서 사용자 회신(확정/선택/정보 요청)을 요구하는 문장을 규칙으로 판정해
 * messages 행에 awaiting_reply/reply_kind를 기록한다 (마이그레이션 011).
 * 후속 질문 칩(suggested_questions, t_344e047a ③)은 '제안'이고 이것은 **회신 필요** — 혼동 금지.
 *
 * 판정 방식 결정 (카드 옵션 'dialogPatterns 추가 또는 answer meta field' 중):
 *   answer meta 규칙 판정. dialogPatterns.json은 5종 dialogue 분류의 프론트-백엔드
 *   드리프트 계약 테이블(단일 콘텐츠)이라 회신 문장 규칙을 얹으면 프론트 강제 변경이
 *   발생 — 분리한다. LLM 추가 호출 0: Stage2 관례(저비용 1회)보다 강하게 비용·지연 0.
 *
 * 오탐 정책 (spec §2.3: 오탐이 누락보다 위험; 대표님 9/28 불만 — '무의미 수사 문구'를
 *   미해결로 쌓지 말 것): 스캔은 답변 마지막 4문장, **의문형 or 명시적 요구 동사**가
 *   있는 문장만 회신 요구로 본다. 평서형 상투 마감("...알려주시면 준비할게요",
 *   "언제든 말씀해주세요")은 회수 — 자유 발화로 언제든 해소되는 미결 노이즈다.
 *
 * 해소: 사용자의 다음 발화(메인/스레드 턴, runTextTurn 경유)로 미해소 대기 행 모두
 *   awaiting_reply=false 전환. 배지 스냅샷: WS reply.pending.updated(queue.updated 관례
 *   동일) + GET /api/sessions/:id/pending (부트스트랩 폴백).
 *
 * 실DB 래치 (008 관례): 마이그레이션 011 미적용 환경(PGRST204/42703)에서는 감지 턴의
 *   insert가 컬럼 없이 1회 재시도되고, 해소/스냅샷은 no-op/null로 강등한다.
 *   최초 감지 시 래치(on) — 011 적용 후 배포 재시작이 자동 복구.
 */
import { DbClient } from './supabase';
import { MessagesRow, ReplyKind } from '../types/db';
import { ApiError, ERROR_CODES } from './errors';

export type { ReplyKind };

export interface ReplyRequest {
  kind: ReplyKind;
  /** 발췌: 회신을 요구한 문장(프론트 모달 행 표시용). */
  excerpt: string;
}

/** 판정 스캔 창(문장) — 답변 끝쪽이 회신 요구 위치의 정상 자리. */
const LAST_SENTENCES = 4;
const SENTENCE_SPLIT = /(?<=[.!?。！？])\s+|\n+/;

function isQuestion(s: string): boolean {
  return /[?？]\s*$/.test(s);
}

/** 예/아니오 확정·승인 요구. 한국어는 '-ㄹ까요/-습니까' interrogative 종결 원칙. */
const YESNO_PATTERNS: RegExp[] = [
  /(?:까요|습니까)\s*[?？]?\s*$/,
  // 평어 종결 "...할까?/보낼까?" — 의문부(?) 필수라 서술형 "...까지만"은 오매칭 안 됨.
  /까\s*[?？]\s*$/,
  /(?:괜찮|무방|괜찮으|문제없|합리적)[가-힣\s]*(?:면\s*)?(?:좋|될|없)[가-힣]*\s*[?？]\s*$/,
  /(?:진행|시작|계속|적용|발송|출력|정리)\s*(?:할|해도)\s*(?:까요|좋을까|될까요|방)?\s*[?？]\s*$/,
  /(?:예|네|yes)\s*[/,·]\s*(?:아니오|아니요|no)/i,
  /\b(?:shall|should)\s+i\b/i,
  /\bdo\s+you\s+want(?:\s+me)?\s+to\b/i,
  /\bwould\s+you\s+like\b/i,
  /\bis\s+(?:it|that|this|these)\s+(?:ok|okay|fine|alright|good|safe|correct)\b/i,
  /\b(?:sound|work)(?:s)?\s+(?:good|for\s+you)\b[^.!?]*[?？]\s*$/i,
  /\b(?:proceed|confirm|approve|agree|go\s+ahead)\b[^.!?]*[?？]\s*$/i,
];

/**
 * 주관식 회신(정보·선택) 요구 — 의문형 + 회신 요구 어휘가 한 문장에 함께 있어야 한다.
 * 평서형 '알려주시면~' 상투마감·수사 질문은 명시적으로 배제한다.
 */
const FREEFORM_PATTERNS: RegExp[] = [
  /(?:알려|선택|정해|골라|답해|확인해|적어|말씀해|보내주)[가-힣\s]*(?:주|줄|줘)?[가-힣\s]*[?？]\s*$/,
  /(?:무엇|어떤|어느|누구|언제|얼마|몇)[^\n]*[?？]\s*$/,
  // 존칭 정보 요구 종결('~건가요?/~인가요?')과 '혹시' 인도어 — 어미 의문부 필수라 평서문은 안전.
  /(?:건가요|인가요)[^\n]*[?？]\s*$/,
  /혹시[^\n]*[?？]\s*$/,
  /(?:goal|deadline|budget|preference|option|choice|date|time|name|amount)[^\n]*[?？]\s*$/i,
  /(?:which|what|how many|how much|when|where|who)[^\n]*[?？]\s*$/i,
  /(?:share|provide|tell me|let me know|choose|pick|send me)[^\n]*[?？]\s*$/i,
];

/** 평서형 상투마감 배제: 의문형도 아니고 명시적 요구('주세요'종결/please)도 아니면 freeform 후보 반려. */
function matchFreeform(s: string): boolean {
  if (!isQuestion(s) && !/\b(?:please|kindly)\b/i.test(s) && !/(?:주세요|해줘|해\s*주지|주시겠)[?！.!]?\s*$/.test(s)) return false;
  return FREEFORM_PATTERNS.some(re => re.test(s));
}

function matchYesno(s: string): boolean {
  return YESNO_PATTERNS.some(re => re.test(s));
}

function pickExcerpt(sentences: string[], match: (s: string) => boolean): string {
  const tail = sentences.slice(-LAST_SENTENCES);
  return tail.find(s => match(s)) || tail[tail.length - 1] || sentences[0] || '';
}

/**
 * 답변 텍스트에서 회신 필요 판정 (순수 함수, LLM/DB 미경유).
 * 코드 블록·마크다운 표는 스캔에서 제거(표 헤드의 '?' 오탐 방지).
 */
export function detectReplyRequest(text: string): ReplyRequest | null {
  const cleaned = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*$/gm, ' ')
    .trim();
  if (!cleaned) return null;
  const sentences = cleaned.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
  const tail = sentences.slice(-LAST_SENTENCES);
  if (!tail.length) return null;
  const yesno = tail.some(matchYesno);
  const freeform = tail.some(matchFreeform);
  if (!yesno && !freeform) return null;
  const kind: ReplyKind = yesno && freeform ? 'both' : yesno ? 'yesno' : 'freeform';
  // 발췌는 결정 요구 문장 우선(both일 때 배지 클릭 후 볼 문장은 '예/아니오' 요구 쪽).
  const excerpt = pickExcerpt(sentences, kind === 'freeform' ? matchFreeform : matchYesno);
  return { kind, excerpt: excerpt.replace(/\s+/g, ' ').trim().slice(0, 160) };
}

// ── 011 미적용 실DB 래치 (008 관례) ─────────────────────────────

let columnMissing = false;
export function isAwaitingReplyKnownUnavailable(): boolean { return columnMissing; }
/** 테스트/진단용 래치 리셋. */
export function __resetAwaitingReplyProbe(): void { columnMissing = false; }
/** 테스트/진단용 — 래치를 강제로 켠다 (라우트/이벤트 강등 경로 검증). */
export function __setAwaitingReplyColumnMissing(v: boolean): void { columnMissing = v; }

export function isMissingReplyColumns(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'PGRST204' || e?.code === '42703'
    || /awaiting_reply|reply_kind/i.test(String(e?.message || ''));
}

/**
 * 답변 행 insert에 병합할 컬럼. 감지 없거나 래치(on)면 빈 객체 — 컬럼 자체를
 * 만지지 않으므로 011 미적용 실DB의 평범한 답변 경로가 래치를 건드리지 않는다.
 */
export function replyRequestColumns(req: ReplyRequest | null): Record<string, unknown> {
  if (!req || columnMissing) return {};
  return { awaiting_reply: true, reply_kind: req.kind };
}

export function markAwaitingReplyColumnsMissing(): void { columnMissing = true; }

// ── 해소 · 스냅샷 ───────────────────────────────────────────────

/**
 * 사용자 발화 = 회신: 세션의 미해소 대기 행을 모두 해소한다. 반환값은 해소된 행 수.
 * 배지 실패가 턴을 죽이지 않게 조용히 강등(래치 포함) — queue 강등 관례 동일.
 */
export async function resolvePendingReplies(db: DbClient, sessionId: string): Promise<number> {
  if (columnMissing) return 0;
  try {
    const { data, error } = await db.from('messages').update({ awaiting_reply: false })
      .eq('session_id', sessionId).eq('awaiting_reply', true).select('id');
    if (error) {
      if (isMissingReplyColumns(error)) columnMissing = true;
      return 0;
    }
    return ((data as { id: string }[] | null) || []).length;
  } catch {
    // 강등: 배지만 놓친다 — 답변 경로 무영향.
    return 0;
  }
}

export interface PendingReplyItem {
  message_id: string;
  turn_index: number;
  excerpt: string;
  reply_kind: ReplyKind;
}

export interface ReplyPendingSnapshot {
  count: number;
  items: PendingReplyItem[];
}

/**
 * 미해소 대기 스냅샷 (WS reply.pending.updated · GET /pending 공통 계약).
 * 래치(on)이면 null — 호출부가 이벤트 생략/빈 스냅샷 강등으로 처리한다.
 * 비(非)-래치 조회 오류는 ApiError로 던진다 (queue 목록 조회와 동일).
 */
export async function replyPendingSnapshot(db: DbClient, sessionId: string): Promise<ReplyPendingSnapshot | null> {
  if (columnMissing) return null;
  const { data, error } = await db.from('messages').select('*')
    .eq('session_id', sessionId).eq('awaiting_reply', true)
    .order('turn_index', { ascending: true });
  if (error) {
    if (isMissingReplyColumns(error)) { columnMissing = true; return null; }
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
  }
  const items = ((data as (MessagesRow & { content: string })[] | null) || []).map(m => {
    const detected = detectReplyRequest(String(m.content || ''));
    return {
      message_id: m.id,
      turn_index: m.turn_index,
      reply_kind: (m.reply_kind ?? detected?.kind ?? 'freeform') as ReplyKind,
      excerpt: (detected?.excerpt || String(m.content || '')).slice(0, 160),
    };
  });
  return { count: items.length, items };
}
