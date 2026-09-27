import CardFrame from '../cards/CardFrame';
import ForkDialog from '../components/ForkDialog';
import ThreadSheet, { ThreadSheetHandle } from '../components/ThreadSheet';
import TypingCard from '../components/TypingCard';
import PttBannerComponent from '../components/PttBanner';
import DevicePresenceBadge from '../components/DevicePresenceBadge';
import ContextPanel from '../components/ContextPanel';
import { useCardActions } from '../hooks/useCardActions';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { useLayout } from '../hooks/useLayout';
import { getPttKey, getPttMode } from '../lib/userPrefs';
import { pttKeyLabel } from '../lib/pttLogic';
import { inspectStore } from '../lib/inspectStore';
import { parseForkOrigin, canForkAgent } from '../lib/cardLogic';
import { api } from '../lib/api';
import { useAttachments } from '../hooks/useAttachments';
import PhotoEditorSheet, { PhotoEditResult } from '../components/PhotoEditorSheet';
import { pickImages, measureImage } from '../lib/imagePicker';
import { errorKey } from '../lib/errorKeys';
import { AttachmentChipRow } from '../components/AttachmentChips';
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
  Pressable,
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
import { colors, radii, spacing, typography, webScreenMotion, iconSize } from '../theme';
import { PaperclipIcon, QueuePendingIcon, QueueAnsweredIcon, QueueSkippedIcon } from '../components/Icon';
import { ChatMessage, buildTimeGroups, validateMessageInput, restoreFailedDraft, queueItemForMessage, SuggestedQuestion, buildQueueStrip } from '../lib/chatLogic';
import QueueStrip from '../components/QueueStrip';
import ThreadListModal from '../components/ThreadListModal';
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
  // 갈라내기(fork) = 김비서 room 전용 (대표님 지시 9/27, t_55f9ed57). 세션 진입 경로가 다양해
  // (딥링크·즐겨찾기·이어보기) route 파라 대신 아래 effect에서 서버 에이전트 행으로 확정한다.
  const [canFork, setCanFork] = useState(() => canForkAgent({ name: route?.params?.agentName, titleKey: presetTitleKey, category: route?.params?.presetCategory }));
  const initialSessionId: string | undefined = route?.params?.sessionId;
  // 즐겨찾기 딥링크 (Wave1): focusMessageId로 진입 → 해당 메시지까지 스크롤 + 하이라이트 1회
  const focusMessageId: string | undefined = route?.params?.focusMessageId;
  // 상단 큐 스트립 칩 탭 점프 (t_2f45ccb1) — 라우트 파라 대신 로컬 상태(같은 화면 내 스크롤만).
  // nonce로 같은 칩 재탭에도 효과 재발동(스크롤 재실행).
  const [queueJump, setQueueJump] = useState<{ id: string; nonce: number } | null>(null);

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
    peers, talking, talk, queue, suggested, threads,
  } = useChatSession({
    sessionId: initialSessionId ?? null, agentId: agentId ?? null, deferConnection: !!route?.params?.demo,
    // 즐겨찾기 2탭 실시간 동기화 (t_b89df485): favorite.updated → useCardActions.local 반영.
    // 카드 훅이 아래에서 생성되므로 ref 우회로 최신 구현체를 쓴다 (WS 수신은 항상 렌더 이후).
    onFavoriteUpdated: (messageId, favorite) => favoriteSyncRef.current?.(messageId, favorite),
  });

  // PTT (t_eded715c): PC 웹 키보드(V 등 재매핑 가능) + 웹 모바일 터치 홀드 겸용.
  // 네이티브에서는 enabled=false — 조이스틱 롱프레스 경로(VoiceHome)가 음성 입력을 담당.
  const { pc, wide } = useLayout();
  const ptt = usePushToTalk(talk, { active: Platform.OS === 'web' && !isDemo });

  useEffect(() => { if (route?.params?.demo) enterDemo(); }, [route?.params?.demo, enterDemo]);
  const [forkMessage, setForkMessage] = useState<ChatMessage | null>(null);
  const [origin, setOrigin] = useState<ForkOrigin | undefined>(() => parseForkOrigin(route?.params?.forkedFrom));
  const sessionTitle = route?.params?.sessionTitle || agentName;
  const [unavailableError, setUnavailableError] = useState<string | null>(null);
  // #52: 스레드는 라우트 push 대신 바텀시트 디텐트(25/50/90%)로 열기 — Apple 지도 카드 시트 패턴
  const threadSheet = useRef<ThreadSheetHandle>(null);
  const { handlers, decorate, actionError, syncFavorite } = useCardActions(
    (message) => {
      if (isDemo || !sessionId || message.pending || message.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
      inspectStore.set(message.id); // PC 컨텍스트 패널 인스펙터 — 지금 열어본 카드를 우측에 상시 비춤
      threadSheet.current?.open({ sessionId, rootMessageId: message.id, agentName, sessionTitle, presetCategory, canFork });
    },
    (message) => {
      if (isDemo || !sessionId || message.pending || message.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
      setForkMessage(message);
    },
    // Wave 1 #1: form 카드 제출 — 데모/미연결에서는 send가 거절되어 false 반환(카드가 잠기지 않음)
    (content) => (isDemo ? Promise.resolve({ ok: false, error: 'errors.unavailableAction' }) : send(content)),
  );
  // favorite.updated WS 수신 → 카드 local 상태 반영 (t_b89df485). 훅 생성 후 ref에 연결한다.
  const favoriteSyncRef = useRef<((messageId: string, favorite: boolean) => void) | null>(null);
  favoriteSyncRef.current = syncFavorite;
  useEffect(() => {
    let active = true;
    if (sessionId && !isDemo) void api.getSession(sessionId).then((env) => {
      const parsed = parseForkOrigin(env.data?.forked_from);
      if (active && parsed) setOrigin(parsed);
      if (env.data?.agent_id) {
        return api.listAgents().then((agents) => {
          if (!active) return;
          const agent = agents.data?.find((row) => row.id === env.data?.agent_id);
          if (agent) setPresetCategory(agent.preset?.category);
          // 진입 경로를 가리지 않고 서버 에이전트 행으로 갈라내기 게이트를 확정한다 (t_55f9ed57).
          setCanFork(canForkAgent({ name: agent?.name, titleKey: agent?.preset?.titleKey, category: agent?.preset?.category }));
        });
      }
    }).catch(() => { /* 선택적 계보 필드 미지원은 기존 대화를 막지 않는다. */ });
    return () => { active = false; };
  }, [sessionId, isDemo]);

  const [input, setInput] = useState('');
  // 첨부 스테이지 + 사진 편집기 (t_4497cfce P1-2/P0-1): 클립 → 선택 → 즉시 업로드 + 편집기.
  const att = useAttachments();
  const [editing, setEditing] = useState<{ source: { uri: string; width: number; height: number }; localId: string } | null>(null);
  const attachPhoto = useCallback(async () => {
    if (isDemo) { setUnavailableError('errors.unavailableAction'); return; }
    try {
      const picked = await pickImages(1);
      if (!picked.length) return;
      const localId = await att.add(picked[0]);
      const size = await measureImage(picked[0].uri);
      if (localId && size.width > 0 && size.height > 0) setEditing({ source: { uri: picked[0].uri, width: size.width, height: size.height }, localId });
    } catch (e) {
      setUnavailableError(errorKey(e));
    }
  }, [isDemo, att, setUnavailableError]);
  // 편집 저장 → 원본 스테이지 행을 편집본으로 교체 + 지시문 프리필 (카드 §1 photo_edit 계약)
  const onEditSave = useCallback(async (res: PhotoEditResult) => {
    if (res.edited) {
      const prev = att.items.find((x) => x.localId === editing?.localId);
      if (prev) att.remove(prev.localId);
      const file = Platform.OS === 'web'
        ? { uri: URL.createObjectURL(res.edited as Blob), name: res.editedName, type: 'image/png' }
        : res.edited as { uri: string; name: string; type: string };
      await att.add(file);
    }
    // 편집 실패 폴백(res.edited=null): 원본 첨부 행을 유지하고 지시문만 입력에 남긴다.
    setInput((cur) => (cur.trim() ? cur.trimEnd() + '\n' : '') + res.text);
  }, [att, editing]);
  // 다중 선택 모드 (대표님 지시 9/26 — "복수로 누를수 있게, 다음대화에서 이어가거나 보관"):
  // 진입 = 앱바 '선택' 버튼 또는 카드 롱프레스. 보관 = 선택 카드 일괄 즐겨찾기(서버 PATCH),
  // 이어가기 = 가장 최근 선택 카드 지점의 포크(ForkDialog 재사용 — 백엔드 선택적 포크 없는 MVP는 계보 preserved 방식).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selection = { active: selectionMode, ids: selectedIds };
  const selectionMessages = useMemo(() => messages.filter((m) => selectedIds.includes(m.id)), [messages, selectedIds]);
  const selectableIds = useMemo(() => messages.filter((m) => !m.pending && m.status !== 'failed').map((m) => m.id), [messages]);
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;
  const exitSelection = useCallback(() => { setSelectionMode(false); setSelectedIds([]); }, []);
  const toggleSelect = useCallback((id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])), []);
  const selectAll = useCallback(() => setSelectedIds(selectableIds), [selectableIds]);
  const clearSelection = useCallback(() => setSelectedIds([]), []);
  const beginSelection = useCallback((withId?: string) => { setSelectionMode(true); if (withId) setSelectedIds([withId]); }, []);
  const forkSelected = useCallback(() => {
    const lastAgent = [...selectionMessages].reverse().find((m) => m.role === 'agent');
    const target = lastAgent ?? selectionMessages[selectionMessages.length - 1];
    if (!target || isDemo || !sessionId || target.pending || target.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
    setForkMessage(target);
    exitSelection();
  }, [selectionMessages, isDemo, sessionId, exitSelection]);
  const [sendFailed, setSendFailed] = useState(false);
  const listRef = useRef<FlatList<TurnGroup>>(null);

  const submit = useCallback(() => {
    const validation = validateMessageInput(input);
    // 첨부 게이트 (t_4497cfce P1-2): 텍스트 필수 + 업로드 중 행 없음 + 완료 행만 동봉 (서버 400 방어 = UX 선방어)
    if (!validation.ok) return;
    if (att.uploading) { setUnavailableError('errors.uploadPending'); return; }
    if (!att.items.length) {
      const text = input;
      setInput('');
      setSendFailed(false);
      void send(text).then((res) => {
        if (!res.ok) {
          setInput((current) => restoreFailedDraft(current, text));
          setSendFailed(true);
        } else {
          try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); } catch { /* web no-op */ }
        }
      });
      return;
    }
    if (!att.ready) { setUnavailableError('errors.uploadFailed'); return; } // 오류 행 = 재시도 후 전송
    const text = input;
    const payload = { ids: att.ids(), previews: att.items.map((it) => ({ localId: it.localId, name: it.name, uri: it.localUri, type: it.type, status: 'done' as const })) };
    setInput('');
    setSendFailed(false);
    void send(text, payload).then((res) => {
      if (!res.ok) {
        setInput((current) => restoreFailedDraft(current, text));
        setSendFailed(true);
        // 첨부는 재시도 실패 시 낙관 행(failed)의 pendingAttachments로 유지 — 서버 링크 실패와 무관하게 ID 재전송 가능
      } else {
        att.clear();
        try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); } catch { /* web no-op */ }
      }
    });
  }, [input, send, att, setUnavailableError]);

  const retry = useCallback(() => {
    setSendFailed(false);
    void retryLastSend().then((res) => {
      if (!res.ok) setSendFailed(true);
      else att.clear(); // 재시도는 최초 실패 시 보존된 첨부 ID로 전송 — 스테이지 정리 (t_4497cfce)
    });
  }, [retryLastSend, att, setSendFailed]);

  const nearBottom = useRef(true);
  const offset = useRef(0);
  const layouts = useRef(new Map<string, { y: number; height: number }>());
  const prependAnchor = useRef<{ id: string; relative: number; y: number } | null>(null);
  const [unseen, setUnseen] = useState(0);
  // 즐겨찾기 딥링크 하이라이트 (Wave1) — highlightId/state만 선언, 스크롤 효과는 groups 정의 후
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusTries = useRef(0);
  const pendingClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pendingClear.current) clearTimeout(pendingClear.current); }, []);
  const previousMessages = useRef<ChatMessage[]>([]);
  const groups = useMemo(() => groupByTurn(messages), [messages]);
  // 답글 스레드 목록 모달 (t_2f45ccb1 확장 3) — 앱바 우측 버튼, 배지 = 활성(미종료) 스레드 수.
  const [threadsOpen, setThreadsOpen] = useState(false);
  const activeThreadCount = threads.filter((th) => !th.ended).length;
  // 칩/모달 액션: 메시지 id → 카드(답글/갈라내기 대상) — 히스토리 밖이면 조용히 무시.
  const openThreadOf = useCallback((messageId: string) => {
    setThreadsOpen(false);
    const m = messages.find((x) => x.id === messageId);
    if (!m) return;
    if (isDemo || !sessionId || m.pending || m.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
    inspectStore.set(m.id);
    threadSheet.current?.open({ sessionId, rootMessageId: m.id, agentName, sessionTitle, presetCategory, canFork });
  }, [messages, isDemo, sessionId, agentName, sessionTitle, presetCategory, canFork]);
  const forkOf = useCallback((messageId: string) => {
    const m = messages.find((x) => x.id === messageId);
    if (!m) return;
    if (isDemo || !sessionId || m.pending || m.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
    setForkMessage(m);
  }, [messages, isDemo, sessionId]);
  // 상단 큐 스트립 행 (t_2f45ccb1) — 서버 queue 스냅샷 우선, 없으면 메시지 로컬 유도.
  const queueStrip = useMemo(() => buildQueueStrip(messages, queue), [messages, queue]);
  // t_64af90b0 #3 — 발신자 라벨 중복 제거: 에이전트명 헤더는 첫 에이전트 메시지만 (이후 카드에는 생략)
  const firstAgentMessageId = useMemo(() => messages.find((m) => m.role === 'agent')?.id, [messages]);
  const times = useMemo(() => new Map(buildTimeGroups(messages, i18n.language).map((g) => [g.id, g.label])), [messages, i18n.language]);
  // 딥링크 스크롤 — 그룹을 찾으면 scrollToIndex + 하이라이트 2.6초, 히스토리 밖이면 loadOlder로 역행 추적
  // 점프 소스 2종 (t_2f45ccb1): 즐겨찾기/피드 딥링크(focusMessageId) + 상단 큐 칩 탭(queueJump, 우선)
  const jumpTarget = queueJump?.id ?? focusMessageId;
  const jumpNonce = queueJump?.nonce ?? 0;
  useEffect(() => {
    if (!jumpTarget) return;
    // setTimeout(0) 지연 — DialogueListScreen의 refresh 패턴과 동일 (effect 동기 setState 회피)
    const find = setTimeout(() => {
      const groupIndex = groups.findIndex((g) => g.items.some((m) => m.id === jumpTarget));
      if (groupIndex >= 0) {
        if (highlightId !== jumpTarget) {
          setHighlightId(jumpTarget);
          const groupKey = groups[groupIndex].key;
          const layout = layouts.current.get(groupKey);
          try {
            if (layout) listRef.current?.scrollToOffset({ offset: Math.max(0, layout.y - 60), animated: true });
            else listRef.current?.scrollToIndex({ index: groupIndex, animated: true, viewPosition: 0.3 });
          } catch { /* 미측정 행 — 다음 레이아웃 잡힐 때 재시도 */ }
          const clear = setTimeout(() => setHighlightId(null), 2800);
          pendingClear.current = clear;
        }
        return;
      }
      if (hasMoreHistory && !loadingHistory && focusTries.current < 12) { focusTries.current += 1; void loadOlder(); }
    }, 0);
    return () => clearTimeout(find);
  }, [jumpTarget, jumpNonce, groups, hasMoreHistory, loadingHistory, loadOlder, highlightId]);
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

  // 후속 질문 칩 전송 (t_1797f432 ③): 입력창 경유 없이 곧바로 send — 실패 시 원문 복원/재시도는 performSend 책임.
  const sendSuggested = useCallback((q: SuggestedQuestion) => {
    if (isDemo) return;
    void send(q.text);
  }, [isDemo, send]);

  const renderFooter = useCallback(() => <View>
    {typing && <TypingCard quip={typingQuip} agentName={agentName} count={activeCount} />}
    {streams.map((stream) => <Surface key={stream.runId} style={[styles.msgCard, styles.msgCardAgent]} elevation={0}>
      <Text style={styles.msgRoleAgent}>{agentName}</Text>
      <Text style={styles.msgText}>{stream.text}</Text>
      <Text testID="ai-generated-badge" style={styles.pendingMark}>{t('common.aiGenerated')}</Text>
      <Text style={styles.typingQuip}>{t(stream.done ? 'chat.saving' : stream.quip)}</Text>
    </Surface>)}
    {/* 후속 질문 칩 (t_1797f432 ③): 백엔드가 run.completed에 생성해 준 예상 질문 2~3개 — 없으면 렌더 없음 */}
    {!typing && !streams.length && suggested.length > 0 && !isDemo && (
      <View style={styles.suggestRow} testID="suggested-questions">
        <Text style={styles.suggestTitle}>{t('chat.suggestTitle')}</Text>
        {suggested.map((q) => (
          <Pressable key={q.id} accessibilityRole="button" onPress={() => sendSuggested(q)} testID={`suggested-${q.id}`} style={({ pressed }) => [styles.suggestChip, pressed && { backgroundColor: colors.surfaceHover }]}>
            <Text style={styles.suggestChipText} numberOfLines={2}>{q.text}</Text>
          </Pressable>
        ))}
      </View>
    )}
  </View>, [typing, typingQuip, agentName, activeCount, streams, suggested, isDemo, sendSuggested, t]);

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
  // AI 고지 상시 표기 (t_eb7f13e9 항목 2, AI 기본법 제31조 ①): 빈 상태 안내에 이어 첫 진입 후에도
  // 앱바 아래 한 줄로 고정. 데모 세션은 백엔드 미연결이라 배너만 동일 노출(오인 방지 고지는 유지).
  const connectionColor = connection === 'live' ? colors.accent : connection === 'offline' ? colors.statusErr : colors.statusWarn;
  const subtitle = isDemo ? t('chat.demoSubtitle') : {
    connecting: t('chat.connecting'), live: t('chat.live'), reconnecting: t('chat.reconnecting'), offline: t('chat.offline'),
  }[connection];

  return (
    <View style={styles.shell}>
    <KeyboardAvoidingView
      style={[styles.container, webScreenMotion('mat-slide-from-right'), { paddingBottom: viewportInset }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* 커스텀 헤더 — 웹 export에서 Paper Appbar 아이콘 글리프 깨짐 방지 (다른 화면과 동일한 ← 텍스트 패턴)
          선택 모드(대표님 9/26): 좌측 ✕ / 제목 = "N개 선택" / 우측 전체선택·전체해제 */}
      <View style={styles.appbar} testID="chat-appbar">
        <TouchableOpacity onPress={selection.active ? exitSelection : () => navigation.goBack()} style={styles.backButton} accessibilityLabel={t(selection.active ? 'common.cancel' : 'common.back')}>
          <Text style={styles.backText}>{selection.active ? '✕' : t('common.backIcon')}</Text>
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.appbarTitle} numberOfLines={1}>{selection.active ? t('selection.count', { countText: formatNumber(selection.ids.length, i18n.language) }) : sessionTitle}</Text>
          {!selection.active && <View style={styles.subtitleRow}>
            <Text
              style={[styles.appbarSubtitle, { color: isDemo ? colors.statusWarn : connectionColor }]}
              numberOfLines={1}
              testID="chat-status-line"
            >
              {t('chat.statusIndicator', { status: subtitle })}
            </Text>
            {/* 크로스 디바이스 presence — 같은 세션을 다른 기기가 실시간으로 보는 중 (t_eded715c) */}
            {!isDemo && <DevicePresenceBadge peers={peers} />}
          </View>}
        </View>
        {/* 답글 스레드 목록 (t_2f45ccb1 확장 3) — 배지 = 활성 스레드 수, 0이면 배지 없음 */}
        {!selection.active && (
          <TouchableOpacity onPress={() => setThreadsOpen(true)} style={styles.backButton} accessibilityLabel={t('queue.threadsTitle')} testID="threads-open">
            <Text style={styles.backText}>{t('common.thread')}{activeThreadCount > 0 ? ` ${formatNumber(activeThreadCount, i18n.language)}` : ''}</Text>
          </TouchableOpacity>
        )}
        {selection.active ? <TouchableOpacity
          onPress={() => (allSelected ? clearSelection() : selectAll())}
          style={styles.backButton}
          accessibilityLabel={t(allSelected ? 'selection.clearAll' : 'selection.selectAll')}
          testID="selection-toggle-all"
        >
          <Text style={styles.backText}>{t(allSelected ? 'selection.clearAll' : 'selection.selectAll')}</Text>
        </TouchableOpacity> : <TouchableOpacity
          onPress={() => beginSelection()}
          style={styles.backButton}
          accessibilityLabel={t('selection.enter')}
          testID="selection-enter"
        >
          <Text style={styles.backText}>{t('selection.enter')}</Text>
        </TouchableOpacity>}
      </View>

      {/* 상단 질문 큐 스트립 (t_2f45ccb1 + 9/28 확장) — 순번+원문+상태 칩. 0건 완전 숨김, 좌측 카운터, 칩 재탭(펼침) 시 답글/갈라내기. */}
      <QueueStrip items={queueStrip} canFork={canFork && !isDemo} onJump={(id) => setQueueJump({ id, nonce: Date.now() })} onReply={openThreadOf} onFork={forkOf} />
      <ThreadListModal visible={threadsOpen} threads={threads} onClose={() => setThreadsOpen(false)} onOpenThread={openThreadOf} />

      {/* AI 사전고지 상시 바 (t_eb7f13e9 항목 2) — 이용약관 제3조2항이 약속한 '채팅 화면 상단 고지'.
          빈 상태의 chat.aiNotice와 달리 메시지가 쌓여도 사라지지 않는다 (AI 기본법 제31조 ①). */}
      <Text testID="ai-disclosure" numberOfLines={1} style={styles.aiDisclosure}>{t('chat.aiDisclosure')}</Text>
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
          {item.items.map((message) => <View key={message.id} style={message.id === highlightId ? styles.focusHighlight : undefined} testID={message.id === highlightId ? 'focus-highlight' : undefined}>
            {/* t_64af90b0 #3 — 에이전트명 헤더는 대화의 첫 에이전트 메시지만 노출, 이후 생략 (Linear/Slack식).
                다중 선택 모드: 행 전체가 선택 토글 래퍼 — 비모드에는 래퍼 없이 카드 그대로 (#51 인터랙션 보존) */}
            {selection.active
              ? <TouchableOpacity
                onPress={() => toggleSelect(message.id)}
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
              {(() => {
                const q = queueItemForMessage(queue, message);
                if (!q) return null;
                return <View style={styles.queueMark} testID={`queue-mark-${q.id}`} accessibilityLabel={t(`queue.${q.status}`)}>
                  {q.status === 'pending' ? <QueuePendingIcon size={iconSize.tileSm} color={colors.text3} />
                    : q.status === 'answered' ? <QueueAnsweredIcon size={iconSize.tileSm} color={colors.statusOk} />
                    : <QueueSkippedIcon size={iconSize.tileSm} color={colors.text3} />}
                  <Text style={styles.queueMarkText}>{t(`queue.${q.status}`)}</Text>
                </View>;
              })()}
            </View>}
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
      {/* PTT 녹음 상태 배너 (확정 ④: 하단 웨이브폼 + 말하세요) — 웹에서만 활성 */}
      {Platform.OS === 'web' && !isDemo && (
        <PttBannerComponent
          active={ptt.active || talking}
          keyLabel={pc ? pttKeyLabel(getPttKey() ?? 'KeyV') : undefined}
          mode={getPttMode() ?? 'hold'}
          error={ptt.error}
        />
      )}
      {/* 다중 선택 액션 바 — t_a0e998cc(대표님 9/26): 보관(즐겨찾기 중복)·볼트로(기본 저장) 제거, 이어가기만 남김 */}
      {selection.active && <View style={styles.selectionBar} testID="selection-bar">
        <Text style={styles.selectionCount}>{t('selection.count', { countText: formatNumber(selectedIds.length, i18n.language) })}</Text>
        <Button compact mode="contained" onPress={forkSelected} buttonColor={colors.accent} textColor={colors.onPrimary} testID="selection-continue">{t('selection.continue')}</Button>
      </View>}
      {input.trim().length > 4000 && <Text style={styles.errorText}>{t('errors.tooLong', { limit: formatNumber(4000, i18n.language) })}</Text>}
      {/* 첨부 스테이지 — 전송 대기 칩 행 (t_4497cfce P1-2) */}
      <View style={styles.stageRow}>
        <AttachmentChipRow items={att.items} onRemove={att.remove} onRetry={att.retry} />
      </View>
      {/* 하단 입력 영역 — 화이트 배경 + 초박형 상단 테두리, 그린 포커스 (Mintlify 패턴) */}
      <View style={styles.inputBar}>
        <View style={styles.inputRow}>
        {/* 클립 버튼 (t_4497cfce P1-2): 사진 선택 → 업로드 + 편집기. PTT 마이크와 동일 SVG 아이콘 버튼 패턴 (#2/#4). */}
        <Pressable accessibilityRole="button" accessibilityLabel={t('attachments.attach')} onPress={() => void attachPhoto()} disabled={isDemo || att.count >= 10} testID="attach-button" style={({ pressed }) => [styles.clipButton, pressed && { backgroundColor: colors.surfaceHover }]}>
          <PaperclipIcon size={iconSize.glyph} color={colors.text2} />
        </Pressable>
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
        {/* t_4b1bd4c2 요구 1: 입력창 옆 마이크 홀드 버튼 폐기 — 음성 진입은 PTT 키(PC) / 조이스틱 탭(음성 홈)으로만 */}
        {/* t_64af90b0 #4 — paper Button은 disabled 시 색상 오버라이드가 무시되어 회색이 된다 →
            커스텀 Pressable: 비활성 = 액센트 55% (초록 체계 유지), 활성 = 액센트. 제출 자체는 submit()이 검증. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.sendLabel')}
          onPress={submit}
          disabled={!validateMessageInput(input).ok}
          testID="send-button"
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: validateMessageInput(input).ok ? colors.accent : colors.accent + '55' },
            pressed && validateMessageInput(input).ok && { backgroundColor: colors.accent + 'CC' },
          ]}
        >
          <Text style={styles.sendLabel}>{t('chat.send')}</Text>
        </Pressable>
        </View>
      </View>
      {/* #52: 스레드 바텀시트 — 카드 탭 시 디텐트 시트로 열림 (전체 화면 라우트 아님) */}
      <ThreadSheet ref={threadSheet} navigation={navigation} />
      {/* 사진 편집기 시트 (t_4497cfce P0-1) — 첨부 선택 후 자동 오픈, 저장 시 스테이지 교체 */}
      <PhotoEditorSheet visible={!!editing} source={editing?.source ?? null} onClose={() => setEditing(null)} onSave={onEditSave} />
    </KeyboardAvoidingView>
    {/* PC wide(≥1100): 우측 컨텍스트 패널 상시 노출 — 모바일/태블릿에서는 렌더 제외(단일 컬럼 유지) */}
    {wide && Platform.OS === 'web' && (
      <ContextPanel
        sessionId={sessionId ?? null}
        messages={messages}
        onOpenVault={() => navigation.navigate('Vault')}
        onOpenFavorites={() => navigation.navigate('Favorites')}
      />
    )}
    </View>
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
  // 즐겨찾기 딥링크 하이라이트 (Wave1) — 액센트 좌측 밴드 + 연그린 tint (말풍선 금지 #54 — 영역 강조)
  focusHighlight: { borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.accentTint, borderRadius: radii.md },
  // 다중 선택 (대표님 9/26) — 선택 행=연그린 밴드, 액션 바=입력창 위 플로팅
  selectedRow: { borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.accentTint, borderRadius: radii.md },
  selectionBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, marginHorizontal: spacing.sp3, marginBottom: spacing.sp1, padding: spacing.sp2, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  selectionCount: { ...typography.caption, color: colors.text2, flex: 1, minWidth: 0 },
  // Wave 2 저장 결과 토스트 — 입력창 위 고정, 노트/보드 딥링크 버튼 포함
  resultToast: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, marginHorizontal: spacing.sp3, marginBottom: spacing.sp1, padding: spacing.sp2, backgroundColor: colors.accentTint, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  toastText: { ...typography.caption, color: colors.text1, flex: 1, minWidth: 0 },
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
  // 질문 큐 체크포인트 (t_1797f432 ②) — user 카드 하단 상태 행: 전송 표시 + 큐 마커 한 줄
  userMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, minWidth: 0 },
  queueMark: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp1, minWidth: 0 },
  queueMarkText: { ...typography.micro, color: colors.text3, flexShrink: 1, minWidth: 0 },
  // 후속 질문 칩 (t_1797f432 ③) — 타이핑/스트리밍 종료 후 최종 답변 아래 2~3개, 탭 시 즉시 전송
  suggestRow: { gap: spacing.sp2, paddingTop: spacing.sp1 },
  suggestTitle: { ...typography.micro, color: colors.text3 },
  suggestChip: { alignSelf: 'flex-start', maxWidth: '90%', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.sp3, paddingVertical: spacing.sp2, backgroundColor: colors.surface },
  suggestChipText: { ...typography.caption, color: colors.text1 },
  // AI 상시 고지 바 — 저대비 micro 한 줄, 메시지가 쌓여도 유지 (t_eb7f13e9 항목 2)
  aiDisclosure: {
    ...typography.micro,
    color: colors.text3,
    paddingHorizontal: spacing.sp4,
    paddingTop: spacing.sp1,
    paddingBottom: spacing.sp1,
    minWidth: 0,
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sp3,
  },
  sendContent: {
    paddingHorizontal: spacing.sp3,
  },
  sendLabel: {
    ...typography.bodyBold,
    letterSpacing: 0,
    color: colors.onPrimary,
    minWidth: 0,
    flexShrink: 1,
  },
  // ── 반응형 2트랙 (t_eded715c) ──
  // shell: 채팅 본문 + (PC wide) 우측 컨텍스트 패널을 나란히. 모바일에서는 패널 미렌더라 단일 컬럼과 동일.
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, marginTop: spacing.sp1 },
  inputRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sp2, minWidth: 0 },
  stageRow: { paddingHorizontal: spacing.sp4, paddingTop: spacing.sp2, minHeight: 0 },
  clipButton: { width: spacing.sp10, height: spacing.sp10, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaise },
});
