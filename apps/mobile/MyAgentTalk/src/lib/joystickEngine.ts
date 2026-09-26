// 매직패드 제스처 인지로직 — 순수 함수 (UI/저장/RN 의존 0, node:test 가능)
// 카드 t_5de18a91: 거리·속도·관성(inertia)을 읽어 제스처 계층을 판정한다.
//   계층 계약 (매직패드 모드):
//     flick  = 짧고 빠른 방향 플릭 → 8방향 중 하나 (기존 맵의 방향 동작 실행)
//     swipe  = 길게 미끄러져 링에서 확정 → 스와이프 계층 동작 (record_stop 등 별도 키)
//     drag   = 우하단 엄지그립 영역에서 시작 → 미세조정(세그먼트 내비), 이탈 시 cancel
//     press  = 이동 없음 + 500ms → 기존 LONG_CENTER(녹음)와 동일 경로
// 엔진은 "어떤 제스처로 확정될 후보/상태"만 계산하고, 의미(동작 실행)는 화면 dispatcher가 결정 —
// 기존 엔진 분리 원칙(joystickMapping과 동일 계약) 유지.
import { JoystickGesture } from '../types';
import { getDirection, GESTURE_CONFIG } from './gesture';

export const PAD_CONFIG = {
  /** 이동 이 하로는 flick/swipe 구분 없이 micro(미세조정으로 취급) */
  microMoveThreshold: 24,
  /** flick 확정: 이 거리 초과 + 이 시간 이내 + 속도 임계 */
  flickMinDistance: 30,
  flickMaxDuration: 220,
  flickMinVelocity: 0.28, // px/ms
  /** swipe 확정: 이 거리 이상 미끄러짐(관성 포함) → 링 선택 오픈 */
  swipeMinDistance: 88,
  /** 관성 추정: 릴리스 직전 윈도우 표본 */
  inertiaWindowMs: 90,
  /** 관성 보정 계수 (손이 멈춘 후에도 링 커서가 미끄러져 멈추는 감각) */
  inertiaFactor: 0.18,
  /** 우측/하단 모서리 기준 — 엄지그립(드래그) 활성 영역 */
  gripEdgeMargin: 96,
  /** 더블탭 판정: 이전 탭 종료로부터 이 시간 이내 재탭 (macOS 기본 ~300ms) */
  doubleTapWindowMs: 300,
  longPressDuration: GESTURE_CONFIG.longPressDuration,
  tapMaxDuration: GESTURE_CONFIG.tapMaxDuration,
} as const;

// 매직패드 전용 확장 동작 키 (자유매핑 8방향과 독립 — 별도 매핑 키)
export const PAD_ACTION_KEYS = ['pad_swipe', 'pad_drag'] as const;
export type PadActionKey = (typeof PAD_ACTION_KEYS)[number];

/** 릴리스/이동 시판정 결과 */
export type PadResolution =
  | { kind: 'tap' }
  | { kind: 'press' } // 아직 미확정(롱프레스 대기 중)
  | { kind: 'micro'; gesture: JoystickGesture | null } // 미세 이동 — 커서 추적용
  | { kind: 'flick'; gesture: JoystickGesture } // 방향 flick — 맵의 방향 동작
  | { kind: 'swipe-open'; gesture: JoystickGesture } // 스와이프 임계 통과 — 링 오픈
  | { kind: 'swipe-commit'; gesture: JoystickGesture; carried: number } // 릴리스 → 관성 캐리
  | { kind: 'scroll'; dx: number; steps: number } // 느린 드래그/원형 드래그 = 스크롤(세그먼트 미세 이동)
  | { kind: 'doubletap' } // 더블탭 = 선택 (macOS 트랙패드 더블클릭=선택 직관)
  | { kind: 'drag-enter' }
  | { kind: 'drag-exit' };

interface Sample {
  x: number;
  y: number;
  t: number;
}

/**
 * 한 번의 패드 제스처(그랜트→릴리스) 상태 머신.
 * 시드(startPoint)는 그랜트 지점 — 우하단 grip 영역이면 드래그로 시작.
 */
