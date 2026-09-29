// 피드 푸터 (t_70cbbd6b: ChatScreen renderFooter/renderHeader JSX 순수 추출 — 렌더/DOM/testID 1:1)
// 타이핑 카드 + 스트리밍 답변 + 후속 질문 칩(푸터), 히스토리 이력 로그 + 더 보기 버튼(헤더).
// sendSuggested/loadHistory 등 상태 전이는 화면 소유 콜백을 그대로 호출한다.
import React from 'react';
import { Pressable, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import TypingCard from '../TypingCard';
import { colors, spacing } from '../../theme';
import { styles } from '../../screens/chatScreenStyles';
import type { SuggestedQuestion, StreamingAnswer } from '../../lib/chatLogic';

interface FooterProps {
  typing: boolean;
  typingQuip: string | null;
  agentName: string;
  activeCount: number;
  streams: StreamingAnswer[];
  suggested: SuggestedQuestion[];
  isDemo: boolean;
  /** 릴레이 자막(t_961ca593) 활성 시 타이핑 카드 quip 중복 억제 */
  hideQuip?: boolean;
  /** t_55b7e30c 연속 발화 그룹 지속 — 타이핑/스트리밍 카드의 발신자 이름 재출력 생략 (본문 카드 규칙과 동일) */
  showSenderName?: boolean;
  onSendSuggested: (q: SuggestedQuestion) => void;
}

export function ChatFeedFooter({ typing, typingQuip, agentName, activeCount, streams, suggested, isDemo, hideQuip, showSenderName = true, onSendSuggested }: FooterProps) {
  const { t } = useTranslation();
  return <View>
    {typing && <TypingCard quip={typingQuip} agentName={agentName} count={activeCount} hideQuip={hideQuip} showName={showSenderName} />}
    {streams.map((stream) => <Surface key={stream.runId} style={[styles.msgCard, styles.msgCardAgent, !showSenderName && styles.msgCardContinuation]} elevation={0} testID="streaming-card">
      {/* t_55b7e30c: 이름 라벨은 발화 그룹 시작에만 (본문 카드와 동일 규칙 — 연쇄 답변/스트리밍 소음 제거) */}
      {showSenderName && <Text style={styles.msgRoleAgent}>{agentName}</Text>}
      <Text style={styles.msgText}>{stream.text}</Text>
      <Text testID="ai-generated-badge" style={styles.pendingMark}>{t('common.aiGenerated')}</Text>
      <Text style={styles.typingQuip}>{t(stream.done ? 'chat.saving' : stream.quip)}</Text>
    </Surface>)}
    {/* 후속 질문 칩 (t_1797f432 ③): 백엔드가 run.completed에 생성해 준 예상 질문 2~3개 — 없으면 렌더 없음 */}
    {!typing && !streams.length && suggested.length > 0 && !isDemo && (
      <View style={styles.suggestRow} testID="suggested-questions">
        <Text style={styles.suggestTitle}>{t('chat.suggestTitle')}</Text>
        {suggested.map((q) => (
          <Pressable key={q.id} accessibilityRole="button" onPress={() => onSendSuggested(q)} testID={`suggested-${q.id}`} style={({ pressed }) => [styles.suggestChip, pressed && { backgroundColor: colors.surfaceHover }]}>
            <Text style={styles.suggestChipText} numberOfLines={2}>{q.text}</Text>
          </Pressable>
        ))}
      </View>
    )}
  </View>;
}

interface HeaderProps {
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  isDemo: boolean;
  onLoadHistory: () => void;
}

export function ChatFeedHeader({ hasMoreHistory, loadingHistory, isDemo, onLoadHistory }: HeaderProps) {
  const { t } = useTranslation();
  if (!hasMoreHistory || isDemo) return <View style={{ height: spacing.sp2 }} />;
  return (
    <View style={styles.loadMoreWrap}>
      <Button mode="text" onPress={onLoadHistory} disabled={loadingHistory} testID="load-older" textColor={colors.text2}>
        {loadingHistory ? t('common.loading') : t('chat.history')}
      </Button>
    </View>
  );
}
