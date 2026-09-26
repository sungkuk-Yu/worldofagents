// 매직패드 입력 위젯 (MagicPad) — 카드 t_5de18a91 요구 2/3/4/5/6
// 넓은 평면에서 제스처 계층을 인지한다 (인지 로직은 lib/joystickEngine — 순수·테스트 가능):
//   탭(이동無·짧음)   → TAP_CENTER (말하기 — 녹음 고정, 요구 6)
//   롱프레스(500ms)   → LONG_CENTER (녹음 — 요구 6)
//   flick(빠른 방향)  → 8방향 중 하나 → 사용자 맵의 방향 동작 (자유매핑과 재사용)
//   swipe(길게 미끄러짐) → 스와이프 계층: ↑녹음종료 ↓취소 ←이전 →다음 (swipeActionFor, 자유매핑과 독립 레이어)
//   드래그(우하단 그립에서 시작) → 미세조정(세그먼트 스텝), 크게 이탈 시 취소
// 변형: variant='hybrid' — 중앙 스틱 썸 + 외부 패드 계층 동시.
// 엔진(이 컴포넌트)은 기호(JoystickGesture / SwipeAction / 스텝)만 emit하고 의미 실행은 화면 dispatcher —
// 기존 엔진/의미 분리 계약(JoystickMic와 동일) 유지.
import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  PanResponder,
  Animated,
  Text,
  Dimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type GestureResponderHandlers,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { JoystickGesture } from '../types';
import { colors, typography, iconSize } from '../theme';
import { getDirection, DIRECTION_ARROWS, DEFAULT_DIRECTION_LABELS, GESTURE_CONFIG } from '../lib/gesture';
import {
  PadGestureTracker, PAD_CONFIG, SwipeAction, dragStepsFromDx, isDoubleTap, swipeActionFor,
} from '../lib/joystickEngine';

interface Props {
  variant: 'pad' | 'hybrid';
  /** flick/스틱 방향 + TAP_CENTER/LONG_CENTER — 조이스틱 모드와 동일 심볼 계약 */
  onGesture: (gesture: JoystickGesture) => void;
  /** 스와이프 계층 확정 (별도 레이어 동작) */
  onSwipe: (action: SwipeAction) => void;
  /** 더블탭 = 선택 (요구 ② 어휘) — 화면이 선택 모드 토글 */
  onDoubleTap: () => void;
  /** 드래그 미세조정 스텝 (누적 아님 — 화면이 세그먼트 이동 적용) */
  onDragStep: (delta: number) => void;
  /** 드래그 종료 (cancelled=true면 이탈 취소로 화면이 복원) */
  onDragEnd: (cancelled: boolean) => void;
  /** 제스처 릴리스 공통 (녹음 종료 트리거는 화면 정책) */
  onRelease: () => void;
  isRecording: boolean;
  directionLabels?: Partial<Record<JoystickGesture, string>>;
}

const screenWidth = Dimensions.get('window').width;
// 크기 레퍼런스 (대표님 지시 9/26 — 자체 창작 금지):
//   · 표면 비례 = Apple Magic Trackpad 활성부 109.5×71.2mm ≈ 1.54:1 (가로:세로) — 매직패드의 실물 제품 규격
//   · 터치 타깃 = Apple HIG 최소 44pt — 중앙 앵커/하이브리드 썸은 조이스틱 썸과 동일 공식(96~140px), 모드 전환 시 형제 모양 유지
//   · 요구 4: iOS 가장자리 스와이프(뒤로가기 ~20px 존) 충돌 방지 — 좌우 24px 인셋으로 화면 중앙 고정 영역
const PAD_WIDTH = Math.min(screenWidth - 48, 380);
const PAD_HEIGHT = Math.round(PAD_WIDTH / 1.54);
// 중앙 앵커/썸 직경 = JoystickMic 썸과 동일 클램프 공식 — 3모드 공통 조형
const ANCHOR_SIZE = Math.min(Math.max(screenWidth * 0.24, 96), 140);
const HYBRID_THUMB_RADIUS = Math.round(ANCHOR_SIZE / 2); // 스틱 썸 활성 반경 (직경=앵커 공식)

type Phase = 'idle' | 'press' | 'swipe' | 'drag' | 'scroll';

export function swipeLabelKo(action: SwipeAction, t: (key: string) => string): string {
  // 엔진 라벨과 같은 물리 직관어 — 확정 피드백(화면 dispatcher와 무관). joystick.actions 사전 재사용.
  return t(`joystick.actions.${action}`);
}

