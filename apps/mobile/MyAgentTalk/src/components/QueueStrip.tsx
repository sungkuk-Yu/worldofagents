// 상단 질문 큐 스트립 (t_2f45ccb1) — 앱바 아래 가로 칩 라인.
// 담백 스타일: 흰 배경 + 극박 회색 구분선, 상태 색만 초록. 이모지 금지(SVG).
// 0건 = 완전 숨김(빈 회색 바 금지). 3건 초과 = 좌우 스크롤(개수 배지 없음).
// 칩 탭 = 해당 카드로 점프 (answered는 답변 카드, 그 외 질문 카드 — jumpMessageId).
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, iconSize, radii, spacing, typography } from '../theme';
import { QueueAnsweredIcon, QueuePendingIcon, QueueSkippedIcon } from './Icon';
import type { QueueStripItem } from '../lib/chatLogic';

interface Props {
  items: QueueStripItem[];
  onJump: (messageId: string) => void;
}

export default function QueueStrip({ items, onJump }: Props) {
  const { t } = useTranslation();
  if (!items.length) return null; // 0건 완전 숨김 — 빈 회색 바 금지
  return (
    <View testID="queue-strip" style={styles.strip}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={t('queue.chipAria', { status: t(`queue.${item.status}`), text: item.text || t('queue.photoQuestion') })}
            onPress={() => item.jumpMessageId && onJump(item.jumpMessageId)}
            testID={`queue-chip-${item.id}`}
            style={({ pressed }) => [styles.chip, pressed && { backgroundColor: colors.surfaceHover }]}
          >
            {item.status === 'pending' && <QueuePendingIcon size={iconSize.tileSm} color={colors.text3} />}
            {item.status === 'answered' && <QueueAnsweredIcon size={iconSize.tileSm} color={colors.accent} />}
            {item.status === 'skipped' && <QueueSkippedIcon size={iconSize.tileSm} color={colors.text3} />}
            <Text
              numberOfLines={1}
              testID={`queue-label-${item.id}`}
              style={[styles.label, item.status === 'skipped' && { color: colors.text3 }]}
            >
              {item.text || t('queue.photoQuestion')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: colors.surface,               // 흰 배경
    borderBottomWidth: StyleSheet.hairlineWidth,   // 극박 회색 구분선
    borderBottomColor: colors.border,
  },
  track: { paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp1 + 2, gap: spacing.sp2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp1,
    paddingHorizontal: spacing.sp2 + 2,
    paddingVertical: spacing.sp1,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: 190, // 1줄 ellipsis — 칩이 라인을 밀지 않게
  },
  label: { ...typography.caption, color: colors.text2, flexShrink: 1 },
});
