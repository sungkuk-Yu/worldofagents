// 디바이스 presence 뱃지 — 같은 세션을 실시간으로 열은 다른 기기 표시 (t_eded715c 요구 2).
// useChatSession.peers (WS presence.update)에서 피드백 루프 없이 렌더된다.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { deviceLabelKey } from '../lib/deviceLabel';
import { colors, radii, spacing, typography } from '../theme';

export default function DevicePresenceBadge({ peers }: { peers: string[] }) {
  const { t } = useTranslation();
  if (!peers.length) return null;
  const label = peers.map((d) => t(deviceLabelKey(d))).join(' + ');
  return (
    <View style={styles.badge} testID="device-presence" accessibilityLabel={t('resume.liveOn', { devices: label })}>
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={1}>{t('resume.liveOn', { devices: label })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp1,
    alignSelf: 'flex-start',
    marginHorizontal: spacing.sp4,
    marginTop: spacing.sp1,
    paddingHorizontal: spacing.sp2,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.accentTint,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 0,
  },
  dot: { width: 6, height: 6, borderRadius: radii.full, backgroundColor: colors.statusOk },
  text: { ...typography.micro, color: colors.text2 },
});
