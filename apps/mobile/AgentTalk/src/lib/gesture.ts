// 조이스틱 제스처 순수 로직 — 테스트 가능한 분리 모듈
// 설계서: ui-interaction-spec.md §1.3 (deadzone/directionThreshold/angleSnap 8방향 스냅)
import { JoystickGesture } from '../types';

export const GESTURE_CONFIG = {
  deadzone: 12,
  directionThreshold: 30,
  angleSnap: 22.5,
  longPressDuration: 500,
  tapMaxDuration: 200,
} as const;

// 8방향 정의 (0° = 위, 시계방향)
export const DIRECTION_ANGLES: { angle: number; gesture: JoystickGesture }[] = [
  { angle: 0, gesture: 'DIR_UP' },
  { angle: 45, gesture: 'DIR_UPRIGHT' },
  { angle: 90, gesture: 'DIR_RIGHT' },
  { angle: 135, gesture: 'DIR_DOWNRIGHT' },
  { angle: 180, gesture: 'DIR_DOWN' },
  { angle: 225, gesture: 'DIR_DOWNLEFT' },
  { angle: 270, gesture: 'DIR_LEFT' },
  { angle: 315, gesture: 'DIR_UPLEFT' },
];

export interface DragVector {
  dx: number;
  dy: number;
}

/**
 * 드래그 벡터(dx,dy)를 8방향 제스처로 스냅.
 * - deadzone 이하면 null (방향 없음)
 * - 22.5° 스냅으로 가장 가까운 8방향 확정
 */
export function getDirection(dx: number, dy: number): JoystickGesture | null {
  const distance = Math.hypot(dx, dy);
  if (distance < GESTURE_CONFIG.directionThreshold) return null;

  let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
  if (angle < 0) angle += 360;

  let closest = DIRECTION_ANGLES[0];
  let minDiff = 360;
  for (const dir of DIRECTION_ANGLES) {
    const diff = Math.abs(angle - dir.angle);
    const wrapped = Math.min(diff, 360 - diff);
    if (wrapped < minDiff) {
      minDiff = wrapped;
      closest = dir;
    }
  }
  return closest.gesture;
}

/** 드래그 벡터가 데드존을 벗어났는지 */
export function isOutsideDeadzone(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= GESTURE_CONFIG.deadzone;
}

/** 터치 지속시간 기준 탭 판별 */
export function isTap(durationMs: number): boolean {
  return durationMs <= GESTURE_CONFIG.tapMaxDuration;
}

/** 8방향 기본 라벨 — 화면/상호작용에 표시 (스크린 7 기본값) */
export const DEFAULT_DIRECTION_LABELS: Record<JoystickGesture, string> = {
  TAP_CENTER: '말하기',
  LONG_CENTER: '녹음 중',
  DIR_UP: '위로',
  DIR_UPRIGHT: '오른쪽 위',
  DIR_RIGHT: '아니오',
  DIR_DOWNRIGHT: '오른쪽 아래',
  DIR_DOWN: '취소',
  DIR_DOWNLEFT: '왼쪽 아래',
  DIR_LEFT: '예',
  DIR_UPLEFT: '왼쪽 위',
};

/** 8방향 화살표 심볼 */
export const DIRECTION_ARROWS: Record<JoystickGesture, string> = {
  TAP_CENTER: '●',
  LONG_CENTER: '●',
  DIR_UP: '↑',
  DIR_UPRIGHT: '↗',
  DIR_RIGHT: '→',
  DIR_DOWNRIGHT: '↘',
  DIR_DOWN: '↓',
  DIR_DOWNLEFT: '↙',
  DIR_LEFT: '←',
  DIR_UPLEFT: '↖',
};