export class PadGestureTracker {
  private start: Sample;
  private samples: Sample[] = [];
  private inGrip: boolean;
  private longPressFired = false;
  readonly padSize: { width: number; height: number };

  constructor(startX: number, startY: number, startT: number, padSize: { width: number; height: number }) {
    this.padSize = padSize;
    this.start = { x: startX, y: startY, t: startT };
    this.samples = [this.start];
    this.inGrip = PadGestureTracker.isGripZone(startX, startY, padSize);
  }

  /** 우하단 모서리 = 한손 그립 시 엄지가 놓이는 영역 */
  static isGripZone(x: number, y: number, padSize: { width: number; height: number }): boolean {
    return (
      x >= padSize.width - PAD_CONFIG.gripEdgeMargin &&
      y >= padSize.height - PAD_CONFIG.gripEdgeMargin
    );
  }

  /** 롱프레스(녹음) 트리거 통보 — 화면 타이머가 호출 */
  markLongPress(): void {
    this.longPressFired = true;
  }

  /** 그랜트 단계에서 드래그 활성 여부 (grip 영역에서 시작) */
  startsAsDrag(): boolean {
    return this.inGrip;
  }

  private get last(): Sample {
    return this.samples[this.samples.length - 1];
  }

  /** 최근 윈도우 평균 속도 px/ms (관성 추정) — 윈도우에 표본이 부족하면 전 경로 평균 */
  velocity(): number {
    const cutoff = this.last.t - PAD_CONFIG.inertiaWindowMs;
    let win = this.samples.filter((s) => s.t >= cutoff);
    if (win.length < 2) win = this.samples;
    const first = win[0];
    const dt = this.last.t - first.t;
    if (dt <= 0) return 0;
    return Math.hypot(this.last.x - first.x, this.last.y - first.y) / dt;
  }

  /** 확정 거리 벡터 = 시작 → 최근 지점 */
  displacement(): { dx: number; dy: number; distance: number; duration: number } {
    const dx = this.last.x - this.start.x;
    const dy = this.last.y - this.start.y;
    return { dx, dy, distance: Math.hypot(dx, dy), duration: this.last.t - this.start.t };
  }

  /** 관성 보정 이동 거리 (스와이프 링 커서용): 실이동 + 속도×계수 */
  inertiaDistance(): number {
    return this.displacement().distance + this.velocity() * PAD_CONFIG.inertiaFactor * 1000;
  }

  /** 누적 각도 변화(deg) — 원형 드래그 판정용. 패드 중심 반경 30px 밖 표본만 계상. */
  angleSweep(): number {
    const cx = this.padSize.width / 2;
    const cy = this.padSize.height / 2;
    let sweep = 0;
    let prev: number | null = null;
    for (const s of this.samples) {
      const rx = s.x - cx;
      const ry = s.y - cy;
      if (Math.hypot(rx, ry) < 30) continue;
      const th = Math.atan2(ry, rx);
      if (prev !== null) {
        let d = ((th - prev) * 180) / Math.PI;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        sweep += Math.abs(d);
      }
      prev = th;
    }
    return sweep;
  }

  /** 이동 중 판정 (PanResponder move) */
  onMove(x: number, y: number, t: number): PadResolution {
    this.samples.push({ x, y, t });
    // 표본 캐핑 (메모리)
    if (this.samples.length > 64) this.samples = this.samples.slice(-32);
    const { dx, dy, distance, duration } = this.displacement();

    if (this.inGrip) {
      // grip 밖으로 크게 벗어나면 드래그 취소로 취급 (오탭 회피)
      if (distance > this.padSize.height * 0.5) return { kind: 'drag-exit' };
      return { kind: 'micro', gesture: null };
    }

    const dir = getDirection(dx, dy);
    if (distance < PAD_CONFIG.microMoveThreshold) {
      return { kind: 'micro', gesture: dir };
    }
    if (distance >= PAD_CONFIG.swipeMinDistance) {
      // 스와이프 임계 통과 — 방향은 관성 보정 벡터로 재스냅
      return { kind: 'swipe-open', gesture: this.snapped(dx, dy) ?? dir ?? 'DIR_DOWN' };
    }
    // 느린 드래그(플릭 창 초과) 또는 원형 드래그(누적 회전 ≥60°) = 스크롤 계층 — dx 비례 미세 이동
    if (duration > PAD_CONFIG.flickMaxDuration || this.angleSweep() >= 60) {
      return { kind: 'scroll', dx, steps: dragStepsFromDx(dx) };
    }
    return { kind: 'micro', gesture: dir };
  }

