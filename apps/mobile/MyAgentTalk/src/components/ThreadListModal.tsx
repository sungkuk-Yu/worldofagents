// 답글 스레드 목록 모달 (t_2f45ccb1 확장 3·4 — 대표님 9/28 새벽, 슬랙 리서치 반영)
// 앱바 우측 '답글' 버튼(배지=활성 스레드 수) → 세션의 모든 스레드 목록.
// 행 = 원 질문 발췌(순번 접두) + 답글 수 + 마지막 활동 시각 + 종료 배지(7일 무활동).
// 행 탭 = 해당 스레드 열기(ThreadSheet 재사용). 필터: 활성/종료/전체 — 정렬 활성>종료(로직단).
// 슬랙 동일 수명: 스레드는 세션 안에만 존재(별도 저장소/아카이브 없음) — 프론트는 배지+정렬만,
// 읽기 전용 토글은 백엔드(t_344e047a) 소관. '답글 알림 끔' 토글은 MVP 생략(카드 카운터로 충분).
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { formatNumber, formatRelative } from '../i18n/format';
import type { ThreadIndexEntry } from '../lib/chatLogic';

type Filter = 'active' | 'ended' | 'all';

interface Props {
  visible: boolean;
  threads: ThreadIndexEntry[];
  onClose: () => void;
  onOpenThread: (rootMessageId: string) => void;
}

export default function ThreadListModal({ visible, threads, onClose, onOpenThread }: Props) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<Filter>('active');
  const rows = useMemo(() => (filter === 'all' ? threads : threads.filter((th) => (filter === 'ended' ? th.ended : !th.ended))), [threads, filter]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.cancel')} testID="threads-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal testID="threads-modal">
          <View style={styles.header}>
            <Text style={styles.title}>{t('queue.threadsTitle')}</Text>
            <Pressable onPress={onClose} accessibilityLabel={t('common.cancel')} testID="threads-close" style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <View style={styles.filters} testID="threads-filters">
            {(['active', 'ended', 'all'] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)} testID={`threads-filter-${f}`} accessibilityRole="button"
                style={[styles.filterChip, filter === f && styles.filterChipOn]}>
                <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>{t(`queue.filter${f === 'active' ? 'Active' : f === 'ended' ? 'Ended' : 'All'}`)}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {rows.length === 0 && <Text style={styles.empty}>{t('queue.threadsEmpty')}</Text>}
            {rows.map((th) => (
              <Pressable key={th.rootId} onPress={() => onOpenThread(th.rootId)} testID={`thread-row-${th.rootId}`}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}>
                {th.rootSeq > 0 && <Text style={styles.rowSeq}>{`${th.rootSeq}.`}</Text>}
                {th.rootSeq === 0 && <View style={styles.rowSeq} />}
                <View style={styles.rowBody}>
                  <Text numberOfLines={1} style={styles.rowText}>{th.rootText}</Text>
                  <Text style={styles.rowMeta}>{t('queue.replyCount', { countText: formatNumber(th.replyCount, i18n.language) })} · {t('queue.lastActivity', { when: th.lastActivity ? formatRelative(new Date(th.lastActivity), i18n.language) : '—' })}</Text>
                </View>
                {th.ended && <View style={styles.endedBadge} testID={`thread-ended-${th.rootId}`}>
                  <Text style={styles.endedText}>{t('queue.endedBadge')}</Text>
                </View>}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '70%', paddingBottom: spacing.sp4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sp4, paddingTop: spacing.sp4, paddingBottom: spacing.sp2 },
  title: { ...typography.title2, color: colors.text1 },
  closeBtn: { padding: spacing.sp1 },
  closeText: { ...typography.title2, color: colors.text3 },
  filters: { flexDirection: 'row', gap: spacing.sp2, paddingHorizontal: spacing.sp4, paddingBottom: spacing.sp2 },
  filterChip: { paddingHorizontal: spacing.sp2 + 2, paddingVertical: spacing.sp1, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  filterChipOn: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  filterText: { ...typography.caption, color: colors.text2 },
  filterTextOn: { color: colors.accent, fontWeight: '600' },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.sp2, paddingBottom: spacing.sp2 },
  empty: { ...typography.caption, color: colors.text3, padding: spacing.sp4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingVertical: spacing.sp2 + 2, paddingHorizontal: spacing.sp2, borderRadius: radii.md },
  rowSeq: { ...typography.caption, color: colors.text3, fontVariant: ['tabular-nums'], width: 24, textAlign: 'right' },
  rowBody: { flex: 1, minWidth: 0 },
  rowText: { ...typography.body, color: colors.text1 },
  rowMeta: { ...typography.micro, color: colors.text3 },
  endedBadge: { paddingHorizontal: spacing.sp2, paddingVertical: 2, borderRadius: radii.sm, backgroundColor: colors.surfaceRaise },
  endedText: { ...typography.micro, color: colors.text3 },
});
