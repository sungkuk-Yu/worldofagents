// 내 질문 트래커 UI (t_fd869e5b, 대표님 10/4 최종 지시) — "질문의 큐를 쓰레드 형식으로, 큐가 어떻게
// 진행되는지 눈으로. 비개발자들도 알기 쉽게. 내 질문이 제대로 들어갔는지 확인 가능하게."
// · PC 우측 패널(QuestionTrackerPanel): ContextPanel의 볼트 노트 섹션 자리를 대체 — 상시 노출(탭 전환 없음).
// · 모바일(QuestionTrackerModal): 390px 우측 패널 미렌더 대체 경로 — 앱바 '현황' 버튼 → 하단 시트
//   (ThreadListModal/PendingReplyModal 규격 재사용: fade backdrop + 시트 + 행).
// 행 렌더 단위(두 경로 공유): 순번 + 질문 1줄 + 4단계 스텝바(`접수됨→이해 확인 중→답변 준비 중→완료`)
// + 접수 확인(서버 저장 체크 / 낙관은 '보내는 중') + '확인 필요' amber 배지 + 오류 행 '다시 시도할게요'
// 재발화 버튼 + 답글 수 칩(탭=스레드 열기). 행 탭 = 카드 점프+하이라이트(기존 requestJump 딥링크 재사용).
// 상태는 화면(useChatSession)의 단일 원천 props만 소비 — 이 파일은 로직 무소유, 파생은 lib/questionTracker.
import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '../theme';
import { formatNumber } from '../i18n/format';
import { TickFailedIcon, TickSentIcon, TrackerIcon } from './Icon';
import { buildQuestionTracker, TRACKER_STAGE_COUNT, TrackerRow } from '../lib/questionTracker';
import type { ChatMessage, PendingReplyItem, QueueItem, StreamingAnswer } from '../lib/chatLogic';

interface DataProps {
  messages: ChatMessage[];
  pendingReplies: PendingReplyItem[];
  streams: StreamingAnswer[];
  queue: QueueItem[];
  /** 행 탭 = 카드 점프+하이라이트 (useQueueStrip.requestJump와 동일 nonce 경로) */
  onJump: (messageId: string) => void;
  /** 답글 칩 탭 = 스레드 열기 (openThreadOf 재사용) */
  onOpenThread: (rootMessageId: string) => void;
  /** 실패 행 재발화 (retryMessage(message.id) 배선) */
  onRetry: (messageId: string) => void;
  testID?: string;
}

const STAGE_KEYS = ['tracker.stage0', 'tracker.stage1', 'tracker.stage2', 'tracker.stage3'] as const;

function StepBar({ stage, needsConfirm, failed }: { stage: number; needsConfirm: boolean; failed: boolean }) {
  return (
    <View style={styles.stepRow} testID="tracker-steps">
      {STAGE_KEYS.map((k, i) => {
        const done = !failed && i < stage;
        const current = !failed && i === stage && stage < TRACKER_STAGE_COUNT - 1;
        return (
          <View key={k} style={styles.stepCell}>
            <View style={[
              styles.stepDot,
              done && styles.stepDotDone,
              current && styles.stepDotCurrent,
              needsConfirm && i === 1 && styles.stepDotAsk,
              failed && i === 0 && { borderColor: colors.statusErr },
            ]} />
            {i < STAGE_KEYS.length - 1 && <View style={[styles.stepLine, done && styles.stepLineDone]} />}
          </View>
        );
      })}
    </View>
  );
}

