// 스레드 패널 — 카드 스레드 내용부 (원본 참조 고정 + 답변 행 목록 + 컴포저)
// #52: 채팅 → 카드 스레드는 바텀시트 디텐트(25%→50%→90%, @gorhom/bottom-sheet)로 진입.
// 이 패널은 ① 바텀시트(ChatScreen)와 ② 전체 화면 라우트(CardThreadScreen — 결과 캔버스 경유)에서 공유한다.
// 스레드는 원본 참조를 고정하고 모든 답변을 같은 폭의 행으로 표시한다 (슬랙식 영역 구분).
import React, { useState } from 'react';
import { View, Text, FlatList, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useChatSession } from '../hooks/useChatSession';
import { useCardActions } from '../hooks/useCardActions';
import CardFrame from '../cards/CardFrame';
import ForkDialog from '../components/ForkDialog';
import TypingCard from './TypingCard';
import { restoreFailedDraft, validateMessageInput } from '../lib/chatLogic';
import { displayValue } from '../cards/payload';
import type { ChatMessage } from '../types';
import { formatTime } from '../i18n/format';
import { colors, spacing, typography } from '../theme';
import { cardStyles } from '../cards/styles';

const segments: Record<string, { color: string; key: string }> = {
  info_card: { color: colors.segInfo, key: 'cards.info' },
  spreadsheet: { color: colors.segData, key: 'cards.data' },
  file: { color: colors.segFile, key: 'cards.file' },
  task_flow: { color: colors.segTask, key: 'cards.task' },
  multi_agent: { color: colors.segMulti, key: 'cards.multi' },
};

export interface ThreadTarget {
  sessionId?: string;
  rootMessageId?: string;
  agentName: string;
  presetCategory?: string;
  sessionTitle?: string;
  /** 갈라내기(fork) 노출 게이트 — 김비서 room 전용 (t_55f9ed57). 생략=노출(기본 true). */
  canFork?: boolean;
}

