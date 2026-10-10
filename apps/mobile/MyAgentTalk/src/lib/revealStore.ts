// 리빌 저장소 ③ — 문장 단위 노출 구동 레이어 (t_4c266653, 대표님 10/10 원지시 ①②③)
// typewriterReveal 순수 스케줄러(3차 개정: 30자/s 지터 타이머 폐기 → 서버 스트림 속도 그대로)의 상태 저장소.
//   · 노출 전진은 feed/markDone/move 이벤트 즉시 — 타이머로 글자를 끌지 않는다. 틱은 '정리원(janitor)' 전용:
//     finished 상태 회수 + caret 정지. '도착 청크는 feed 후 ≤1틱(실질 0틱)에 경계까지 노출' 게이트의 근거.
//   · 미완 꼬리(마지막 컷점 이후)는 보류 — 다음 컷점 포함 청크 또는 확정까지. 확정 = 전문 즉시.
//   · 통째 도착(empathy 재질문 등)은 리빌 상태 미생성(③) — 즉시 표시가 정답. 예/아니요 칩 발화 창을
//     표시 연출이 태우지 못하게 된다(t_e1de4cc4 exceptKey의 근본 해소; 인자 규약 자체는 하위 호환 유지).
// React/RN 의존 없음 (lib 순수 관례). 사용처: useChatSession(feed/markDone/move/finishOrDrop/reconcile),
// RevealBody(view/subscribe), ChatScreen(setEnabled/hasPending).
// 원칙 (승계):
//   · messages[].content(원문)는 절대 변형하지 않는다 — 노출 진도는 표시 계층뿐. 답글/수출/트래커 무영향.
//   · 되감기 없음. 진도는 단조(monotonic) — 짧은 incoming 무시, finished 재생성/재시작 금지.
//   · typewriterReveal 플래그 OFF / prefers-reduced-motion(setEnabled(false)) = 상태 미생성 = 즉시 렌더 1:1.
//   · 취소·오류 = 즉시 전문 노출(finish) 또는 폐기(drop; 폴백=원문이 즉시 전문과 동일).
import {
  advanceReveal, createReveal, feedReveal, finishReveal, isRevealing, revealChars,
  revealedText, sentenceBoundary, REVEAL_TICK_MS,
  type RevealState,
} from './typewriterReveal';

export interface RevealView {
  text: string;
  revealing: boolean;
  /** 리빌 상태 진행 중(버퍼가 진도보다 앞섬 = 미완 꼬리 보류 포함) — caret 표시 조건 (요구3) */
  typing: boolean;
}
export type RevealListener = () => void;

export interface RevealStore {
  enabled: () => boolean;
  setEnabled: (next: boolean) => void;
  /** answer.delta 누적 원문 급식 — 첫 delta에서 상태 생성 + 컷점까지 즉시 노출(0틱). 절대 되감지 않는다.
   *  반환: 노출 전진 여부. now 인자는 규약 호환(이벤트 전진이라 미사용). */
  feed: (key: string, fullText: string, now?: number) => boolean;
  /** 통째 확정 행 급식 — 3차 개정(t_4c266653 ③): 리빌 상태 생성하지 않는다. false 고정 (즉시 표시 = 정답).
   *  시그니처 유지는 호출 측(useChatSession) 규약 — 호출 자체가 무해하며, 훗날 연출 재요구 시의 지점. */
  begin: (key: string, fullText: string, now?: number) => boolean;
  /** 서버 확정 힌트(answer.done): 전문 즉시 노출. 본문 신장만 허용 — 되감기 없음. */
  markDone: (key: string, fullText?: string) => void;
  /** 스트림 카드(stream-<runId>) → 확정 행(id) 계승 — 확정 본문은 통째 즉시(되감기·점프 없음). */
  move: (fromKey: string, toKey: string, finalText?: string) => boolean;
  /** 즉시 전문 노출(fullText) 또는 폐기 — 취소·오류 경로 (요구4). */
  finishOrDrop: (key: string, fullText?: string) => void;
  /** 스트림 키 고아 회수 — 현재 streams 유효 목록에 없는 stream-* 상태 폐기(영구 커서 금지). */
  reconcileStreamKeys: (liveKeys: string[]) => void;
  /** 전체 폐기 (테스트/하네스 용도) */
  reset: () => void;
  view: (key: string, fallback: string) => RevealView;
  has: (key: string) => boolean;
  subscribe: (key: string, cb: RevealListener) => () => void;
  subscribeAll: (cb: RevealListener) => () => void;
  /** 진행 중 리빌 존재 — 칩 억제 게이트·타이머 생명.
   *  exceptKey(예/아니요 칩 후보 empathy 행): 통째 도착이 리빌을 만들지 않으므로 실질적으로 empathy는
   *  이 인자 없이도 억제 사유가 아니다 — 하위 호환 규약 유지(미주입 = 기존 동작 1:1). */
  hasPending: (exceptKey?: string) => boolean;
  /** 정리원 구동 통로 (unit: 타머 대신 시각 주입 — 시각 자체는 무의미, 회수/정리만 수행) */
  tick: (now?: number) => void;
  tickMs: number;
}

