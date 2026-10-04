// 사람 타이핑 리빌 스케줄러 ②-프론트 (t_da4f8623, 대표님 10/4 "한글자씩 나타나는 걸 원해")
// 서버 청크(answer.delta ~5자/톡, t_a654c9ac pacer)는 수신 버퍼(=text 누적)에 쌓이고, 노출은 1자씩
// 40~120ms 지터로 전진한다. 누적 원문과 노출 진도는 분리 — 서버가 앞서가도 절대 되감지 않는다.
// 순수 로직(React/타머 무관): now를 주입받아 nextRevealAt을 결정 → unit에서 시드 결정성 검증 가능.
// 회귀 금지 계약 (t_a654c9ac): 원문 누적·drain·cancel 경로 불변 — 이 모듈은 '노출 진도' 표시 계층만 추가.
//   - finish()(취소·오류·잔류 확정) = 전문 즉시 노출(되감기 없음).
//   - prefers-reduced-motion/플래그 OFF = 상태 생성 자체가 없어 원문 즉시 렌더(기존 동작 1:1).

/** 1자 노출 기본 간격 상한(ms) — 지터 범위 40~120ms (카드 명시) */
export const REVEAL_CHAR_MS = 120;
/** 지터 하한(ms) */
export const REVEAL_MIN_MS = 40;
/** 문장부호(./?!,\n) 뒤 숨고르 상한(ms) — 150~400ms (카드 명시) */
export const REVEAL_PAUSE_MS = 400;
const REVEAL_PAUSE_MIN_MS = 150;
/** 숨고르 대상: 종결/구두점 + 개행 (카드 명시, locale 구두점 예비) */
const PAUSE_AFTER = new Set(['.', '?', '!', ',', '。', '，', '\n']);
/** 무리(3~8자 연속 노출 후 숨고름 — 사람 치도독감) 경계 */
const BURST_MIN = 3;
const BURST_MAX = 8;
/** 리빌 틱 간격(ms) — revealStore.TICK_MS와 정합. 지터 하한 40ms > 틱이라 글자 구간 스킵이 없다. */
export const REVEAL_TICK_MS = 32;
/** 서버 확정(pendingDone) 후 잔여 소진 상한(ms) — 방생 끝난 전문의 폭주/영구 잔류 금지 */
export const REVEAL_DRAIN_MS = 2000;
export const REVEAL_DRAIN_TICKS = Math.max(1, Math.ceil(REVEAL_DRAIN_MS / REVEAL_TICK_MS));

