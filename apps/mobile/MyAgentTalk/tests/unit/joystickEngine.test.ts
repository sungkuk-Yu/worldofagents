// 매직패드 제스처 인지로직 단위 테스트 — src/lib/joystickEngine.ts (카드 t_5de18a91)
// 계층 판정: tap / press(롱프레스) / flick / swipe(open→commit·관성) / drag(그립 시작·이탈)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PadGestureTracker, PAD_CONFIG, dragStepsFromDx, isDoubleTap, swipeActionFor, SwipeAction,
} from '../../src/lib/joystickEngine';

const PAD = { width: 340, height: 265 };
const CENTER = { x: 170, y: 132 };

// ── tap / press ─────────────────────────────────
test('탭: 이동 없이 200ms 이내 릴리스 → tap', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  tr.onMove(CENTER.x + 2, CENTER.y + 1, 80);
  assert.deepEqual(tr.onRelease(150), { kind: 'tap' });
});

test('롱프레스 후 릴리스는 tap이 아니라 press — 녹음 토글 재발동 방지', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  tr.markLongPress();
  assert.deepEqual(tr.onRelease(900), { kind: 'press' });
});

test('느린 소폭 이동(<flickMin)·200ms 초과 릴리스는 micro (오탭 실행 방지)', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  tr.onMove(CENTER.x + 5, CENTER.y, 400);
  const res = tr.onRelease(500);
  assert.equal(res.kind, 'micro');
});

// ── flick (방향 확정 → 맵 동작) ──────────────────
test('flick: 160ms 안에 60px 우측 → DIR_RIGHT flick', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  tr.onMove(CENTER.x + 30, CENTER.y, 80);
  tr.onMove(CENTER.x + 60, CENTER.y, 160);
  const res = tr.onRelease(160);
  assert.equal(res.kind, 'flick');
  if (res.kind === 'flick') assert.equal(res.gesture, 'DIR_RIGHT');
});

test('flick: 위쪽 짧은고속 → DIR_UP (자유매핑 방향과 동일 심볼)', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  tr.onMove(CENTER.x, CENTER.y - 45, 100);
  const res = tr.onRelease(100);
  assert.equal(res.kind, 'flick');
  if (res.kind === 'flick') assert.equal(res.gesture, 'DIR_UP');
});

test('느린 방향 드래그(flickMaxDuration 초과)는 flick 확정 안 함 — micro', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  tr.onMove(CENTER.x + 50, CENTER.y, 600); // 600ms에 50px → 속도 0.083 < 임계
  const res = tr.onRelease(600);
  assert.equal(res.kind, 'micro');
});

// ── swipe (긴 미끄러짐 → 확정 계층) ─────────────
test('swipe: 120px 초과 이동에서 open → 릴리스 커밋, 방향 유지', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  const mid = tr.onMove(CENTER.x - 120, CENTER.y, 200);
  assert.equal(mid.kind, 'swipe-open');
  if (mid.kind === 'swipe-open') assert.equal(mid.gesture, 'DIR_LEFT');
  const done = tr.onRelease(210);
  assert.equal(done.kind, 'swipe-commit');
});

test('관성: 릴리스 직후 swipeProgress는 실이동보다 크다 (캐리 보정)', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  tr.onMove(CENTER.x, CENTER.y + 60, 60);
  tr.onMove(CENTER.x, CENTER.y + 120, 90); // 고속
  const p = tr.swipeProgress();
  const rawOnly = Math.min(1, 120 / (PAD.height * 0.9));
  assert.ok(p > rawOnly, `관성 보정(${p}) > 실이동(${rawOnly})`);
});

// ── drag (우하단 그립 → 미세조정) ───────────────
test('그립 영역 시작 = startsAsDrag, 우하단 좌표 판정', () => {
  const gx = PAD.width - 20, gy = PAD.height - 20;
  assert.ok(PadGestureTracker.isGripZone(gx, gy, PAD));
  assert.ok(!PadGestureTracker.isGripZone(CENTER.x, CENTER.y, PAD));
  const tr = new PadGestureTracker(gx, gy, 0, PAD);
  assert.equal(tr.startsAsDrag(), true);
});

test('드래그 이탈(패드 높이 50% 초과 이동) → drag-exit (취소 의미)', () => {
  const tr = new PadGestureTracker(PAD.width - 20, PAD.height - 20, 0, PAD);
  const far = tr.onMove(20, 20, 300); // 좌상단 대각 이탈
  assert.equal(far.kind, 'drag-exit');
});

