// 컴포넌트 단위 테스트 — 조이스틱 8방향 제스처 순수 로직 (src/lib/gesture.ts)
// ui-interaction-spec.md §1.3 (deadzone / directionThreshold / 22.5° 각도 스냅)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDirection,
  isOutsideDeadzone,
  isTap,
  DEFAULT_DIRECTION_LABELS,
  DIRECTION_ARROWS,
  GESTURE_CONFIG,
} from '../../src/lib/gesture';

// ── 8방향 스냅 ─────────────────────────────────
test('8방향: 축 방향 제스처를 정확히 스냅한다', () => {
  assert.equal(getDirection(0, -40), 'DIR_UP'); // 위
  assert.equal(getDirection(0, 40), 'DIR_DOWN'); // 아래
  assert.equal(getDirection(40, 0), 'DIR_RIGHT'); // 오른쪽
  assert.equal(getDirection(-40, 0), 'DIR_LEFT'); // 왼쪽
});

test('8방향: 대각선 45° 제스처를 정확히 스냅한다', () => {
  const d = 40 / Math.SQRT2; // 45° 대각 거리
  assert.equal(getDirection(d, -d), 'DIR_UPRIGHT'); // 오른쪽 위
  assert.equal(getDirection(d, d), 'DIR_DOWNRIGHT'); // 오른쪽 아래
  assert.equal(getDirection(-d, d), 'DIR_DOWNLEFT'); // 왼쪽 아래
  assert.equal(getDirection(-d, -d), 'DIR_UPLEFT'); // 왼쪽 위
});

test('8방향: 인접 경계 근처에서 가장 가까운 방향으로 스냅한다', () => {
  // 20° 기울기(≈0°에 가까움)는 DIR_UP 으로
  assert.equal(getDirection(Math.sin(Math.PI / 9) * 60, -Math.cos(Math.PI / 9) * 60), 'DIR_UP');
  // 22.5° 스냅 경계: 25° 는 0°보다 45°(오른쪽 위)에 가까움 → DIR_UPRIGHT
  assert.equal(getDirection(Math.sin((25 * Math.PI) / 180) * 60, -Math.cos((25 * Math.PI) / 180) * 60), 'DIR_UPRIGHT');
  // 40° 는 45°(오른쪽 위)에 더 가까움
  assert.equal(getDirection(Math.sin((40 * Math.PI) / 180) * 60, -Math.cos((40 * Math.PI) / 180) * 60), 'DIR_UPRIGHT');
  // 70° 는 45°보다 90°(오른쪽)에 가까움
  assert.equal(getDirection(Math.sin((70 * Math.PI) / 180) * 60, -Math.cos((70 * Math.PI) / 180) * 60), 'DIR_RIGHT');
});

test('deadzone: 방향 임계값 미만이면 null', () => {
  assert.equal(getDirection(0, 0), null);
  assert.equal(getDirection(GESTURE_CONFIG.directionThreshold - 1, 0), null);
  assert.equal(getDirection(0, GESTURE_CONFIG.directionThreshold - 1), null);
});

test('deadzone: 정확히 임계값 이상이면 방향 확정', () => {
  assert.equal(getDirection(0, -GESTURE_CONFIG.directionThreshold), 'DIR_UP');
});

// ── 데드존 / 탭 ─────────────────────────────────
test('isOutsideDeadzone: 유클리드 거리 기준 데드존 판별', () => {
  assert.equal(isOutsideDeadzone(0, 0), false);
  assert.equal(isOutsideDeadzone(GESTURE_CONFIG.deadzone - 1, 0), false);
  assert.equal(isOutsideDeadzone(GESTURE_CONFIG.deadzone, 0), true);
  assert.equal(isOutsideDeadzone(6, 8), false); // sqrt(36+64)=10 < 12 → 데드존 내부
  assert.equal(isOutsideDeadzone(9, 12), true); // sqrt(81+144)=15 >= 12 → 데드존 외부
});

test('isTap: 200ms 이내만 탭으로 인식', () => {
  assert.equal(isTap(0), true);
  assert.equal(isTap(GESTURE_CONFIG.tapMaxDuration), true);
  assert.equal(isTap(GESTURE_CONFIG.tapMaxDuration + 1), false);
  assert.equal(isTap(500), false);
});

// ── 라벨/화살표 완결성 ─────────────────────────
test('모든 8방향 + 중앙 제스처에 라벨·화살표가 존재한다', () => {
  for (const g of [
    'TAP_CENTER', 'LONG_CENTER',
    'DIR_UP', 'DIR_UPRIGHT', 'DIR_RIGHT', 'DIR_DOWNRIGHT',
    'DIR_DOWN', 'DIR_DOWNLEFT', 'DIR_LEFT', 'DIR_UPLEFT',
  ] as const) {
    assert.ok(DEFAULT_DIRECTION_LABELS[g], `라벨 누락: ${g}`);
    assert.ok(DIRECTION_ARROWS[g], `화살표 누락: ${g}`);
  }
});