// 리빌 상태 저장소 (t_da4f8623 ②-프론트) — typewriterReveal 순수 스케줄러의 구동 레이어.
// React/RN 의존 없음 (lib 순수 관례 — useAckChip 각인 Map과 동일 철학, node --test 컴파일 대상):
//   · useChatSession: feed(WS delta) / markDone(answer.done) / begin(라이브 empathy 행) /
//     move(스트림 카드→확정 행 계승) / finishOrDrop(취소·오류) / reconcileStreamKeys(잔류 회수).
//   · 컴포넌트: useRevealView(store, key, 원문폴백) 로 읽기만 — 미생성 행은 폴백(원문) = 기존 렌더 1:1.
// 원칙:
//   · messages[].content(원문)는 절대 변형하지 않는다 — 노출 진도는 표시 계층뿐.
//     답글/수출/트래커/검색/선택복제는 content 원문 그대로 (요구4 회귀 금지).
//   · 되감기 없음. 지각 중복·재구독 리플레이가 리빌을 재시작하지 못한다 (has 가드 + 길이 후퇴 무시).
//   · typewriterReveal 플래그 OFF / prefers-reduced-motion(setEnabled(false)) = 상태 미생성·전량 즉시 =
//     기존 렌더 1:1 + 타이핑 버블 생명주기도 구 동작 복귀 (기존 e2e 하네스는 전부 reducedMotion:'reduce').
//   · 취소·오류 = 즉시 전문 노출(finish) 또는 상태 폐기(drop; 폴백=원문이 즉시 전문과 동일 결과) (요구4).
import {
  advanceReveal, createReveal, finishReveal, isRevealing, revealChars, revealedText,
  REVEAL_DRAIN_TICKS, REVEAL_TICK_MS,
  type RevealState,
} from './typewriterReveal';

export interface RevealView {
  text: string;
  revealing: boolean;
  /** 리빌 상태 진행 중(버퍼 선행 또는 확정 잔여 드레인) — caret 표시 조건 (요구3) */
  typing: boolean;
}
export type RevealListener = () => void;

export interface RevealStore {
  enabled: () => boolean;
  setEnabled: (next: boolean) => void;
  /** answer.delta 누적 원문 급식 — 첫 delta에서 상태 생성(진도 0), 이후 누적만. 절대 되감지 않는다.
   *  now 주입可选 (unit: 타머 비의존 생성각). */
  feed: (key: string, fullText: string, now?: number) => void;
  /** 라이브 확정 행(empathy early 등) 급식 — 최초 수신에만 생성, 재시작 금지. 반환: 리빌 시작 여부. */
  begin: (key: string, fullText: string, now?: number) => boolean;
  /** 서버 확정 힌트(answer.done): 소진 즉시 커서 정지. 본문이 길면 신장만 — 되감기 없음. */
  markDone: (key: string, fullText?: string) => void;
  /** 스트림 카드(stream-<runId>) → 확정 행(id) 계승 — ID merge와 같은 틱에 진도 이동(타이핑 연속성). */
  move: (fromKey: string, toKey: string, finalText?: string) => boolean;
  /** 즉시 전문 노출(fullText) 또는 폐기 — 취소·오류 경로 (요구4). */
  finishOrDrop: (key: string, fullText?: string) => void;
  /** 스트림 키 고아 회수 — 현재 streams 유효 목록에 없는 stream-* 상태 폐기(영구 커서 금지). */
  reconcileStreamKeys: (liveKeys: string[]) => void;
  /** 전체 폐기 (테스트/하네스 용도; 세션 전환은 자연 소진에 맡김 — 키가 UUID라 교차 오염 없음) */
  reset: () => void;
  view: (key: string, fallback: string) => RevealView;
  has: (key: string) => boolean;
  subscribe: (key: string, cb: RevealListener) => () => void;
  subscribeAll: (cb: RevealListener) => () => void;
  /** 진행 중 리빌 존재 — 칩 억제 게이트·타이핑 버블 소멸 조건 */
  hasPending: () => boolean;
  /** 순수 구동 통로 (unit: 타머 대신 시각 주입) */
  tick: (now: number) => void;
  tickMs: number;
}

