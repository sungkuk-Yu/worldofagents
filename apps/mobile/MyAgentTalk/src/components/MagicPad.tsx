// 매직패드 입력 위젯 (MagicPad) — t_4b1bd4c2 입력 콘솔 재설계 (렌더만; 엔진 불변)
// 제스처 계층 계약 (lib/joystickEngine 순수 로직 그대로):
//   탭(이동無·짧음)   → TAP_CENTER (말하기 — 녹음 고정)
//   롱프레스(500ms)   → LONG_CENTER (녹음)
//   flick(빠른 방향)  → 8방향 중 하나 → 사용자 맵의 방향 동작 (자유매핑 재사용)
//   swipe(길게 미끄러짐) → 스와이프 계층: ↑녹음종료 ↓취소 ←이전 →다음 (swipeActionFor, 독립 레이어)
//   드래그(우하단 그립에서 시작) → 미세조정(세그먼트 스텝), 크게 이탈 시 취소
// 변형: variant='hybrid' — 중앙 스틱 썸 + 외부 패드 계층 동시.
// 대표님 9/28深夜 확정 요구 반영:
//   요구 1: 🎤/🔴 이모지 앵커·펄스 링·레드 녹음 링 폐기 — 평상시 패드는 담백한 흰 평면 하나.
//   요구 2: 방향 라벨은 눌림(touchstart) 동안만 페이드인, 놓으면 페이드아웃 (overlayLayer).
//   요구 3: 2색(#00A86B+흰/극회색) 평면 조형 — 도트 그리드·연그립 그립 패치 등 게임 HUD 장식품 제거.
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
import { colors, radii, spacing, typography, iconSize, shadows } from '../theme';
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
// 크기 레퍼런스 (9/26 실측 기준 유지):
//   · 표면 비례 = Apple Magic Trackpad 활성부 109.5×71.2mm ≈ 1.54:1 — 매직패드의 실물 제품 규격
//   · 터치 타깃 = Apple HIG 최소 44pt — 중앙 앵커/하이브리드 썸은 조이스틱 썸과 동일 공식(96~140px)
//   · iOS 가장자리 스와이프(뒤로가기 ~20px 존) 충돌 방지 — 좌우 24px 인셋으로 화면 중앙 고정 영역
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
  // 요구 2: 눌림 동안만 오버레이 — grant 페이드인 / release·terminate 페이드아웃
  const [overlayFade] = useState(() => new Animated.Value(0));
  const [pressed, setPressed] = useState(false);
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
        setPressed(true);
        Animated.timing(overlayFade, { toValue: 1, duration: 160, useNativeDriver: true }).start();

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
        setPressed(false);
        Animated.timing(overlayFade, { toValue: 0, duration: 220, useNativeDriver: true }).start();
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
        setPressed(false);
        Animated.timing(overlayFade, { toValue: 0, duration: 220, useNativeDriver: true }).start();
        phaseRef.current = 'idle';
        trackerRef.current = null;
        cbs.current.onRelease();
      },
    });
    setPanHandlers(responder.panHandlers);
  }, [overlayFade]);

  // 눌림 중 8방향 오버레이 데이터 (요구 2 — 평상시에는 렌더 자체가 없다)
  const labels = { ...DEFAULT_DIRECTION_LABELS, ...directionLabels };
  const overlayRingR = Math.min(PAD_WIDTH, PAD_HEIGHT) * 0.5 - 26;
  const OVERLAY_DIRS: { key: JoystickGesture; angle: number }[] = [
    { key: 'DIR_UP', angle: 0 }, { key: 'DIR_UPRIGHT', angle: 45 },
    { key: 'DIR_RIGHT', angle: 90 }, { key: 'DIR_DOWNRIGHT', angle: 135 },
    { key: 'DIR_DOWN', angle: 180 }, { key: 'DIR_DOWNLEFT', angle: 225 },
    { key: 'DIR_LEFT', angle: 270 }, { key: 'DIR_UPLEFT', angle: 315 },
  ];

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* 패드 표면 — 흰 평면 + 헤어라인 하나. 도트 그리드/장식 제거(요구 3) */}
      <View
        style={[styles.pad, pressed && styles.padPressed, isRecording && styles.padRecording]}
        testID="magic-pad"
        accessibilityLabel="magic-pad"
        {...panHandlers}
      >
        {/* 우하단 그립 — 면 대신 액센트 코너 마크 2줄로만 (작은 물음표: 존재는 알리되 장식 금지) */}
        <View style={styles.gripMark} pointerEvents="none" testID="magic-pad-grip">
          <View style={styles.gripLineH} />
          <View style={styles.gripLineV} />
        </View>

        {/* 눌림 중 8방향 오버레이 링 (touchstart 페이드인 → release 페이드아웃 — 슬롯은 상시 마운트,
            opacity가 0이면 화면에 없다. 조건부 렌더로 언마운트하면 페이드아웃이 안 보임(요구 2)) */}
        <Animated.View
          pointerEvents="none"
          style={[styles.overlayLayer, { opacity: overlayFade }]}
          testID="magic-pad-overlay"
        >
          {OVERLAY_DIRS.map(({ key, angle }) => {
            const rad = (angle * Math.PI) / 180;
            const selected = hint?.arrow === DIRECTION_ARROWS[key] && !!hint?.arrow;
            return (
              <View
                key={key}
                testID="joystick-direction-label"
                style={[
                  styles.overlaySlot,
                  {
                    left: '50%', top: '50%',
                    transform: [
                      { translateX: Math.sin(rad) * overlayRingR - 34 },
                      { translateY: -Math.cos(rad) * overlayRingR - 13 },
                    ],
                  },
                ]}
              >
                <Text style={[styles.overlayArrow, selected && styles.overlayArrowSelected]}>
                  {DIRECTION_ARROWS[key]}
                </Text>
                <Text style={[styles.overlayLabel, selected && styles.overlayLabelSelected]} numberOfLines={1}>
                  {labels[key] ?? DEFAULT_DIRECTION_LABELS[key]}
                </Text>
              </View>
            );
          })}
        </Animated.View>

        {/* hybrid = 중앙 스틱 썸 (흰 디스크 + 녹음 점; 🎤 이모지 폐기, 요구 1) */}
        {variant === 'hybrid' && (
          <View style={[styles.hybridThumb, isRecording && styles.hybridThumbRecording]} pointerEvents="none">
            <View style={[styles.recDot, isRecording && styles.recDotActive]} />
          </View>
        )}

        {/* 스와이프 궤적 페이드 (요구 ② 시각) — 극회색 도트 그라데이션 */}
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

        {/* 제스처 확정 피드백 배지 — 흰 칩 + 헤어라인 + 액센트 화살표 (어두운 HUD 박스 폐기) */}
        {hint && (
          <View style={styles.hintBadge} pointerEvents="none">
            {hint.arrow ? <Text style={styles.hintArrow}>{hint.arrow}</Text> : null}
            <Text style={styles.hintText}>{hint.text}</Text>
          </View>
        )}
      </View>

      {/* pad 모드 중앙 정중앙 마커 — 눌림 시에만 나타나 녹음 앵커 위치를 알려주는 극박 링
          (평상시 마이크 코어·펄스·레드 링 전부 제거 — 요구 1/2) */}
      {variant === 'pad' && (
        <Animated.View style={[styles.centerMark, { opacity: overlayFade }]} pointerEvents="none">
          <View style={[styles.recDot, isRecording && styles.recDotActive]} />
        </Animated.View>
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
    borderRadius: radii.lg, // 28 → 12 — Apple 연속성: 카드 반지름 체계와 맞춘다
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    userSelect: 'none', // 웹: 드래그가 텍스트 선택으로 새면 responder가 terminate됨 (RNW selectionchange)
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sh1,
  },
  padPressed: { borderColor: colors.borderStrong }, // 눌림 = 헤어라인 한 단계 진해짐 (연속성)
  padRecording: { borderColor: colors.accent, backgroundColor: colors.accentTint }, // 녹음 = 극연그린 한 장
  gripMark: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 18,
    height: 18,
  },
  gripLineH: {
    position: 'absolute', right: 0, bottom: 0, width: 14, height: 2,
    borderRadius: radii.full, backgroundColor: colors.borderStrong,
  },
  gripLineV: {
    position: 'absolute', right: 0, bottom: 0, width: 2, height: 14,
    borderRadius: radii.full, backgroundColor: colors.borderStrong,
  },
  overlayLayer: {
    position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  overlaySlot: {
    position: 'absolute',
    width: 68,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sp1,
    paddingVertical: 2,
  },
  overlayArrow: {
    ...typography.subhead,
    fontWeight: '700',
    color: colors.text2,
    textAlign: 'center',
  },
  overlayArrowSelected: { color: colors.accent },
  overlayLabel: {
    ...typography.micro,
    fontWeight: '500',
    color: colors.text3,
    textAlign: 'center',
  },
  overlayLabelSelected: { color: colors.text1, fontWeight: '600' },
  hybridThumb: {
    position: 'absolute',
    alignSelf: 'center',
    top: (PAD_HEIGHT - HYBRID_THUMB_RADIUS * 2) / 2,
    width: HYBRID_THUMB_RADIUS * 2,
    height: HYBRID_THUMB_RADIUS * 2,
    borderRadius: HYBRID_THUMB_RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sh1,
  },
  hybridThumbRecording: { borderColor: colors.accent },
  recDot: {
    width: 14,
    height: 14,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  recDotActive: {
    width: 18,
    height: 18,
  },
  trailLayer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  trailDot: {
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.accent,
  },
  hintBadge: {
    position: 'absolute',
    top: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp1,
    ...shadows.sh1,
  },
  hintArrow: { ...typography.headline, fontSize: iconSize.glyph, fontWeight: '700', color: colors.accent },
  hintText: { ...typography.micro, fontWeight: '600', color: colors.text1 },
  centerMark: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: ANCHOR_SIZE,
    height: ANCHOR_SIZE,
    borderRadius: ANCHOR_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.sh1,
  },
});
