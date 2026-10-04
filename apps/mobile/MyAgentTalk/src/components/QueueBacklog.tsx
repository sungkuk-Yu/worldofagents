// 진행 중 질문(밀린 큐) 전역 입구 UI (t_140ecc15, 대표님 10/4 지시 ②).
// "가운데 창 우측 상단 '진행 중 질문' 버튼 = 전역 큐 입구 — 버튼에 pending 수 배지(주황 = 답변 중+대기,
//  빨강 = 멈춤), 0이면 배지 숨김. 탭 → 질문별 排队 시각화(번호=대기 순서, 앞 질문 상태 주황/빨강,
//  내 질문 도착 시각·대기 시간). 모바일은 시트로 동일 데이터, PC는 우측 상시 패널 + 버튼=스크롤 앵커."
// 데이터: useChatSession의 queueView 파생(props) — 이 파일은 로직 무소유(트래커와 동일 원칙).
// 행 구성: 상태 알약(답변 중/대기 n번째·앞 질문 …/멈춤) + 질문 1줄 + 대기시간(도착 시각 기준)
//   + 실패 행 재발화. 멈춤 행은 빨강, 그 외 주황 계열 — 운영(김비서/대표님)이 '배지 0'으로 해소 확인.
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { formatNumber, formatRelative } from '../i18n/format';
import { TickFailedIcon, TrackerIcon } from './Icon';
import { QueueView, QueueViewItem, queueAheadKey, queueWaitDurationUnit } from '../lib/queueVisibility';

interface DataProps {
  view: QueueView;
  /** 행 탭 = 카드 점프+하이라이트 (requestJump; 큐 전용 행 = 메시지 없으면 미전달) */
  onJump: (messageId: string) => void;
  /** 실패(stopped) 행 재발화 (retryMessage 배선) */
  onRetry: (messageId: string) => void;
  testID?: string;
}

function StatusPill({ view, item }: { view: QueueView; item: QueueViewItem }) {
  const { t, i18n } = useTranslation();
  const num = (n: number) => formatNumber(n, i18n.language);
  if (item.status === 'answering') {
    return <View style={[styles.pill, styles.pillWarn]} testID={`queue-pill-${item.id}`}><Text style={styles.pillWarnText}>{t('queueView.answering')}</Text></View>;
  }
  if (item.status === 'stopped') {
    return <View style={[styles.pill, styles.pillStop]} testID={`queue-pill-${item.id}`}><Text style={styles.pillStopText}>{t('queueView.stopped')}</Text></View>;
  }
  // waiting 행만 '대기 n번째 · 앞 질문 상태' 라벨 — 앞 행 상태(답변 중/대기/멈춤)를 실데이터로 보여준다.
  const ahead = queueAheadKey(view, item);
  const label = ahead
    ? t(ahead, { countText: num(item.position) })
    : t('queueView.pos', { countText: num(item.position) });
  return <View style={[styles.pill, styles.pillWarn]} testID={`queue-pill-${item.id}`}><Text style={styles.pillWarnText}>{label}</Text></View>;
}

function QueueRow({ view, item, onJump, onRetry }: { view: QueueView; item: QueueViewItem } & Pick<DataProps, 'onJump' | 'onRetry'>) {
  const { t, i18n } = useTranslation();
  const now = Date.now();
  const waited = item.arrivalMs > 0
    ? t('queueView.waited', {
      when: formatRelative(new Date(item.arrivalMs), i18n.language, new Date(now)),
      duration: (() => { const u = queueWaitDurationUnit(now - item.arrivalMs); return t(u.key, { countText: formatNumber(u.value, i18n.language) }); })(),
    })
    : '';
  return (
    <View style={styles.rowWrap} testID={`queue-row-${item.id}`}>
      {/* 큐 전용 행(messages 미도착 — 다른 디바이스 발화)은 점프 대상 카드가 없다 → 비활성 */}
      <Pressable accessibilityRole="button" onPress={() => onJump(item.id)} style={styles.row} testID={`queue-jump-${item.id}`} disabled={!!item.queueId && item.arrivalMs === 0}>
        <View style={styles.rowBody}>
          <Text numberOfLines={1} style={styles.rowText}>{item.text || t('queue.photoQuestion')}</Text>
          <View style={styles.metaRow}>
            {item.failed
              ? <TickFailedIcon size={12} color={colors.statusErr} />
              : item.arrivalMs > 0 && now - item.arrivalMs > 5 * 60_000 && <View style={styles.stuckDot} />}
            <StatusPill view={view} item={item} />
            {waited ? <Text style={styles.waitText}>{waited}</Text> : null}
          </View>
        </View>
      </Pressable>
      {item.failed && (
        <Pressable accessibilityRole="button" onPress={() => onRetry(item.id)} style={styles.retryBtn} testID={`queue-retry-${item.id}`}>
          <Text style={styles.retryText}>{t('tracker.retry')}</Text>
        </Pressable>
      )}
    </View>
  );
}

