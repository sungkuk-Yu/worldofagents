/**
 * 세션 제목 자동 채움 (t_cc52fd4f 심야 D1-③ — 대표님 9/28 지시).
 *
 * 백서 §4.0: 세션 제목은 관계(user×agent) 마스터의 고유 속성 → 캐논은 006의
 * sessions.title 컬럼, 미설정 시 metadata->>'title' 폴백(포크 시 기록).
 * 이 모듈은 "첫 사용자 메시지 요약" 파생 규칙(결정론·무LLM)과 원-라운드트립
 * 가드 세팅을 담당한다 — REST sendMessage / WS message.send / PTT 트랜스크립트
 * / 큐 드레인까지 runTextTurn 단일 결절점이므로 이 안에 모든 경로가 들어온다.
 *
 * 동시 첫 턴 레이스: UPDATE ... WHERE title IS NULL (is.null 가드) — PostgREST와
 * devstore 양쪽에서 선착자 1행만 반영되고 후착자는 0행(무언). SELECT-then-UPDATE
 * 읽기-쓰기 레이스를 쓰지 않는다 (t_486cf23b 교훈: pooler transaction 모드 원칙).
 */
import { DbClient } from './supabase';

/** 제목 상한 — 마이그레이션 010 백필 SQL과 반드시 동일 값 유지 (50자 + 생략부호 포함). */
export const SESSION_TITLE_MAX = 50;

/**
 * 수동 개명 상한 (t_95c5498e) — 자동 파생(SESSION_TITLE_MAX)과 별개.
 * 김비서 10/4 경주 지시: 80자 초안 → 120자 상향(세션 목록 셀 절단 고려, 대표님 "짧고 직관적" 라벨 성향).
 * 프론트 정합 완료 (t_0da93d18, 10/4): SessionTitleDialog maxLength 200→120 + 근접 카운터 —
 * 클라이언트 절단으로 정상 경로에서 400 불가, 아래 검증은 direct-call 방어선으로 유지.
 */
export const SESSION_TITLE_EDIT_MAX = 120;

/** 006/세션 목록과 동일한 캐논 규칙: title 컬럼 우선, metadata.title 폴백. */
export function sessionTitleOf(session: { title?: string | null; metadata?: unknown } | null | undefined): string | null {
  if (!session) return null;
  if (typeof session.title === 'string' && session.title.trim()) return session.title.trim();
  const meta = session.metadata as Record<string, unknown> | null;
  const fromMeta = meta && typeof meta.title === 'string' ? meta.title.trim() : '';
  return fromMeta || null;
}

/**
 * 첫 사용자 메시지 → 세션 제목 요약 (010 백필의 SQL과 동일 semantics):
 * ① 개행은 첫 행만 ② 공백 연속은 한 칸으로 ③ 상한 초과 시 앞 49자 + '…'.
 *    절단은 문자(코드포인트) 단위 — SQL의 left(t,49)과 1:1, 단어 경계 우선 등
 *    예외를 두면 백필과 런타임이 어긋난다 (의도적으로 단순하게 고정).
 */
export function deriveSessionTitle(firstMessage: string): string | null {
  const firstLine = firstMessage.split(/\r?\n/)[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  const chars = [...collapsed];
  if (chars.length <= SESSION_TITLE_MAX) return collapsed;
  // 초과는 앞 49자 + '…' — 마이그레이션 010 백필의 left(t,49)||'…'와 문자 단위 동일 규칙.
  return `${chars.slice(0, SESSION_TITLE_MAX - 1).join('')}…`;
}

/**
 * 제목이 아직 없는 세션에만 1회 세팅 (WHERE id=? AND title IS NULL).
 * 반환: 실제 갱신 여부 — 후착 레이스/이미 제목 있는 세션(포크·수동)은 false.
 * 실패 지점(네트워크 등)은 호출자catch — 제목 누락은 목록 폴백 규칙으로 UI 무영향.
 */
export async function setSessionTitleIfEmpty(db: DbClient, sessionId: string, title: string): Promise<boolean> {
  const { data } = await db
    .from('sessions')
    .update({ title })
    .eq('id', sessionId)
    .is('title', null)
    .select('id');
  return Boolean((data as { id: string }[] | null)?.length);
}
