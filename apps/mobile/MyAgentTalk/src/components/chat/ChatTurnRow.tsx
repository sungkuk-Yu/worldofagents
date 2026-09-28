// 턴 그룹 행 (t_70cbbd6b: ChatScreen renderItem 본문 순수 추출 — 렌더/DOM/testID 1:1)
// 시간 라인 + 메시지별 카드 래퍼(포커스 하이라이트/선택 토글래퍼/user 메타/실패 재시도행)까지 화면행 전체를 소유.
// 상태 변경은 화면 소유 콜백(decorate/handlers/toggleSelect/retry/delete)을 그대로 호출 — 이 컴포넌트는 로직 무소유.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import CardFrame from '../../cards/CardFrame';
import { QueueMessageMark } from '../QueueStrip';
import { styles } from '../../screens/chatScreenStyles';
import type { ChatMessage, QueueItem, TurnGroup } from '../../lib/chatLogic';
import type { CardActionHandlers } from '../../cards/types';

interface Props {
  group: TurnGroup;
  timeLabel: string | null | undefined;
  highlightId: string | null;
  decorate: (m: ChatMessage) => ChatMessage;
  handlers: CardActionHandlers;
  presetCategory?: string;
  canFork: boolean;
  agentName: string;
  firstAgentMessageId: string | undefined;
  sessionTitle: string;
  isDemo: boolean;
  queue: QueueItem[];
  selectionActive: boolean;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onResend: (message: ChatMessage) => void;
  onDelete: (id: string) => void;
}

export default function ChatTurnRow({
  group, timeLabel, highlightId, decorate, handlers, presetCategory, canFork, agentName,
  firstAgentMessageId, sessionTitle, isDemo, queue, selectionActive, selectedIds, onToggleSelect, onResend, onDelete,
}: Props) {
  const { t } = useTranslation();
  return <View>
    {timeLabel && <Text style={styles.pendingMark}>{timeLabel}</Text>}
    {group.items.map((message) => <View key={message.id} style={message.id === highlightId ? styles.focusHighlight : undefined} testID={message.id === highlightId ? 'focus-highlight' : undefined}>
      {/* t_64af90b0 #3 — 에이전트명 헤더는 대화의 첫 에이전트 메시지만 노출, 이후 생략 (Linear/Slack식).
          다중 선택 모드: 행 전체가 선택 토글 래퍼 — 비모드에는 래퍼 없이 카드 그대로 (#51 인터랙션 보존) */}
      {selectionActive
        ? <TouchableOpacity
          onPress={() => onToggleSelect(message.id)}
          style={selectedIds.includes(message.id) ? styles.selectedRow : undefined}
          testID={`select-${message.id}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selectedIds.includes(message.id) }}
        >
          <CardFrame presetCategory={presetCategory} canFork={canFork} message={decorate(message)} handlers={handlers} agentName={agentName} showHeader={message.id === firstAgentMessageId} sessionTitle={sessionTitle} exportDisabled={isDemo} />
        </TouchableOpacity>
        : <CardFrame presetCategory={presetCategory} canFork={canFork} message={decorate(message)} handlers={handlers} agentName={agentName} showHeader={message.id === firstAgentMessageId} sessionTitle={sessionTitle} exportDisabled={isDemo} />}
      {message.role === 'user' && <View style={styles.userMetaRow}>
        <Text style={styles.pendingMark}>{t(message.status === 'failed' ? 'chat.failed' : message.pending ? 'chat.sending' : 'chat.sent')}</Text>
        {/* 질문 큐 체크포인트 (t_1797f432 ②): 매칭 큐 항목의 상태 마커 — 서버 이벤트 없으면 렌더 없음 */}
        <QueueMessageMark queue={queue} message={message} />
      </View>}
      {message.status === 'failed' && <View style={styles.msgHeader}>
        <Button onPress={() => onResend(message)}>{t('chat.resend')}</Button>
        <Button onPress={() => onDelete(message.id)}>{t('chat.delete')}</Button>
      </View>}
    </View>)}
  </View>;
}