// 결정성 시드: 문자열 해시 → xorshift32 시퀀스. Math.random 금지 — unit 스냅샷·e2e 중간 프레임
// 단언이 재현 가능해야 한다(t_cc232982 하네스 교훈). 같은 스트림은 같은 노출 패턴, 다른 run은 다른 패턴.
function hashSeed(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export function revealRand(seed: number, step: number): number {
  let x = (seed ^ Math.imul(step + 1, 2654435761)) >>> 0;
  if (x === 0) x = 0x9e3779b9;
  x ^= x << 13; x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5; x >>>= 0;
  return x / 0xffffffff;
}

/** 노출 단위 = 코드포인트(자모 조립 한글 1자 = 1; Array.from은 surrogate-safe) */
export const revealChars = (s: string): string[] => Array.from(s);

/** 스트림 1개(run/행 id)의 리빌 상태. 불변 갱신. */
export interface RevealState {
  key: string;
  /** 서버 누적 원문 (절대 되감지 않는 진실) */
  text: string;
  /** 노출 진도: text에서 몇 글자까지 보여줬나 */
  revealed: number;
  /** 다음 노출 허용 시각(ms). now < nextRevealAt이면 대기. */
  nextRevealAt: number;
  /** 노출 결정 시드 (key 해시) */
  seed: number;
  /** 현재 무리(burst) 진행 글자 수 */
  burst: number;
  /** 확정(완료) — 리빌 중단, text 전체가 진도 */
  finished: boolean;
  /** 서버 방생 종료(done/message.new/REST 확정) 힌트 — 소진 즉시 finished 전환(커서 정지) */
  pendingDone?: boolean;
  /** 통째 확정 도착(empathy 라이브 수신 등) — 진도만 늦은 것, text는 더 자라지 않는다.
   *  자연 지터 속도로 리빌 후 소진 시 finished 전환(드레인 폭주 없음, 회수 보증). */
  sealed?: boolean;
  /** pendingDone 소진 모드: 1틱 전진 글자 수 (setPendingDone이 REVEAL_DRAIN_TICKS 기준으로 산출) */
  drainStep?: number;
  /** 지터 단계 카운터 (결정성 시퀀스 위치) */
  step: number;
}

export function createReveal(key: string, now: number): RevealState {
  return { key, text: '', revealed: 0, nextRevealAt: now, seed: hashSeed(key), burst: 0, finished: false, step: 0 };
}

/** 서버 청크 수신: 누적 원문만 갱신. 절대 되감지 않는다 — incoming이 prev보다 짧으면(이상 프레임) 무시.
 *  재질문 empathy 행처럼 통째로 들어온 확정 text도 여기서 급식(도착 즉시 통째 렌더 금지 → 진도 0에서 리빌). */
export function feedReveal(s: RevealState, fullText: string): RevealState {
  if (s.finished || fullText === s.text) return s;
  if (fullText.length < s.text.length) return s;
  return { ...s, text: fullText };
}

/** 문자 뒤 간격(ms) — 문장부호 150~400ms 숨고르 / 일반 40~120ms 지터 / 3~8자 무리 끝 추가 숨고르.
 *  (step, seed)로만 결정 — Math.random 없음, 재현 가능. */
export function gapAfterChar(s: RevealState, ch: string, step: number): { gap: number; burst: number } {
  if (PAUSE_AFTER.has(ch)) {
    return { gap: REVEAL_PAUSE_MIN_MS + Math.floor(revealRand(s.seed, step) * (REVEAL_PAUSE_MS - REVEAL_PAUSE_MIN_MS)), burst: 0 };
  }
  let gap = REVEAL_MIN_MS + Math.floor(revealRand(s.seed, step) * (REVEAL_CHAR_MS - REVEAL_MIN_MS));
  let burst = s.burst + 1;
  if (burst >= BURST_MIN + Math.floor(revealRand(s.seed, step + 997) * (BURST_MAX - BURST_MIN + 1))) {
    gap += REVEAL_PAUSE_MIN_MS;
    burst = 0;
  }
  return { gap, burst };
}

/** now 기준 노출 전진. tick 루프는 revealStore, 이 함수는 순수.
 *  반환: [다음 상태, 노출이 실제로 전진했나]. 전진 없으면 렌더 스킵(토큰마다 재렌더 금지 교훈 승계).
 *  - 자연 구간(서버 방생 중): 1틱 1자. nextRevealAt이 과거로 밀려도(탭 스로틀링·클럭 점프)
 *    폭주하지 않고 1자만 — 버퍼 선행이 '되감기처럼 보이는 점프'가 되지 않게 (카드: 버퍼 선행 요구).
 *  - pendingDone 소진 모드(서버 확정, 잔여>0): drainStep자/틱로 REVEAL_DRAIN_MS 내 소진 —
 *    폭주·영구 잔류 금지. 지터는 문자마다 유지. */
export function advanceReveal(s: RevealState, now: number): [RevealState, boolean] {
  if (s.finished) return s.revealed < revealChars(s.text).length ? [{ ...s, revealed: revealChars(s.text).length }, true] : [s, false];
  const all = revealChars(s.text);
  if (s.revealed >= all.length) return [s, false];
  if (now < s.nextRevealAt) return [s, false];

  if (s.pendingDone) {
    const stepChars = Math.max(1, Math.min(all.length - s.revealed, s.drainStep ?? 1));
    const nextRevealed = Math.min(all.length, s.revealed + stepChars);
    return [{ ...s, revealed: nextRevealed, nextRevealAt: now + REVEAL_TICK_MS, burst: 0, step: s.step + stepChars, drainStep: s.drainStep }, true];
  }

  const { gap, burst } = gapAfterChar(s, all[s.revealed], s.step + 1);
  return [{ ...s, revealed: s.revealed + 1, nextRevealAt: now + gap, burst, step: s.step + 1 }, true];
}

/** 노출 문자열 (진도까지의 슬라이스) */
export function revealedText(s: RevealState): string {
  return revealChars(s.text).slice(0, s.revealed).join('');
}

/** 리빌 진행 중인가 (버퍼가 진도보다 앞선 상태 = caret 유지 조건) */
export function isRevealing(s: RevealState): boolean {
  return !s.finished && s.revealed < revealChars(s.text).length;
}

/** 즉시 전량 노출 (prefers-reduced-motion / 취소·오류 확정 / 대형 행 폴백) — 리빌 중단, 전문 진도. */
export function revealNow(s: RevealState): RevealState {
  return { ...s, revealed: revealChars(s.text).length, finished: true, pendingDone: false, drainStep: undefined };
}

/** 확정: 취소·오류·잔류 정합 — 전문 즉시 렌더(되감기 없음). incoming이 더 길면 진실 우선. */
export function finishReveal(s: RevealState, fullText?: string): RevealState {
  const text = typeof fullText === 'string' && fullText.length >= s.text.length ? fullText : s.text;
  const arr = revealChars(text);
  return { ...s, text, revealed: arr.length, finished: true, pendingDone: false, drainStep: undefined };
}
