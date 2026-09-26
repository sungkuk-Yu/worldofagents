// 조이스틱 마이크 버튼 (JoystickMic)
// 화면 7 중앙에 위치, 8방향 + 탭/롱프레스 제스처 인식
// 설계서: ui-interaction-spec.md §1
//   §1.4 상태별 시각 피드백: 방향 드래그 중 반투명 화살표+라벨 → 확정 시 아이콘 변경+햅틱
//   §1.5 롱프레스: 500ms 확정 → 레드 코어 + 파형 애니메이션 + 실시간 트랜스크립트
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
import { colors, typography, iconSize, shadows } from '../theme';
import {
  getDirection,
  isOutsideDeadzone,
  isTap,
  DIRECTION_ARROWS,
  DEFAULT_DIRECTION_LABELS,
} from '../lib/gesture';
import Waveform from './Waveform';

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
  /** 드래그 중 라벨 오버라이드 (기본: 예/아니오/취소 등) */
  directionLabels?: Partial<Record<JoystickGesture, string>>;
}

// 버튼 실측·재조정 (대표님 지시 9/26 — 자체 창작 금지, 실제 제품 레퍼런스):
//   · 현행 실측: thumb = width×0.22 → 390px 폰에서 85.8px, 단일체(베이스 없음)
//   · 레퍼런스: PS5 DualSense 스틱 캡 Ø21mm ≈ 390px 뷰포트 환산 논리 ~115px,
//     모바일 게임 가상조이스틱(스위치 스타일) 관례 = 썸 너비 20~25% + 베이스 직경 썸의 ~1.5배
//   · 재조정: thumb = clamp(width×0.24, 96, 140) (HIG 44pt 최소 타깃의 2.2배), 베이스 = 1.5×thumb 정적 링
//   · PC 웹(3패널)에서는 140px 상한으로 화면을 압도하지 않고 하단 중앙 유지
const screenWidth = Dimensions.get('window').width;
const BUTTON_SIZE = Math.min(Math.max(screenWidth * 0.24, 96), 140);
const BASE_SIZE = Math.round(BUTTON_SIZE * 1.5); // 정적 베이스 링 (스위치 캡+스커트 비례)
const KNOB_TRAVEL = Math.round((BASE_SIZE - BUTTON_SIZE) / 2); // 썸 이동 한계 = 베이스 안쪽 (실물 스틱 물리)