export default function MagicPad({
  variant, onGesture, onSwipe, onDoubleTap, onDragStep, onDragEnd, onRelease,
  isRecording, directionLabels,
}: Props) {
  const { t } = useTranslation();
  const [pulseAnim] = useState(() => new Animated.Value(0.5));
  const [hint, setHint] = useState<{ arrow?: string; text: string } | null>(null);
  const [trail, setTrail] = useState<{ x: number; y: number }[]>([]); // 스와이프 궤적 (페이드 렌더)
  const trailRef = useRef<{ x: number; y: number }[]>([]);
  const trackerRef = useRef<PadGestureTracker | null>(null);
  const startRef = useRef({ x: 0, y: 0 }); // grant 지점(절대 좌표) — gs.dx/dy 상대값 환산용
  const dragLastSteps = useRef(0);
  const hintDirRef = useRef<JoystickGesture | null>(null); // 방향 스냅 변경 시 Light 1회 (요구 5)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const lastTapAtRef = useRef(0); // 더블탭 판정용 — 이전 탭 종료 시각

  // 최신 콜백/props/t를 ref에 유지 — PanResponder는 1회 생성(JoystickMic 패턴). t는 언어 전환 반영용
  const cbs = useRef({ onGesture, onSwipe, onDoubleTap, onDragStep, onDragEnd, onRelease, variant, directionLabels, t });
  useEffect(() => {
    cbs.current = { onGesture, onSwipe, onDoubleTap, onDragStep, onDragEnd, onRelease, variant, directionLabels, t };
  }, [onGesture, onSwipe, onDoubleTap, onDragStep, onDragEnd, onRelease, variant, directionLabels, t]);

  // 아이들 펄스 (패드에 띄워진 마이크 앵커)
  useEffect(() => {
    if (!isRecording) {
      const pulse = Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
      ]));
      pulse.start();
      return () => pulse.stop();
    }
  }, [isRecording, pulseAnim]);

  const clearLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  // panHandlers는 state로 관리 (렌더 중 ref 접근 방지 — RN 규칙)
  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});

  useEffect(() => {
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        // 웹: 패드 위 드래그가 네이티브 텍스트 선택을 起動하면 selectionchange → RNW responder terminate
        // (이후 제스처가 좀비 이벤트로 cancel되어 flick/swipe가 죽음). 그랜트 시 선택 해제 + preventDefault 차단.
        try { (evt as any).preventDefault?.(); } catch { /* native no-op */ }
        if (typeof window !== 'undefined' && window.getSelection) window.getSelection()?.removeAllRanges();
        startRef.current = { x: locationX, y: locationY };
        const tr = new PadGestureTracker(locationX, locationY, Date.now(), {
          width: PAD_WIDTH, height: PAD_HEIGHT,
        });
        trackerRef.current = tr;
        dragLastSteps.current = 0;
        hintDirRef.current = null;

        const inThumb =
          cbs.current.variant === 'hybrid' &&
          Math.hypot(locationX - PAD_WIDTH / 2, locationY - PAD_HEIGHT / 2) <= HYBRID_THUMB_RADIUS;

        if (!inThumb && tr.startsAsDrag()) {
          // 우하단 그립 = 드래그(미세조정) 전용 계층
          phaseRef.current = 'drag';
          setHint({ text: cbs.current.t('joystick.dragFineTune') });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return;
        }
        phaseRef.current = 'press';
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          trackerRef.current?.markLongPress();
          cbs.current.onGesture('LONG_CENTER');
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }, GESTURE_CONFIG.longPressDuration);
      },

      onPanResponderMove: (_evt: GestureResponderEvent, gs: PanResponderGestureState) => {
        const tr = trackerRef.current;
        if (!tr) return;
        // PanResponder gs.dx/dy는 grant 지점 기준 상대값 → 절대 좌표로 환산해 엔진에 공급
        const res = tr.onMove(
          startRef.current.x + gs.dx,
          startRef.current.y + gs.dy,
          Date.now(),
        );
        const { dx, dy, distance } = tr.displacement();

        // 스와이프 단계: 궤적 샘플 누적 (최대 24 — 페이드 렌더용). open 확정 이동도 첫 점으로 계상.
        if (phaseRef.current === 'swipe' || res.kind === 'swipe-open') {
          trailRef.current = [...trailRef.current.slice(-23), { x: startRef.current.x + dx, y: startRef.current.y + dy }];
          setTrail(trailRef.current);
        }

        if (res.kind === 'drag-exit') {
          phaseRef.current = 'idle';
          setHint(null);
          cbs.current.onDragEnd(true); // 크게 이탈 = 취소
          clearLongPress();
          return;
        }
        if (phaseRef.current === 'drag') {
          const steps = dragStepsFromDx(dx);
          const delta = steps - dragLastSteps.current;
          if (delta !== 0) {
            dragLastSteps.current = steps;
            cbs.current.onDragStep(delta);
            Haptics.selectionAsync();
          }
          return;
        }
        if (res.kind === 'swipe-open') {
          // 스와이프 임계 통과 — 확정 상태(링)로 전환, 릴리스 시 커밋. 임계 통과 1회 추가 햅틱 (요구 5)
          clearLongPress();
          if (phaseRef.current !== 'swipe') {
            // 첫 진입만: 궤적 리셋 + Light 1회 (이후 move는 리셋 없음 — 매 move swipe-open 재발화)
            trailRef.current = [];
            setTrail([]);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          phaseRef.current = 'swipe';
          setHint({
            arrow: DIRECTION_ARROWS[res.gesture],
            text: swipeLabelKo(swipeActionFor(res.gesture), cbs.current.t),
          });
          return;
        }
        if (res.kind === 'scroll') {
          // 느린 드래그/원형 드래그 = 스크롤 계층 — dx 누적 스텝만큼 세그먼트 미세 이동 (요구 ② '드래그 후 정지=스크롤')
          clearLongPress();
          phaseRef.current = 'scroll';
          const delta = res.steps - dragLastSteps.current;
          if (delta !== 0) {
            dragLastSteps.current = res.steps;
            cbs.current.onDragStep(delta);
            Haptics.selectionAsync();
          }
          setHint({ text: cbs.current.t('joystick.scrollHint') });
          return;
        }
        if (distance >= PAD_CONFIG.microMoveThreshold) {
          // 방향 후보 (flick/swipe 공용 — 릴리스에서 계층 확정). hybrid 썸 내는 스틱처럼 라벨.
          const dir = getDirection(dx, dy);
          if (dir) {
            clearLongPress();
            const isSwipe = distance >= PAD_CONFIG.swipeMinDistance;
            const labels = { ...DEFAULT_DIRECTION_LABELS, ...cbs.current.directionLabels };
            setHint({
              arrow: DIRECTION_ARROWS[dir],
              text: isSwipe ? swipeLabelKo(swipeActionFor(dir), cbs.current.t) : labels[dir] ?? DEFAULT_DIRECTION_LABELS[dir],
            });
            // 스냅된 방향이 바뀔 때만 Light (요구 5 — 방향 피드백)
            if (hintDirRef.current !== dir) {
              hintDirRef.current = dir;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
          }
        }
      },

      onPanResponderRelease: () => {
        const tr = trackerRef.current;
        clearLongPress();
        setHint(null);
        setTrail([]);
        trailRef.current = [];
        const wasDrag = phaseRef.current === 'drag';
        const wasPress = phaseRef.current === 'press';
        phaseRef.current = 'idle';
        if (!tr) { cbs.current.onRelease(); return; }
        trackerRef.current = null;

        if (wasDrag) {
          cbs.current.onDragEnd(false);
          cbs.current.onRelease();
          return;
        }
        const res = tr.onRelease(Date.now());
        switch (res.kind) {
          case 'tap':
            // 이동 없는 짧은 탭 = 말하기 토글 (패드 어디든 — 중앙 탭과 동일 의미, 요구 6)
            if (wasPress) {
              const now = Date.now();
              if (isDoubleTap(now - lastTapAtRef.current)) {
                // 더블탭 = 선택 계층 (요구 ② 어휘) — 첫 탭의 실수 녹음 시작을 되돌리고 선택 이벤트 발동
                lastTapAtRef.current = 0;
                cbs.current.onDoubleTap();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                cbs.current.onRelease();
                return;
              }
              lastTapAtRef.current = now;
              cbs.current.onGesture('TAP_CENTER');
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            break;
          case 'flick':
            cbs.current.onGesture(res.gesture); // 사용자 맵의 방향 동작
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            break;
          case 'swipe-commit':
            cbs.current.onSwipe(swipeActionFor(res.gesture));
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); // 확정 = Medium (요구 5)
            break;
          default:
            break; // press(롱프레스 후 릴리스)/micro — 실행 없음
        }
        cbs.current.onRelease();
      },

      onPanResponderTerminate: () => {
        clearLongPress();
        setHint(null);
        setTrail([]);
        trailRef.current = [];
        phaseRef.current = 'idle';
        trackerRef.current = null;
        cbs.current.onRelease();
      },
    });
    setPanHandlers(responder.panHandlers);
  }, []);

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* 패드 표면 */}
      <View style={styles.pad} testID="magic-pad" accessibilityLabel="magic-pad" {...panHandlers}>
        {/* 도트 그리드 (매직패드 질감) */}
        <View style={styles.grid} pointerEvents="none">
          {Array.from({ length: 5 }).map((_, r) => (
            <View key={r} style={styles.gridRow}>
              {Array.from({ length: 7 }).map((__, c) => <View key={c} style={styles.dot} />)}
            </View>
          ))}
        </View>

        {/* 우하단 그립 영역 힌트 */}
        <View style={styles.gripZone} pointerEvents="none">
          <Text style={styles.gripLabel}>{t('joystick.grip')}</Text>
        </View>

        {/* hybrid = 중앙 스틱 썸 오버레이 */}
        {variant === 'hybrid' && (
          <View style={styles.hybridThumb} pointerEvents="none">
            <Text style={styles.hybridThumbIcon}>{isRecording ? '🔴' : '🎤'}</Text>
          </View>
        )}

        {/* 스와이프 궤적 페이드 (요구 ② 시각) */}
        {trail.length > 1 && (
          <View style={styles.trailLayer} pointerEvents="none">
            {trail.map((p, i) => (
              <View
                key={i}
                testID="swipe-trail-dot"
                style={[styles.trailDot, {
                  left: p.x - 5, top: p.y - 5,
                  opacity: 0.15 + 0.75 * (i / (trail.length - 1)),
                }]}
              />
            ))}
          </View>
        )}

        {/* 제스처 피드백 배지 */}
        {hint && (
          <View style={styles.hintBadge} pointerEvents="none">
            {hint.arrow ? <Text style={styles.hintArrow}>{hint.arrow}</Text> : null}
            <Text style={styles.hintText}>{hint.text}</Text>
          </View>
        )}
      </View>

      {/* pad 모드: 중앙 마이크 앵커 (표면 위 시각 정중앙, 탭은 패드 어디든 가능) */}
      {variant === 'pad' && (
        <View style={styles.micAnchor} pointerEvents="none">
          {!isRecording && <Animated.View style={[styles.pulseRing, { opacity: pulseAnim }]} />}
          {isRecording && <View style={styles.recordingRing} />}
          <View style={[styles.micCore, isRecording && styles.micCoreRecording]}>
            <Text style={styles.micIcon}>{isRecording ? '🔴' : '🎤'}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: PAD_WIDTH,
    height: PAD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pad: {
    width: PAD_WIDTH,
    height: PAD_HEIGHT,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    userSelect: 'none', // 웹: 드래그가 텍스트 선택으로 새면 responder가 terminate됨 (RNW selectionchange)
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { opacity: 0.5 },
  gridRow: { flexDirection: 'row', gap: 34, marginVertical: 14 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.border },
  gripZone: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: PAD_CONFIG.gripEdgeMargin,
    height: PAD_CONFIG.gripEdgeMargin,
    borderTopLeftRadius: 999,
    backgroundColor: colors.accentTint,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: 8,
  },
  gripLabel: { ...typography.micro, fontWeight: '700', color: colors.segTask },
  hybridThumb: {
    position: 'absolute',
    alignSelf: 'center',
    top: (PAD_HEIGHT - HYBRID_THUMB_RADIUS * 2) / 2,
    width: HYBRID_THUMB_RADIUS * 2,
    height: HYBRID_THUMB_RADIUS * 2,
    borderRadius: HYBRID_THUMB_RADIUS,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hybridThumbIcon: { fontSize: Math.round(ANCHOR_SIZE * 0.32) },
  hintBadge: {
    position: 'absolute',
    top: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(17,24,39,0.72)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  hintArrow: { ...typography.headline, fontSize: iconSize.glyph, fontWeight: '700', color: '#fff' },
  hintText: { ...typography.micro, fontWeight: '600', color: '#fff' },
  trailLayer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  trailDot: {
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.accent,
  },
  micAnchor: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute', width: ANCHOR_SIZE + 24, height: ANCHOR_SIZE + 24, borderRadius: (ANCHOR_SIZE + 24) / 2,
    borderWidth: 2, borderColor: colors.accent,
  },
  recordingRing: {
    position: 'absolute', width: ANCHOR_SIZE + 36, height: ANCHOR_SIZE + 36, borderRadius: (ANCHOR_SIZE + 36) / 2,
    borderWidth: 3, borderColor: colors.statusErr,
  },
  micCore: {
    width: ANCHOR_SIZE, height: ANCHOR_SIZE, borderRadius: ANCHOR_SIZE / 2,
    backgroundColor: colors.surfaceRaise,
    alignItems: 'center', justifyContent: 'center',
    elevation: 8,
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  micCoreRecording: { backgroundColor: '#3D1A1A', shadowColor: colors.statusErr },
  micIcon: { fontSize: Math.round(ANCHOR_SIZE * 0.35) },
});
