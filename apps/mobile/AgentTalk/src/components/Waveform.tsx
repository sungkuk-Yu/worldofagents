// 실시간 파형 시각화 (Waveform)
// 설계: ui-interaction-spec.md §1.5 — 롱프레스 확정 시 "레드 core + 파형" 애니메이션
//       agenttalk-figma F02 (음성홈 녹음 중: 레드 core + 파형 + 실시간 트랜스크립트)
// RN Animated 기준 21개 막대, 녹음 활성 시 무작위 진폭으로 상하 진동.
import React, { useEffect } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

interface Props {
  /** 녹음 중이면 true → 레드 파형 + 애니메이션 구동 */
  active: boolean;
  /** 중앙 버튼 색상 (기본 그린, 녹음 중 레드) */
  color?: string;
  /** 막대 수 (기본 21) */
  barCount?: number;
  /** 컨테이너 높이 (기본 36) */
  height?: number;
}

const BAR_COUNT = 21;
const BAR_HEIGHT = 28;

export default function Waveform({ active, color, barCount = BAR_COUNT, height = 36 }: Props) {
  // Animated.Value 는 렌더 간 안정적인 identity 가 필요 → useState 초기화 패턴 (렌더 중 ref 접근 금지 규칙 대응)
  const [anims] = React.useState(() =>
    Array.from({ length: barCount }, () => new Animated.Value(0.18))
  );

  // 녹음 중: 막대별 무작위 진폭으로 왕복 (stagger + loop)
  useEffect(() => {
    if (!active) {
      // 정지 상태 → 최소 진폭으로 되돌림
      anims.forEach((a) => a.stopAnimation());
      Animated.parallel(
        anims.map((a, i) =>
          Animated.timing(a, {
            toValue: 0.12 + ((i % 5) * 0.02),
            duration: 200,
            useNativeDriver: true,
          })
        )
      ).start();
      return;
    }

    const loop = Animated.loop(
      Animated.stagger(
        45,
        anims.map((a) =>
          Animated.sequence([
            Animated.timing(a, {
              toValue: 0.5 + Math.random() * 0.5,
              duration: 160 + Math.random() * 120,
              useNativeDriver: true,
            }),
            Animated.timing(a, {
              toValue: 0.12 + Math.random() * 0.2,
              duration: 140 + Math.random() * 120,
              useNativeDriver: true,
            }),
          ])
        )
      )
    );
    loop.start();
    return () => loop.stop();
  }, [active, anims]);

  const barColor = active ? color ?? colors.statusErr : color ?? colors.accent;

  return (
    <View style={[styles.container, { height }]} pointerEvents="none">
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              backgroundColor: barColor,
              opacity: active ? 1 : 0.45,
              transform: [{ scaleY: a }],
              marginHorizontal: Math.max(1, barCount > 30 ? 1 : 2),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    width: 3,
    height: BAR_HEIGHT,
    borderRadius: 2,
  },
});