test('드래그 중 미세 이동은 drag-exit 없음 → micro', () => {
  const tr = new PadGestureTracker(PAD.width - 20, PAD.height - 20, 0, PAD);
  const near = tr.onMove(PAD.width - 60, PAD.height - 30, 100);
  assert.equal(near.kind, 'micro');
});

test('dragStepsFromDx: 40px당 ±1, 클램프 ±5, 데드존(라운드) 안정', () => {
  assert.equal(dragStepsFromDx(0), 0);
  assert.equal(dragStepsFromDx(20), 1); // round(0.5)=1? Math.round(0.5)=1 (JS 반올림 ↑)
  assert.equal(dragStepsFromDx(-80), -2);
  assert.equal(dragStepsFromDx(1000), 5);
  assert.equal(dragStepsFromDx(-1000), -5);
});

// ── swipe 계층 의미 (물리 직관 고정 매핑) ───────
test('swipeActionFor: ↑종료 ↓취소 ←이전 →다음, 대각은 지배축 폴백', () => {
  assert.equal(swipeActionFor('DIR_UP'), 'record_stop');
  assert.equal(swipeActionFor('DIR_DOWN'), 'cancel');
  assert.equal(swipeActionFor('DIR_LEFT'), 'prev_segment');
  assert.equal(swipeActionFor('DIR_RIGHT'), 'next_segment');
  assert.equal(swipeActionFor('DIR_UPLEFT'), 'record_stop');   // 세로 지배
  assert.equal(swipeActionFor('DIR_DOWNRIGHT'), 'cancel');     // 세로 지배
});

test('PAD_CONFIG: 플릭/스와이프 임계는 위계 정렬 (micro < flick < swipe)', () => {
  assert.ok(PAD_CONFIG.microMoveThreshold < PAD_CONFIG.flickMinDistance);
  assert.ok(PAD_CONFIG.flickMinDistance < PAD_CONFIG.swipeMinDistance);
});

// ── scroll 계층 (느린 드래그/원형 드래그 = 스크롤, 카드 본문 ② '드래그 후 정지=스크롤') ──
test('onMove: flickMin~swipeMin 구간에서 플릭 창 초과(느린 드래그) → scroll + dx 스텝', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  const res = tr.onMove(CENTER.x + 50, CENTER.y, 600); // 50px@600ms: 빠르지 않음 → 스크롤
  assert.equal(res.kind, 'scroll');
  if (res.kind === 'scroll') {
    assert.equal(res.dx, 50);
    assert.equal(res.steps, 1); // 40px/스텝
  }
});

test('onMove: 패드 중심 원형 드래그(누적 회전 ≥60°) → scroll (하이브리드 ③ 원형드래그=스크롤)', () => {
  // 중심 기준 반지름 60px로 60°→90° 회전 경로 (시작점 기준 코드는 swipeMin 88px 미만 유지)
  const cx = PAD.width / 2, cy = PAD.height / 2, r = 60;
  const tr = new PadGestureTracker(cx, cy - r, 0, PAD);
  tr.onMove(cx + r * Math.sin(Math.PI / 3), cy - r * Math.cos(Math.PI / 3), 100); // 60° 지점
  const res = tr.onMove(cx + r, cy, 200); // 90° 지점 — 누적 회전 90° ≥ 60°
  assert.equal(res.kind, 'scroll');
});

test('onMove: 빠르고 짧은 방향 이동은 여전히 scroll 아니라 micro(후보) — flick은 릴리스에서 확정', () => {
  const tr = new PadGestureTracker(CENTER.x, CENTER.y, 0, PAD);
  const res = tr.onMove(CENTER.x + 60, CENTER.y, 100); // 100ms: 플릭 창 내
  assert.equal(res.kind, 'micro');
});

// ── 더블탭 창 ─────────────────────────────────
test('isDoubleTap: 300ms 창 내 재탭만 true, 경계/음수/초과 처리', () => {
  assert.equal(isDoubleTap(120), true);
  assert.equal(isDoubleTap(0), true);
  assert.equal(isDoubleTap(300), true);
  assert.equal(isDoubleTap(301), false);
  assert.equal(isDoubleTap(-5), false);
});
