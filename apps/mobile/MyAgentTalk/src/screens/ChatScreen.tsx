import CardFrame from '../cards/CardFrame';
import ForkDialog from '../components/ForkDialog';
import ThreadSheet, { ThreadSheetHandle } from '../components/ThreadSheet';
import TypingCard from '../components/TypingCard';
import { useCardActions } from '../hooks/useCardActions';
import { parseForkOrigin } from '../lib/cardLogic';
import { api } from '../lib/api';
import type { ForkOrigin } from '../types';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
// Screen 2: 텍스트 채팅 (ChatScreen) — Phase 2 채팅 MVP
// 설계 기준: ui-interaction-spec.md 화면 2(메인 채팅) + agenttalk-figma tokens.json v1.1
// 정체성 (대표님 지시 2026-09-25):
//   - 사람↔에이전트 대화 전용. 카카오톡식 좌우 말풍선·읽음확인 금지 → 전폭 사각형 카드 스택
//   - 결과 중심: 에이전트 응답은 유형별 기능과 공통 액션이 있는 구조화 카드로 렌더
//   - 처리중 상태는 100% 신뢰 가능: typing=true인 동안 카드가 예외 없이 항상 표시됨
//     (useChatSession의 소스 카운터 트래커가 REST/WS 중복 신호에도 상태 소실을 방지)
//   - 지연은 자연어로: 스피너 대신 대화체 quip ("잠깐만요, 생각 중이에요…") + 잔잔한 점 애니메이션
// 디자인 시스템: popular-web-designs/mintlify 패턴 재활용 — 화이트 캔버스, 초박형 테두리 분리,
//   그린 액센트(#00A86B)는 CTA/포커스/라벨에만, 그림자 최소화, 사각 카드(radii.md 8px).
// 컴포넌트: react-native-paper 조립 (Appbar/TextInput/Button/Surface/Text)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  NativeSyntheticEvent, NativeScrollEvent,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Button,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { colors, radii, spacing, typography, webScreenMotion } from '../theme';
import { ChatMessage, buildTimeGroups, validateMessageInput, restoreFailedDraft } from '../lib/chatLogic';
import { useChatSession } from '../hooks/useChatSession';

interface Props {
  navigation: any;
  route: any;
}

// 같은 turnIndex 의 연속 에이전트 메시지를 하나의 턴 카드로 그룹
interface TurnGroup {
  key: string;
  role: 'user' | 'system' | 'agent';
  items: ChatMessage[];
}

function groupByTurn(messages: ChatMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (m.role === 'agent' && last && last.role === 'agent' && (m.runId ? last.items[0].runId === m.runId : last.items[0].turnIndex === m.turnIndex)) {
      last.items.push(m);
    } else {
      groups.push({ key: m.id, role: m.role, items: [m] });
    }
  }
  return groups;
}

