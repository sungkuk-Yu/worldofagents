// 처리중 표시 — t_64e3edd6 ③ (#324/#325 QUIET_PROGRESS, 대표님 9/29 "중간 포인트 너무 많이 뜨고"):
//   활성 시 = 점 3개만 (agentName 헤더·quip 줄·작업 count 줄 제거 — 병렬 위젯 창 축소, 페르소나 라인은 #328 소관).
//   비활성 시 = 기존 자연어 quip 카드 1:1 복원.
// ChatScreen·ThreadPanel 공용 — 순환 import 방지 위해 독립 모듈로 분리.
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
import { colors, radii, spacing, typography } from '../theme';
import { QUIET_PROGRESS } from '../lib/featureFlags';

export default function TypingCard({ quip, agentName, count, hideQuip, showName = true }: { quip: string | null; agentName: string; count: number; /** 릴레이 자막 스트립(t_961ca593)이 같은 런의 자막을 소유할 때 중복 라인 억제 */ hideQuip?: boolean; /** t_55b7e30c 연속 발화 그룹이 이어지는 중이면 이름 재출력 생략 (본문 카드 규칙과 동일) */ showName?: boolean }) {
  const { t, i18n } = useTranslation();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });

  if (QUIET_PROGRESS) {
    // 점 3개 한 줄 — 카드 폭/여백 최소화(빈 시간 안내는 페르소나 라인이 맡는다: #325 침묵 금지)
    return (
      <View style={styles.dotsOnly} testID="typing-indicator"
        accessibilityLabel={t('chat.preparing', { agentName })}
        accessibilityRole="progressbar"
        accessibilityLiveRegion="polite"
      >
        {[0, 1, 2].map((i) => (
          <Animated.View key={i} style={[styles.dot, { opacity: dotOpacity, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.1] }) }] }]} />
        ))}
      </View>
    );
  }

  return (
    <Surface style={[styles.card, styles.typingCard]} elevation={0} testID="typing-indicator"
      accessibilityLabel={t('chat.preparing', { agentName })}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.header}>
        {/* t_55b7e30c: 연속 발화 그룹 지속 중(showName=false)이면 이름 재출력 생략 — 점 3개(처리중)는 유지 */}
        {showName && <Text style={[styles.role, styles.roleAgent]} testID="typing-sender">{agentName}</Text>}
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[styles.dot, { opacity: dotOpacity, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.1] }) }] }]}
            />
          ))}
        </View>
      </View>
      {count > 1 && <Text style={styles.quip}>{t('chat.tasks', { countText: formatNumber(count, i18n.language) })}</Text>}
      {!hideQuip && <Text style={styles.quip}>{t(quip || 'quip.default')}</Text>}
    </Surface>
  );
}

const styles = StyleSheet.create({
  dotsOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp1,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp2,
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp3,
  },
  typingCard: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
    marginBottom: spacing.sp1,
  },
  role: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.5,
    minWidth: 0,
    flexShrink: 1,
  },
  roleAgent: {
    color: colors.text2,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp1,
  },
  dot: {
    width: spacing.sp1,
    height: spacing.sp1,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  quip: {
    ...typography.subhead,
    color: colors.text2,
    fontStyle: 'italic',
  },
});