export function TrackerRowView({ row, onJump, onOpenThread, onRetry }: { row: TrackerRow; onJump: DataProps['onJump']; onOpenThread: DataProps['onOpenThread']; onRetry: DataProps['onRetry'] }) {
  const { t, i18n } = useTranslation();
  const num = (n: number) => formatNumber(n, i18n.language);
  const stageLabel = row.failed ? 'tracker.retry' : row.stage === 3 ? 'tracker.stage3' : row.stage === 0 && !row.confirmed ? 'tracker.sending' : STAGE_KEYS[row.stage];
  return (
    <View style={styles.rowWrap} testID={`tracker-row-${row.messageId}`}>
      <Pressable accessibilityRole="button" onPress={() => onJump(row.messageId)} style={styles.row} testID={`tracker-jump-${row.messageId}`}>
        <Text style={styles.seq}>{`${row.seq}.`}</Text>
        <View style={styles.rowBody}>
          <Text numberOfLines={1} style={styles.rowText}>{row.text || t('queue.photoQuestion')}</Text>
          <StepBar stage={row.stage} needsConfirm={row.needsConfirm} failed={row.failed} />
          <View style={styles.metaRow}>
            {/* ① 접수 확인 — 서버 저장 확정(초록 체크) vs 낙관 발송 중(회색 시계) 구분 (대표님: 낙관/확정 구분 표시) */}
            {row.failed
              ? <TickFailedIcon size={12} color={colors.statusErr} />
              : row.confirmed
                ? <TickSentIcon size={12} color={colors.accent} />
                : <View style={styles.sendingDot} />}
            <Text style={[styles.stageText, row.failed && { color: colors.statusErr }, row.stage === 3 && !row.failed && { color: colors.accent }]}>{t(stageLabel)}</Text>
            {row.needsConfirm && !row.failed && <View style={styles.askBadge} testID={`tracker-ask-${row.messageId}`}><Text style={styles.askText}>{t('tracker.needsConfirm')}</Text></View>}
            {row.replyCount > 0 && (
              <Pressable accessibilityRole="button" onPress={() => onOpenThread(row.messageId)} hitSlop={6} testID={`tracker-thread-${row.messageId}`}>
                <Text style={styles.replyChip}>{t('queue.replyCount', { countText: num(row.replyCount) })}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Pressable>
      {row.failed && (
        <Pressable accessibilityRole="button" onPress={() => onRetry(row.messageId)} style={styles.retryBtn} testID={`tracker-retry-${row.messageId}`}>
          <Text style={styles.retryText}>{t('tracker.retry')}</Text>
        </Pressable>
      )}
    </View>
  );
}

function useTrackerRows(p: DataProps) {
  return useMemo(() => {
    const r = buildQuestionTracker(p.messages, p.pendingReplies, p.streams, { queue: p.queue });
    // 최신 질문이 위로 ( 목록 상한은 로직단이 오래된 쪽부터 접음 — 렌더는 순서만 뒤집는다)
    return { ...r, rows: [...r.rows].reverse() };
  },
    // 시각 의존(24h 축약)은 리렌더 시점 평가면 충분 — 상주 타이머 금지 (useAckChip 교훈)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.messages, p.pendingReplies, p.streams, p.queue],
  );
}

function TrackerList({ rows, collapsedDone, onJump, onOpenThread, onRetry }: { rows: TrackerRow[]; collapsedDone: number } & Pick<DataProps, 'onJump' | 'onOpenThread' | 'onRetry'>) {
  const { t, i18n } = useTranslation();
  return (
    <View style={styles.list}>
      {/* t_64af90b0 #10 관례 계승 — 빈 상태 = 아이콘+한 줄 안내 (구 노트 빈 행의 SVG 대체) */}
      {rows.length === 0 && <View style={styles.emptyRow}><TrackerIcon size={16} color={colors.text3} /><Text style={styles.empty} testID="tracker-empty">{t('tracker.empty')}</Text></View>}
      {rows.map((row) => <TrackerRowView key={row.messageId} row={row} onJump={onJump} onOpenThread={onOpenThread} onRetry={onRetry} />)}
      {collapsedDone > 0 && <Text style={styles.collapsed} testID="tracker-collapsed">{t('tracker.collapsed', { countText: formatNumber(collapsedDone, i18n.language) })}</Text>}
    </View>
  );
}

/** ContextPanel 내부 섹션 (340px 폭 컨테이너 없음 — 부모 섹션 스타일에 중첩) */
export function QuestionTrackerSection(props: DataProps) {
  const { t } = useTranslation();
  const { rows, collapsedDone } = useTrackerRows(props);
  return (
    <View testID={props.testID ?? 'question-tracker-panel'}>
      <Text style={styles.panelTitle}>{t('tracker.title')}</Text>
      <TrackerList rows={rows} collapsedDone={collapsedDone} onJump={props.onJump} onOpenThread={props.onOpenThread} onRetry={props.onRetry} />
    </View>
  );
}

/** PC 우측 패널 — 볼트 노트 섹션 대체 (t_fd869e5b). 목록 폭발 방지는 24h 축약(로직단). */
export function QuestionTrackerPanel(props: DataProps) {
  const { t } = useTranslation();
  const { rows, collapsedDone } = useTrackerRows(props);
  return (
    <View style={styles.panel} testID={props.testID ?? 'question-tracker-panel'}>
      <Text style={styles.panelTitle}>{t('tracker.title')}</Text>
      <TrackerList rows={rows} collapsedDone={collapsedDone} onJump={props.onJump} onOpenThread={props.onOpenThread} onRetry={props.onRetry} />
    </View>
  );
}

/** 모바일(390px) 대체 경로 — 앱바 '현황' 버튼 → 하단 시트 (기존 답글/답변대기 모달 규격) */
export function QuestionTrackerModal({ visible, onClose, ...data }: DataProps & { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { rows, collapsedDone } = useTrackerRows(data);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} testID="tracker-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()} accessibilityViewIsModal testID={data.testID ?? 'tracker-modal'}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('tracker.title')}</Text>
            <Pressable onPress={onClose} accessibilityLabel={t('common.close')} testID="tracker-close" style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
            <TrackerList rows={rows} collapsedDone={collapsedDone} onJump={data.onJump} onOpenThread={data.onOpenThread} onRetry={data.onRetry} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 340, // CONTEXT_WIDTH — 사이드카 폭 계약 유지
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp5,
    gap: spacing.sp3,
  },
  panelTitle: { ...typography.subhead, fontWeight: '700', color: colors.text1, letterSpacing: 0 },
  list: { gap: spacing.sp2 },
  empty: { ...typography.caption, color: colors.text3, paddingVertical: spacing.sp2 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, paddingVertical: spacing.sp2 },
  collapsed: { ...typography.micro, color: colors.text3, paddingTop: spacing.sp1 },
  rowWrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: spacing.sp2, gap: spacing.sp1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sp2, paddingVertical: spacing.sp1 },
  seq: { ...typography.caption, color: colors.text3, fontVariant: ['tabular-nums'], width: 22, textAlign: 'right', marginTop: 2 },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.sp1 },
  rowText: { ...typography.body, color: colors.text1 },
  stepRow: { flexDirection: 'row', alignItems: 'center' },
  stepCell: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  stepDotDone: { borderColor: colors.accent, backgroundColor: colors.accent },
  stepDotCurrent: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  stepDotAsk: { borderColor: colors.statusWarn, backgroundColor: colors.statusWarn },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: 2 },
  stepLineDone: { backgroundColor: colors.accent },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, flexWrap: 'wrap' },
  stageText: { ...typography.micro, color: colors.text2 },
  sendingDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: colors.text3, borderStyle: 'dotted' },
  askBadge: { paddingHorizontal: spacing.sp2, paddingVertical: 2, borderRadius: radii.sm, backgroundColor: colors.accentTint },
  askText: { ...typography.micro, color: colors.statusWarn, fontWeight: '600' },
  replyChip: { ...typography.micro, color: colors.accent, fontWeight: '600' },
  retryBtn: { alignSelf: 'flex-start', paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp1, borderRadius: radii.full, borderWidth: 1, borderColor: colors.statusErr },
  retryText: { ...typography.caption, color: colors.statusErr, fontWeight: '600' },
  // ── 모바일 시트 (ThreadListModal/PendingReplyModal 규격) ──
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '70%', paddingBottom: spacing.sp4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sp4, paddingTop: spacing.sp4, paddingBottom: spacing.sp2 },
  sheetTitle: { ...typography.title2, color: colors.text1 },
  closeBtn: { padding: spacing.sp1 },
  closeText: { ...typography.title2, color: colors.text3 },
  sheetList: { flexGrow: 0 },
  sheetListContent: { paddingHorizontal: spacing.sp4, paddingBottom: spacing.sp2 },
});
