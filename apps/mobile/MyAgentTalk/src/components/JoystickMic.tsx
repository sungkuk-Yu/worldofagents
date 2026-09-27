// 조이스틱 입력 디스크 (JoystickMic) — t_4b1bd4c2 입력 콘솔 재설계
// 대표님 9/28深夜 확정 요구 반영:
//   요구 1: 마이크/🎤 이모지 폐기 — 썸 중앙은 담백한 녹음 점 하나만.
//   요구 2: 8방향 라벨 오버레이는 눌리는(touchstart) 순간에만 페이드인, 놓으면 페이드아웃. 평상시 상시 노출 금지.
//   요구 3: 2색 체계(#00A86B + 흰/극회색) · Apple HIG 스프링 감각 · 게임 HUD 금지(펄스 링/레드 코어/상시 화살표 제거).
//   엔진 불변: 제스처 인지는 lib/gesture 순수 로직(getDirection/isOutsideDeadzone/isTap) 그대로 — 렌더만 재작성.
import React, { useRef, useState, useEffect } from 'react';
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
import { JoystickGesture } from '../types';
import { colors, radii, spacing, typography, iconSize, shadows } from '../theme';
import {
  getDirection,
  isOutsideDeadzone,
  isTap,
  DIRECTION_ARROWS,
  DEFAULT_DIRECTION_LABELS,
} from '../lib/gesture';
import Waveform from './Waveform';

// 조이스틱 설정 (설계서 §1.3) — 감지 임계값 불변
const CONFIG = {
  deadzone: 12,
  directionThreshold: 30,
  angleSnap: 22.5,
  longPressDuration: 500,
  tapMaxDuration: 200,
  hapticOnDirection: true,
  hapticOnRelease: true,
};

interface Props {
  onGesture: (gesture: JoystickGesture) => void;
  onRelease: () => void;
  /** t_e735d936: 그랜트(touchstart) 통지 — 채팅 음성 콘솔의 홀드-투-톡 시작 지점.
   *  엔진 계약(onGesture/onRelease/testID) 불변, 선택적 추가 콜백만 확장. */
  onPressStart?: () => void;
  isRecording: boolean;
  /** 드래그 중 라벨 오버라이드 (기본: 예/아니오/취소 등) */
  directionLabels?: Partial<Record<JoystickGesture, string>>;
}

// 크기 계 — 9/26 실측 기준 유지(썸 24%·클램프 96~140, 베이스 1.5×), 위층 조형만 2색 평면화
const screenWidth = Dimensions.get('window').width;
const BUTTON_SIZE = Math.min(Math.max(screenWidth * 0.24, 96), 140);
const BASE_SIZE = Math.round(BUTTON_SIZE * 1.5);
const KNOB_TRAVEL = Math.round((BASE_SIZE - BUTTON_SIZE) / 2);

// 8방향 오버레이 배치 — 버튼 중심 반지름 위에 화살표+라벨 (0°=위, 시계방향; lib/gesture와 동일 각계)
const OVERLAY_DIRS: { key: JoystickGesture; angle: number }[] = [
  { key: 'DIR_UP', angle: 0 }, { key: 'DIR_UPRIGHT', angle: 45 },
  { key: 'DIR_RIGHT', angle: 90 }, { key: 'DIR_DOWNRIGHT', angle: 135 },
  { key: 'DIR_DOWN', angle: 180 }, { key: 'DIR_DOWNLEFT', angle: 225 },
  { key: 'DIR_LEFT', angle: 270 }, { key: 'DIR_UPLEFT', angle: 315 },
];
const OVERLAY_R = BASE_SIZE / 2 + 2;

