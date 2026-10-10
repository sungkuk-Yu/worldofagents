// 사람 타이핑 리빌 스케줄러 ③ — 문장 단위 노출 (t_4c266653, 대표님 10/10 원지시: 30자/s 연출 타이머 폐기)
// t_da4f8623 3차 개정 반영: '답변도 아닌게 30cps로 총알받이처럼 다 쳐주고' + industry 벤치(클로드 CLI 등)
// 체감 = 스트리밍 속도 그대로. 따라서 노출에 지터 타이머를 얹지 않는다 —
//   · 버퍼(서버 누적 원문)에서 마지막 컷점(줄바꿈 \n 또는 종결부호 . ? ! …)까지만 노출.
//   · 전진 지연 0: feed 후 ≤1틱(revealStore.TICK_MS)에 경계까지 점프. 체감 속도 = 서버 스트림 속도.
//   · 마지막 미완 문장은 다음 컷점 또는 확정(answer.done)까지 보류 — 반쯤 나와 줄 단위 재줄바꿈 금지.
//   · 확정·취소·오류 = 전문 즉시 노출 (되감기 없음).
//   · 통째 도착(sealed) 행은 리빌 상태 자체를 만들지 않는다 — 즉시 표시가 정답 (t_4c266653 ③).
// 삭제: gapAfterChar/40~120ms 지터/seed/xorshift (Math.random은 원래부터 금지였으나 이 경로는 전면 폐기) —
// 노출 결정 전량: 같은 입력 = 같은 출력. 상수 재설계로 SENTENCE_CLOSERS 단일 진실.
// 회귀 금지 계약 승계 (t_a654c9ac/t_da4f8623): messages[].content(원문) 불변, 누적 되감기 불가,
// finish/cancel 즉시 전문, prefers-reduced-motion/플래그 OFF = 상태 미생성 = 기존 즉시 렌더 1:1.

/** 리빌 틱 간격(ms) — revealStore.TICK_MS와 정합. '도착 후 ≤1틱 노출' 게이트의 1틱. */
export const REVEAL_TICK_MS = 32;

/** 컷점 문자: 줄바꿈 + 종결부호 (,.는 컷 아님 — 쉼표 컷은 5자 delta에서 미세 점프로 회귀하므로
 *  카드 경계 케이스로 잠금: '쉼표는 컷점 아니다'). locale 종결(。？！) 예비 포함. */
export const SENTENCE_CLOSERS: readonly string[] = ['.', '?', '!', '…', '。', '？', '！', '\n'];
const CLOSER_SET = new Set<string>(SENTENCE_CLOSERS);

/** 노출 단위 = 코드포인트(자모 조립 한글 1자 = 1; Array.from은 surrogate-safe) */
export const revealChars = (s: string): string[] => Array.from(s);

/** 마지막 컷점 직후 인덱스 = 노출 가능 길이. 컷점 없으면 0(전문 미완 보류). */
export function sentenceBoundary(chars: string[]): number {
  for (let i = chars.length - 1; i >= 0; i--) if (CLOSER_SET.has(chars[i])) return i + 1;
  return 0;
}

/** 스트림 1개(run/행 id)의 리빌 상태. 불변 갱신. */
export interface RevealState {
  key: string;
  /** 서버 누적 원문 (절대 되감지 않는 진실) */
  text: string;
  /** 노출 진도: text에서 몇 글자(코드포인트)까지 보여줬나 — 항상 컷점 또는 전문. */
  revealed: number;
  /** 확정(완료) — 리빌 중단, text 전체가 진도. 다음 틱에 회수(렌더는 폴백=원문과 동일 텍스트로 수렴). */
  finished: boolean;
}

export function createReveal(key: string): RevealState {
  return { key, text: '', revealed: 0, finished: false };
}

/** 서버 청크 수신: 누적 원문만 갱신. 절대 되감지 않는다 — incoming이 prev보다 짧으면(이상 프레임) 무시. */
export function feedReveal(s: RevealState, fullText: string): RevealState {
  if (s.finished || fullText === s.text) return s;
  if (fullText.length < s.text.length) return s;
  return { ...s, text: fullText };
}

/** now 기준 노출 전진 — 지터/대기 시각 개념이 없다: 버퍼의 컷점까지 즉시 점프.
 *  반환: [다음 상태, 노출이 실제로 전진했나]. 전진 없으면 렌더 스킵(토큰마다 재렌더 금지 교훈 승계).
 *  - 스트림 중: target = sentenceBoundary(buffer). 미완 꼬리는 보류(다음 컷점/확정까지).
 *  - pendingDone(서버 확정 힌트): 전문 즉시 — done 구간 보류 금지.
 *  폭주 개념이 사라졌다: 점프 크기는 서버가 보낸 문장 길이 그 자체(체감=스트림 속도). */
export function advanceReveal(s: RevealState, pendingDone: boolean = false): [RevealState, boolean] {
  if (s.finished) {
    const all = revealChars(s.text).length;
    return s.revealed < all ? [{ ...s, revealed: all }, true] : [s, false];
  }
  const all = revealChars(s.text);
  const target = pendingDone ? all.length : sentenceBoundary(all);
  if (target <= s.revealed) return [s, false];
  return [{ ...s, revealed: target }, true];
}

/** 노출 문자열 (진도까지의 슬라이스) */
export function revealedText(s: RevealState): string {
  return revealChars(s.text).slice(0, s.revealed).join('');
}

/** 리빌 진행 중인가 (버퍼가 진도보다 앞선 상태 = caret 유지 조건 — 미완 문장 대기 중도 true) */
export function isRevealing(s: RevealState): boolean {
  return !s.finished && s.revealed < revealChars(s.text).length;
}

/** 즉시 전량 노출 (prefers-reduced-motion / 취소·오류 확정 / 대형 행 폴백) — 리빌 중단, 전문 진도. */
export function revealNow(s: RevealState): RevealState {
  return { ...s, revealed: revealChars(s.text).length, finished: true };
}

/** 확정: 취소·오류·done — 전문 즉시 렌더(되감기 없음). incoming이 더 길면 진실 우선. */
export function finishReveal(s: RevealState, fullText?: string): RevealState {
  const text = typeof fullText === 'string' && fullText.length >= s.text.length ? fullText : s.text;
  return { ...s, text, revealed: revealChars(text).length, finished: true };
}
