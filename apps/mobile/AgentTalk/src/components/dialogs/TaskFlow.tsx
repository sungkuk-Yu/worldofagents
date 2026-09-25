// 다이얼로그 컴포넌트: 작업 위임형 (TaskFlow) — 세그먼트: 작업
// 설계: agenttalk-modern-ux-plan.md §3.1-D · dialogue-functionality-spec.md §3.4 · 화면 13
// 작업 계획 카드 → 4단 스테퍼 → task_log 타임라인 → 실행/수정/즉시중단
// 막힘(blocked) 상태는 경고색이 아닌 중립 회색
import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { TaskFlow as TaskFlowType, TaskStatus } from '../../types';
import { colors, radii, spacing } from '../../theme';

const SEG = colors.segTask;

// 목업 작업 플로우
const MOCK_TASK: TaskFlowType = {
  id: 'task-1',
  title: '회식비 정산',
  status: 'in-progress',
  steps: [
    { id: 's1', description: '요청 분석', status: 'completed', completedAt: new Date() },
    { id: 's2', description: '영수증 수집', status: 'completed', completedAt: new Date() },
    { id: 's3', description: '인원별 배분', status: 'in-progress' },
    { id: 's4', description: '정산표 전달', status: 'pending' },
  ],
  createdAt: new Date(),
};

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: '○',
  'in-progress': '◐',
  completed: '●',
  cancelled: '✕',
  failed: '✕',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: colors.text3,
  'in-progress': SEG,
  completed: colors.statusOk,
  cancelled: colors.statusNeutral,
  failed: colors.statusErr,
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '대기',
  'in-progress': '진행 중',
  completed: '완료',
  cancelled: '취소',
  failed: '실패',
};

export default function TaskFlowView() {
  const completedCount = MOCK_TASK.steps.filter((s) => s.status === 'completed').length;
  const progress = (completedCount / MOCK_TASK.steps.length) * 100;

  return (
    <View style={styles.container}>
      <View style={styles.cardHeader}>
        <View style={[styles.segIcon, { backgroundColor: withAlpha(SEG, 0.16) }]}>
          <Text style={[styles.segIconText, { color: SEG }]}>✓</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardType}>작업 · 승인 필요</Text>
          <Text style={styles.cardTitle}>{MOCK_TASK.title}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: withAlpha(SEG, 0.14) }]}>
          <Text style={[styles.statusBadgeText, { color: SEG }]}>진행 중</Text>
        </View>
      </View>

      {/* 4단 스테퍼 */}
      <View style={styles.stepper}>
        {MOCK_TASK.steps.map((step, i) => (
          <React.Fragment key={step.id}>
            {i > 0 && (
              <View
                style={[
                  styles.stepperLine,
                  { backgroundColor: i < completedCount + 1 ? SEG : colors.borderStrong },
                ]}
              />
            )}
            <View style={styles.stepperNode}>
              <View
                style={[
                  styles.stepperDot,
                  step.status === 'completed' && { backgroundColor: SEG },
                  step.status === 'in-progress' && { borderColor: SEG },
                ]}
              >
                {step.status === 'completed' && (
                  <Text style={[styles.stepperCheck, { color: colors.onPrimary }]}>✓</Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepperLabel,
                  step.status === 'completed' && { color: colors.text3 },
                  step.status === 'in-progress' && { color: SEG, fontWeight: '700' },
                ]}
                numberOfLines={1}
              >
                {step.description}
              </Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {/* 진행 바 */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: SEG }]} />
      </View>
      <Text style={styles.progressText}>{completedCount}/{MOCK_TASK.steps.length} 단계 완료</Text>

      {/* 타임라인 (task_log) */}
      <View style={styles.timeline}>
        {MOCK_TASK.steps.map((step, i) => (
          <View key={step.id} style={styles.timelineRow}>
            <View style={styles.timelineLeft}>
              <Text style={[styles.timelineDot, { backgroundColor: STATUS_COLORS[step.status] }]}>
                {STATUS_ICONS[step.status]}
              </Text>
              {i < MOCK_TASK.steps.length - 1 && <View style={styles.timelineLine} />}
            </View>
            <View style={styles.timelineBody}>
              <Text
                style={[
                  styles.timelineText,
                  step.status === 'completed' && styles.timelineTextDone,
                ]}
              >
                {step.description}
              </Text>
              <View style={styles.timelineMeta}>
                <Text style={styles.timelineTime}>
                  {step.completedAt
                    ? step.completedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </Text>
                <Text style={[styles.timelineStatus, { color: STATUS_COLORS[step.status] }]}>
                  {STATUS_LABELS[step.status]}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* 액션: 실행/수정/즉시중단 */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: SEG }]}
          accessibilityLabel="작업 실행"
        >
          <Text style={[styles.actionText, styles.primaryActionText]}>실행하기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionText}>수정</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.stopButton]}>
          <Text style={[styles.actionText, { color: colors.statusErr }]}>즉시 중단</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sp4,
  },
  segIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sp3,
  },
  segIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  cardHeaderText: {
    flex: 1,
  },
  cardType: {
    fontSize: 11,
    color: colors.text3,
    fontWeight: '600',
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text1,
  },
  statusBadge: {
    borderRadius: radii.full,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sp4,
  },
  stepperNode: {
    alignItems: 'center',
    width: 64,
  },
  stepperDot: {
    width: 22,
    height: 22,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaise,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sp1,
  },
  stepperCheck: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepperLabel: {
    fontSize: 10,
    color: colors.text3,
    textAlign: 'center',
  },
  stepperLine: {
    flex: 1,
    height: 2,
    alignSelf: 'flex-start',
    marginTop: 10,
    marginHorizontal: -6,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.surfaceHover,
    borderRadius: 2,
    marginBottom: spacing.sp1,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 11,
    color: colors.text3,
    marginBottom: spacing.sp4,
  },
  timeline: {
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sp3,
    marginBottom: spacing.sp4,
  },
  timelineRow: {
    flexDirection: 'row',
  },
  timelineLeft: {
    alignItems: 'center',
    width: 24,
  },
  timelineDot: {
    fontSize: 12,
    marginTop: 2,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: colors.borderStrong,
    marginVertical: 2,
  },
  timelineBody: {
    flex: 1,
    paddingLeft: spacing.sp3,
    paddingBottom: spacing.sp4,
  },
  timelineText: {
    fontSize: 14,
    color: colors.text1,
    fontWeight: '500',
  },
  timelineTextDone: {
    color: colors.text3,
  },
  timelineMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: spacing.sp2,
  },
  timelineTime: {
    fontSize: 11,
    color: colors.text3,
  },
  timelineStatus: {
    fontSize: 11,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sp2,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.sp3,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  stopButton: {
    backgroundColor: withAlpha(colors.statusErr, 0.08),
    borderColor: withAlpha(colors.statusErr, 0.35),
  },
  actionText: {
    fontSize: 13,
    color: colors.text1,
    fontWeight: '500',
  },
  primaryActionText: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
});