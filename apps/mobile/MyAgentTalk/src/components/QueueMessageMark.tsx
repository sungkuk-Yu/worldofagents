// 질문 큐 체크포인트 마커 (t_1797f432 ②) — 사용자 메시지 행의 상태 아이콘+라벨.
//
// 상단 질문 큐 스트립(앱바 아래 가로 칩 라인, t_2f45ccb1)은 폐기됐다 (t_3c882443,
// 대표님 10/4 지시 3 — t_fd869e5b 트래커 이관과 합동): 진행 상황 표시는 '내 질문 트래커'로
// 이관하고 화면 상단 중복 위젯을 제거한다.
// - 칩의 카드 점프: QuestionTracker 행 탭이 useQueueStrip.requestJump(nonce 경로)를 그대로 재사용.
// - GET /queue 보조 폴링(useQueueStrip)과 WS queue.updated 단일 상태원천은 유지 — 이 마커의 데이터.
// - 구 스트립 렌더/buildQueueStrip/QueueStripItem은 dead code로 제거 (서버 API 계약 자체는 불변).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, iconSize, spacing, typography } from '../theme';
import { QueueAnsweredIcon, QueuePendingIcon, QueueSkippedIcon } from './Icon';
import { queueItemForMessage, ChatMessage, QueueItem } from '../lib/chatLogic';

// 매칭 큐 항목이 없으면 렌더 없음(서버 이벤트 미착지 구간 조용히 스킵).
export function QueueMessageMark({ queue, message }: { queue: QueueItem[]; message: ChatMessage }) {
  const { t } = useTranslation();
  const q = queueItemForMessage(queue, message);
  if (!q) return null;
  return <View style={styles.mark} testID={`queue-mark-${q.id}`} accessibilityLabel={t(`queue.${q.status}`)}>
    {q.status === 'pending' ? <QueuePendingIcon size={iconSize.tileSm} color={colors.text3} />
      : q.status === 'answered' ? <QueueAnsweredIcon size={iconSize.tileSm} color={colors.statusOk} />
      : <QueueSkippedIcon size={iconSize.tileSm} color={colors.text3} />}
    <Text style={styles.markText}>{t(`queue.${q.status}`)}</Text>
  </View>;
}

// 값은 ChatScreen 인라인 시절과 동일 (리팩터링 전용)
const styles = StyleSheet.create({
  mark: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp1, minWidth: 0 },
  markText: { ...typography.micro, color: colors.text3, flexShrink: 1, minWidth: 0 },
});