  /** 릴리스 판정 — flick / swipe 커밋 / tap / long-press 이후 tap 구분 */
  onRelease(t: number): PadResolution {
    if (this.inGrip) return { kind: 'drag-exit' }; // 드래그 종료 = 화면이 커밋/취소 결정
    const { dx, dy, distance, duration } = this.displacement();

    if (this.longPressFired) {
      // 롱프레스(LONG_CENTER) 확정 후 릴리스 = 녹음 종료 이벤트(화면의 onRelease) — 추가 제스처 없음
      return { kind: 'press' };
    }
    if (distance < PAD_CONFIG.flickMinDistance) {
      return duration <= PAD_CONFIG.tapMaxDuration ? { kind: 'tap' } : { kind: 'micro', gesture: null };
    }
    if (distance >= PAD_CONFIG.swipeMinDistance) {
      return {
        kind: 'swipe-commit',
        gesture: this.snapped(dx, dy) ?? 'DIR_DOWN',
        carried: this.velocity() * PAD_CONFIG.inertiaFactor * 1000,
      };
    }
    // flick: 짧고 빠를 때만 방향 확정 — 느린 소폭 드래그는 micro (의도치 않은 실행 방지)
    const v = this.velocity();
    const dir = this.snapped(dx, dy);
    if (dir && duration <= PAD_CONFIG.flickMaxDuration && v >= PAD_CONFIG.flickMinVelocity) {
      return { kind: 'flick', gesture: dir };
    }
    return { kind: 'micro', gesture: dir };
  }

  /** 스와이프 링 커서 위치(0..1) — 관성 보정 거리 기준 */
  swipeProgress(): number {
    return Math.min(1, this.inertiaDistance() / (this.padSize.height * 0.9));
  }

  private snapped(dx: number, dy: number): JoystickGesture | null {
    return getDirection(dx, dy);
  }
}

/** 더블탭 창 이내 재탭 여부 (이전 탭 종료 기준). macOS 트랙패드 ~300ms. */
export function isDoubleTap(gapMs: number, windowMs: number = PAD_CONFIG.doubleTapWindowMs): boolean {
  return gapMs >= 0 && gapMs <= windowMs;
}

/** 드래그(미세조정) 이동량을 세그먼트 스텝으로 변환: 40px당 ±1, 최대 ±5 */
export function dragStepsFromDx(dx: number, stepPx = 40, max = 5): number {
  const steps = Math.round(dx / stepPx);
  return Math.max(-max, Math.min(max, steps));
}

/** 스와이프 확정(릴리스) 시 방향 → 스와이프 계층 동작.
 *  물리 직관 고정 매핑(자유매핑 8방향과 독립 레이어 — flick은 사용자 맵, swipe는 이 표):
 *    위 = 녹음 종료·결과 보기 / 아래 = 취소 / 좌 = 이전 결과 / 우 = 다음 결과
 *  대각은 지배 축(priority: 세로→가로)으로 폴백. */
export type SwipeAction = 'record_stop' | 'cancel' | 'prev_segment' | 'next_segment';

export function swipeActionFor(dir: JoystickGesture): SwipeAction {
  if (dir === 'DIR_UP') return 'record_stop';
  if (dir === 'DIR_DOWN') return 'cancel';
  if (dir === 'DIR_LEFT') return 'prev_segment';
  if (dir === 'DIR_RIGHT') return 'next_segment';
  const vertical = dir.includes('UP') || dir.includes('DOWN');
  if (vertical) return dir.includes('UP') ? 'record_stop' : 'cancel';
  return dir.includes('LEFT') ? 'prev_segment' : 'next_segment';
}
