// 조이스틱 제스처 순수 로직 — 테스트 가능한 분리 모듈
// 설계서: ui-interaction-spec.md §1.3 (deadzone/directionThreshold/angleSnap 8방향 스냅)
// t_08d671a8 (대표님 10/4): 5방향 액션 매핑 확장 — ↑키보드 ←취소 →수정 ↓사진 ↗파일
import { JoystickGesture } from '../types';

export const GESTURE_CONFIG = {
  deadzone: 12,
  directionThreshold: 30,
  angleSnap: 22.5,
  longPressDuration: 500,
  tapMaxDuration: 200,
  /** t_08d671a8: 센터 데드존 (패드 반경의 40% 이내 = 기본 전송, 방향 무시) */
  centerDeadzoneFactor: 0.4,
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
/* i18n-exempt-start — 8방향 기본 라벨. 사용자 저장 데이터(joystickMapping 커스텀 라벨)와
   동일 채널 혼재 + t_267f14da/t_eded715c 소관 파일 — 값 키화 금지.
   화면 표시는 VoiceHomeScreen이 directionLabels로 t('cards.formYes') 등 주입. */
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
/* i18n-exempt-end */

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

// ────────────────────────────────────────────────────────────────────────────
// t_08d671a8 (대표님 10/4): 5방향 액션 매핑 — 홀드+방향 릴리즈 조이스틱 계약
// "위로 올리면 키보드, 왼쪽 가면 취소, 오른쪽 가면 수정, 아래로 가면 사진첨부, 1시방향이면 파일첨부"
// ────────────────────────────────────────────────────────────────────────────

/** 음성 스테이지 5방향+센터 액션 타입 */
export type StageAction = 'send' | 'keyboard' | 'cancel' | 'edit' | 'photo' | 'file';

/** 방향별 섹터 정의 (중심 각도, 허용 반각) — 0°=12시, 시계방향 */
const STAGE_SECTORS: { action: StageAction; centerAngle: number; halfWidth: number }[] = [
  { action: 'keyboard', centerAngle: 0, halfWidth: 30 },      // ↑ 12시: 330~30°
  { action: 'file', centerAngle: 30, halfWidth: 15 },         // ↗ 1시: 15~45°
  { action: 'edit', centerAngle: 90, halfWidth: 30 },         // → 3시: 60~120°
  { action: 'photo', centerAngle: 180, halfWidth: 30 },       // ↓ 6시: 150~210°
  { action: 'cancel', centerAngle: 270, halfWidth: 30 },      // ← 9시: 240~300°
];

/**
 * 각도(0°=12시, 시계방향)와 거리를 입력받아 액션 결정.
 * - 거리 < centerDeadzone (패드 반경 * 0.4) → 'send' (센터 유지 릴리스)
 * - 각도가 섹터에 매칭 → 해당 액션
 * - 매칭 없음 → 'send' (기본)
 *
 * 순수 함수 — 단위테스트 대상 (각도 경계·센터 데드존)
 */
export function selectAction(angleDeg: number, distance: number, padRadius: number): StageAction {
  const centerDeadzone = padRadius * GESTURE_CONFIG.centerDeadzoneFactor;
  if (distance < centerDeadzone) return 'send';

  // 각도 정규화 (0~360)
  let angle = angleDeg % 360;
  if (angle < 0) angle += 360;

  for (const sector of STAGE_SECTORS) {
    const diff = Math.abs(angle - sector.centerAngle);
    const wrapped = Math.min(diff, 360 - diff);
    if (wrapped <= sector.halfWidth) return sector.action;
  }

  return 'send'; // 매칭 없는 영역 (2시, 4시, 5시, 7시, 8시, 10시, 11시 등) = 기본 전송
}

/**
 * dx,dy 드래그 벡터로부터 각도 계산 (0°=12시, 시계방향)
 */
export function vectorToAngle(dx: number, dy: number): number {
  let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

/**
 * dx,dy 드래그 벡터와 패드 반경으로 액션 결정 (selectAction 래퍼)
 */
export function selectActionFromVector(dx: number, dy: number, padRadius: number): StageAction {
  const distance = Math.hypot(dx, dy);
  const angle = vectorToAngle(dx, dy);
  return selectAction(angle, distance, padRadius);
}

/** 5방향 나침반 데이터 — 상단 클러스터 가이드 렌더용 */
export const COMPASS_DIRECTIONS: { action: StageAction; arrow: string; label: string; angle: number }[] = [
  { action: 'keyboard', arrow: '↑', label: '키보드', angle: 0 },
  { action: 'file', arrow: '↗', label: '파일', angle: 30 },
  { action: 'edit', arrow: '→', label: '수정', angle: 90 },
  { action: 'photo', arrow: '↓', label: '사진', angle: 180 },
  { action: 'cancel', arrow: '←', label: '취소', angle: 270 },
];