export default function ChatScreen({ navigation, route }: Props) {
  const { t, i18n } = useTranslation();
  const agentId: string | undefined = route?.params?.agentId;
  const [presetCategory, setPresetCategory] = useState<string | undefined>(route?.params?.presetCategory);
  const presetTitleKey = route?.params?.presetTitleKey;
  const agentName: string = presetTitleKey && i18n.exists(presetTitleKey) ? t(presetTitleKey) : route?.params?.agentName || t('common.agent');
  const initialSessionId: string | undefined = route?.params?.sessionId;

  const {
    messages, sessionId, enterDemo,
    typing,
    typingQuip,
    isDemo,
    error,
    hasMoreHistory,
    loadingHistory,
    ready,
    send,
    loadOlder,
    retryLastSend,
    connection, activeCount, streams, retryConnection, retryMessage, deleteMessage,
  } = useChatSession({ sessionId: initialSessionId ?? null, agentId: agentId ?? null, deferConnection: !!route?.params?.demo });

  useEffect(() => { if (route?.params?.demo) enterDemo(); }, [route?.params?.demo, enterDemo]);
  const [forkMessage, setForkMessage] = useState<ChatMessage | null>(null);
  const [origin, setOrigin] = useState<ForkOrigin | undefined>(() => parseForkOrigin(route?.params?.forkedFrom));
  const sessionTitle = route?.params?.sessionTitle || agentName;
  const [unavailableError, setUnavailableError] = useState<string | null>(null);
  // #52: 스레드는 라우트 push 대신 바텀시트 디텐트(25/50/90%)로 열기 — Apple 지도 카드 시트 패턴
  const threadSheet = useRef<ThreadSheetHandle>(null);
  const { handlers, decorate, actionError } = useCardActions(
    (message) => {
      if (isDemo || !sessionId || message.pending || message.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
      threadSheet.current?.open({ sessionId, rootMessageId: message.id, agentName, sessionTitle, presetCategory });
    },
    (message) => {
      if (isDemo || !sessionId || message.pending || message.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
      setForkMessage(message);
    },
  );
  useEffect(() => {
    let active = true;
    if (sessionId && !isDemo) void api.getSession(sessionId).then((env) => {
      const parsed = parseForkOrigin(env.data?.forked_from);
      if (active && parsed) setOrigin(parsed);
      if (env.data?.agent_id) {
        return api.listAgents().then((agents) => {
          if (active) setPresetCategory(agents.data?.find((agent) => agent.id === env.data?.agent_id)?.preset?.category);
        });
      }
    }).catch(() => { /* 선택적 계보 필드 미지원은 기존 대화를 막지 않는다. */ });
    return () => { active = false; };
  }, [sessionId, isDemo]);

  const [input, setInput] = useState('');
  const [sendFailed, setSendFailed] = useState(false);
  const listRef = useRef<FlatList<TurnGroup>>(null);

  const submit = useCallback(() => {
    const validation = validateMessageInput(input);
    if (!validation.ok) return;
    const text = input;
    setInput('');
    setSendFailed(false);
    void send(text).then((res) => {
      if (!res.ok) {
        // 실패 시 입력 원문 복원 (Codex 리뷰 #2 — 초안 보존) + 재시도 UI
        setInput((current) => restoreFailedDraft(current, text));
        setSendFailed(true);
      } else {
        // 햅틱 (#52 규칙 4): 전송 성공 = light impact — 이 3곳 외 남용 금지
        try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); } catch { /* web no-op */ }
      }
    });
  }, [input, send]);

  const retry = useCallback(() => {
    setSendFailed(false);
    void retryLastSend().then((res) => {
      if (!res.ok) setSendFailed(true);
    });
  }, [retryLastSend]);

  const nearBottom = useRef(true);
  const offset = useRef(0);
  const layouts = useRef(new Map<string, { y: number; height: number }>());
  const prependAnchor = useRef<{ id: string; relative: number; y: number } | null>(null);
  const [unseen, setUnseen] = useState(0);
  const previousMessages = useRef<ChatMessage[]>([]);
  const groups = useMemo(() => groupByTurn(messages), [messages]);
  const times = useMemo(() => new Map(buildTimeGroups(messages, i18n.language).map((g) => [g.id, g.label])), [messages, i18n.language]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    offset.current = contentOffset.y;
    nearBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y <= 80;
    if (nearBottom.current) setUnseen(0);
  }, []);
  useEffect(() => {
    const previous = previousMessages.current;
    previousMessages.current = messages;
    const ids = new Set(previous.map((m) => m.id));
    const tail = previous[previous.length - 1];
    const added = messages.filter((m) => !ids.has(m.id) && (!tail || m.turnIndex >= tail.turnIndex)).length;
    if (!nearBottom.current && added) {
      // 목록 변경으로 새 메시지 알림 수를 동기화한다.
      setUnseen((count) => count + added);
    }
  }, [messages]);
  const jumpToEnd = useCallback(() => {
    nearBottom.current = true; setUnseen(0);
    listRef.current?.scrollToEnd({ animated: true });
  }, []);
  const loadHistory = useCallback(async () => {
    if (loadingHistory) return;
    const anchor = groups.find((g) => {
      const layout = layouts.current.get(g.key);
      return layout && layout.y + layout.height >= offset.current;
    });
    if (anchor && Platform.OS === 'web') {
      prependAnchor.current = { id: anchor.key, relative: layouts.current.get(anchor.key)!.y - offset.current, y: layouts.current.get(anchor.key)!.y };
    }
    nearBottom.current = false;
    await loadOlder();
  }, [groups, loadOlder, loadingHistory]);
  const renderCell = useCallback(({ children, onLayout, item, style, onFocusCapture }: React.ComponentProps<NonNullable<React.ComponentProps<typeof FlatList<TurnGroup>>['CellRendererComponent']>>) => <View style={style} {...{ onFocusCapture }} onLayout={(event) => {
          onLayout?.(event);
          const id = item.key;
          const layout = event.nativeEvent.layout;
          layouts.current.set(id, { y: layout.y, height: layout.height });
          const anchor = prependAnchor.current;
          if (anchor?.id === id && layout.y !== anchor.y) {
            prependAnchor.current = null;
            listRef.current?.scrollToOffset({ offset: Math.max(0, layout.y - anchor.relative), animated: false });
          }
        }}>{children}</View>, []);

  const [viewportInset, setViewportInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setViewportInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, []);

  const renderFooter = useCallback(() => <View>
    {typing && <TypingCard quip={typingQuip} agentName={agentName} count={activeCount} />}
    {streams.map((stream) => <Surface key={stream.runId} style={[styles.msgCard, styles.msgCardAgent]} elevation={0}>
      <Text style={styles.msgRoleAgent}>{agentName}</Text>
      <Text style={styles.msgText}>{stream.text}</Text>
      <Text testID="ai-generated-badge" style={styles.pendingMark}>{t('common.aiGenerated')}</Text>
      <Text style={styles.typingQuip}>{t(stream.done ? 'chat.saving' : stream.quip)}</Text>
    </Surface>)}
  </View>, [typing, typingQuip, agentName, activeCount, streams, t]);

  const renderHeader = useCallback(() => {
    if (!hasMoreHistory || isDemo) return <View style={{ height: spacing.sp2 }} />;
    return (
      <View style={styles.loadMoreWrap}>
        <Button mode="text" onPress={() => void loadHistory()} disabled={loadingHistory} testID="load-older" textColor={colors.text2}>
          {loadingHistory ? t('common.loading') : t('chat.history')}
        </Button>
      </View>
    );
  }, [hasMoreHistory, isDemo, loadHistory, loadingHistory, t]);

  // 앱바 서브타이틀 — 에이전트를 "살아있는 존재"로: 처리 중이면 자연어 상태를 그대로 노출
  const connectionColor = connection === 'live' ? colors.accent : connection === 'offline' ? colors.statusErr : colors.statusWarn;
  const subtitle = isDemo ? t('chat.demoSubtitle') : {
    connecting: t('chat.connecting'), live: t('chat.live'), reconnecting: t('chat.reconnecting'), offline: t('chat.offline'),
  }[connection];

  return (
    <KeyboardAvoidingView
      style={[styles.container, webScreenMotion('mat-slide-from-right'), { paddingBottom: viewportInset }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* 커스텀 헤더 — 웹 export에서 Paper Appbar 아이콘 글리프 깨짐 방지 (다른 화면과 동일한 ← 텍스트 패턴) */}
      <View style={styles.appbar} testID="chat-appbar">
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel={t('common.back')}>
          <Text style={styles.backText}>{t('common.backIcon')}</Text>
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.appbarTitle} numberOfLines={1}>{sessionTitle}</Text>
          <Text
            style={[styles.appbarSubtitle, { color: isDemo ? colors.statusWarn : connectionColor }]}
            numberOfLines={1}
            testID="chat-status-line"
          >
            {t('chat.statusIndicator', { status: subtitle })}
          </Text>
        </View>

      </View>

      {isDemo && <Text testID="demo-badge" style={styles.pendingMark}>{t('chat.demoBadge')}</Text>}
      {origin && <Text style={styles.pendingMark} numberOfLines={1}>{t('fork.lineage', { origin: origin.title || t('fork.original') })}</Text>}
      {(actionError || unavailableError) && <Text accessibilityRole="alert" style={styles.errorText}>{t(actionError || unavailableError!)}</Text>}
      {forkMessage && sessionId && <ForkDialog sessionId={sessionId} messageId={forkMessage.id} title={sessionTitle} navigation={navigation} onClose={() => setForkMessage(null)} />}
      {error && (
        <View style={styles.errorBar} testID="error-bar">
          <Text style={styles.errorText}>{t(error)}</Text>
          {connection === 'offline' && <><Button onPress={retryConnection} textColor={colors.accent}>{t('common.retry')}</Button></>}
          {sendFailed && (
            <TouchableOpacity onPress={retry} style={styles.retryButton} testID="retry-send">
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={groups}
        renderItem={({ item }) => <View>
          {times.get(item.key) && <Text style={styles.pendingMark}>{times.get(item.key)}</Text>}
          {item.items.map((message) => <View key={message.id}>
            <CardFrame presetCategory={presetCategory} message={decorate(message)} handlers={handlers} agentName={agentName} />
            {message.role === 'user' && <Text style={styles.pendingMark}>{t(message.status === 'failed' ? 'chat.failed' : message.pending ? 'chat.sending' : 'chat.sent')}</Text>}
            {message.status === 'failed' && <View style={styles.msgHeader}>
              <Button onPress={() => { void retryMessage(message.id).then((result) => { if (!result.ok) setInput((current) => restoreFailedDraft(current, message.draft ?? message.content)); }); }}>{t('chat.resend')}</Button>
              <Button onPress={() => deleteMessage(message.id)}>{t('chat.delete')}</Button>
            </View>}
          </View>)}
        </View>}
        CellRendererComponent={renderCell}
        onScrollBeginDrag={() => { prependAnchor.current = null; }}
        onScroll={onScroll}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={Platform.OS === 'web' ? undefined : { minIndexForVisible: 0 }}
        onContentSizeChange={() => { if (nearBottom.current && !loadingHistory) listRef.current?.scrollToEnd({ animated: false }); }}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        onEndReachedThreshold={0.1}
        testID="message-list"
        ListEmptyComponent={
          error && connection === 'offline' ? <View style={styles.empty}>
            <Text style={styles.errorText}>{t(error)}</Text>
            <Button onPress={retryConnection} textColor={colors.accent}>{t('common.retry')}</Button>

          </View> : ready && !loadingHistory ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t('chat.greeting', { agentName })}</Text>
              <Text style={styles.emptySub}>{t('chat.help')}</Text>
              <Text style={styles.pendingMark}>{t('chat.aiNotice')}</Text>
            </View>
          ) : null
        }
      />

      {unseen > 0 && <Button onPress={jumpToEnd} textColor={colors.accent} style={styles.msgCard}>{t('chat.unseen', { countText: formatNumber(unseen, i18n.language) })}</Button>}
      {input.trim().length > 4000 && <Text style={styles.errorText}>{t('errors.tooLong', { limit: formatNumber(4000, i18n.language) })}</Text>}
      {/* 하단 입력 영역 — 화이트 배경 + 초박형 상단 테두리, 그린 포커스 (Mintlify 패턴) */}
      <View style={styles.inputBar}>
        <TextInput
          mode="outlined"
          value={input}
          onChangeText={setInput}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={colors.text3}
          style={styles.textInput}
          outlineColor={colors.border}
          activeOutlineColor={colors.accent}
          textColor={colors.text1}
          dense
          multiline={false}
          testID="chat-input"
          onSubmitEditing={submit}
          returnKeyType="send"
          accessibilityLabel={t('chat.input')}
        />
        <Button
          mode="contained"
          onPress={submit}
          disabled={!validateMessageInput(input).ok}
          buttonColor={colors.accent}
          textColor={colors.onPrimary}
          style={styles.sendButton}
          contentStyle={styles.sendContent}
          labelStyle={styles.sendLabel}
          testID="send-button"
          accessibilityLabel={t('chat.sendLabel')}
        >
          {t('chat.send')}
        </Button>
      </View>
      {/* #52: 스레드 바텀시트 — 카드 탭 시 디텐트 시트로 열림 (전체 화면 라우트 아님) */}
      <ThreadSheet ref={threadSheet} navigation={navigation} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sp2,
    paddingTop: spacing.sp3,
    paddingBottom: spacing.sp2,
  },
  backButton: {
    width: spacing.sp10,
    height: spacing.sp10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    ...typography.headline,
    color: colors.text1,
  },
  headerBody: {
    minWidth: 0,
    flexShrink: 1,
    flex: 1,
    marginLeft: spacing.sp1,
    marginRight: spacing.sp2,
  },
  appbarTitle: {
    ...typography.headline,
    letterSpacing: -0.2,
    color: colors.text1,
  },
  appbarSubtitle: {
    ...typography.micro,
    marginTop: spacing.sp1,
  },
  demoBadge: {
    backgroundColor: colors.surfaceRaise,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    marginRight: spacing.sp3,
  },
  demoBadgeText: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.statusWarn,
  },
  errorBar: {
    flexWrap: 'wrap',
    backgroundColor: colors.surfaceRaise,
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp2,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceRaise,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sp2,
  },
  errorText: {
    ...typography.caption,
    color: colors.statusErr,
    flex: 1,
  },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.statusErr,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp1,
  },
  retryText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.statusErr,
  },
  listContent: {
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp3,
    gap: spacing.sp2,
    flexGrow: 1,
  },
  // 전폭 사각형 카드 스택 — 메신저 말풍선 관습(좌우 배치) 배제
  msgCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sp3,
    paddingVertical: spacing.sp3,
  },
  msgCardAgent: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  msgHeader: {
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
    marginBottom: spacing.sp1,
  },
  msgRole: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.5,
    minWidth: 0,
    flexShrink: 1,
  },
  msgRoleUser: {
    color: colors.accent,
  },
  msgRoleAgent: {
    color: colors.text2,
  },
  neuronChip: {
    minWidth: 0,
    flexShrink: 1,
    backgroundColor: colors.border,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
  },
  neuronChipText: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: colors.accent,
  },
  pendingMark: {
    ...typography.micro,
    minWidth: 0,
    flexShrink: 1,
    marginLeft: 'auto',
    color: colors.text3,
  },
  msgText: {
    ...typography.body,
    color: colors.text1,
  },
  empathyText: {
    ...typography.body,
    lineHeight: typography.bodyBold.lineHeight,
    color: colors.text2,
    fontStyle: 'italic',
    marginBottom: spacing.sp1,
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: spacing.sp1,
  },
  systemText: {
    ...typography.caption,
    color: colors.statusErr,
    backgroundColor: colors.surfaceRaise,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    borderRadius: radii.xs,
    overflow: 'hidden',
  },
  typingQuip: {
    ...typography.subhead,
    color: colors.text2,
    fontStyle: 'italic',
  },
  loadMoreWrap: {
    alignItems: 'center',
    paddingVertical: spacing.sp1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sp10,
    paddingHorizontal: spacing.sp8,
  },
  emptyTitle: {
    ...typography.title2,
    letterSpacing: -0.24,
    color: colors.text1,
    marginBottom: spacing.sp2,
    textAlign: 'center',
  },
  emptySub: {
    ...typography.subhead,
    color: colors.text3,
    textAlign: 'center',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
    paddingHorizontal: spacing.sp3,
    paddingTop: spacing.sp2,
    paddingBottom: Platform.OS === 'ios' ? spacing.sp4 : spacing.sp3,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  textInput: {
    ...typography.body,
    minWidth: 0,
    flexShrink: 1,
    flex: 1,
    backgroundColor: colors.surface,
    maxHeight: spacing.sp6 * 2,
    borderRadius: radii.md,
  },
  sendButton: {
    minWidth: 0,
    flexShrink: 1,
    borderRadius: radii.md,
    minHeight: spacing.sp10 + spacing.sp1,
  },
  sendContent: {
    paddingHorizontal: spacing.sp3,
  },
  sendLabel: {
    ...typography.bodyBold,
    letterSpacing: 0,
    minWidth: 0,
    flexShrink: 1,
  },
});
