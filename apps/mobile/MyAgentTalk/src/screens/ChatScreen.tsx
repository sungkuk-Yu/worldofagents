import ForkDialog from '../components/ForkDialog';
import ThreadSheet, { ThreadSheetHandle } from '../components/ThreadSheet';
import PttBannerComponent from '../components/PttBanner';
import ChatAppBar from '../components/chat/ChatAppBar';
import ChatTurnRow from '../components/chat/ChatTurnRow';
import { ChatFeedFooter, ChatFeedHeader } from '../components/chat/ChatFeed';
import { useChatSelection } from '../hooks/useChatSelection';
import { styles } from './chatScreenStyles';
import ContextPanel from '../components/ContextPanel';
import { useCardActions } from '../hooks/useCardActions';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { useLayout } from '../hooks/useLayout';
import ChatInputConsole from '../components/ChatInputConsole';
import { useQueueStrip } from '../hooks/useQueueStrip';
import PendingReplyModal from '../components/PendingReplyModal';
import { usePendingReplies } from '../hooks/usePendingReplies';
import { voiceFirstConsole } from '../lib/layout';
import { getPttKey, getPttMode } from '../lib/userPrefs';
import { pttKeyLabel } from '../lib/pttLogic';
import { inspectStore } from '../lib/inspectStore';
import { parseForkOrigin, canForkAgent } from '../lib/cardLogic';
import { api } from '../lib/api';
import { useAttachments } from '../hooks/useAttachments';
import PhotoEditorSheet, { PhotoEditResult } from '../components/PhotoEditorSheet';
import { pickImages, measureImage } from '../lib/imagePicker';
import { errorKey } from '../lib/errorKeys';
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
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Button,
  Text,
} from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { colors, webScreenMotion } from '../theme';
import { ChatMessage, TurnGroup, groupByTurn, buildTimeGroups, validateMessageInput, restoreFailedDraft, SuggestedQuestion } from '../lib/chatLogic';
import QueueStrip from '../components/QueueStrip';
import RelayCaptionStrip from '../components/RelayCaptionStrip';
import ThreadListModal from '../components/ThreadListModal';
import { useChatSession } from '../hooks/useChatSession';
import { useAckChip } from '../hooks/useAckChip';

