import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
// Screen 2: 텍스트 채팅 (ChatScreen) — Phase 2 채팅 MVP
// 설계 기준: ui-interaction-spec.md 화면 2(메인 채팅) + agenttalk-figma tokens.json v1.1
// 정체성 (대표님 지시 2026-09-25):
//   - 사람↔에이전트 대화 전용. 카카오톡식 좌우 말풍선·읽음확인 금지 → 전폭 사각형 카드 스택
//   - 결과 중심: 에이전트 응답은 뉴런 출처 라벨이 있는 구조화 카드로 렌더
//   - 처리중 상태는 100% 신뢰 가능: typing=true인 동안 카드가 예외 없이 항상 표시됨
//     (useChatSession의 소스 카운터 트래커가 REST/WS 중복 신호에도 상태 소실을 방지)
//   - 지연은 자연어로: 스피너 대신 대화체 quip ("잠깐만요, 생각 중이에요…") + 잔잔한 점 애니메이션
// 디자인 시스템: popular-web-designs/mintlify 패턴 재활용 — 화이트 캔버스, 초박형 테두리 분리,
//   그린 액센트(#00A86B)는 CTA/포커스/라벨에만, 그림자 최소화, 사각 카드(radii.md 8px).
// 컴포넌트: react-native-paper 조립 (Appbar/TextInput/Button/Surface/Text)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
import { colors, radii, spacing, typography } from '../theme';
import { ChatMessage, buildTimeGroups, validateMessageInput, restoreFailedDraft } from '../lib/chatLogic';
import { useChatSession } from '../hooks/useChatSession';

interface Props {
  navigation: any;
  route: any;
}

// ── 메시지 카드 (전폭 사각형 — 좌우 말풍선 아님) ──
function MessageCard({ item, agentName, retry, remove }: { item: ChatMessage; agentName: string; retry: () => void; remove: () => void }) {
  const { t } = useTranslation();
  if (item.role === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{item.content}</Text>
      </View>
    );
  }
  const isUser = item.role === 'user';
  return (
    <Surface
      style={[styles.msgCard, isUser ? styles.msgCardUser : styles.msgCardAgent]}
      elevation={0}
      testID={isUser ? 'message-user' : 'message-agent'}
      accessibilityLabel={t(isUser ? 'chat.userMessage' : 'chat.agentMessage', { agentName, content: item.content })}
    >
      {/* 카드 헤더 — 발신 주체 라벨 (메신저 관습 대신 카드 구조로 구분) */}
      <View style={styles.msgHeader}>
        <Text style={[styles.msgRole, isUser ? styles.msgRoleUser : styles.msgRoleAgent]}>
          {isUser ? t('chat.me') : agentName}
        </Text>
        {isUser && <Text style={styles.pendingMark}>{item.status === 'failed' ? t('chat.failed') : item.status === 'pending' ? t('chat.sending') : t('chat.sent')}</Text>}
      </View>
      <Text style={styles.msgText}>{item.content}</Text>
      {item.status === 'failed' && <View style={styles.msgHeader}>
        <Button onPress={retry} textColor={colors.accent}>{t('chat.resend')}</Button>
        <Button onPress={remove} textColor={colors.text2}>{t('chat.delete')}</Button>
      </View>}
    </Surface>
  );
}

// ── 에이전트 턴 카드 — 같은 턴의 공감+답변을 하나의 결과 카드로 (Codex 리뷰 #4) ──
// 내부 뉴런 이름(공감 에이뉴런 등)은 사용자에게 노출하지 않음: 대화만 시끄러워짐.
// 공감을 카드 상단의 짧은 인사말로, 답변을 본문으로 구조화 = 결과 중심 출력.
function AgentTurnCard({ items, agentName }: { items: ChatMessage[]; agentName: string }) {
  const { t } = useTranslation();
  const empathy = items.find((m) => m.sourceNeuron === 'empathy');
  const body = items.filter((m) => m !== empathy);
  const pending = items.some((m) => m.pending);
  const text = body.map((m) => m.content).join('\n\n');
  return (
    <Surface
      style={[styles.msgCard, styles.msgCardAgent]}
      elevation={0}
      testID="message-agent"
      accessibilityLabel={t('chat.agentMessage', { agentName, content: text })}
    >
      <View style={styles.msgHeader}>
        <Text style={[styles.msgRole, styles.msgRoleAgent]}>{agentName}</Text>
        {pending && <Text style={styles.pendingMark}>{t('chat.sending')}</Text>}
      </View>
      {empathy ? <Text style={styles.empathyText}>{empathy.content}</Text> : null}
      {body.map((m) => (
        <Text key={m.id} style={styles.msgText}>{m.content}</Text>
      ))}
    </Surface>
  );
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

// ── 처리중 카드 — 자연어 quip + 잔잔한 점 3개 (스피너 대신 대화체) ──
// 정체성 규칙: 에이전트가 일하는 동안은 이 카드가 예외 없이 계속 보인다.
function TypingCard({ quip, agentName, count }: { quip: string | null; agentName: string; count: number }) {
  const { t, i18n } = useTranslation();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });

  return (
    <Surface style={[styles.msgCard, styles.msgCardAgent, styles.typingCard]} elevation={0} testID="typing-indicator"
      accessibilityLabel={t('chat.preparing', { agentName })}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.msgHeader}>
        <Text style={[styles.msgRole, styles.msgRoleAgent]}>{agentName}</Text>
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[styles.dot, { opacity: dotOpacity, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.1] }) }] }]}
            />
          ))}
        </View>
      </View>
      {count > 1 && <Text style={styles.typingQuip}>{t('chat.tasks', { countText: formatNumber(count, i18n.language) })}</Text>}
      <Text style={styles.typingQuip}>{t(quip || 'quip.default')}</Text>
    </Surface>
  );
}

