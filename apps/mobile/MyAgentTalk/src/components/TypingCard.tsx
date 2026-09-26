// 처리중 카드 — 자연어 quip + 잔잔한 점 3개 (스피너 대신 대화체)
// 정체성 규칙: 에이전트가 일하는 동안은 이 카드가 예외 없이 계속 보인다.
// ChatScreen·ThreadPanel 공용 — 순환 import 방지 위해 독립 모듈로 분리.
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
import { colors, radii, spacing, typography } from '../theme';

export default function TypingCard({ quip, agentName, count }: { quip: string | null; agentName: string; count: number }) {
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

  return (
    <Surface style={[styles.card, styles.typingCard]} elevation={0} testID="typing-indicator"
      accessibilityLabel={t('chat.preparing', { agentName })}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.header}>
        <Text style={[styles.role, styles.roleAgent]}>{agentName}</Text>
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
      <Text style={styles.quip}>{t(quip || 'quip.default')}</Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
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
