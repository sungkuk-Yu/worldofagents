// 조이스틱 입력 모드 — 순수 로직 (카드 t_5de18a91 요구 2: 3모드 + 설정 전환)
//   joystick: 기존 고정 위치 8방향 스틱 (JoystickMic)
//   pad:      매직패드 — 넓은 평면, 플릭(방향)/스와이프(확정)/드래그(미세조정·우하단 그립) 계층
//   hybrid:   매직패드 위에 중앙 스틱 썸 — 스틱 8방향 + 패드 계층 동시
// 저장/화면과 독립: 정규화만 여기서 (userPrefs가 서버 preferences.joystickMode에 얹음).
export const JOYSTICK_MODES = ['joystick', 'pad', 'hybrid'] as const;
export type JoystickMode = (typeof JOYSTICK_MODES)[number];

// 추천 기본 = 하이브리드 (카드 본문 ③: "기본값 권장") — 기존 사용자(설정 안 함)도 패드 계층 추가 체감, 스틱 감각 유지
export const DEFAULT_MODE: JoystickMode = 'hybrid';

export const MODE_LABEL_KEYS: Record<JoystickMode, string> = {
  joystick: 'joystick.modes.joystick',
  pad: 'joystick.modes.pad',
  hybrid: 'joystick.modes.hybrid',
};

/** 역직렬화 — 알 수 없는 값은 null (호출자가 기본 폴백) */
export function normalizeJoystickMode(raw: unknown): JoystickMode | null {
  if (typeof raw === 'string' && (JOYSTICK_MODES as readonly string[]).includes(raw)) {
    return raw as JoystickMode;
  }
  return null;
}

/** 매직패드 계열(pad/hybrid)이면 true — 화면이 Which 입력 위젯을 렌더할지 결정 */
export function usesPad(mode: JoystickMode): boolean {
  return mode === 'pad' || mode === 'hybrid';
}
