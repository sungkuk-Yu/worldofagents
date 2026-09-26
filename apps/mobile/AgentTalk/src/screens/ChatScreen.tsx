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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
import { ChatMessage } from '../types';
import { useChatSession } from '../hooks/useChatSession';

interface Props {
  navigation: any;
  route: any;
}

// 뉴런 라벨 (source_neuron → 표시명) — 백엔드 protocol.ts NEURON_NAMES 대응
const NEURON_LABEL: Record<string, string> = {
  empathy: '공감 에이뉴런',
  answer: '답변생성 에이뉴런',
  visual: '비주얼 에이뉴런',
  queue: '큐 에이뉴런',
};

// ── 메시지 카드 (전폭 사각형 — 좌우 말풍선 아님) ──
function MessageCard({ item, agentName }: { item: ChatMessage; agentName: string }) {
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
      accessibilityLabel={`${isUser ? '내가 보낸 메시지' : `${agentName}의 응답`}: ${item.content}`}
    >
      {/* 카드 헤더 — 발신 주체 라벨 (메신저 관습 대신 카드 구조로 구분) */}
      <View style={styles.msgHeader}>
        <Text style={[styles.msgRole, isUser ? styles.msgRoleUser : styles.msgRoleAgent]}>
          {isUser ? '나' : agentName}
        </Text>
        {!isUser && item.sourceNeuron && (
          <View style={styles.neuronChip}>
            <Text style={styles.neuronChipText}>{NEURON_LABEL[item.sourceNeuron] || item.sourceNeuron}</Text>
          </View>
        )}
        {item.pending && <Text style={styles.pendingMark}>전송 중…</Text>}
      </View>
      <Text style={styles.msgText}>{item.content}</Text>
    </Surface>
  );
}

// ── 처리중 카드 — 자연어 quip + 잔잔한 점 3개 (스피너 대신 대화체) ──
// 정체성 규칙: 에이전트가 일하는 동안은 이 카드가 예외 없이 계속 보인다.
function TypingCard({ quip, agentName }: { quip: string | null; agentName: string }) {
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
      accessibilityLabel={`${agentName}이(가) 응답을 준비하고 있습니다`}
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
      <Text style={styles.typingQuip}>{quip || '잠깐만요, 생각 중이에요…'}</Text>
    </Surface>
  );
}

