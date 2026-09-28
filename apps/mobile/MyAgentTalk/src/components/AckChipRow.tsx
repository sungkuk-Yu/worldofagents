// 공감 카드 하단 예/아니요 칩 (t_043539ff) — 에코 카드 노출 후 3초 한시.
// 시각/수명 로직은 lib/ackChips(순수) 소유, 이 컴포넌트는 렌더+탭 전송만.
// 탭 payload = t('chat.ackYes'/'chat.ackNo') → ko '예'/'아니요', en 'Yes'/'No' —
// 백엔드 isConfirmationUtterance 집합과 완전 일치(카드 #3: 재생성 방지 게이트가 수신 조건).
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';

interface Props {
  /** 탭 시 전송 문장 확정 콜백 — 화면(send)으로 전달 */
  onPressAck: (text: string) => void;
}

export default function AckChipRow({ onPressAck }: Props) {
  const { t } = useTranslation();
  const yes = t('chat.ackYes');
  const no = t('chat.ackNo');
  return (
    <View style={styles.row} testID="ack-chips">
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressAck(yes)}
        testID="ack-chip-yes"
        style={({ pressed }) => [styles.chip, styles.chipYes, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.chipYesText}>{yes}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressAck(no)}
        testID="ack-chip-no"
        style={({ pressed }) => [styles.chip, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Text style={styles.chipText}>{no}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sp2, marginTop: spacing.sp1, paddingHorizontal: spacing.sp1 },
  chip: {
    minHeight: spacing.sp8,
    minWidth: spacing.sp10 * 2,
    paddingHorizontal: spacing.sp4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipYes: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipYesText: { ...typography.bodyBold, color: colors.onPrimary },
  chipText: { ...typography.bodyBold, color: colors.text1 },
});
