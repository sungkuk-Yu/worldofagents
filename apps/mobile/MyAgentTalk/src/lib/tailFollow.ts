// 꼬리 추종 판정 순수 로직 (t_4c12323c — 대표님 10/9 "위로 올리려고 하는데 드래그 기능에 버그").
// onScroll 분기(정착/이탈/재추종)를 UI에서 분리 — 단위 테스트 대상. 상태 머신은 ChatScreen이 소유하고
// 여기는 "이번 이벤트로 무엇을 할까"만 답한다.
//
// 배경 계약 (t_1731f0f6 r4/r5):
//  - gap<=100 = 정착: 추종 종료 + 배지 해제 (텔레그램/Slack near-bottom 관습).
//  - scrolledUp+의도 = 사용자 이탈: 추종 사망(nearBottom=false) — 이후 arrival은 배지로 알린다.
//  - scrolledUp+무의도+유휴 = r4 서명(확정 카드 수축→브라우저 clamp→재성장 후 지연 합성 scroll-end)
//    = 이탈이 아니라 즉시 재추종(followTail).
// 결함 (t_4c12323c 실측, probe_fling/probe_final): 느린 위로 드래그에서 정착 창(gap≤100)이
//  의도 체인(userScrollAt)을 클리어한 직후, 릴리스 관성이 gap>100으로 밀면 branch3이それを
//  '수축 클램프 딥'으로 오판 → 말미로 되 끌어온다(445→356 드래그→관성 251→404 스냅백).
//  사용자가 "드래그가 말을 안 듣고 스텝친다"고 체감한 증상의 원인이 여기.
// 수리: branch3 진입 전 '모멘텀 창'을 본다 — 마지막 사용자 제스처 마킹(touchmove/wheel/키)
//  이 모멘텀 감쇠 시간(≤1200ms) 이내면 그 감소는 관성이지 클램프 딥이 아니다 → 이탈로 전향.
//  의도 체인(userScrollAt, 400ms·자기 갱신)과 달리 모멘텀 마킹은 정착 클리어와 무관하게
//  유지된다 — 그래서 "settled 후 관성 건넘"이 이탈로 잡힌다. 창이 넓어도 r4 시그니처는
//  안전: 클램프 딥은 사용자가 말미에서 유휴(idle) 상태일 때만 발생(마킹 1.2s+ 경과).
//
// 드래그 중 성장 얭김 (t_4c12323c r2 실측: 445→401, Δ44 — 지문이 내려간 동안 리빌/도착
// growth 이벤트가 followTail을 재발화시켜 말미로 반복 야킹): 손가락이 리스트에 닿아 있는
// 동안은 프로그램 추종이 사용자 드래그와 경쟁한다 → growth 트리거 자체를 억제(dragging 게이트).
// 관습(텔레그램/Slack): 손가락 다운 = 네이티브 드래그 우선, 릴리스 후 정착/성장 이벤트가 재평가.
export type TailScrollDecision = 'settle' | 'exit' | 'refollow' | 'hold';

export interface TailScrollInput {
  /** 실측 끝과의 거리(px): scrollHeight - scrollTop - clientHeight. 음수(과스크롤) 허용. */
  gap: number;
  /** 오프셋 실질 감소(= 위로/히스토리 방향 이동). */
  scrolledUp: boolean;
  /** 400ms 의도 체인 활성(wheel/touchmove/키/스크롤바 — onScroll가 창을 자기 갱신). */
  intent: boolean;
  /** 마지막 사용자 제스처 마킹이 모멘텀 창(1200ms) 이내. 정착(branch1)의 체인 클리어와 무관. */
  touchRecent: boolean;
  /** 현재 말미 추종 활성 상태(nearBottom). */
  nearBottom: boolean;
  /** followTail rAF 루프가 이미 도는 중 — 중복 재추종 금지(기존 가드). */
  following: boolean;
}

/** 정착 판정 임계 — 말미 이 근접이면 "보고 있다"로 본다 (t_1731f0f6 정착 100px 관습 불변). */
export const SETTLE_GAP = 100;

export function decideTailScroll(s: TailScrollInput): TailScrollDecision {
  if (s.gap <= SETTLE_GAP) return 'settle';
  if (s.scrolledUp && s.intent) return 'exit';
  if (s.scrolledUp && s.nearBottom && !s.following) {
    // t_4c12323c: 정착 직후 릴리스 관성이 gap>100을 넘는 이벤트는 '의도 없는 감소'가 아니다.
    // 마지막 제스처 마킹이 모멘텀 창 안이면 사용자 이탈로 전향 — 재추종 스냅백 금지.
    if (s.touchRecent) return 'exit';
    return 'refollow'; // r4 클램프 딥 — 유휴 상태의 프로그램적 감소, 즉시 재추종(계약 보존).
  }
  return 'hold';
}

/** 의도 체인 창(ms) — 기 ChatScreen 상수와 동일 (관성 감속 초반까지 커버). */
export const INTENT_WINDOW_MS = 400;
/** 모멘텀 창(ms) — touchEnd 후 브라우저 관성 감쇠 관측 상한(실측 ~600ms) + 여유. */
export const MOMENTUM_WINDOW_MS = 1200;

/** 의도 체인 갱신 여부 (onScroll가 intent=true일 때 체인을 연장하는 기존 규칙). */
export function shouldRenewIntentChain(web: boolean, intent: boolean): boolean {
  return web && intent;
}

/**
 * onContentSizeChange growth 분기 결정 (t_4c12323c):
 *  - 'clamp-sync': 오프셋이 새 maxOffset를 초과(콘텐츠 수축) — 미러 동기화+정착. (기존 1분기)
 *  - 'suppress': 손가락이 리스트에 닿는 드래그 중(useDragging) 추종 야킹 금지 — 사용자
 *    제스처가 끝난 뒤 정착/성장이 재평가한다. 리빌·arrival 이벤트가 중도 개입해
 *    scrollTop을 말미로 되돌리는 경주(실측 445→401 얭김) 원천 차단.
 *  - 'follow': nearBottom 유지 중 growth — 측정 bottom clamp rAF 추종. (기존 2분기)
 *  - 'ignore': 이탈 상태 growth — 배지 경로(messages effect)만. (기존 3분기)
 */
export function decideTailGrowth(s: { overMax: boolean; dragging: boolean; nearBottom: boolean }): 'clamp-sync' | 'suppress' | 'follow' | 'ignore' {
  if (s.overMax) return 'clamp-sync';
  if (s.dragging) return 'suppress';
  if (s.nearBottom) return 'follow';
  return 'ignore';
}