export default function JoystickMic({ onGesture, onRelease, onPressStart, isRecording, directionLabels }: Props) {
  // RN Animated 표준 패턴 — Animated.Value 는 렌더 간 안정적인 identity 가 필요 → useState 초기화
  // (React 19 react-hooks/refs 규칙: 렌더 중 ref 접근 금지 대응)
  const [scaleAnim] = React.useState(() => new Animated.Value(1));
  const [knobAnim] = React.useState(() => new Animated.ValueXY({ x: 0, y: 0 }));
  // 요구 2: 눌림 동안만 오버레이 — grant 시 페이드인, release 시 페이드아웃
  const [overlayFade] = React.useState(() => new Animated.Value(0));
  const touchStartTime = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentDirection = useRef<JoystickGesture | null>(null);
  const pressedRef = useRef(false);

  // 최신 콜백을 ref에 유지 (useEffect 재생성 방지)
  const onGestureRef = useRef(onGesture);
  const onReleaseRef = useRef(onRelease);
  const onPressStartRef = useRef(onPressStart);
  useEffect(() => {
    onGestureRef.current = onGesture;
    onReleaseRef.current = onRelease;
    onPressStartRef.current = onPressStart;
  }, [onGesture, onRelease, onPressStart]);

  // 드래그 중 방향 (라이브 피드백용 상태)
  const [activeDirection, setActiveDirection] = useState<JoystickGesture | null>(null);
  const activeDirectionRef = useRef<JoystickGesture | null>(null);
  const setActive = (d: JoystickGesture | null) => {
    activeDirectionRef.current = d;
    setActiveDirection(d);
  };

  // panHandlers를 state로 관리 (렌더 중 ref 접근 방지)
  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});

  useEffect(() => {
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        touchStartTime.current = Date.now();
        pressedRef.current = true;
        Animated.spring(scaleAnim, {
          toValue: 1.04,
          friction: 5,
          tension: 80,
          useNativeDriver: true,
        }).start();
        Animated.spring(knobAnim, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
        }).start();
        // touchstart → 8방향 오버레이 페이드인 (160ms, 요구 2)
        Animated.timing(overlayFade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
        // t_e735d936: 그랜트 통지 — 채팅 홀드-투-톡은 여기서 시작 (마이크 권한도 이 제스처부터만 요청)
        onPressStartRef.current?.();

        longPressTimer.current = setTimeout(() => {
          onGestureRef.current('LONG_CENTER');
          if (CONFIG.hapticOnDirection) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
        }, CONFIG.longPressDuration);
      },

      onPanResponderMove: (_evt: GestureResponderEvent, gs: PanResponderGestureState) => {
        const { dx, dy } = gs;
        const direction = getDirection(dx, dy);

        // 썸 이동 — 물리 스틱처럼 베이스 링 안쪽에서만 (이동 한계 KNOB_TRAVEL)
        if (isOutsideDeadzone(dx, dy)) {
          knobAnim.setValue({
            x: Math.max(-KNOB_TRAVEL, Math.min(KNOB_TRAVEL, dx * 0.42)),
            y: Math.max(-KNOB_TRAVEL, Math.min(KNOB_TRAVEL, dy * 0.42)),
          });
        }

        if (direction && direction !== currentDirection.current) {
          currentDirection.current = direction;
          setActive(direction);
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
          }
          if (CONFIG.hapticOnDirection) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        }
      },

      onPanResponderRelease: () => {
        const duration = Date.now() - touchStartTime.current;
        pressedRef.current = false;
        // 복귀 스프링 (HIG 감각 — 뻣뻣한 instant 대신 감쇠 스프링)
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 6,
          tension: 68,
          useNativeDriver: true,
        }).start();
        Animated.spring(knobAnim, {
          toValue: { x: 0, y: 0 },
          friction: 6,
          tension: 68,
          useNativeDriver: true,
        }).start();
        // 놓음 → 오버레이 페이드아웃 (220ms, 요구 2)
        Animated.timing(overlayFade, { toValue: 0, duration: 220, useNativeDriver: true }).start();

        if (currentDirection.current) {
          onGestureRef.current(currentDirection.current);
          if (CONFIG.hapticOnRelease) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
        } else if (isTap(duration)) {
          onGestureRef.current('TAP_CENTER');
          if (CONFIG.hapticOnRelease) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        }

        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        currentDirection.current = null;
        setActive(null);
        onReleaseRef.current();
      },
    });

    setPanHandlers(responder.panHandlers);
  }, [scaleAnim, knobAnim, overlayFade]);

  // 드래그 중 방향 피드백 (요구 2: 눌린 동안만 렌더 — 평상시 DOM에 오버레이 자체가 없다)
  const labels = { ...DEFAULT_DIRECTION_LABELS, ...directionLabels };

  return (
    <View style={styles.container} testID="joystick-mic">
      {/* 정적 베이스 — 극회색 평면 디스크 + 헤어라인. 게임 HUD 금지: 펄스 링·스커트·레드 코어 제거 */}
      <View pointerEvents="none" style={styles.baseRing} />

      {/* 눌림 중 8방향 오버레이 (touchstart 페이드인 → release 페이드아웃) */}
      <Animated.View
        pointerEvents="none"
        style={[styles.overlayLayer, { opacity: overlayFade }]}
        testID="joystick-overlay"
      >
        {OVERLAY_DIRS.map(({ key, angle }) => {
          const rad = (angle * Math.PI) / 180;
          const selected = activeDirection === key;
          return (
            <View
              key={key}
              testID="joystick-direction-label"
              style={[
                styles.overlaySlot,
                {
                  left: '50%', top: '50%',
                  transform: [
                    { translateX: Math.sin(rad) * OVERLAY_R - 34 },
                    { translateY: -Math.cos(rad) * OVERLAY_R - 13 },
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

      {/* 썸 — 흰 디스크 + 헤어라인 + 극박 그림자. 중앙은 마이크 대신 녹음 점 하나 (요구 1)
          확정(스냅)된 방향이 있으면 그 자리에 화살표로 대체 표시 */}
      <Animated.View
        style={[
          styles.button,
          { transform: [{ scale: scaleAnim }, ...knobAnim.getTranslateTransform()] },
          isRecording && styles.buttonRecording,
          !!activeDirection && styles.buttonArmed,
        ]}
        {...panHandlers}
      >
        {activeDirection && activeDirection !== 'TAP_CENTER' && activeDirection !== 'LONG_CENTER' ? (
          <Text style={styles.thumbArrow}>{DIRECTION_ARROWS[activeDirection]}</Text>
        ) : (
          <View style={[styles.recDot, isRecording && styles.recDotActive]} />
        )}
      </Animated.View>

      {/* 녹음 중 파형 — 액센트 2색 체계 유지 (레드 금지), 썸 바로 아래 */}
      <View style={styles.waveformWrap} pointerEvents="none">
        <Waveform active={isRecording} color={colors.accent} barCount={15} height={22} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: BASE_SIZE,
    height: BASE_SIZE + spacing.sp6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  baseRing: {
    position: 'absolute',
    width: BASE_SIZE,
    height: BASE_SIZE,
    borderRadius: BASE_SIZE / 2,
    backgroundColor: colors.surfaceRaise, // 극회색 디스크 — 흰 화면 위에 한 단계 얹힘
    borderWidth: 1,
    borderColor: colors.border,
  },
  overlayLayer: {
    position: 'absolute',
    width: BASE_SIZE + 76,
    height: BASE_SIZE + 76,
    alignItems: 'center',
    justifyContent: 'center',
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
    ...shadows.sh1,
  },
  overlayArrow: {
    ...typography.subhead,
    fontWeight: '700',
    color: colors.text2,
    textAlign: 'center',
  },
  overlayArrowSelected: { color: colors.accent },
  overlayLabel: {
    ...typography.microXs,
    fontWeight: '500',
    color: colors.text3,
    textAlign: 'center',
  },
  overlayLabelSelected: { color: colors.text1, fontWeight: '600' },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: colors.surface, // 흰 썸 — 2색 체계의 흰
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sh1,
  },
  buttonRecording: {
    backgroundColor: colors.accentTint, // 녹음 = 극연그린 밴드 (레드 HUD 금지, 요구 3)
    borderColor: colors.accent,
  },
  buttonArmed: {
    borderColor: colors.accent, // 방향 스냅 확정 — 액센트 헤어라인 하나만
  },
  recDot: {
    width: 14,
    height: 14,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  recDotActive: {
    backgroundColor: colors.accent,
    width: 18,
    height: 18,
  },
  thumbArrow: {
    ...typography.headline,
    fontSize: iconSize.glyph,
    fontWeight: '700',
    color: colors.accent,
  },
  waveformWrap: {
    position: 'absolute',
    bottom: 0,
    width: BUTTON_SIZE * 1.2,
  },
});