interface Props {
  navigation: any;
  route: any;
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
  // 상단 큐 스트립 칩 탭 점프 (t_2f45ccb1) — 점프 요청/폴링은 useQueueStrip이 소유 (t_91cb659c 응집).

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
    peers, talking, talk, queue, suggested, threads, applyQueueSnapshot, relay,
    pendingReplies, applyPendingSnapshot,
  } = useChatSession({
    sessionId: initialSessionId ?? null, agentId: agentId ?? null, deferConnection: !!route?.params?.demo,
    // 즐겨찾기 2탭 실시간 동기화 (t_b89df485): favorite.updated → useCardActions.local 반영.
    // 카드 훅이 아래에서 생성되므로 ref 우회로 최신 구현체를 쓴다 (WS 수신은 항상 렌더 이후).
    onFavoriteUpdated: (messageId, favorite) => favoriteSyncRef.current?.(messageId, favorite),
  });

  // PTT (t_eded715c): PC 웹 키보드(V 등 재매핑 가능) + 웹 모바일 터치 홀드 겸용.
  // 네이티브에서는 enabled=false — 조이스틱 롱프레스 경로(VoiceHome)가 음성 입력을 담당.
  const { pc, wide, width } = useLayout();
  const ptt = usePushToTalk(talk, { active: Platform.OS === 'web' && !isDemo });
  // t_e735d936 요구 1/2: 음성 우선 — 웹 모바일 진입은 음성 콘솔이 1차 UI, 입력창은 키보드를
  // 열었을 때만 나타나는 2차 UI. 콘솔 조립과 키보드 계층 전환은 ChatInputConsole 소유 (t_91cb659c),
  // 방향→동작 매핑(↑=키보드 등)은 전역 조이스틱 맵을 그대로 쓴다.
  const voiceMode = voiceFirstConsole({ os: Platform.OS, width, isDemo });

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
  // 선택 모드/ID 집합/파생값은 useChatSelection 소유 (t_70cbbd6b 순수 추출).
  const selection = useChatSelection(messages);
  const { selectedMessages: selectionMessages, exit: exitSelection, toggle: toggleSelect, begin: beginSelection } = selection;
  const forkSelected = useCallback(() => {
    const lastAgent = [...selectionMessages].reverse().find((m) => m.role === 'agent');
    const target = lastAgent ?? selectionMessages[selectionMessages.length - 1];
    if (!target || isDemo || !sessionId || target.pending || target.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
    setForkMessage(target);
    exitSelection();
  }, [selectionMessages, isDemo, sessionId, exitSelection, setForkMessage, setUnavailableError]);
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
  }, [messages, isDemo, sessionId, agentName, sessionTitle, presetCategory, canFork, setThreadsOpen, setUnavailableError]);
  const forkOf = useCallback((messageId: string) => {
    const m = messages.find((x) => x.id === messageId);
    if (!m) return;
    if (isDemo || !sessionId || m.pending || m.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
    setForkMessage(m);
  }, [messages, isDemo, sessionId, setForkMessage, setUnavailableError]);
  // 상단 큐 스트립 (t_2f45ccb1 → t_91cb659c 응집): 칩 행 빌드 · GET /queue 보조 폴링 · 칩 탭 점프 요청은 useQueueStrip 소유.
  const strip = useQueueStrip({ sessionId, live: !isDemo, messages, queue, applyQueueSnapshot });
  // 답변 대기 (t_363c0faa): GET /pending 보조 폴링(부트스트랩 1회 + 미해소 중 15초 + 런 종료 직후 1회)은
  // usePendingReplies가 소유 — WS reply.pending.updated가 단일 상태원천 (queue 계층 원칙 동일).
  usePendingReplies({ sessionId, live: !isDemo, pendingCount: pendingReplies.length, typing, applyPendingSnapshot });
  const [pendingOpen, setPendingOpen] = useState(false);
  // freeform 행 탭 = 카드 점프 + 입력창 개방 (키보드 계층 신호는 콘솔이 소유, nonce로 재요청 가능)
  const [composeNonce, setComposeNonce] = useState(0);
  const requestJump = strip.requestJump; // 안정 ref — memo deps는 개별 함수로 (t_70cbbd6b 관례)
  // 예/아니오 빠른 회신 (t_043539ff 조이스틱 대응 — 발화 '예'/'아니오' 동일): suggested 칩(sendSuggested)과
  // 동일 전송 경로. 실패 시 원문 복구는 submit과 같은 restoreFailedDraft.
  const sendPendingReply = useCallback((utterance: string) => {
    if (isDemo) return;
    void send(utterance).then((res) => {
      if (!res.ok) {
        setInput((current) => restoreFailedDraft(current, utterance));
        setSendFailed(true);
      }
    });
  }, [isDemo, send, setInput, setSendFailed]);
  const jumpComposePending = useCallback((messageId: string) => {
    setPendingOpen(false); // 시트를 닫아야 점프한 카드와 입력창이 보인다
    requestJump(messageId);
    setComposeNonce((n) => n + 1);
  }, [requestJump]);
  // t_64af90b0 #3 — 발신자 라벨 중복 제거: 에이전트명 헤더는 첫 에이전트 메시지만 (이후 카드에는 생략)
  const firstAgentMessageId = useMemo(() => messages.find((m) => m.role === 'agent')?.id, [messages]);
  const times = useMemo(() => new Map(buildTimeGroups(messages, i18n.language).map((g) => [g.id, g.label])), [messages, i18n.language]);
  // 딥링크 스크롤 — 그룹을 찾으면 scrollToIndex + 하이라이트 2.6초, 히스토리 밖이면 loadOlder로 역행 추적
  // 점프 소스 2종 (t_2f45ccb1): 즐겨찾기/피드 딥링크(focusMessageId) + 상단 큐 칩 탭(strip.jump, 우선)
  const jumpTarget = strip.jump?.id ?? focusMessageId;
  const jumpNonce = strip.jump?.nonce ?? 0;
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

  // 공감 카드 하단 예/아니요 칩 + 조이스틱 홀드-arm (t_043539ff) — 전송 payload는
  // 백엔드 isConfirmationUtterance 집합과 일치하는 '예'/'아니요'(en 'Yes'/'No') 텍스트 1회 send.
  const ackChip = useAckChip(messages);
  const sendAck = useCallback((text: string) => {
    if (isDemo) return;
    void send(text);
  }, [isDemo, send]);

  const renderFooter = useCallback(() => <ChatFeedFooter
    typing={typing} typingQuip={typingQuip} agentName={agentName} activeCount={activeCount}
    streams={streams} suggested={suggested} isDemo={isDemo} onSendSuggested={sendSuggested}
    hideQuip={!!relay}
  />, [typing, typingQuip, agentName, activeCount, streams, suggested, isDemo, sendSuggested, relay]);

  const renderHeader = useCallback(() => <ChatFeedHeader
    hasMoreHistory={hasMoreHistory} loadingHistory={loadingHistory} isDemo={isDemo} onLoadHistory={() => void loadHistory()}
  />, [hasMoreHistory, isDemo, loadHistory, loadingHistory]);

  return (
    <View style={styles.shell}>
    <KeyboardAvoidingView
      style={[styles.container, webScreenMotion('mat-slide-from-right'), { paddingBottom: viewportInset }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* 커스텀 헤더 — 웹 export에서 Paper Appbar 아이콘 글리프 깨짐 방지 (다른 화면과 동일한 ← 텍스트 패턴)
          선택 모드(대표님 9/26): 좌측 ✕ / 제목 = "N개 선택" / 우측 전체선택·전체해제 — ChatAppBar 소유 (t_70cbbd6b) */}
      <ChatAppBar
        selection={selection}
        sessionTitle={sessionTitle}
        isDemo={isDemo}
        peers={peers}
        connection={connection}
        activeThreadCount={activeThreadCount}
        pendingReplyCount={pendingReplies.length}
        onBack={() => navigation.goBack()}
        onOpenThreads={() => setThreadsOpen(true)}
        onOpenPending={() => setPendingOpen(true)}
        onBeginSelection={() => beginSelection()}
      />

      {/* 상단 질문 큐 스트립 (t_2f45ccb1 + 9/28 확장) — 순번+원문+상태 칩. 0건 완전 숨김, 좌측 카운터, 칩 재탭(펼침) 시 답글/갈라내기. */}
      <QueueStrip items={strip.items} canFork={canFork && !isDemo} onJump={strip.requestJump} onReply={openThreadOf} onFork={forkOf} />
      <ThreadListModal visible={threadsOpen} threads={threads} onClose={() => setThreadsOpen(false)} onOpenThread={openThreadOf} />
      {/* 답변 대기 모달 (t_363c0faa) — 발췌 목록 + 예/아니오 빠른 회신 + freeform 점프. 해소 스냅샷(count 0) 시 자동 닫힘. */}
      <PendingReplyModal
        visible={pendingOpen}
        items={pendingReplies}
        onClose={() => setPendingOpen(false)}
        onQuickReply={(_messageId, utterance) => sendPendingReply(utterance)}
        onJumpCompose={jumpComposePending}
      />

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
        renderItem={({ item }) => <ChatTurnRow
          group={item}
          timeLabel={times.get(item.key)}
          highlightId={highlightId}
          ackChipId={ackChip?.id ?? null}
          onSendAck={sendAck}
          decorate={decorate}
          handlers={handlers}
          presetCategory={presetCategory}
          canFork={canFork}
          agentName={agentName}
          firstAgentMessageId={firstAgentMessageId}
          sessionTitle={sessionTitle}
          isDemo={isDemo}
          queue={queue}
          selectionActive={selection.active}
          selectedIds={selection.ids}
          onToggleSelect={toggleSelect}
          onResend={(message) => { void retryMessage(message.id).then((result) => { if (!result.ok) setInput((current) => restoreFailedDraft(current, message.draft ?? message.content)); }); }}
          onDelete={deleteMessage}
        />}
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
      {/* PTT 녹음 상태 배너 (확정 ④: 하단 웨이브폼 + 말하세요) — 웹에서만 활성.
          t_e735d936: 음성 우선 모드에서는 오류 안내가 콘솔 내부(chat-voice-fallback)에 있으므로 배너 중복 금지. */}
      {Platform.OS === 'web' && !isDemo && (
        <PttBannerComponent
          active={ptt.active || talking}
          keyLabel={pc ? pttKeyLabel(getPttKey() ?? 'KeyV') : undefined}
          mode={getPttMode() ?? 'hold'}
          error={voiceMode ? null : ptt.error}
        />
      )}
      {/* 다중 선택 액션 바 — t_a0e998cc(대표님 9/26): 보관(즐겨찾기 중복)·볼트로(기본 저장) 제거, 이어가기만 남김 */}
      {selection.active && <View style={styles.selectionBar} testID="selection-bar">
        <Text style={styles.selectionCount}>{t('selection.count', { countText: formatNumber(selection.ids.length, i18n.language) })}</Text>
        <Button compact mode="contained" onPress={forkSelected} buttonColor={colors.accent} textColor={colors.onPrimary} testID="selection-continue">{t('selection.continue')}</Button>
      </View>}
      {/* 비서실 백스테이지 릴레이 자막 (t_961ca593 Phase B 案①) — 입력 콘솔 위 상시 1줄, stage 전환 페이드.
          relay=null(비서 외 페르소나=이벤트 0건, 데모 포함)이면 렌더 0 — 기존 레이아웃 DOM 불변. */}
      <RelayCaptionStrip caption={relay} />
      {/* 하단 입력 영역 (t_91cb659c): 첨부 스테이지 + 음성 콘솔(1차) + 키보드 입력바(2차) 조립은 ChatInputConsole 소유
          (초장문 안내 한 줄 포함).
          t_e735d936 요구 1 유지: 웹 모바일은 기본이 음성 콘솔(조이스틱 홀드-투-톡), 입력창은 키보드를
          열었을 때만 나타나는 2차 UI. PC/네이티브/데모는 기존 입력창 상시. */}
      <ChatInputConsole
        value={input}
        onChangeText={setInput}
        onSubmit={submit}
        isDemo={isDemo}
        attachmentItems={att.items}
        attachmentCount={att.count}
        onAttach={() => void attachPhoto()}
        onAttachmentRemove={att.remove}
        onAttachmentRetry={att.retry}
        voiceMode={voiceMode}
        initialKeyboardOpen={route?.params?.keyboard === '1'}
        recording={ptt.active || talking}
        pttError={ptt.error}
        onPressHoldStart={ptt.startHold}
        onHoldEnd={ptt.endHold}
        onHoldAbort={ptt.abortHold}
        onSendAck={sendAck}
        forceOpenKeyboard={composeNonce}
      />
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