export default function JoystickMic({ onGesture, onRelease, isRecording, directionLabels }: Props) {
  // RN Animated 표준 패턴 — Animated.Value 는 렌더 간 안정적인 identity 가 필요 → useState 초기화
  // (React 19 react-hooks/refs 규칙: 렌더 중 ref 접근 금지 대응)
  const [scaleAnim] = React.useState(() => new Animated.Value(1));
  const [pulseAnim] = React.useState(() => new Animated.Value(0.5));
  const [knobAnim] = React.useState(() => new Animated.ValueXY({ x: 0, y: 0 }));
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
        Animated.spring(scaleAnim, {
          toValue: 1.05,
          useNativeDriver: true,
        }).start();
        Animated.spring(knobAnim, {
          toValue: { x: 0, y: 0 },
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
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
        }).start();
        Animated.spring(knobAnim, {
          toValue: { x: 0, y: 0 },
          useNativeDriver: true,
        }).start();

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
  }, [scaleAnim, knobAnim]);

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

  // 드래그 중 방향 화살표/라벨 (렌더는 상태 기반 — currentDirection ref 는 핸들러 전용)
  const labels = { ...DEFAULT_DIRECTION_LABELS, ...directionLabels };
  const selectedGesture = activeDirection;

  return (
    <View style={styles.container}>
      {/* 파형 애니메이션 (녹음 중, 버튼 바로 아래) */}
      <View style={styles.waveformWrap} pointerEvents="none">
        <Waveform active={isRecording} color={colors.statusErr} barCount={15} height={26} />
      </View>

      {/* 펄스 링 (아이들 상태) */}
      {!isRecording && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pulseRing,
            { opacity: pulseAnim },
          ]}
        />
      )}

      {/* 녹음 중 링 */}
      {isRecording && <View pointerEvents="none" style={styles.recordingRing} />}

      {/* 정적 베이스 링 — 캡+스커트 2계층 조형 (레퍼런스: 콘솔 가상스틱 관례) */}
      <View pointerEvents="none" style={styles.baseRing} />

      {/* 드래그 방향 피드백 (반투명 화살표, §1.4) */}
      {selectedGesture && selectedGesture !== 'TAP_CENTER' && selectedGesture !== 'LONG_CENTER' && (
        <Animated.View pointerEvents="none" style={styles.directionFeedback}>
          <Text style={styles.dtoDirectionArrow}>{DIRECTION_ARROWS[selectedGesture]}</Text>
          <Text style={styles.directionLabel}>
            {labels[selectedGesture] ?? DEFAULT_DIRECTION_LABELS[selectedGesture]}
          </Text>
        </Animated.View>
      )}

      {/* 메인 버튼 */}
      <Animated.View
        style={[
          styles.button,
          {
            transform: [
              { scale: scaleAnim },
              ...knobAnim.getTranslateTransform(),
            ],
          },
          isRecording && styles.buttonRecording,
        ]}
        {...panHandlers}
      >
        {selectedGesture && selectedGesture !== 'TAP_CENTER' && selectedGesture !== 'LONG_CENTER' ? (
          <Text style={[styles.buttonIcon, { color: colors.onPrimary }]}>
            {DIRECTION_ARROWS[selectedGesture]}
          </Text>
        ) : (
          <Text style={styles.buttonIcon}>
            {isRecording ? '🔴' : '🎤'}
          </Text>
        )}
      </Animated.View>

      {/* 방향 인디케이터 (간소화) */}
      {!isRecording && !selectedGesture && (
        <View pointerEvents="none" style={styles.directionLabels}>
          <Text style={[styles.dirLabel, styles.dirUp]}>↑</Text>
          <Text style={[styles.dirLabel, styles.dirLeft]}>←</Text>
          <Text style={[styles.dirLabel, styles.dirRight]}>→</Text>
          <Text style={[styles.dirLabel, styles.dirDown]}>↓</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: BASE_SIZE,
    height: BASE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  baseRing: {
    position: 'absolute',
    width: BASE_SIZE,
    height: BASE_SIZE,
    borderRadius: BASE_SIZE / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sh1,
  },
  waveformWrap: {
    position: 'absolute',
    // 베이스 링(1.5×) 하단 안쪽 — 컨테이너가 썸+스커트 크기로 축소된 데 맞춘 재배치
    top: BASE_SIZE - 18,
    width: BUTTON_SIZE * 1.2,
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
    width: BASE_SIZE + 20,
    height: BASE_SIZE + 20,
    borderRadius: (BASE_SIZE + 20) / 2,
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
  directionFeedback: {
    position: 'absolute',
    top: 8, // 썸 상단 위쪽 — 1.5× 베이스 컨테이너에 맞춰 재배치 (§1.4 화살표+라벨)
    alignItems: 'center',
    backgroundColor: 'rgba(17,24,39,0.72)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 10,
  },
  dtoDirectionArrow: {
    ...typography.headline,
    fontSize: iconSize.glyph,
    fontWeight: '700',
    color: '#fff',
  },
  directionLabel: {
    ...typography.micro,
    fontWeight: '600',
    color: '#fff',
  },
  directionLabels: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dirLabel: {
    ...typography.headline,
    fontSize: iconSize.glyph,
    position: 'absolute',
    color: colors.text3,
  },
  dirUp: { top: 0 },
  dirLeft: { left: 0 },
  dirRight: { right: 0 },
  dirDown: { bottom: 0 },
});