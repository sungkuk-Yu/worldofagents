// 피드 푸터 (t_70cbbd6b: ChatScreen renderFooter/renderHeader JSX 순수 추출 — 렌더/DOM/testID 1:1)
// 타이핑 카드 + 스트리밍 답변 + 후속 질문 칩(푸터), 히스토리 이력 로그 + 더 보기 버튼(헤더).
// sendSuggested/loadHistory 등 상태 전이는 화면 소유 콜백을 그대로 호출한다.
// t_cc232982: 스트리밍 카드는 '성장하는 카드' — delta 누적 본문 + 말미 펄싱 도트(answer.done 정지).
// 본문은 순수 <Text> 유지: 미닫힌 markdown 파싱 추측 금지 — MarkdownView 결합은 t_e9480e0f 소관(게이트 5 합의).
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import TypingCard from '../TypingCard';
import ChatMarkdown from '../ChatMarkdown';
import { looksLikeChatMarkdown } from '../../lib/chatMarkdown';
import { renderFlags } from '../../lib/renderFlags';
import { colors, spacing } from '../../theme';
import { styles } from '../../screens/chatScreenStyles';
import { QUIET_PROGRESS } from '../../lib/featureFlags';
import type { SuggestedQuestion, StreamingAnswer } from '../../lib/chatLogic';

/** 스트리밍 꼬리 커서 — ChatGPT식 펄싱 도트(게이트 4택1). done 시 미렌더=정지. 언마운트 시 루프 stop. */
function StreamingCursor() {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      testID="streaming-cursor"
      pointerEvents="none"
      style={[styles.streamCursor, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }]}
    />
  );
}

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
    {/* t_4af94b1c②: 첫 answer.delta 도착~run.completed 사이 typing과 streams가 중첩되면 같은 quip이
        두 카드에 이중 렌더된다 — quip은 스트리밍 카드 소유, 타이핑 카드는 점 표시만 (QUIET·정체성 규칙 승계). */}
    {typing && <TypingCard quip={typingQuip} agentName={agentName} count={activeCount} hideQuip={hideQuip || streams.length > 0} showName={showSenderName} />}
    {/* ① (t_5c559e85) streamIdPatch ON: delta는 리스트 인라인 카드(stream-*) content patch로 렌더 —
        footer 임시 카드는 이중 렌더의 원천이라 그리지 않는다(done '저장 중' 상태도 인라인 카드가 소유).
        OFF 시(플래그/롤백) 이 옛 경로로 복귀. ② 옛 경로에도 동일 contain:layout 적용.
        t_55b7e30c: 이름 라벨은 발화 그룹 시작에만 (본문 카드와 동일 규칙). */}
    {!renderFlags.streamIdPatch && streams.map((stream) => <Surface key={stream.runId} testID="streaming-card" style={[styles.msgCard, styles.msgCardAgent, styles.streamContainWeb, !showSenderName && styles.msgCardContinuation]} elevation={0}>
      {showSenderName && <Text style={styles.msgRoleAgent}>{agentName}</Text>}
      {/* t_e9480e0f 백로그① — 스트리밍 카드 마크다운: 블록 문법 감지 시 ChatMarkdown(streaming=true:
          미닫힌 ``` fence는 임시 마감 렌더, answer.done 최종 텍스트에서 자연 재파싱).
          평문/미완답변은 gate false → 기존 <Text> 경로 그대로(회귀 금지). */}
      {looksLikeChatMarkdown(stream.text)
        ? <ChatMarkdown content={stream.text} streaming={!stream.done} style={styles.msgText} testID="chat-bubble-stream" />
        : <Text testID="streaming-text" style={styles.msgText}>{stream.text}</Text>}
      {/* 말미 커서: delta 성장 중에만 — answer.done(done=true)에서 정지(게이트 4) */}
      {!stream.done && <StreamingCursor />}
      <Text testID="ai-generated-badge" style={styles.pendingMark}>{t('common.aiGenerated')}</Text>
      {/* t_64e3edd6 ③ QUIET_PROGRESS: 스트리밍 카드의 quip 줄('생각 중' 등 진행 텍스트) 제거 — 본문만.
          비활성 시 기존 줄 복원. AI 고지 배지는 법정 표시라 유지. */}
      {!QUIET_PROGRESS && <Text style={styles.typingQuip}>{t(stream.done ? 'chat.saving' : stream.quip)}</Text>}
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