function QueueList({ view, onJump, onRetry }: Pick<DataProps, 'view' | 'onJump' | 'onRetry'>) {
  const { t, i18n } = useTranslation();
  const num = (n: number) => formatNumber(n, i18n.language);
  return (
    <View style={styles.list}>
      <View style={styles.countsRow} testID="queue-counts">
        <Text style={styles.countsText}>{t('queueView.counts', { countText: num(view.pendingCount), stopText: num(view.stoppedCount) })}</Text>
      </View>
      {view.items.length === 0 && (
        <View style={styles.emptyRow}><TrackerIcon size={16} color={colors.text3} /><Text style={styles.empty} testID="queue-backlog-empty">{t('queueView.empty')}</Text></View>
      )}
      {view.items.map((item) => <QueueRow key={item.id} view={view} item={item} onJump={onJump} onRetry={onRetry} />)}
    </View>
  );
}

/** ContextPanel 상시 섹션 (t_140ecc15 ② — PC: 버튼 탭은 이 영역으로 스크롤 앵커) */
export function QueueBacklogSection(props: DataProps) {
  const { t } = useTranslation();
  return (
    <View testID={props.testID ?? 'queue-backlog-panel'}>
      <Text style={styles.panelTitle}>{t('queueView.title')}</Text>
      <QueueList view={props.view} onJump={props.onJump} onRetry={props.onRetry} />
    </View>
  );
}

/** 모바일(390px)/네이티브 대체 경로 — 앱바 '진행 중 질문' 탭 → 하단 시트 (트래커/답글 모달 규격) */
export function QueueBacklogModal({ visible, onClose, ...data }: DataProps & { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} testID="queue-backlog-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal testID={data.testID ?? 'queue-backlog-modal'}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('queueView.title')}</Text>
            <Pressable onPress={onClose} accessibilityLabel={t('common.close')} testID="queue-backlog-close" style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
            <QueueList view={data.view} onJump={(id) => { onClose(); data.onJump(id); }} onRetry={data.onRetry} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panelTitle: { ...typography.subhead, fontWeight: '700', color: colors.text1, marginBottom: spacing.sp2, letterSpacing: 0 },
  list: { gap: spacing.sp2 },
  countsRow: { minHeight: 1 },
  countsText: { ...typography.caption, color: colors.text2 },
  empty: { ...typography.caption, color: colors.text3 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingVertical: spacing.sp2 },
  rowWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sp2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingVertical: spacing.sp1 },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.sp1 },
  rowText: { ...typography.caption, color: colors.text1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sp2 },
  stuckDot: { width: 8, height: 8, borderRadius: radii.full, backgroundColor: colors.statusErr },
  pill: { borderRadius: radii.full, paddingHorizontal: spacing.sp2, paddingVertical: 2, borderWidth: 1 },
  pillWarn: { borderColor: colors.statusWarn, backgroundColor: 'rgba(217,119,6,0.08)' },
  pillWarnText: { ...typography.micro, color: colors.statusWarn, fontWeight: '700' },
  pillStop: { borderColor: colors.statusErr, backgroundColor: 'rgba(220,38,38,0.08)' },
  pillStopText: { ...typography.micro, color: colors.statusErr, fontWeight: '700' },
  waitText: { ...typography.micro, color: colors.text3 },
  retryBtn: { alignSelf: 'flex-start', paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp1 },
  retryText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(16,24,40,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '70%', paddingBottom: spacing.sp4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sp4, paddingTop: spacing.sp4, paddingBottom: spacing.sp2 },
  sheetTitle: { ...typography.title2, color: colors.text1 },
  closeBtn: { paddingHorizontal: spacing.sp2, paddingVertical: spacing.sp1 },
  closeText: { ...typography.subhead, color: colors.text2 },
  sheetList: { paddingHorizontal: spacing.sp4 },
  sheetListContent: { paddingBottom: spacing.sp3 },
});
