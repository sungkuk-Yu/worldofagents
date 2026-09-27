// 상단 질문 큐 스트립 (t_2f45ccb1 + 대표님 9/28 새벽 확장) — 앱바 아래 가로 칩 라인.
// 1) 칩 = `N.` 순번 접두 + 질문 원문 1줄 ellipsis + 상태 아이콘(SVG, 이모지 금지)
//    / 좌측 '질문 N개' 카운터 (3건 초과 시 우측 스크롤).
// 2) 칩 탭 = 카드 점프; 재탭(펼침) 시 해당 질문 기준 답글(스레드)/갈라내기 버튼 노출 — 바로 실행.
//    갈라내기는 canFork(김비서 room) 게이트 재사용. 0건 = 완전 숨김(빈 회색 바 금지).
// 담백 스타일: 흰 배경 + 극박 회색 구분선, 상태 색만 초록.
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, iconSize, radii, spacing, typography } from '../theme';
import { formatNumber } from '../i18n/format';
import { QueueAnsweredIcon, QueuePendingIcon, QueueSkippedIcon } from './Icon';
import type { QueueStripItem } from '../lib/chatLogic';

interface Props {
  items: QueueStripItem[];
  canFork: boolean;
  onJump: (messageId: string) => void;
  /** 답글(스레드) 열기 — 인자: 질문 메시지 id */
  onReply: (questionMessageId: string) => void;
  /** 갈라내기 — 인자: 질문 메시지 id */
  onFork: (questionMessageId: string) => void;
}

export default function QueueStrip({ items, canFork, onJump, onReply, onFork }: Props) {
  const { t, i18n } = useTranslation();
  // 펼침(액션 노출)된 칩 id — 다른 칩 탭 시 이동, 같은 칩 재탭이면 액션 토글 (하나만 열림)
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!items.length) return null; // 0건 완전 숨김 — 빈 회색 바 금지
  const press = (it: QueueStripItem) => {
    if (it.jumpMessageId) onJump(it.jumpMessageId);
    setExpanded((cur) => (cur === it.id ? null : it.id));
  };
  return (
    <View testID="queue-strip" style={styles.strip}>
      <Text style={styles.counter} testID="queue-counter">{t('queue.count', { countText: formatNumber(items.length, i18n.language) })}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track} style={styles.scroller} testID="queue-scroller">
        {items.map((it) => {
          const isOpen = expanded === it.id;
          return (
            <View key={it.id} style={styles.chipWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('queue.chipAria', { status: t(`queue.${it.status}`), text: it.text || t('queue.photoQuestion') })}
                accessibilityState={{ expanded: isOpen }}
                onPress={() => press(it)}
                testID={`queue-chip-${it.id}`}
                style={({ pressed }) => [styles.chip, isOpen && styles.chipOpen, pressed && { backgroundColor: colors.surfaceHover }]}
              >
                <Text style={styles.seq}>{`${it.seq}.`}</Text>
                {it.status === 'pending' && <QueuePendingIcon size={iconSize.tileSm} color={colors.text3} />}
                {it.status === 'answered' && <QueueAnsweredIcon size={iconSize.tileSm} color={colors.accent} />}
                {it.status === 'skipped' && <QueueSkippedIcon size={iconSize.tileSm} color={colors.text3} />}
                <Text numberOfLines={1} testID={`queue-label-${it.id}`} style={[styles.label, it.status === 'skipped' && { color: colors.text3 }]}>
                  {it.text || t('queue.photoQuestion')}
                </Text>
              </Pressable>
              {isOpen && it.questionMessageId && (
                <View style={styles.actions} testID={`queue-actions-${it.id}`}>
                  <Pressable accessibilityRole="button" onPress={() => onReply(it.questionMessageId as string)} testID={`queue-reply-${it.id}`} style={({ pressed }) => [styles.actionChip, pressed && { backgroundColor: colors.surfaceHover }]}>
                    <Text style={styles.actionText}>{t('queue.replyAction')}{it.replyCount > 0 ? ` (${formatNumber(it.replyCount, i18n.language)})` : ''}</Text>
                  </Pressable>
                  {canFork && (
                    <Pressable accessibilityRole="button" onPress={() => { setExpanded(null); onFork(it.questionMessageId as string); }} testID={`queue-fork-${it.id}`} style={({ pressed }) => [styles.actionChip, pressed && { backgroundColor: colors.surfaceHover }]}>
                      <Text style={styles.actionText}>{t('queue.forkAction')}</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,               // 흰 배경
    borderBottomWidth: StyleSheet.hairlineWidth,   // 극박 회색 구분선
    borderBottomColor: colors.border,
  },
  scroller: { flexShrink: 1 },
  counter: { ...typography.caption, color: colors.text3, paddingHorizontal: spacing.sp3, paddingTop: spacing.sp1 + 4, flexShrink: 0 },
  track: { paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp1 + 2, gap: spacing.sp2 },
  chipWrap: { flexShrink: 0 },
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
  chipOpen: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaise },
  seq: { ...typography.caption, color: colors.text3, fontVariant: ['tabular-nums'] },
  label: { ...typography.caption, color: colors.text2, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: spacing.sp1, paddingTop: spacing.sp1, paddingLeft: spacing.sp1 },
  actionChip: {
    paddingHorizontal: spacing.sp2, paddingVertical: 2, borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface,
  },
  actionText: { ...typography.micro, color: colors.text2 },
});