export default function ChatScreen({ navigation, route }: Props) {
  const { t, i18n } = useTranslation();
  const agentId: string | undefined = route?.params?.agentId;
  const presetTitleKey = route?.params?.presetTitleKey;
  const agentName: string = presetTitleKey && i18n.exists(presetTitleKey) ? t(presetTitleKey) : route?.params?.agentName || t('common.agent');
  const initialSessionId: string | undefined = route?.params?.sessionId;

  const {
    messages,
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
  } = useChatSession({ sessionId: initialSessionId ?? null, agentId: agentId ?? null });

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
  const subtitle = {
    connecting: t('chat.connecting'), live: t('chat.live'), reconnecting: t('chat.reconnecting'), offline: t('chat.offline'),
  }[connection];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingBottom: viewportInset }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* 커스텀 헤더 — 웹 export에서 Paper Appbar 아이콘 글리프 깨짐 방지 (다른 화면과 동일한 ← 텍스트 패턴) */}
      <View style={styles.appbar} testID="chat-appbar">
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel={t('common.back')}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.appbarTitle} numberOfLines={1}>{agentName}</Text>
          <Text
            style={[styles.appbarSubtitle, { color: isDemo ? colors.statusWarn : connectionColor }]}
            numberOfLines={1}
            testID="chat-status-line"
          >
            ● {subtitle}
          </Text>
        </View>

      </View>

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
          {item.role === 'agent' ? <AgentTurnCard items={item.items} agentName={agentName} />
            : <MessageCard item={item.items[0]} agentName={agentName}
                retry={() => { void retryMessage(item.key).then((result) => { if (!result.ok) setInput((current) => restoreFailedDraft(current, item.items[0].draft ?? item.items[0].content)); }); }}
                remove={() => deleteMessage(item.key)} />}
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
    fontSize: typography.headline.fontSize,
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
    fontSize: typography.headline.fontSize,
    fontWeight: '600',
    color: colors.text1,
    letterSpacing: -0.2,
  },
  appbarSubtitle: {
    fontSize: typography.micro.fontSize,
    fontWeight: '500',
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
    fontSize: typography.micro.fontSize,
    fontWeight: '700',
    color: colors.statusWarn,
    letterSpacing: 0.6,
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
    fontSize: typography.caption.fontSize,
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
    fontSize: typography.caption.fontSize,
    color: colors.statusErr,
    fontWeight: '600',
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
  msgCardUser: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
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
    minWidth: 0,
    flexShrink: 1,
    fontSize: typography.micro.fontSize,
    fontWeight: '700',
    letterSpacing: 0.5,
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
    fontSize: typography.micro.fontSize,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 0.3,
  },
  pendingMark: {
    minWidth: 0,
    flexShrink: 1,
    marginLeft: 'auto',
    fontSize: typography.micro.fontSize,
    color: colors.text3,
  },
  msgText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.text1,
  },
  empathyText: {
    fontSize: typography.body.fontSize,
    color: colors.text2,
    fontStyle: 'italic',
    lineHeight: typography.bodyBold.lineHeight,
    marginBottom: spacing.sp1,
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: spacing.sp1,
  },
  systemText: {
    fontSize: typography.caption.fontSize,
    color: colors.statusErr,
    backgroundColor: colors.surfaceRaise,
    paddingHorizontal: spacing.sp2,
    paddingVertical: spacing.sp1,
    borderRadius: radii.xs,
    overflow: 'hidden',
  },
  typingCard: {
    borderColor: colors.border,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp1,
  },
  dot: {
    width: spacing.sp1,
    height: spacing.sp1,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  typingQuip: {
    fontSize: typography.subhead.fontSize,
    color: colors.text2,
    lineHeight: typography.subhead.lineHeight,
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
    fontSize: typography.title2.fontSize,
    fontWeight: '700',
    color: colors.text1,
    marginBottom: spacing.sp2,
    letterSpacing: -0.24,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: typography.subhead.fontSize,
    color: colors.text3,
    textAlign: 'center',
    lineHeight: typography.subhead.lineHeight,
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
    minWidth: 0,
    flexShrink: 1,
    flex: 1,
    backgroundColor: colors.surface,
    fontSize: typography.body.fontSize,
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
    minWidth: 0,
    flexShrink: 1,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '600',
    letterSpacing: 0,
  },
});
