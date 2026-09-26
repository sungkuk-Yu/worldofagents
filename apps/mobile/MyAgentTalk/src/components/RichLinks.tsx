// payload.links → 카드 하단 링크 버튼 행 (Wave1 #4 "전달 기능" — 에이전트가 준 링크를 바로 태우기)
import React from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { PayloadLink } from '../lib/richtext';

export default function RichLinks({ links }: { links: PayloadLink[] }) {
  const { t } = useTranslation();
  if (!links.length) return null;
  const open = (url: string) => {
    // 웹: 앵커 없이 openURL이 same-tab navigation — _blank로 새 탭 유지 (#53 웹 퍼스트)
    if (Platform.OS === 'web') { try { window.open(url, '_blank', 'noopener'); return; } catch { /* fallthrough */ } }
    void Linking.openURL(url).catch(() => undefined);
  };
  return <View style={styles.row} testID="payload-links">
    {links.map((link) => (
      <Text key={`${link.url}-${link.label}`} onPress={() => open(link.url)} role="link" accessibilityLabel={t('cards.openLink', { label: link.label })} style={styles.chip}>
        {link.label} ↗
      </Text>
    ))}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sp2, marginTop: spacing.sp2 },
  chip: { ...typography.caption, color: colors.accent, backgroundColor: colors.surfaceRaise, borderRadius: radii.xs, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, overflow: 'hidden' },
});