export default function ThreadPanel({ target, navigation, onBack, onOpenNested }: {
  target: ThreadTarget;
  navigation: any;
  /** 뒤로 — 시트 모드면 dismiss/스택 pop, 화면 모드면 navigation.goBack */
  onBack: () => void;
  /** 중첩 스레드 열기 — 시트 모드면 내부 스택 push, 화면 모드면 navigation.push */
  onOpenNested?: (message: ChatMessage) => void;
}) {
  const { t, i18n } = useTranslation();
  const { sessionId, rootMessageId, presetCategory, agentName } = target;
  const canFork = target.canFork !== false;
  const chat = useChatSession({ sessionId: rootMessageId ? sessionId : undefined, rootMessageId });
  const [input, setInput] = useState('');
  const [fork, setFork] = useState<ChatMessage | null>(null);
  const { handlers, decorate, actionError } = useCardActions(
    (message) => onOpenNested
      ? onOpenNested(message)
      : navigation.push('CardThread', { sessionId, rootMessageId: message.id, agentName, presetCategory, sessionTitle: target.sessionTitle, canFork: target.canFork }),
    setFork,
  );
  const root = chat.rootMessage;
  const meta = segments[root?.dialogueType || ''] ?? { color: colors.accent, key: 'cards.text' };
  const send = async () => {
    if (!validateMessageInput(input).ok) return;
    const draft = input; setInput('');
    const result = await chat.send(draft);
    // 햅틱 (#52 규칙 4): 전송 성공 = light impact (웹은 expo-haptics no-op 폴백)
    if (result.ok) { try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); } catch { /* web no-op */ } }
    else setInput((current) => restoreFailedDraft(current, draft));
  };
  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={cardStyles.row}><Button onPress={onBack}>{t('common.back')}</Button><Text style={cardStyles.title}>{t('common.thread')}</Text></View>
    {root && <View style={[styles.refBar, { borderLeftColor: meta.color }]}>
      <Text style={[cardStyles.title, { color: meta.color }]}>{t('cards.referenceIcon')}</Text>
      <View style={styles.body}><Text style={cardStyles.micro}>{t(meta.key)}</Text><Text style={cardStyles.title} numberOfLines={2}>{displayValue(root.payload?.title) || root.content}</Text></View>
      {canFork && <Button onPress={() => setFork(root)} compact testID="thread-fork">{t('fork.short')}</Button>}
    </View>}
    {(chat.error || actionError) && <View style={styles.error} testID="thread-error">
      <Text accessibilityRole="alert" style={styles.errorText}>{t(chat.error || actionError!)}</Text>
      <Button onPress={chat.retryConnection}>{t('common.retry')}</Button>
    </View>}
    {!root && !chat.error && <Text style={cardStyles.micro}>{t('common.loading')}</Text>}
    {root && <FlatList data={chat.messages} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
      renderItem={({ item, index }) => {
        const date = item.createdAt ? new Date(item.createdAt) : null;
        // t_64af90b0 #1/#3 — '나' 라벨 제거·에이전트명은 첫 메시지만 (본문 라벨 3단 중복 해소)
        const showSender = index === 0 || !chat.messages.slice(0, index).some((m) => m.role === item.role);
        return <View style={styles.reply}>
          {(showSender && item.role !== 'user') || date ? <View style={cardStyles.row}>
            {showSender && item.role !== 'user' && <Text style={[cardStyles.title, { color: colors.accent }]}>{agentName}</Text>}
            {date && Number.isFinite(date.getTime()) && <Text style={cardStyles.micro}>{formatTime(date, i18n.language)}</Text>}
            {item.role === 'user' && <Text style={cardStyles.micro}>{t(item.status === 'failed' ? 'chat.failed' : item.pending ? 'chat.sending' : 'chat.sent')}</Text>}
          </View> : null}
          <CardFrame presetCategory={presetCategory} canFork={canFork} compact message={decorate(item)} handlers={handlers} agentName={agentName} />
          {item.status === 'failed' && <View style={cardStyles.row}>
            <Button onPress={() => void chat.retryMessage(item.id)}>{t('chat.resend')}</Button>
            <Button onPress={() => chat.deleteMessage(item.id)}>{t('chat.delete')}</Button>
          </View>}
        </View>;
      }}
      ListFooterComponent={<View>
        {/* t_4af94b1c②: 스트리밍 카드와 타이핑 카드 quip 이중 렌더 방지 — streams가 있으면 quip은 카드 쪽 소유 */}
        {chat.typing && <TypingCard agentName={agentName} count={chat.activeCount} quip={chat.typingQuip} hideQuip={chat.streams.length > 0} />}
        {chat.streams.map((stream) => <View key={stream.runId} style={styles.reply}>
          <Text style={cardStyles.body}>{stream.text}</Text>
          <Text testID="ai-generated-badge" style={cardStyles.micro}>{t('common.aiGenerated')}</Text>
          <Text style={cardStyles.micro}>{t(stream.done ? 'chat.saving' : stream.quip)}</Text>
        </View>)}
      </View>} />}
    <View style={styles.composer}>
      <TextInput mode="outlined" outlineColor={colors.border} activeOutlineColor={colors.accent} textColor={colors.text1} placeholderTextColor={colors.text3} dense style={styles.body} multiline value={input} onChangeText={setInput} placeholder={t('chat.placeholder')} accessibilityLabel={t('chat.placeholder')} disabled={!root} />
      <Button disabled={!root || !validateMessageInput(input).ok} onPress={() => void send()}>{t('chat.send')}</Button>
    </View>
    {fork && sessionId && <ForkDialog sessionId={sessionId} messageId={fork.id} title={target.sessionTitle || agentName} navigation={navigation} onClose={() => setFork(null)} />}
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  body: { flex: 1, minWidth: 0 },
  refBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, padding: spacing.sp3, borderLeftWidth: spacing.sp1, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceRaise },
  list: { padding: spacing.sp3 },
  reply: { paddingVertical: spacing.sp3, borderBottomWidth: 1, borderColor: colors.border },
  error: { padding: spacing.sp3 },
  errorText: { ...typography.caption, color: colors.statusErr },
  composer: { flexDirection: 'row', alignItems: 'center', padding: spacing.sp2, borderTopWidth: 1, borderColor: colors.border },
});