const MAX_REVEAL_CHARS = 1500; // 초대형 스트림(복사 본문 등)은 리빌 생략 — 경계 계산·재렌더 비용, 즉시 렌더로 수렴

export function createRevealStore(): RevealStore {
  const states = new Map<string, RevealState>();
  const listeners = new Map<string, Set<RevealListener>>();
  const allListeners = new Set<RevealListener>();
  const viewCache = new Map<string, RevealView>();
  let enabled = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  function notify(key: string): void {
    viewCache.delete(key);
    listeners.get(key)?.forEach((cb) => { try { cb(); } catch { /* 구독자 예외가 저장소를 오염시키지 않는다 */ } });
    allListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
  }

  function pendingNow(exceptKey?: string): boolean {
    for (const s of states.values()) if (isRevealing(s) && s.key !== exceptKey) return true;
    return false;
  }

  function ensureTimer(): void {
    // 3차 개정: finished 즉시 전환으로 '정리원'은 states에 잔류가 있는 한 돌아야 한다(pendingNow은
    // revealing만 봐서 finished 회수 틱을 놓침 → map leak). 잔류 0이면 자기 정지.
    if (timer !== null || states.size === 0) return;
    timer = setInterval(() => tick(), REVEAL_TICK_MS);
    // node(unit 하네스)에서 열린 핸들로 프로세스 종료가 지연되지 않게 (브라우저의 number에는 no-op)
    (timer as unknown as { unref?: () => void }).unref?.();
  }
  function stopTimer(): void {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  /** 급식·확정 공통 노출 전진: 컷점(또는 pendingDone 시 전문)까지 즉시. 단조 — 후퇴 없으면 무알림.
   *  (advanceReveal이 now를 보지 않으므로 [s2, moved]는 결정적; feed와 done의 유일한 전진 경로.) */
  function push(s: RevealState, done: boolean): [RevealState, boolean] {
    return advanceReveal(s, done);
  }

  /** 정리원: finished 상태 회수(렌더는 폴백=동일 텍스트로 수렴, caret 자동 소멸 — 요구3).
   *  미완 꼬리 보류 상태는 회수하지 않는다: 다음 delta 또는 확정이 같은 진도에서 이어붙인다. */
  function tick(_now?: number): void {
    const changed: string[] = [];
    for (const [key, s] of states) {
      if (s.finished) { states.delete(key); changed.push(key); continue; }
      // finished가 아닌데 진도가 경계/전문 뒤로 처진 이상 상태(직접 조작 포함)는 여기서 정합화.
      const [next, moved] = push(s, false);
      if (moved) { states.set(key, next); changed.push(key); }
    }
    changed.forEach(notify);
    // 3차 개정: 정리원은 잔류 상태가 0이 될 때까지 돈다 — pendingNow만 보면 finished 회수 전에
    // 타이머가 꺼져 회수가 영구 정체된다(map 잔류). tick 한 번에 finished 전부 회수 후 자기 정지.
    if (states.size === 0) stopTimer();
  }

  return {
    tickMs: REVEAL_TICK_MS,
    enabled: () => enabled,
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      if (!next) {
        // 전환 중이던 리빌 즉시 종료 — 상태 회수. view는 폴백(content=전문)로 수렴 → 즉시 전량과 동일 결과.
        for (const key of [...states.keys()]) if (states.delete(key)) notify(key);
        stopTimer();
      }
    },
    feed(key: string, fullText: string, _now?: number): boolean {
      if (!enabled || !fullText) return false;
      const s = states.get(key);
      if (!s) {
        if (fullText.length > MAX_REVEAL_CHARS) return false; // 대형 = 상태 미생성 → 폴백(원문 즉시) 1:1
        const fresh: RevealState = { ...createReveal(key), text: fullText, revealed: sentenceBoundary(revealChars(fullText)) };
        states.set(key, fresh);
        notify(key);
        ensureTimer();
        return fresh.revealed > 0;
      }
      if (s.finished) return false;
      if (fullText.length > MAX_REVEAL_CHARS) { states.set(key, { ...finishReveal(s, fullText), key }); notify(key); return true; } // 대형 성장 = 즉시 전문
      const fed = feedReveal(s, fullText); // 신장만 (짧아지는 incoming 무시)
      if (fed === s) return false;
      const [next, moved] = push(fed, false);
      states.set(key, next);
      if (moved) notify(key);
      ensureTimer();
      return moved;
    },
    begin(_key: string, _fullText: string, _now?: number): boolean {
      // ③ 통째 도착 연출 폐기 (t_4c266653): empathy 재질문·REST 인라인 답변은 도착 즉시 표시가 정답.
      // 상태 생성 없음 → view 폴백(원문) → 기존 즉시 렌더와 동일 트리.
      return false;
    },
    markDone(key: string, fullText?: string) {
      const s = states.get(key);
      if (!s || s.finished) return;
      const text = typeof fullText === 'string' && fullText.length >= s.text.length ? fullText : s.text;
      // 확정 = 전문 즉시 (②: 미완 꼬리를 다음 확정까지 보류하다 이제 통째로) — 되감기 없음.
      states.set(key, { ...finishReveal(s, text), key });
      notify(key);
      ensureTimer(); // 회수는 다음 tick 정리원이 수행
    },
    move(fromKey: string, toKey: string, finalText?: string): boolean {
      const s = states.get(fromKey);
      if (!s) return false;
      states.delete(fromKey);
      const text = typeof finalText === 'string' && finalText.length >= s.text.length ? finalText : s.text;
      if (!states.has(toKey)) {
        // 확정 행은 전문 즉시 (되감기·되감기처럼 보이는 점프 불가 — 진도는 항상 뒤에서 앞).
        states.set(toKey, { ...finishReveal(s, text), key: toKey });
      } else {
        const cur = states.get(toKey)!;
        if (!cur.finished) states.set(toKey, finishReveal(cur, text));
      }
      notify(fromKey);
      notify(toKey);
      ensureTimer();
      return true;
    },
    finishOrDrop(key: string, fullText?: string) {
      const s = states.get(key);
      if (!s) return;
      if (typeof fullText === 'string' && fullText.trim()) states.set(key, { ...finishReveal(s, fullText), key });
      else states.delete(key);
      notify(key);
      ensureTimer();
    },
    reconcileStreamKeys(liveKeys: string[]) {
      const live = new Set(liveKeys);
      for (const key of [...states.keys()]) {
        if (key.startsWith('stream-') && !live.has(key) && states.delete(key)) notify(key);
      }
      if (states.size === 0) stopTimer();
    },
    reset() {
      const keys = [...states.keys()];
      states.clear(); viewCache.clear(); stopTimer();
      keys.forEach(notify);
    },
    view(key: string, fallback: string): RevealView {
      const s = states.get(key);
      const next: RevealView = s
        ? { text: revealedText(s), revealing: isRevealing(s), typing: !s.finished }
        : { text: fallback, revealing: false, typing: false };
      const prev = viewCache.get(key);
      if (prev && prev.text === next.text && prev.revealing === next.revealing && prev.typing === next.typing) return prev;
      viewCache.set(key, next);
      return next;
    },
    has: (key: string) => states.has(key),
    subscribe(key, cb) {
      let set = listeners.get(key);
      if (!set) { set = new Set(); listeners.set(key, set); }
      set.add(cb);
      return () => { const cur = listeners.get(key); if (!cur) return; cur.delete(cb); if (!cur.size) listeners.delete(key); };
    },
    subscribeAll(cb) { allListeners.add(cb); return () => { allListeners.delete(cb); }; },
    hasPending: (exceptKey?: string) => pendingNow(exceptKey),
    tick,
  };
}

/** 앱 공용 인스턴스 — 키가 UUID(stream-<runId>/message id)라 세션 간 교차 오염이 없고,
 *  모든 상태는 확정 후 정리원이 자기 회수(타이머 자동 정지)라 잔류 leaks가 없다. */
export const revealStore = createRevealStore();