export default function ChatScreen({ navigation, route }: Props) {
  const agentId: string | undefined = route?.params?.agentId;
  const agentName: string = route?.params?.agentName || '에이전트';
  const initialSessionId: string | undefined = route?.params?.sessionId;

  const {
    sessionId,
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
  } = useChatSession({ sessionId: initialSessionId ?? null, agentId: agentId ?? null });

  const [input, setInput] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void send(text);
  }, [input, send]);

  // 새 메시지/typing 도착 시 최하단 스크롤
  useEffect(() => {
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(t);
  }, [messages.length, typing]);

  const renderFooter = useCallback(() => {
    // 처리중 카드 — typing=true인 동안 항상 렌더 (100% 신뢰 규칙)
    if (!typing) return null;
    return <TypingCard quip={typingQuip} agentName={agentName} />;
  }, [typing, typingQuip, agentName]);

  const renderHeader = useCallback(() => {
    if (!hasMoreHistory || isDemo) return <View style={{ height: spacing.sp2 }} />;
    return (
      <View style={styles.loadMoreWrap}>
        <Button mode="text" onPress={() => void loadOlder()} disabled={loadingHistory} testID="load-older" textColor={colors.text2}>
          {loadingHistory ? '불러오는 중…' : '이전 대화 보기'}
        </Button>
      </View>
    );
  }, [hasMoreHistory, isDemo, loadOlder, loadingHistory]);

  // 앱바 서브타이틀 — 에이전트를 "살아있는 존재"로: 처리 중이면 자연어 상태를 그대로 노출
  const subtitle = isDemo
    ? '데모 모드 — 백엔드 미연결'
    : typing
    ? (typingQuip || '응답 준비 중…')
    : sessionId
    ? `${agentName}이(가) 듣고 있어요 · 세션 ${sessionId.slice(0, 8)}`
    : ready
    ? '연결됨'
    : '연결 중…';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* 커스텀 헤더 — 웹 export에서 Paper Appbar 아이콘 글리프 깨짐 방지 (다른 화면과 동일한 ← 텍스트 패턴) */}
      <View style={styles.appbar} testID="chat-appbar">
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="뒤로 가기">
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.appbarTitle} numberOfLines={1}>{agentName}</Text>
          <Text
            style={[styles.appbarSubtitle, { color: isDemo ? colors.statusWarn : typing ? colors.accent : colors.text3 }]}
            numberOfLines={1}
            testID="chat-status-line"
          >
            {subtitle}
          </Text>
        </View>
        {isDemo && (
          <Surface style={styles.demoBadge} elevation={0}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
          </Surface>
        )}
      </View>

      {error && !typing && (
        <View style={styles.errorBar} testID="error-bar">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        renderItem={({ item }) => <MessageCard item={item} agentName={agentName} />}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        onEndReachedThreshold={0.1}
        testID="message-list"
        ListEmptyComponent={
          ready && !loadingHistory ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{`안녕하세요, ${agentName}이에요`}</Text>
              <Text style={styles.emptySub}>무엇을 도와드릴까요? 아래에 적어 보내주시면 바로 살펴볼게요.</Text>
            </View>
          ) : null
        }
      />

      {/* 하단 입력 영역 — 화이트 배경 + 초박형 상단 테두리, 그린 포커스 (Mintlify 패턴) */}
      <View style={styles.inputBar}>
        <TextInput
          mode="outlined"
          value={input}
          onChangeText={setInput}
          placeholder="에이전트에게 메시지 보내기…"
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
          accessibilityLabel="메시지 입력창"
        />
        <Button
          mode="contained"
          onPress={submit}
          disabled={!input.trim()}
          buttonColor={colors.accent}
          textColor={colors.onPrimary}
          style={styles.sendButton}
          contentStyle={styles.sendContent}
          labelStyle={styles.sendLabel}
          testID="send-button"
          accessibilityLabel="메시지 전송"
        >
          전송
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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    fontSize: 20,
    color: colors.text1,
  },
  headerBody: {
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
    marginTop: 1,
  },
  demoBadge: {
    backgroundColor: 'rgba(217,119,6,0.12)',
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sp2,
    paddingVertical: 2,
    marginRight: spacing.sp3,
  },
  demoBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.statusWarn,
    letterSpacing: 0.6,
  },
  errorBar: {
    backgroundColor: 'rgba(220,38,38,0.08)',
    paddingHorizontal: spacing.sp4,
    paddingVertical: spacing.sp2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(220,38,38,0.2)',
  },
  errorText: {
    fontSize: typography.caption.fontSize,
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
    paddingVertical: spacing.sp2 + 2,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sp2,
    marginBottom: spacing.sp1,
  },
  msgRole: {
    fontSize: 10,
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
    backgroundColor: 'rgba(0,168,107,0.08)',
    borderRadius: radii.xs,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  neuronChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 0.3,
  },
  pendingMark: {
    marginLeft: 'auto',
    fontSize: 10,
    color: colors.text3,
  },
  msgText: {
    fontSize: typography.body.fontSize,
    lineHeight: 22,
    color: colors.text1,
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: spacing.sp1,
  },
  systemText: {
    fontSize: typography.caption.fontSize,
    color: colors.statusErr,
    backgroundColor: 'rgba(220,38,38,0.06)',
    paddingHorizontal: spacing.sp2,
    paddingVertical: 3,
    borderRadius: radii.xs,
    overflow: 'hidden',
  },
  typingCard: {
    borderColor: 'rgba(0,168,107,0.35)',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  typingQuip: {
    fontSize: typography.subhead.fontSize,
    color: colors.text2,
    lineHeight: 19,
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
    paddingTop: 100,
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
    lineHeight: 19,
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
    flex: 1,
    backgroundColor: colors.surface,
    fontSize: typography.body.fontSize,
    maxHeight: 48,
    borderRadius: radii.md,
  },
  sendButton: {
    borderRadius: radii.md,
    height: 44,
  },
  sendContent: {
    paddingHorizontal: spacing.sp3,
  },
  sendLabel: {
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '600',
    letterSpacing: 0,
  },
});
