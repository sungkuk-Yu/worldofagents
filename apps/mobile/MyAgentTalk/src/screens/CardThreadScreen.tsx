// 스레드는 원본 참조를 고정하고 모든 답변을 같은 폭의 행으로 표시한다.
import React, { useState } from 'react';
import { View, Text, FlatList, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useChatSession } from '../hooks/useChatSession';
import { useCardActions } from '../hooks/useCardActions';
import CardFrame from '../cards/CardFrame';
import ForkDialog from '../components/ForkDialog';
import { TypingCard } from './ChatScreen';
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
export default function CardThreadScreen({ navigation, route }: { navigation: any; route: any }) {
  const { t, i18n } = useTranslation();
  const sessionId = typeof route?.params?.sessionId === 'string' ? route.params.sessionId : undefined;
  const rootMessageId = typeof route?.params?.rootMessageId === 'string' ? route.params.rootMessageId : undefined;
  const presetCategory = route?.params?.presetCategory;
  const agentName = route?.params?.agentName || t('common.agent');
  const chat = useChatSession({ sessionId: rootMessageId ? sessionId : undefined, rootMessageId });
  const [input, setInput] = useState('');
  const [fork, setFork] = useState<ChatMessage | null>(null);
  const { handlers, decorate, actionError } = useCardActions(
    (message) => navigation.push('CardThread', { sessionId, rootMessageId: message.id, agentName, presetCategory, sessionTitle: route?.params?.sessionTitle }),
    setFork,
  );
  const root = chat.rootMessage;
  const meta = segments[root?.dialogueType || ''] ?? { color: colors.accent, key: 'cards.text' };
  const send = async () => {
    if (!validateMessageInput(input).ok) return;
    const draft = input; setInput('');
    const result = await chat.send(draft);
    if (!result.ok) setInput((current) => restoreFailedDraft(current, draft));
  };
  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={cardStyles.row}><Button onPress={() => navigation.goBack()}>{t('common.back')}</Button><Text style={cardStyles.title}>{t('common.thread')}</Text></View>
    {root && <View style={[styles.refBar, { borderLeftColor: meta.color }]}>
      <Text style={[cardStyles.title, { color: meta.color }]}>{t('cards.referenceIcon')}</Text>
      <View style={styles.body}><Text style={cardStyles.micro}>{t(meta.key)}</Text><Text style={cardStyles.title} numberOfLines={2}>{displayValue(root.payload?.title) || root.content}</Text></View>
      <Button onPress={() => setFork(root)} compact>{t('fork.short')}</Button>
    </View>}
    {(chat.error || actionError) && <View style={styles.error} testID="thread-error">
      <Text accessibilityRole="alert" style={styles.errorText}>{t(chat.error || actionError!)}</Text>
      <Button onPress={chat.retryConnection}>{t('common.retry')}</Button>
    </View>}
    {!root && !chat.error && <Text style={cardStyles.micro}>{t('common.loading')}</Text>}
    {root && <FlatList data={chat.messages} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        const date = item.createdAt ? new Date(item.createdAt) : null;
        return <View style={styles.reply}>
          <View style={cardStyles.row}>
            <Text style={[cardStyles.title, { color: item.role === 'user' ? colors.text1 : colors.accent }]}>{item.role === 'user' ? t('chat.me') : agentName}</Text>
            <Text style={cardStyles.micro}>{date && Number.isFinite(date.getTime()) ? formatTime(date, i18n.language) : null}</Text>
            {item.role === 'user' && <Text style={cardStyles.micro}>{t(item.status === 'failed' ? 'chat.failed' : item.pending ? 'chat.sending' : 'chat.sent')}</Text>}
          </View>
          <CardFrame presetCategory={presetCategory} compact message={decorate(item)} handlers={handlers} agentName={agentName} />
          {item.status === 'failed' && <View style={cardStyles.row}>
            <Button onPress={() => void chat.retryMessage(item.id)}>{t('chat.resend')}</Button>
            <Button onPress={() => chat.deleteMessage(item.id)}>{t('chat.delete')}</Button>
          </View>}
        </View>;
      }}
      ListFooterComponent={<View>
        {chat.typing && <TypingCard agentName={agentName} count={chat.activeCount} quip={chat.typingQuip} />}
        {chat.streams.map((stream) => <View key={stream.runId} style={styles.reply}>
          <Text style={cardStyles.body}>{stream.text}</Text>
          <Text testID="ai-generated-badge" style={cardStyles.micro}>{t('common.aiGenerated')}</Text>
          <Text style={cardStyles.micro}>{t(stream.done ? 'chat.saving' : stream.quip)}</Text>
        </View>)}
      </View>} />}
    <View style={styles.composer}>
      <TextInput style={styles.body} multiline value={input} onChangeText={setInput} placeholder={t('chat.placeholder')} accessibilityLabel={t('chat.placeholder')} disabled={!root} />
      <Button disabled={!root || !validateMessageInput(input).ok} onPress={() => void send()}>{t('chat.send')}</Button>
    </View>
    {fork && sessionId && <ForkDialog sessionId={sessionId} messageId={fork.id} title={route?.params?.sessionTitle || agentName} navigation={navigation} onClose={() => setFork(null)} />}
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
