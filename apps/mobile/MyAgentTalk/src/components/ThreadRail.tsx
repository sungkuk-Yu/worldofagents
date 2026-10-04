// 좌측 스레드 레일 — 슬랙식 스레드 전용 공간 (t_fd869e5b 요구1, 대표님 10/4 원문:
// "왼쪽에 볼트노트보다는 왼쪽편의 공간은 슬랙처럼 쓰레드가 발생하는 공간으로 내비되어야").
// PC(≥768) 채팅 라우트의 사이드바 자리를 세션목록 대신 스레드가 차지한다:
//   목록 = 답글(reply_to_id 012 계약)이 발생한 카드 기준 스레드 인덱스 (useChatSession이 발행한
//          railStore 스냅샷 구독 — 데이터는 messages 파생, 새 백엔드 API 없음)
//   행 탭 = 레일 내부 상세로 ThreadPanel 재사용 (원본 고정 + 답글 행 + 컴포저, t_62897e88 배선 공유)
//   중첩 답글 탭 = 레일 내부 스택 push (전체 화면 라우트 전환 없음)
// 뒤로 = 목록. 빈 세션 = 안내문 한 줄. 앱바 '답글' 버튼/바텀시트는 모바일 경로 보존 위해 유지.
import React, { useEffect, useSyncExternalStore, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { railStore } from '../lib/railStore';
import ThreadPanel from './ThreadPanel';
import { colors, radii, spacing, typography } from '../theme';
import { formatNumber, formatRelative } from '../i18n/format';

export default function ThreadRail({ navigation }: { navigation: any }) {
  const { t, i18n } = useTranslation();
  const state = useSyncExternalStore(railStore.subscribe, railStore.get, railStore.get);
  // 레일 내부 중첩 스택: open[0]=루트 목록에서 고른 스레드, push=답글 카드에서 재진입 (슬랙: 레일 안에서 완결)
  const [stack, setStack] = useState<string[]>([]);
  const openRootId = stack[stack.length - 1] ?? null;
  // 세션 전환 = 스택 초기화 (이전 세션의 스레드 상세가 새 세션에 붙어 보이면 안 된다)
  useEffect(() => { setStack([]); }, [state.sessionId]);
  const pushThread = (messageId: string) => setStack((s) => (s[s.length - 1] === messageId ? s : [...s, messageId]));

  if (!state.sessionId || !state.meta) {
    return (
      <View style={styles.rail} testID="thread-rail">
        <Text style={styles.title}>{t('queue.threadsTitle')}</Text>
        <Text style={styles.empty} testID="thread-rail-empty">{t('queue.threadsEmpty')}</Text>
      </View>
    );
  }
  if (openRootId && state.meta) {
    return (
      <View style={styles.railDetail} testID="thread-rail-detail">
        <ThreadPanel
          navigation={navigation}
          target={{ sessionId: state.sessionId, rootMessageId: openRootId, ...state.meta }}
          onBack={() => setStack((s) => s.slice(0, -1))}
          onOpenNested={(m) => pushThread(m.id)}
        />
      </View>
    );
  }
  const activeCount = state.threads.filter((th) => !th.ended).length;
  return (
    <View style={styles.rail} testID="thread-rail">
      <View style={styles.header}>
        <Text style={styles.title}>{t('queue.threadsTitle')}</Text>
        {activeCount > 0 && <Text style={styles.badge} testID="thread-rail-count">{formatNumber(activeCount, i18n.language)}</Text>}
      </View>
      {state.threads.length === 0 && <Text style={styles.empty} testID="thread-rail-empty">{t('queue.threadsEmpty')}</Text>}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {state.threads.map((th) => (
          <Pressable key={th.rootId} onPress={() => pushThread(th.rootId)} testID={`thread-rail-row-${th.rootId}`}
            accessibilityRole="button" accessibilityLabel={th.rootText}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}>
            <Text style={styles.rowSeq}>{th.rootSeq > 0 ? `${th.rootSeq}.` : ''}</Text>
            <View style={styles.rowBody}>
              <Text numberOfLines={1} style={styles.rowText}>{th.rootText}</Text>
              <Text style={styles.rowMeta}>{t('queue.replyCount', { countText: formatNumber(th.replyCount, i18n.language) })} · {t('queue.lastActivity', { when: th.lastActivity ? formatRelative(new Date(th.lastActivity), i18n.language) : '—' })}</Text>
            </View>
            {th.ended && <View style={styles.endedBadge} testID={`thread-rail-ended-${th.rootId}`}>
              <Text style={styles.endedText}>{t('queue.endedBadge')}</Text>
            </View>}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { flex: 1, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border, paddingHorizontal: spacing.sp3, paddingTop: spacing.sp4, gap: spacing.sp2 },
  railDetail: { flex: 1, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingHorizontal: spacing.sp1 },
  title: { ...typography.subhead, fontWeight: '700', color: colors.text1, letterSpacing: 0 },
  badge: { ...typography.micro, color: colors.accent, backgroundColor: colors.accentTint, borderRadius: radii.full, paddingHorizontal: spacing.sp2, paddingVertical: 1, fontVariant: ['tabular-nums'] },
  empty: { ...typography.caption, color: colors.text3, paddingHorizontal: spacing.sp1, paddingTop: spacing.sp2 },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.sp3, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sp2, paddingVertical: spacing.sp2, paddingHorizontal: spacing.sp1, borderRadius: radii.md },
  rowSeq: { ...typography.caption, color: colors.text3, fontVariant: ['tabular-nums'], width: 20, textAlign: 'right', marginTop: 1 },
  rowBody: { flex: 1, minWidth: 0 },
  rowText: { ...typography.body, color: colors.text1 },
  rowMeta: { ...typography.micro, color: colors.text3 },
  endedBadge: { paddingHorizontal: spacing.sp2, paddingVertical: 2, borderRadius: radii.sm, backgroundColor: colors.surfaceRaise, marginTop: 2 },
  endedText: { ...typography.micro, color: colors.text3 },
});
