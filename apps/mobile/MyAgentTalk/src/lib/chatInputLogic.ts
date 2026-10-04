// 채팅 입력창 Enter 분기·높이 성장 순수 로직 (t_c690274e — 대표님 10/3 'Shift+Enter 줄바꿈 불가' 교대)
// 표준 채팅앱(Telegram/카톡 웹) 계약: Enter 단독=전송, Shift+Enter=개행, IME 조합 중 Enter=미전송·미개행.
// 웹: RN-web TextInput.handleKeyDown은 multiline+blurOnSubmit=false에서 Enter submit을 스킵하고 개행을
//   keydown 기본 동작에 남긴다 → Shift+Enter는 그대로 개행. Enter 단독 승격은 컴포넌트의
//   onKeyDownCapture(paper가 rest→pickProps keyboardProps로 DOM까지 투하)에서 preventDefault(개행 차단)
//   + submit 직접 호출. RN-web bubble의 submit 분기도 isDefaultPrevented로 스킵 → 이중 전송 0.
//   조합 중 가드는 RN-web의 isComposing()와 동일 기준(isComposing || keyCode===229, w3.org/TR/uievents).
// 네이티브(0.86): submitBehavior='submit' 계약이 동일 분기를 수행 → 이 판정 함수는 웹에서만 참조된다
//   (컴포넌트에서 Platform.OS!=='web' 조기 return).
// 단위 테스트: tests/unit/chatInputLogic.test.ts (tsconfig.test.json include 필수).

/** keydown 시점의 입력 키 이벤트 스냅샷 (web: DOM KeyboardEvent 하위 집합) */
export interface EnterKeyLike {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/** Enter 단독(Shift 없음·조합 아님)이면 true — 전송 승격 + 개행 preventDefault. */
export function shouldSendOnEnter(e: EnterKeyLike): boolean {
  if (e.key !== 'Enter') return false;
  if (e.shiftKey) return false; // Shift+Enter = 줄바꿈 (기본 동작에 양보)
  // 한글 IME 조합 확정 Enter — w3.org/uievents keyCode 229 또는 isComposing. 절대 전송 승격 금지.
  if (e.isComposing || e.keyCode === 229) return false;
  return true;
}

// ── 높이 성장 (요구 3): 1줄 → 최대 5줄, 초과 시 내부 스크롤, 발송(=value 소거) 후 원복 ──
// 계측 기준: paper outlined multiline dense(라벨 없음)의 textarea 패딩 = contentAreaPadding
// (dense?10:20) 상하합 20. scrollHeight는 content+padding이라 아래 상수와 자동 상쇄된다.
export const INPUT_LINE_HEIGHT = 26.35;      // typography.body 17×1.55 (t_99322cc0)
export const INPUT_MAX_LINES = 5;
export const INPUT_PAD_V = 24;               // textarea 상하 패딩 실측(~22) + 여유 2 — 5줄이 MAX에 걸려 2px 잘림 나는 것 방지
export const INPUT_MIN_HEIGHT = 48;          // dense outlined 1줄 시각 높이(MIN_DENSE_HEIGHT_OUTLINED) — 축소 금지
export const INPUT_MAX_HEIGHT = INPUT_MAX_LINES * INPUT_LINE_HEIGHT + INPUT_PAD_V; // 155.75

/**
 * textarea 자연 높이(scrollHeight; height:'auto' 풀 상태에서 계측) → 입력창 높이 px.
 * 5줄 초과분은 MAX에 클램프 → 컴포넌트가 overflowY:auto로 내부 스크롤. 소거 시 48로 원복.
 */
export function inputHeightFor(naturalHeight: number): number {
  if (!Number.isFinite(naturalHeight) || naturalHeight <= 0) return INPUT_MIN_HEIGHT;
  return Math.min(Math.max(naturalHeight, INPUT_MIN_HEIGHT), INPUT_MAX_HEIGHT);
}

/** 자연 높이가 MAX 초과 = 잘려 내부 스크롤이 필요한지 (true→auto, false→hidden). */
export function inputScrolls(naturalHeight: number): boolean {
  return Number.isFinite(naturalHeight) && naturalHeight > INPUT_MAX_HEIGHT;
}