const MAX_REVEAL_CHARS = 1500; // 초대형 행(복사 본문 등)은 리빌 생략 — 분 단위 타이핑 금지, 즉시 렌더
const MAX_BEGIN_CHARS = 240;   // 통째 도착 행의 리빌 상한 — REST 인라인 장문답변이 20초 타이핑되는 것 금지

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

  function pendingNow(): boolean {
    for (const s of states.values()) if (isRevealing(s)) return true;
    return false;
  }

  function ensureTimer(): void {
    if (timer !== null || !pendingNow()) return;
    timer = setInterval(() => tick(Date.now()), REVEAL_TICK_MS);
    // node(unit 하네스)에서 열린 핸들로 프로세스 종료가 지연되지 않게 (브라우저의 number에는 no-op)
    (timer as unknown as { unref?: () => void }).unref?.();
  }
  function stopTimer(): void {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  /** 모든 리빌 상태를 now 기준으로 전진. 변경 키만 알림.
   *  now 주입 = unit 결정성 검증 통로(타머 비의존).
   *  회수 규칙: finished(드레인 완료·확정)만 회수 — 이후 렌더는 폴백(원문)과 동일 텍스트라
   *  전환 프레임 없이 자연 수렴, caret 자동 소멸(요구3). '버퍼 소진했으나 아직 방생 중' 상태는
   *  회수하지 않는다: 다음 delta가 같은 진도에서 이어붙는다(회수 후 재생성 = 되감기 폭주 재현). */
  function tick(now: number): void {
    const changed: string[] = [];
    for (const [key, s] of states) {
      if (s.finished) { states.delete(key); changed.push(key); continue; }
      if (!isRevealing(s)) {
        // 소진 + 서버 확정 힌트(pendingDone) 또는 통째 도착(sealed) → finished 표식(커서 정지), 다음 틱 회수.
        // 확정 힌트 없는 스트림 소진(청크 간 갭)은 caret 유지(방중) — 다음 delta가 같은 진도에서 이어붙는다.
        if (s.pendingDone || s.sealed) { states.set(key, { ...s, finished: true }); changed.push(key); }
        continue;
      }
      const [next, moved] = advanceReveal(s, now);
      if (moved) { states.set(key, next); changed.push(key); }
    }
    changed.forEach(notify);
    if (!pendingNow()) stopTimer();
  }

  return {
    tickMs: REVEAL_TICK_MS,
    enabled: () => enabled,
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      if (!next) {
        // 전환 중이던 리빌은 즉시 종료 — 상태 회수. view는 폴백(호출 측 content=전문)로 수렴하므로
        // '즉시 전량 노출'과 동일 결과, finished 상태 잔류(leak)가 없다.
        for (const key of [...states.keys()]) if (states.delete(key)) notify(key);
        stopTimer();
      }
    },
    feed(key: string, fullText: string, now?: number) {
      if (!enabled || !fullText) return;
      const s = states.get(key);
      if (!s) {
        if (fullText.length > MAX_REVEAL_CHARS) return; // 대형 행 = 상태 미생성 → 폴백(원문 즉시) 1:1
        states.set(key, { ...createReveal(key, now ?? Date.now()), text: fullText });
        notify(key);
        ensureTimer();
        return;
      }
      if (s.finished) return;
      if (fullText.length > MAX_REVEAL_CHARS) { states.set(key, { ...finishReveal(s, fullText), key }); notify(key); return; } // 스트림이 대형으로 성장 → 즉시 전문
      if (fullText === s.text || fullText.length < s.text.length) return; // 절대 되감지 않음
      states.set(key, { ...s, text: fullText });
      ensureTimer();
    },
    begin(key: string, fullText: string, now?: number): boolean {
      if (!enabled || !fullText.trim() || fullText.length > MAX_BEGIN_CHARS || states.has(key)) return false;
      // 통째 확정 도착(empathy 라이브 수신) — sealed: 진도만 늦은 것, text는 더 안 자란다. 소진 시 자연 회수.
      states.set(key, { ...createReveal(key, now ?? Date.now()), text: fullText, sealed: true });
      notify(key);
      ensureTimer();
      return true;
    },
    markDone(key: string, fullText?: string) {
      const s = states.get(key);
      if (!s || s.pendingDone || s.finished) return;
      const text = typeof fullText === 'string' && fullText.length > s.text.length ? fullText : s.text;
      const remaining = revealChars(text).length - s.revealed;
      states.set(key, { ...s, text, pendingDone: true, drainStep: Math.max(1, Math.ceil(remaining / REVEAL_DRAIN_TICKS)) });
      ensureTimer();
    },
    move(fromKey: string, toKey: string, finalText?: string): boolean {
      const s = states.get(fromKey);
      if (!s) return false;
      states.delete(fromKey);
      const text = typeof finalText === 'string' && finalText.length >= s.text.length ? finalText : s.text;
      const arr = revealChars(text);
      if (!states.has(toKey)) {
        const remaining = arr.length - s.revealed;
        if (remaining <= 0) { notify(fromKey); return true; } // 소진 완료 — 회수, 렌더는 폴백(원문)로 수렴
        states.set(toKey, { ...s, key: toKey, text, revealed: Math.min(s.revealed, arr.length), pendingDone: true, drainStep: Math.max(1, Math.ceil(remaining / REVEAL_DRAIN_TICKS)) });
      } else {
        // 확정 행 리빌이 이미 시작돼 있었으면(경쟁) 앞선 진도만 이식, 재시작하지 않는다.
        const cur = states.get(toKey)!;
        if (!cur.finished) states.set(toKey, { ...cur, text, revealed: Math.max(cur.revealed, Math.min(s.revealed, arr.length)) });
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
    },
    reconcileStreamKeys(liveKeys: string[]) {
      const live = new Set(liveKeys);
      for (const key of [...states.keys()]) {
        if (key.startsWith('stream-') && !live.has(key) && states.delete(key)) notify(key);
      }
      if (!pendingNow()) stopTimer();
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
    hasPending: () => pendingNow(),
    tick,
  };
}

/** 앱 공용 인스턴스 — 키가 UUID(stream-<runId>/message id)라 세션 간 교차 오염이 없고,
 *  모든 상태는 소진 시 자기 회수(타이머 자동 정지)라 잔류 leaks가 없다. 세션 전환 reset 불요. */
export const revealStore = createRevealStore();
