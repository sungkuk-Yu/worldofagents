// 조이스틱 마이크 버튼 (JoystickMic)
// 화면 7 중앙에 위치, 8방향 + 탭/롱프레스 제스처 인식
// 설계서: ui-interaction-spec.md §1
import React, { useRef, useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  PanResponder,
  Animated,
  Text,
  Dimensions,
  GestureResponderEvent,
  PanResponderGestureState,
  type GestureResponderHandlers,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { JoystickGesture } from '../types';
import { colors } from '../theme';

// 조이스틱 설정 (설계서 §1.3)
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
  isRecording: boolean;
}

// 버튼 크기는 화면 너비의 22% (최소 80px, 최대 140px)
const screenWidth = Dimensions.get('window').width;
const BUTTON_SIZE = Math.min(Math.max(screenWidth * 0.22, 80), 140);

function getDirection(dx: number, dy: number): JoystickGesture | null {
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < CONFIG.directionThreshold) return null;

  // 각도 계산 (0° = 위, 시계방향)
  let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
  if (angle < 0) angle += 360;

  // 8방향 스냅
  const directions: { angle: number; gesture: JoystickGesture }[] = [
    { angle: 0, gesture: 'DIR_UP' },
    { angle: 45, gesture: 'DIR_UPRIGHT' },
    { angle: 90, gesture: 'DIR_RIGHT' },
    { angle: 135, gesture: 'DIR_DOWNRIGHT' },
    { angle: 180, gesture: 'DIR_DOWN' },
    { angle: 225, gesture: 'DIR_DOWNLEFT' },
    { angle: 270, gesture: 'DIR_LEFT' },
    { angle: 315, gesture: 'DIR_UPLEFT' },
  ];

  let closest = directions[0];
  let minDiff = 360;
  for (const dir of directions) {
    const diff = Math.abs(angle - dir.angle);
    const wrapped = Math.min(diff, 360 - diff);
    if (wrapped < minDiff) {
      minDiff = wrapped;
      closest = dir;
    }
  }

  return closest.gesture;
}

export default function JoystickMic({ onGesture, onRelease, isRecording }: Props) {
  // React Native Animated API 표준 패턴 - useRef().current는 렌더에서 안전
  /* eslint-disable react-hooks/refs */
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0.5)).current;
  /* eslint-enable react-hooks/refs */
  const touchStartTime = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentDirection = useRef<JoystickGesture | null>(null);

  // 최신 콜백을 ref에 유지 (useEffect 재생성 방지)
  const onGestureRef = useRef(onGesture);
  const onReleaseRef = useRef(onRelease);
  useEffect(() => {
    onGestureRef.current = onGesture;
    onReleaseRef.current = onRelease;
  }, [onGesture, onRelease]);

  // panHandlers를 state로 관리 (렌더 중 ref 접근 방지)
  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});

  useEffect(() => {
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        touchStartTime.current = Date.now();
        Animated.spring(scaleAnim, {
          toValue: 1.05,
          useNativeDriver: true,
        }).start();

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

        if (direction && direction !== currentDirection.current) {
          currentDirection.current = direction;
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
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
        }).start();

        if (currentDirection.current) {
          onGestureRef.current(currentDirection.current);
          if (CONFIG.hapticOnRelease) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
        } else if (duration <= CONFIG.tapMaxDuration) {
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
        onReleaseRef.current();
      },
    });

    setPanHandlers(responder.panHandlers);
  }, [scaleAnim]);

  // 아이들 상태 펄스 애니메이션
  useEffect(() => {
    if (!isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isRecording, pulseAnim]);

  return (
    <View style={styles.container}>
      {/* 펄스 링 (아이들 상태) */}
      {!isRecording && (
        <Animated.View
          style={[
            styles.pulseRing,
            { opacity: pulseAnim },
          ]}
        />
      )}

      {/* 녹음 중 링 */}
      {isRecording && <View style={styles.recordingRing} />}

      {/* 메인 버튼 */}
      <Animated.View
        style={[
          styles.button,
          { transform: [{ scale: scaleAnim }] },
          isRecording && styles.buttonRecording,
        ]}
        {...panHandlers}
      >
        <Text style={styles.buttonIcon}>
          {isRecording ? '⏹' : '🎤'}
        </Text>
      </Animated.View>

      {/* 방향 인디케이터 (간소화) */}
      <View style={styles.directionLabels}>
        <Text style={[styles.dirLabel, styles.dirUp]}>↑</Text>
        <Text style={[styles.dirLabel, styles.dirLeft]}>←</Text>
        <Text style={[styles.dirLabel, styles.dirRight]}>→</Text>
        <Text style={[styles.dirLabel, styles.dirDown]}>↓</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: BUTTON_SIZE * 2.5,
    height: BUTTON_SIZE * 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: BUTTON_SIZE * 1.4,
    height: BUTTON_SIZE * 1.4,
    borderRadius: (BUTTON_SIZE * 1.4) / 2,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  recordingRing: {
    position: 'absolute',
    width: BUTTON_SIZE * 1.5,
    height: BUTTON_SIZE * 1.5,
    borderRadius: (BUTTON_SIZE * 1.5) / 2,
    borderWidth: 3,
    borderColor: colors.statusErr,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: colors.surfaceRaise,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  buttonRecording: {
    backgroundColor: '#3D1A1A',
    shadowColor: colors.statusErr,
  },
  buttonIcon: {
    fontSize: BUTTON_SIZE * 0.35,
  },
  directionLabels: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dirLabel: {
    position: 'absolute',
    fontSize: 18,
    color: colors.text3,
  },
  dirUp: { top: 0 },
  dirLeft: { left: 0 },
  dirRight: { right: 0 },
  dirDown: { bottom: 0 },
});
