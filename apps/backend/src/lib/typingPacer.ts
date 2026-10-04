/**
 * 사람 타이핑 감각 딜레이 (t_a654c9ac, 대표님 10/4 "바로 대답하면 너무 빨라. 사람이 직접
 * 타이핑 하든거처럼") — 답변 스트리밍 출력을 모스부호식 즉시-flush가 아니라 타이핑
 * 속도(초당 12~25자, 3~7자 버스트 청크, 문장부호 후 미세 pause)로 의류 보내는 pacer.
 *
 * 설계 계약:
 *  - feed(접수)는 즉시, 출력(sink)만 지연시킨다. LLM 생성 속도가 타이핑을 앞서면
 *    백로그 비율만큼 속도를 조인다 (최대 6배 — '로딩 멈춤' 오해 방지, 카드 요구).
 *  - 첫 feed 후 maxTotalDelayMs를 넘기면 잔여 전량 즉시 flush — 지연 상한 방패.
 *  - 취소(cancel) 시 타이머 정리 후 잔여 폐기 — run.cancelled의 partial_text(호출부가
 *    raw 누적 소유)가 미노출 분문을 보존하므로 delta 재스트림은 중복이다.
 *  - drain()은 answer.done 발행 전 대기 지점에서 부른다 — 이벤트 순서 계약
 *    answer.delta* < answer.done < run.completed 불변 (maxTotalDelayMs가 대기 상한).
 *  - rng/now/setTimer 주입 가능(테스트 결정성).
 */
import { config } from '../config';

export interface TypingPacerOptions {
  /** 최종 조립된 청크를 WS delta로 넘기는 싱크 (index 관리 포함). */
  sink: (chunk: string) => void;
  rng?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (h: unknown) => void;
  now?: () => number;
}

/** 이 정도 백로그부터 캐치업 배속이 시작된다 (LLM이 타이핑보다 빠른 구간). */
const BACKLOG_TARGET = 60;
/** 캐치업 최대 배속 — 체감 리듬을 완전히 죽이지 않는 상한. */
const CATCHUP_MAX_MULT = 6;

export interface TypingPacer {
  /** 토큰 단위 원시 delta 접수 — 출력은 스케줄에 따라 sink로 나간다. */
  feed(delta: string): void;
  /** LLM 스트림 종료 — 잔여 소진까지 대기 (지연 상한이 있어 유한). */
  drain(): Promise<void>;
  /** 취소 — 타이머 정리, 잔여 폐기(이후 스케줄·출력 금지). */
  cancel(): void;
}

const SENTENCE_END = /[.!?。！？\n]$/;

/**
 * 사람 타이핑 pacer 생성. humanTyping.enabled=false면 null — 호출부는 더미 분기 없이
 * (pacer===null → 즉시 emit 경로) 기존 동작과 1:1 복귀한다.
 */
export function createTypingPacer(opts: TypingPacerOptions): TypingPacer | null {
  if (!config.humanTyping.enabled) return null;
  const { sink } = opts;
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? Date.now;
  const setT = opts.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutFn ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let pending = '';
  let dead = false;
  let timer: unknown = null;
  let settleResolve: (() => void) | null = null;
  let draining = false;
  let startedAt: number | null = null; // 첫 feed 시점 — 파이프라인(LLM) 대기 시간을 지연 예산에 섞지 않는다.

  const randInt = (min: number, max: number) => min + Math.floor(rng() * Math.max(1, max - min + 1));

  const finishIfIdle = () => {
    if (draining && !pending && timer === null && settleResolve) {
      const r = settleResolve; settleResolve = null; r();
    }
  };

  const step = () => {
    timer = null;
    if (dead) return;
    if (!pending) { finishIfIdle(); return; }
    const ht = config.humanTyping;
    // 지연 상한 방패: 첫 feed 후 maxTotalDelayMs 초과 시 잔여 전량 즉시 — '로딩 멈춤' 금지.
    if (ht.maxTotalDelayMs > 0 && startedAt !== null && now() - startedAt > ht.maxTotalDelayMs) {
      const rest = pending; pending = '';
      sink(rest);
      finishIfIdle();
      return;
    }
    const cps = randInt(ht.cpsMin, ht.cpsMax);
    const size = Math.min(pending.length, randInt(3, 7));
    const chunk = pending.slice(0, size);
    pending = pending.slice(size);
    sink(chunk);
    if (!pending) { finishIfIdle(); return; }
    // 인터벌 = 버스트 크기/타이핑 속도 ÷ 캐치업 배속(백로그 비례, 상한 6×) + 문장부호 pause.
    const catchup = Math.min(CATCHUP_MAX_MULT, Math.max(1, pending.length / BACKLOG_TARGET));
    let waitMs = (size / Math.max(1, cps * catchup)) * 1000;
    if (SENTENCE_END.test(chunk) && ht.sentencePauseMs > 0) {
      waitMs += 60 + rng() * Math.max(0, ht.sentencePauseMs - 60);
    }
    timer = setT(step, waitMs);
  };

  return {
    feed(delta: string) {
      if (dead || !delta) return;
      if (startedAt === null) startedAt = now();
      pending += delta;
      if (timer === null) timer = setT(step, 0);
    },
    drain() {
      if (dead || (!pending && timer === null)) return Promise.resolve();
      draining = true;
      return new Promise<void>(resolve => { settleResolve = resolve; });
    },
    cancel() {
      dead = true;
      if (timer !== null) { clearT(timer); timer = null; }
      // 미노출 잔여는 폐기 — run.cancelled의 partial_text(누적 문자열 소유)가 보존한다.
      pending = '';
      finishIfIdle();
    },
  };
}

/**
 * 재질문 카드가 뜬 턴의 '자동 예 진행' 지연(ms) — 칩 노출 후 자동예 간주 시점.
 * 대표님 10/4 계약: 예/아니오 칩 창(ACK_AUTO_PROCEED_MS=2500)과 동일 플로어 + 지터 ≤100ms,
 * 즉 [chipFloorMs, chipFloorMs+chipJitterMs] = [2500, 2600] — 게이트 '자동예 진행 ≤2.6s' 봉인.
 * answerNode의 leadMs를 교체하는 데 쓴다 (초과분 없음 — 사람이 읽을 창을 정확히 소진한다).
 */
export function chipProceedMs(rng: () => number = Math.random): number {
  const ht = config.humanTyping;
  return Math.round(ht.chipFloorMs + rng() * Math.max(0, ht.chipJitterMs));
}

/**
 * 재질문 없는 텍스트 턴의 답변 첫 토큰 전 사람 리드타임(ms) —
 * 발화 길이 비율(40자 상한 곡선)로 [leadMinMs, leadMaxMs] 보간 + ±15% 지터.
 * 대표님 10/4 요구2: "바로 대답하면 너무 빨라" — 0.8~2.0s 랜덤 인간적 고민 시간.
 * (음성·echoMode off 턴은 호출부에서 이 함수를 타지 않는다 — leadMs=0 SLA 불변.)
 */
export function typingLeadMs(utteranceLength: number, rng: () => number = Math.random): number {
  const ht = config.humanTyping;
  const ramp = Math.min(1, Math.max(0, utteranceLength) / 40);
  const base = ht.leadMinMs + ramp * Math.max(0, ht.leadMaxMs - ht.leadMinMs);
  const jitter = 1 + (rng() - 0.5) * 0.3; // ±15%
  return Math.max(0, Math.round(base * jitter));
}
