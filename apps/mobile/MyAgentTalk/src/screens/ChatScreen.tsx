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
import { QuestionTrackerModal } from '../components/QuestionTracker';
import FavoritesModal from '../components/FavoritesModal';
import { usePendingReplies } from '../hooks/usePendingReplies';
import { voiceFirstConsole } from '../lib/layout';
import { voiceStageHeight, chatListPaddingOverride } from '../lib/voiceStage';
import { getPttKey, getPttMode, getEchoMode, setEchoMode, ECHO_MODE_DEFAULT, subscribePrefs } from '../lib/userPrefs';
import { pttKeyLabel } from '../lib/pttLogic';
import { inspectStore } from '../lib/inspectStore';
import { railStore } from '../lib/railStore';
import { parseForkOrigin, canForkAgent } from '../lib/cardLogic';
import { api } from '../lib/api';
import { useAttachments } from '../hooks/useAttachments';
import PhotoEditorSheet, { PhotoEditResult } from '../components/PhotoEditorSheet';
import { pickImages, measureImage } from '../lib/imagePicker';
import { errorKey } from '../lib/errorKeys';
import type { ForkOrigin, ReplyQuote } from '../types';
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
import { ChatMessage, TurnGroup, FeedItem, groupByTurn, insertDateSeparators, isDateSeparator, buildTimeGroups, buildSenderGroups, streamingHeaderAfter, validateMessageInput, restoreFailedDraft, SuggestedQuestion, canReplyTo, localReplyQuote } from '../lib/chatLogic';
import DateSeparatorRow from '../components/chat/DateSeparatorRow';
import DatePinnedHeader, { DatePinnedHandle, SepMetric } from '../components/chat/DatePinnedHeader';
import { formatDateSeparator } from '../i18n/format';
import QueueStrip from '../components/QueueStrip';
import RelayCaptionStrip from '../components/RelayCaptionStrip';
import ThreadListModal from '../components/ThreadListModal';
import MessageActionSheet from '../components/MessageActionSheet';
import { ReplyDraftBar } from '../components/ReplyQuoteBar';
import { useChatSession } from '../hooks/useChatSession';
import { useAckChip } from '../hooks/useAckChip';
import { ackResultCardIds } from '../lib/ackChips';
import { QUIET_PROGRESS, SENDER_GROUPING } from '../lib/featureFlags';
import { renderFlags } from '../lib/renderFlags';
import { createDraftSaver, readDraft } from '../lib/draftStore';

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
  const { pc, wide, width, height: viewportHeight } = useLayout();
  const ptt = usePushToTalk(talk, { active: Platform.OS === 'web' && !isDemo });
  // t_e735d936 요구 1/2 → t_4758f25d 재스펙: 웹 모바일 진입 = 하단 ~30% 투명 음성 스테이지
  // (홀드 시 링+마이크+실측 게인 sine 리본), 입력창은 ↑ 제스처로 여는 B 계층.
  // PC 레이아웃(≥768)/네이티브/데모는 기존 텍스트 입력바 유지 (원 카드 요구 4).
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
  // ④ room별 미전송 드래프트 (t_5c559e85, core.telegram.org/api/drafts): 진입 복원 1회 +
  // 입력 변경 디바운스 저장 + 발송 시 원자적 clear. 데모/세션 없음은 대상 아님. 웹 localStorage 전용
  // (네이티브는 스토리지 부재 → draftStore가 no-op, 체감 무해).
  const draftSaver = useMemo(() => createDraftSaver(), []);
  useEffect(() => {
    if (!renderFlags.inputDraftPersist || isDemo || !sessionId) return;
    setInput((cur) => (cur ? cur : readDraft(sessionId)));
  }, [sessionId, isDemo]);
  useEffect(() => {
    if (!renderFlags.inputDraftPersist || isDemo || !sessionId) return;
    draftSaver.schedule(sessionId, input);
  }, [input, sessionId, isDemo, draftSaver]);
  useEffect(() => () => { draftSaver.flush(); }, [draftSaver]);
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
  // 답글/인용 (t_62897e88 백로그④) — actionTarget=롱프레스 메뉴 행, draftQuote=발송 대기 인용(입력바 위 바).
  // 확정 인용은 메시지 replyTo(서버 structured_payload.reply_to 스냅샷)로 별도 저장 — 이 두 상태는 '쓰는 중'뿐.
  const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
  const [draftQuote, setDraftQuote] = useState<ReplyQuote | null>(null);
  // 되물음 행(t_8bf12fa4) — userPrefs.subscribePrefs로 설정 화면 토글 변경도 시트 라벨에 실시간 반영(동일 상태).
  const [, prefsTick] = useState(0);
  useEffect(() => subscribePrefs(() => prefsTick((n) => n + 1)), []);
  const sheetEchoOn = (getEchoMode() ?? ECHO_MODE_DEFAULT) === 'on';
  const sheetToggleEcho = useCallback(() => {
    void setEchoMode(sheetEchoOn ? 'off' : 'on');
  }, [sheetEchoOn]);
  const forkSelected = useCallback(() => {
    const lastAgent = [...selectionMessages].reverse().find((m) => m.role === 'agent');
    const target = lastAgent ?? selectionMessages[selectionMessages.length - 1];
    if (!target || isDemo || !sessionId || target.pending || target.status === 'failed') { setUnavailableError('errors.unavailableAction'); return; }
    setForkMessage(target);
    exitSelection();
  }, [selectionMessages, isDemo, sessionId, exitSelection, setForkMessage, setUnavailableError]);
  const [sendFailed, setSendFailed] = useState(false);
  const listRef = useRef<FlatList<FeedItem>>(null);

  const submit = useCallback(() => {
    const validation = validateMessageInput(input);
    // 첨부 게이트 (t_4497cfce P1-2): 텍스트 필수 + 업로드 중 행 없음 + 완료 행만 동봉 (서버 400 방어 = UX 선방어)
    if (!validation.ok) return;
    if (att.uploading) { setUnavailableError('errors.uploadPending'); return; }
    // 답글 인용 발화 (t_62897e88): 대기 중인 인용 요약이면 reply_to_id+요약을 attach. 실패 시 원문과 함께
    // 인용도 복원(재시도 바가 다시 뜬다). 성공/전송 개시 시 바는 즉시 소멸(텔레그램: 전송=인용 해소).
    const quote = draftQuote ?? undefined;
    if (!att.items.length) {
      const text = input;
      setInput('');
      setDraftQuote(null);
      if (renderFlags.inputDraftPersist && sessionId) draftSaver.clearNow(sessionId); // ④ 발송 = 원자적 드래프트 소거
      setSendFailed(false);
      void send(text, undefined, quote).then((res) => {
        if (!res.ok) {
          setInput((current) => restoreFailedDraft(current, text));
          setDraftQuote(quote ?? null);
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
    setDraftQuote(null);
    if (renderFlags.inputDraftPersist && sessionId) draftSaver.clearNow(sessionId); // ④ 발송 = 원자적 드래프트 소거
    setSendFailed(false);
    void send(text, payload, quote).then((res) => {
      if (!res.ok) {
        setInput((current) => restoreFailedDraft(current, text));
        setDraftQuote(quote ?? null);
        setSendFailed(true);
        // 첨부는 재시도 실패 시 낙관 행(failed)의 pendingAttachments로 유지 — 서버 링크 실패와 무관하게 ID 재전송 가능
      } else {
        att.clear();
        try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); } catch { /* web no-op */ }
      }
    });
  }, [input, send, att, draftQuote, setUnavailableError, sessionId, draftSaver]);

  const retry = useCallback(() => {
    setSendFailed(false);
    void retryLastSend().then((res) => {
      if (!res.ok) setSendFailed(true);
      else att.clear(); // 재시도는 최초 실패 시 보존된 첨부 ID로 전송 — 스테이지 정리 (t_4497cfce)
    });
  }, [retryLastSend, att, setSendFailed]);

  const nearBottom = useRef(true);
  const offset = useRef(0);
  // 텔레그램식 꼬리 추종 (t_1731f0f6 — 대표님 9/29: "새 카드 발동 시 그 카드로, 글이
  // 길어지면 그 끝으로"). 라이브 실패 root cause 2종:
  //  (1) scrollToEnd 단발(onContentSizeChange)이 레이아웃 확정(줄바꿈 리레이아웃) 전에 실행돼
  //      옛 끝에 닿음 → 수리: 측정 기반 bottom clamp(scrollToOffset(contentH - viewportH)) +
  //      레이아웃 확정 rAF 재시도 2회 루프(카드 D 지시: 단발 금지).
  //  (2) 성장 직후 스크롤 이벤트가 'contentSize 커진 값 + offset 옛값' stale 쌍으로 도착해
  //      gap>100 오판 → nearBottom=false 전향(추종 영구 사망) + unseen 배지 오탐(라이브에서
  //      답마다 배지 뜬 증상) → 수리: gap>100 전향은 추종 유휴일 때만, 이탈 판정은 실질 상방
  //      오프셋 감소 우선. clamp 타깃이 strip 패딩 포함 절대 끝이라 마지막 카드가 voice-stage
  //      아래로 넘어가지 않고(요구 C), flex-end 짧은 히스토리 앵커와는 직교(무해).
  const tailRef = useRef({ raf: 0, budget: 0, contentH: 0, viewportH: 0, userScrollAt: 0 });
  // 라이브 스크롤 박스 노드 (t_1731f0f6 r5): RNW FlatList→VirtualizedList→ScrollView 체인의
  // getScrollableNode. 이벤트 nativeEvent 쌍은 레이아웃 확정 전 스냅샷일 수 있어(낡은
  // contentSize + 클램프된 offset = r4 오판 root cause) 추종·정착 판정은 DOM 실측 우선,
  // 노드 미확보(네이티브/초기 프레임) 시에만 이벤트 미러로 폴백.
  const scrollBoxNode = useCallback((): HTMLElement | null => {
    if (Platform.OS !== 'web') return null;
    const ref = listRef.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null;
    const node = ref?.getScrollableNode?.() ?? null;
    return node && node.scrollHeight > 0 ? node : null;
  }, []);
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loadingHistory; }, [loadingHistory]);
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
  // 날짜 구분선 합성 아이템 (t_34f3e92c②): groups 경계에 separator 삽입 — feed이 곧 FlatList data.
  // scrollToIndex/KeyExtractor/CellRenderer layouts가 같은 인덱스·키 공간을 공유해 딥링크 정합성 유지.
  const labelForDate = useCallback((first: ChatMessage) => (first.createdAt && Number.isFinite(new Date(first.createdAt).getTime())
    ? formatDateSeparator(new Date(first.createdAt), i18n.language, { today: t('chat.dateToday'), yesterday: t('chat.dateYesterday') })
    : null), [i18n.language, t]);
  const feed = useMemo(() => insertDateSeparators(groups, labelForDate), [groups, labelForDate]);
  // 상단 고정 날짜 탭 (t_34f3e92c②): 스크롤 오프셋과 구분선 레이아웃(layouts 맵 — CellRenderer가
  // 이미 key→{y,height} 측정 중)에서 산출. sticky CSS가 아닌 오버레이 — react-native-web ScrollView의
  // stickyHeaderIndices는 자식을 단일 컨테이너에 감싸 push-out(밀려남)이 아닌 겹침이 된다(소스 확인).
  const pinnedRef = useRef<DatePinnedHandle>(null);
  const listWrapRef = useRef<HTMLElement | null>(null);
  const syncPinnedDate = useCallback(() => {
    // 오프셋은 state가 아닌 DOM 실측 — 프로그램 scrollToEnd/scrollToOffset은 onScroll를
    // guarantee하지 않아 ref 값이 낡으면 최상단에서도 고정 탭이 붙는 오동작(9/29 스모크 실측).
    // RNW View ref는 호스트 DOM element를 포워딩한다(forwardedRef → hostRef).
    const scroller = (listWrapRef.current?.querySelector?.('[data-testid="message-list"]') as HTMLElement | null) ?? null;
    const liveOffset = scroller ? scroller.scrollTop : offset.current;
    const seps: SepMetric[] = [];
    for (const it of feed) {
      if (!isDateSeparator(it)) continue;
      const l = layouts.current.get(it.key);
      if (l) seps.push({ key: it.key, label: it.label, y: l.y, h: l.height });
    }
    seps.sort((a, b) => a.y - b.y);
    pinnedRef.current?.update(seps, liveOffset);
  }, [feed]);
  // feed 교체(히스토리 prepend/새 발화) 후 레이아웃 반영 타이 — 스크롤이 멈춘 상태에서도 고정 탭이
  // 최신 레이아웃을 따르도록 2회 재동기(즉시/차 프레임)한다. CellRenderer onLayout이 추가 보정.
  useEffect(() => { syncPinnedDate(); const r = requestAnimationFrame(syncPinnedDate); return () => cancelAnimationFrame(r); }, [syncPinnedDate]);
  // 답글 스레드 목록 모달 (t_2f45ccb1 확장 3) — 앱바 우측 버튼, 배지 = 활성(미종료) 스레드 수.
  const [threadsOpen, setThreadsOpen] = useState(false);
  const activeThreadCount = threads.filter((th) => !th.ended).length;
  // 좌측 레일 발행 (t_fd869e5b 요구1): 채팅 화면이 스레드 인덱스/메타 단일 발행자 — ThreadRail이 구독.
  // 데모 세션은 스레드 원천이 없다 → sessionId null과 함께 reset (이전 세션 스레드가 레일에 남으면 안 됨).
  useEffect(() => {
    if (isDemo || !sessionId) { railStore.reset(); return; }
    railStore.publish({
      sessionId,
      threads,
      meta: { agentName, sessionTitle, presetCategory, canFork },
    });
  }, [isDemo, sessionId, threads, agentName, sessionTitle, presetCategory, canFork]);
  useEffect(() => () => railStore.reset(), []);
  // 내 질문 트래커 모바일 경로 (t_fd869e5b) — wide 미만(우측 패널 미렌더) 앱바 '현황' 버튼 → 하단 시트.
  const [trackerOpen, setTrackerOpen] = useState(false);
  // 즐겨찾기 상단 모달 (t_fd869e5b 요구3) — 컨텍스트 패널 '전체' 링크도 라우트 push 대신 동일 모달.
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  // 트래커 행 재발화 — 실패 user 카드 재전송 (ChatTurnRow onResend와 동일 경로: restoreFailedDraft 폴백 불요,
  // 재발화 버튼은 실패 행 전용이며 실패 시 입력창 복구는 화면 상단 error-bar가 담당).
  const retryFromTracker = useCallback((messageId: string) => {
    const m = messages.find((x) => x.id === messageId);
    if (!m || isDemo || !sessionId) { setUnavailableError('errors.unavailableAction'); return; }
    void retryMessage(m.id);
  }, [messages, isDemo, sessionId, retryMessage]);
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
  // ── 답글/인용 배선 (t_62897e88 백로그④) ─────────────────────────
  // 롱프레스(모바일)/홀드(웹 마우스 450ms, rnw PressResponder) → 액션 시트.
  // 미전송/실패 행은 답글 대상 불가(서버 FK 될 수 없음) + 데모 세션은 시트 자체를 열지 않는다.
  const openActionSheet = useCallback((message: ChatMessage) => {
    if (isDemo || selection.active) return;
    setActionTarget(message);
  }, [isDemo, selection.active]);
  // '답글' 실행 → 인용 바 개방(취소 가능) + 기존 카드의 openThread(스레드)와 달리 발화 자체는 입력바 경유.
  const startReply = useCallback((message: ChatMessage) => {
    if (isDemo || !sessionId || !canReplyTo(message)) { setUnavailableError('errors.unavailableAction'); return; }
    const source = messages.find((m) => m.id === message.id);
    if (!source) return;
    setDraftQuote(localReplyQuote(source, source.role === 'user' ? t('chat.me') : agentName));
    // 음성 계층(A)이면 키보드 개방 nonce로 B 계층을 연다 (t_363c0faa 점프 관례 재사용). PC/네이티브는 입력바 상시 — 무해.
    setComposeNonce((n) => n + 1);
  }, [isDemo, sessionId, messages, agentName, t, setUnavailableError]);
  // 시트 액션 (t_62897e88) — 시트가 실행+종료를 한 번에. 즐겨찾기/포크는 기존 화면 로직 재사용.
  const sheetReply = useCallback(() => { if (actionTarget) startReply(actionTarget); }, [actionTarget, startReply]);
  const sheetFavorite = useCallback(() => { if (actionTarget) handlers.toggleFavorite(actionTarget); }, [actionTarget, handlers]);
  const sheetFork = useCallback(() => { if (actionTarget) forkOf(actionTarget.id); }, [actionTarget, forkOf]);
  const sheetSelect = useCallback(() => { if (actionTarget) beginSelection(actionTarget.id); }, [actionTarget, beginSelection]);
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
  // t_55b7e30c 백로그③ — 연속 발화 그룹핑(텔레그램/Slack식): 발화 그룹 전환(user↔agent, agentId 변경,
  // 공백>60초)에만 헤더 재출력 + 그룹 내 좌 오프셋. t_64af90b0 #3의 firstAgentMessageId(전 대화 첫 카드만) 대체.
  // SENDER_GROUPING=false(롤백 경로) = 구 동작 복원: 첫 에이전트 카드만 header, 오프셋 없음.
  const firstAgentMessageId = useMemo(() => messages.find((m) => m.role === 'agent')?.id, [messages]);
  const senderFlags = useMemo(() => {
    if (!SENDER_GROUPING) {
      const legacy = messages.map((m) => ({ id: m.id, header: m.id === firstAgentMessageId, continuation: false }));
      return new Map(legacy.map((f) => [f.id, f]));
    }
    return new Map(buildSenderGroups(messages).map((f) => [f.id, f]));
  }, [messages, firstAgentMessageId]);
  const times = useMemo(() => new Map(buildTimeGroups(messages, i18n.language).map((g) => [g.id, g.label])), [messages, i18n.language]);
  // 딥링크 스크롤 — 그룹을 찾으면 scrollToIndex + 하이라이트 2.6초, 히스토리 밖이면 loadOlder로 역행 추적
  // 점프 소스 2종 (t_2f45ccb1): 즐겨찾기/피드 딥링크(focusMessageId) + 상단 큐 칩 탭(strip.jump, 우선)
  const cancelFollow = useCallback(() => {
    const t = tailRef.current;
    if (t.raf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(t.raf); else clearTimeout(t.raf);
      t.raf = 0;
    }
    t.budget = 0;
  }, []);
  const jumpTarget = strip.jump?.id ?? focusMessageId;
  const jumpNonce = strip.jump?.nonce ?? 0;
  // nonce 점프 소비 가드 (t_62897e88 발견 결함): 하이라이트 2.8초 소멸이 highlightId dep를 바꾸면
  // effect가 재실행되고, strip.jump 미사용 경로(nonce=0)는 같은 타깃을 무한 재점화한다.
  // 딥링크(focusMessageId)는 세션당 1회뿐이라는 원 계약과 인용 라인 재탭 재점화 요구를 모두 지키려면
  // '성공한 점프의 nonce'를 기억했다가 동일 nonce 재실행을 차단한다.
  const consumedJump = useRef<number | null>(null); // null 시작 — 딥링크 nonce=0과 구분 (초점 진입 1회 발동 보존)
  useEffect(() => {
    if (!jumpTarget) return;
    if (jumpNonce === consumedJump.current) return;
    // setTimeout(0) 지연 — DialogueListScreen의 refresh 패턴과 동일 (effect 동기 setState 회피)
    const find = setTimeout(() => {
      const groupIndex = feed.findIndex((it) => !isDateSeparator(it) && it.items.some((m) => m.id === jumpTarget));
      if (groupIndex >= 0) {
        if (highlightId !== jumpTarget) {
          consumedJump.current = jumpNonce;
          setHighlightId(jumpTarget);
          const groupKey = (feed[groupIndex] as TurnGroup).key;
          const layout = layouts.current.get(groupKey);
          try {
            // 딥링크/칩 상방 점프 = 말미 이탈(사용자 항법). nearBottom 명시 전향 + 이탈 오판
            // 방지를 위해 의도 마킹도 함께(web 이탈 게이트와 무관하게 재추종에 끌려오지 않음).
            cancelFollow();
            nearBottom.current = false;
            tailRef.current.userScrollAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
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
  }, [jumpTarget, jumpNonce, feed, hasMoreHistory, loadingHistory, loadOlder, highlightId, cancelFollow]);
  // ── 꼬리 추종 (t_1731f0f6) ──────────────────────────────────────────
  // growth 이벤트(onContentSizeChange — 신규 카드/스트리밍 delta/타입잉 카드·예/아니오 행
  // 등장)마다 측정 기반 bottom clamp scrollToOffset(contentH - viewportH)을 즉시 1회 +
  // 레이아웃 확정 rAF 재시도 2회 (카드 D: scrollToEnd 단발 금지). 레이아웃이 이벤트보다
  // 늦게 확정되면 첫 스크롤은 옛 끝에 닿고, 확정 시 새 contentSize로 onContentSizeChange가
  // 재발화 → 루프 재시작. 정착(offset≥target-2) 시 즉시 중단. delta 박자마다 재시작이라
  // 한 박자 딜레이는 허용(요구 B)되 최종 완료 시점엔 반드시 끝에 도달한다.
  // (cancelFollow는 딥링크 점프 effect보다 먼저 선언 — TDZ/lint: 사용 전 선언.)
  const followTail = useCallback((steps = 3, animated = false) => {
    const t = tailRef.current;
    if (t.raf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(t.raf); else clearTimeout(t.raf);
      t.raf = 0;
    }
    t.budget = steps;
    const step = () => {
      t.raf = 0;
      if (!nearBottom.current || loadingRef.current) { t.budget = 0; return; }
      t.budget -= 1;
      // 실측 우선 (r5): DOM 노드가 보이면 scrollHeight-clientHeight가 오늘의 진짜 끝.
      // 미러(t.contentH/t.viewportH)는 onContentSizeChange 순서에 낡을 수 있어 r4의
      // '옛 끝에 닿고 정착 오판'을 만들었다. 미러는 노드 미확보 시 폴백.
      const node = scrollBoxNode();
      const target = node ? Math.max(0, node.scrollHeight - node.clientHeight)
        : (t.contentH > 0 && t.viewportH > 0 ? Math.max(0, t.contentH - t.viewportH) : null);
      if (target !== null) {
        const atEnd = node ? node.scrollTop >= target - 2 : offset.current >= target - 2;
        if (atEnd) { // 정착 — 잔여 재시도 불필요. 미러를 실측으로 동기화(r4 stale 쌍 차단).
          t.budget = 0;
          if (node) { offset.current = node.scrollTop; t.contentH = node.scrollHeight; }
          return;
        }
        listRef.current?.scrollToOffset({ offset: target, animated });
      } else listRef.current?.scrollToEnd({ animated }); // 뷰포트 미측정(초기 프레임) — 폴백
      if (t.budget > 0) {
        t.raf = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(step)
          : (setTimeout(step, 16) as unknown as number);
      }
    };
    step();
  }, [scrollBoxNode]);
  useEffect(() => cancelFollow, [cancelFollow]);
  // 이탈 판정 = 오프셋 실질 감소 + 사용자 의도 체인. r4 라이브 실패 root cause(review r4 ②):
  // 확정 카드 교체로 콘텐츠 수축 → 브라우저 clamp로 오프셋 '감소'가 프로그램적으로 발생 +
  // RNW ScrollViewBase는 clamp 100ms 후 합성 scroll-end를 지연 발행 — 그때 콘텐츠가 재성장
  // 하면 (감소+말미 밖) 조합이 사용자 이탈과 구분 불가 → 추종 사망 + 배지 오점등(29s/126s).
  // 의도 신호(wheel/touchmove/키)를 DOM 노드에 직접 바인딩(네이티브 이벤트, RNW props 우회) —
  // 의도 창 내의 감소만 이탈로 전향, 창마다 갱신해 모멘텀·휠 감속 전체가 의도 구간. 딥링크
  // 점프·하단점프는 사용자 항법이므로 코드에서 의도를 명시 마킹. 노드 미확보(네이티브) = 창 0
  // → r4 이전 scrolledUp 단독 동작으로 폴백.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let node: HTMLElement | null = null;
    let raf = 0;
    let tries = 0;
    const mark = () => { tailRef.current.userScrollAt = typeof performance !== 'undefined' ? performance.now() : Date.now(); };
    // 스크롤바 드래그 = 의도(pointermove with button), 단순 탭/선택 = 무의도.
    const onPointerMove = (e: PointerEvent) => { if (e.buttons > 0) mark(); };
    const bind = () => {
      const next = scrollBoxNode();
      if (next && next !== node) {
        node = next;
        next.addEventListener('wheel', mark, { passive: true });
        next.addEventListener('touchmove', mark, { passive: true });
        next.addEventListener('keydown', mark);
        next.addEventListener('pointermove', onPointerMove);
      }
      // 노드 미확보 = 소수 프레임의 과도기 — 600프레임(≈10s) 상한으로 재시도(런어웨이 루프 금지)
      if (!next && ++tries < 600) raf = requestAnimationFrame(bind);
    };
    bind();
    return () => {
      cancelAnimationFrame(raf);
      if (node) {
        node.removeEventListener('wheel', mark);
        node.removeEventListener('touchmove', mark);
        node.removeEventListener('keydown', mark);
        node.removeEventListener('pointermove', onPointerMove);
      }
    };
  }, [scrollBoxNode]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const t = tailRef.current;
    if (layoutMeasurement.height > 0) t.viewportH = layoutMeasurement.height;
    const scrolledUp = contentOffset.y < offset.current - 4;
    offset.current = contentOffset.y;
    const node = scrollBoxNode();
    const gap = node && node.scrollHeight > 0
      ? node.scrollHeight - node.scrollTop - node.clientHeight
      : contentSize.height - layoutMeasurement.height - contentOffset.y;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const intent = Platform.OS !== 'web' || now - t.userScrollAt < 400; // 네이티브=노드 미확보 → scrolledUp 단독(r4 이전 폴백)
    if (intent && Platform.OS === 'web') t.userScrollAt = now; // 체인 갱신 — 관성/감속 구간 전체 유지
    if (gap <= 100) {
      // 정착(근거: 텔레그램/Slack 관습 near-bottom ~100px — 김비서 적용 게이트 t_c6cbcd53 ①):
      // 추종 종료 + 배지 해제. 수축 프레임의 clamp(의도 무관)는 실측 gap≈0 → 여기로 온다.
      // 의도 창 클리어: 말미에 있다는 사실 자체가 프로그램적 딥의 이탈 오판을 무효화 —
      // 직후 clamp 딥은 branch3(재추종)으로, 실제 재이탈은 새 wheel/touch 마킹이 담당.
      cancelFollow();
      t.userScrollAt = 0;
      if (node && node.scrollHeight > 0) { offset.current = node.scrollTop; t.contentH = node.scrollHeight; }
      nearBottom.current = true; setUnseen(0);
    } else if (scrolledUp && intent) {
      // 의도 있는 상방 이탈만 추종 사망(+ 이후 arrival 배지 armed). growth 추종 재시작은
      // onContentSizeChange가 담당(nearBottom false라 성장 무시) — 상태만 지난다.
      cancelFollow();
      nearBottom.current = false;
    } else if (scrolledUp && nearBottom.current && !t.raf) {
      // 의도 없는 감소 + 말미 밖 + 유휴 = 지연 합성 scroll-end의 수축 클램프 딥(r4 29s 서명).
      // 이탈이 아니다 — 즉시 재추종(말미가 목표).
      followTail(3, false);
    }
    syncPinnedDate();
  }, [cancelFollow, followTail, scrollBoxNode, syncPinnedDate]);
  useEffect(() => {
    const previous = previousMessages.current;
    previousMessages.current = messages;
    const ids = new Set(previous.map((m) => m.id));
    const tail = previous[previous.length - 1];
    // ①(t_5c559e85): 인라인 스트림 카드는 확정 행과 같은 자리의 transient — '새 메시지' 카운트 제외(중복 셈).
    const added = messages.filter((m) => m.status !== 'streaming' && !ids.has(m.id) && (!tail || m.turnIndex >= tail.turnIndex)).length;
    if (!nearBottom.current && added) {
      // 목록 변경으로 새 메시지 알림 수를 동기화한다.
      setUnseen((count) => count + added);
    }
  }, [messages]);
  const jumpToEnd = useCallback(() => {
    // 배지 탭 = 명시적 하강. animated bottom clamp + 레이아웃 확정 rAF 재시도(정착 확인).
    // 스트리밍 추종과 동일 루프지만 animated — 콘텐츠가 계속 성장해도 각 스텝이 새 타깃으로
    // 부드럽게 재수렴한다 (t_1731f0f6).
    nearBottom.current = true; setUnseen(0);
    followTail(3, true);
  }, [followTail]);
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
  // t_1213a6a4 P0 회귀 교정 — CellRendererComponent identity는 불변이어야 한다.
  // React는 element type(여기서 renderCell 함수 참조)이 바뀌면 같은 key라도 트리 전체를 unmount/remount한다.
  // t_34f3e92c가 syncPinnedDate(→feed closure)를 deps에 넣으면서 메시지 1건 확정에도 feed이 재생성되어
  // renderCell 새 identity → 전 카드 셀 재마운트 → FormCard submitted/입력값 등 컴포넌트 로컬 상태 소실
  // (wave1 재현 실측: POST 확정 후 전 message-agent 노드 __probed=NEW). VoiceStage cbRef와 동일 latest-ref
  // 우회: 콜백 identity는 고정하고 호출 시점에만 최신 클로저를 소비한다(onLayout은 commit 후 실행 → 효과 순서 안전).
  const syncPinnedDateRef = useRef(syncPinnedDate);
  useEffect(() => { syncPinnedDateRef.current = syncPinnedDate; }, [syncPinnedDate]);
  const renderCell = useCallback(({ children, onLayout, item, style, onFocusCapture }: React.ComponentProps<NonNullable<React.ComponentProps<typeof FlatList<FeedItem>>['CellRendererComponent']>>) => <View style={style} {...{ onFocusCapture }} onLayout={(event) => {
          onLayout?.(event);
          const id = item.key;
          const layout = event.nativeEvent.layout;
          layouts.current.set(id, { y: layout.y, height: layout.height });
          if (isDateSeparator(item)) syncPinnedDateRef.current(); // 구분선 측정/재배치 직후 고정 탭 보정(스크롤 정지 중에도)
          const anchor = prependAnchor.current;
          if (anchor?.id === id && layout.y !== anchor.y) {
            prependAnchor.current = null;
            listRef.current?.scrollToOffset({ offset: Math.max(0, layout.y - anchor.relative), animated: false });
          }
        }}>{children}</View>, []);

  const [viewportInset, setViewportInset] = useState(0);
  // t_4758f25d #311 패딩 계약: A 계층(투명 strip) 활성 기간에만 리스트 하단 패딩 = strip 높이
  // (동일 함수 voiceStageHeight(viewportHeight) — 콘솔과 화면이 같은 산출식을 쓴다).
  // B 계층(키보드 입력바)이 열리면 strip 미렌더 → 통지로 패딩 0(빈 공간 금지).
  const [stageActive, setStageActive] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      // t_dee9e982 최종 루트원인: inset은 '소프트키보드가 실제로 열렸을 때'에만 존재 의미가 있다.
      // 포커스가 없는데 vv 값이 전이 프레임(innerHeight 스케일 혼선, vv.height=0 등)으로 읽히면
      // inset=화면전체(844)가 돼 채팅이 위로 압축·상단고정 — 사용자가 목격한 증상과 정확히 일치.
      // 게이트: input/textarea focus 중에만 계산, 그 외엔 0. (클램프 ih-150는 focus 중에도 방어)
      const ae = document.activeElement as HTMLElement | null;
      const focused = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (!focused) { setViewportInset(0); return; }
      const h = viewport.height;
      if (!Number.isFinite(h) || h <= 0) return;
      const raw = Math.max(0, window.innerHeight - h - viewport.offsetTop);
      setViewportInset(Math.min(raw, Math.max(0, window.innerHeight - 150)));
    };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    update();
    const retry = setTimeout(update, 250);
    return () => { clearTimeout(retry); viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); window.removeEventListener('resize', update); window.removeEventListener('orientationchange', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); };
  }, []);

  // 후속 질문 칩 전송 (t_1797f432 ③): 입력창 경유 없이 곧바로 send — 실패 시 원문 복원/재시도는 performSend 책임.
  const sendSuggested = useCallback((q: SuggestedQuestion) => {
    if (isDemo) return;
    void send(q.text);
  }, [isDemo, send]);

  // 공감 재질문 카드 하단 예/아니요 버튼 행 + 조이스틱 끝방향 ack (t_043539ff → t_c62a2eb7 → t_64e3edd6) —
  // 전송 payload는 백엔드 isConfirmationUtterance 집합과 일치하는 라벨 텍스트('예'/'아니요', en Yes/No) 1회 send.
  // t_64e3edd6: ① 표시 후 2.5초 미터치 자동 소진(useAckChip 타이머) ② ack 결과 user 카드는 렌더 숨김
  // ③ 좌예·우아니요 조이스틱은 이 버튼 행이 활성일 때만 (VoiceStage ackActive).
  // t_cc232982 요구3: 답변 토큰 성장 중(answer.done 전)이면 버튼 행 억제 — 반쯤 쓰인 카드에
  // 예/아니요가 붙어 자동진행과 충돌하는 것을 막는다. done 카드(saving 구간)는 해제.
  const ackChip = useAckChip(messages, streams.some((s) => !s.done));
  const hiddenAckIds = useMemo(() => ackResultCardIds(messages, [t('chat.ackYes'), t('chat.ackNo')]), [messages, t]);
  const sendAck = useCallback((text: string) => {
    if (isDemo) return;
    void send(text);
  }, [isDemo, send]);

  const renderFooter = useCallback(() => <ChatFeedFooter
    typing={typing} typingQuip={typingQuip} agentName={agentName} activeCount={activeCount}
    streams={streams} suggested={suggested} isDemo={isDemo} onSendSuggested={sendSuggested}
    hideQuip={!!relay}
    // t_55b7e30c: 목록 꼬리가 에이전트 행이고 60초 창 내면 그룹 지속 → 타이핑/스트리밍 카드 이름 생략
    showSenderName={SENDER_GROUPING ? streamingHeaderAfter(messages[messages.length - 1]) : true}
  />, [typing, typingQuip, agentName, activeCount, streams, suggested, isDemo, sendSuggested, relay, messages]);

  const renderHeader = useCallback(() => <ChatFeedHeader
    hasMoreHistory={hasMoreHistory} loadingHistory={loadingHistory} isDemo={isDemo} onLoadHistory={() => void loadHistory()}
  />, [hasMoreHistory, isDemo, loadHistory, loadingHistory]);

  return (
    <View style={styles.shell}>
    <KeyboardAvoidingView
      style={[styles.container, webScreenMotion('mat-slide-from-right'), { paddingBottom: viewportInset, position: 'relative' }]}
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
        showTrackerButton={!wide || Platform.OS !== 'web'}
        onBack={() => navigation.goBack()}
        onOpenThreads={() => setThreadsOpen(true)}
        onOpenPending={() => setPendingOpen(true)}
        onOpenTracker={() => setTrackerOpen(true)}
        onBeginSelection={() => beginSelection()}
      />

      {/* 상단 질문 큐 스트립 (t_2f45ccb1 + 9/28 확장) — 순번+원문+상태 칩. 0건 완전 숨김, 좌측 카운터, 칩 재탭(펼침) 시 답글/갈라내기.
          t_64e3edd6 ③ (#324/#325 QUIET_PROGRESS): 스트리밍/타이핑 중에는 칩 행 숨김 — 병렬 위젯 창 축소,
          카드 스트림+입력 위 한 줄만 남긴다. 런 종료 후 복원(도중 칩 갱신도 잠시 숨김 — 의도된 단순화). */}
      <QueueStrip items={QUIET_PROGRESS && (typing || streams.length > 0) ? [] : strip.items} canFork={canFork && !isDemo} onJump={strip.requestJump} onReply={openThreadOf} onFork={forkOf} />
      <ThreadListModal visible={threadsOpen} threads={threads} onClose={() => setThreadsOpen(false)} onOpenThread={openThreadOf} />
      {/* 답변 대기 모달 (t_363c0faa) — 발췌 목록 + 예/아니오 빠른 회신 + freeform 점프. 해소 스냅샷(count 0) 시 자동 닫힘. */}
      <PendingReplyModal
        visible={pendingOpen}
        items={pendingReplies}
        onClose={() => setPendingOpen(false)}
        onQuickReply={(_messageId, utterance) => sendPendingReply(utterance)}
        onJumpCompose={jumpComposePending}
      />
      {/* 카드 롱프레스 액션 시트 (t_62897e88) — 답글/즐겨찾기/갈라내기/선택. transparent Modal:
          FlatList 히트테스트가 카드 위 드롭다운을 압도하는 루트cause 교훈(t_3116c5bc) 재발 방지 */}
      <MessageActionSheet
        visible={!!actionTarget}
        excerpt={actionTarget ? (actionTarget.content || '').replace(/\s+/g, ' ').slice(0, 80) : ''}
        canFork={canFork && !isDemo}
        favorited={!!(actionTarget && decorate(actionTarget).favorite)}
        echoOn={sheetEchoOn}
        onClose={() => setActionTarget(null)}
        onReply={sheetReply}
        onFavorite={sheetFavorite}
        onFork={sheetFork}
        onSelect={sheetSelect}
        onToggleEcho={sheetToggleEcho}
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

      <View style={styles.listWrap} ref={(el) => { listWrapRef.current = (el as unknown as HTMLElement | null) ?? null; }}>
      <FlatList
        ref={listRef}
        data={feed}
        renderItem={({ item }) => isDateSeparator(item) ? <DateSeparatorRow separator={item} /> : <ChatTurnRow
          group={item}
          timeLabel={times.get(item.key)}
          highlightId={highlightId}
          ackChipId={ackChip?.id ?? null}
          hiddenAckIds={hiddenAckIds}
          onSendAck={sendAck}
          decorate={decorate}
          handlers={handlers}
          presetCategory={presetCategory}
          canFork={canFork}
          agentName={agentName}
          senderFlags={senderFlags}
          sessionTitle={sessionTitle}
          isDemo={isDemo}
          queue={queue}
          selectionActive={selection.active}
          selectedIds={selection.ids}
          onToggleSelect={toggleSelect}
          onResend={(message) => { void retryMessage(message.id).then((result) => { if (!result.ok) setInput((current) => restoreFailedDraft(current, message.draft ?? message.content)); }); }}
          onDelete={deleteMessage}
          onMessageLongPress={openActionSheet}
          onQuoteJump={requestJump}
        />}
        CellRendererComponent={renderCell}
        onScrollBeginDrag={() => { prependAnchor.current = null; }}
        onScroll={onScroll}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={Platform.OS === 'web' ? undefined : { minIndexForVisible: 0 }}
        onContentSizeChange={(_w, h) => {
          // 꼬리 추종 트리거 (t_1731f0f6): 신규 카드·스트리밍 delta·타입잉 카드/예아니오 행
          // 등장 = contentSize grow(이벤트가 새 높이 실측 동봉). scrollToEnd 단발(old)은 레이아웃
          // 확정 전에 실행돼 라이브에서 끝에 닿지 못했다 → 측정 기반 rAF 루프(즉시+재시도 2)로 교체.
          const t = tailRef.current;
          if (h <= 0) return;
          t.contentH = h;
          const node = scrollBoxNode();
          const maxOffset = node ? Math.max(0, node.scrollHeight - node.clientHeight)
            : (t.viewportH > 0 ? Math.max(0, h - t.viewportH) : null);
          if (maxOffset !== null && offset.current > maxOffset) {
            // 수축 clamp: 스트림 카드→짧은 확정 카드 교체 등으로 콘텐츠가 줄면 브라우저가
            // scroll 이벤트 없이 bottom clamp한다(오프셋 미러가 낡은 채로 말미에 도달). 미러를
            // 동기화하고 정착 처리 — 배지 잔등/추종 오탐 방지 (t_1731f0f6).
            offset.current = node ? node.scrollTop : maxOffset;
            if (node) t.contentH = node.scrollHeight;
            cancelFollow();
            nearBottom.current = true; setUnseen(0);
          } else if (nearBottom.current && !loadingHistory) {
            followTail(3, false);
          }
        }}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[styles.listContent, chatListPaddingOverride(stageActive, viewportHeight)]}
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
      {/* 상단 고정 날짜 탭 오버레이 (t_34f3e92c②) — 스크롤 박스(listWrap) 좌상단 absolute.
          본문 DOM에는 data-testid="pinned-date" 한 개만 존재, 인-플로우 구분선과 별도 testID. */}
      <DatePinnedHeader ref={pinnedRef} />
      </View>

      {unseen > 0 && <Button testID="unseen-badge" onPress={jumpToEnd} textColor={colors.accent} style={[styles.msgCard, { position: 'relative', zIndex: 100 }]}>{t('chat.unseen', { countText: formatNumber(unseen, i18n.language) })}</Button>}
      {/* PTT 녹음 상태 배너 (확정 ④: 하단 웨이브폼 + 말하세요) — 웹에서만 활성.
          t_e735d936/t_4758f25d: 음성 계층(A)에서는 스테이지의 링+리본이 녹음 시각화 자체 — 배너 중복 금지. */}
      {Platform.OS === 'web' && !isDemo && !voiceMode && (
        <PttBannerComponent
          active={ptt.active || talking}
          keyLabel={pc ? pttKeyLabel(getPttKey() ?? 'KeyV') : undefined}
          mode={getPttMode() ?? 'hold'}
          error={voiceMode ? null : ptt.error}
          pending={ptt.pending}
        />
      )}
      {/* 다중 선택 액션 바 — t_a0e998cc(대표님 9/26): 보관(즐겨찾기 중복)·볼트로(기본 저장) 제거, 이어가기만 남김 */}
      {selection.active && <View style={styles.selectionBar} testID="selection-bar">
        <Text style={styles.selectionCount}>{t('selection.count', { countText: formatNumber(selection.ids.length, i18n.language) })}</Text>
        <Button compact mode="contained" onPress={forkSelected} buttonColor={colors.accent} textColor={colors.onPrimary} testID="selection-continue">{t('selection.continue')}</Button>
      </View>}
      {/* 비서실 백스테이지 릴레이 자막 (t_961ca593 Phase B 案①) — 입력 콘솔 위 상시 1줄, stage 전환 페이드.
          relay=null(비서 외 페르소나=이벤트 0건, 데모 포함)이면 렌더 0 — 기존 레이아웃 DOM 불변.
          t_4758f25d: A 계층(transparent strip) 활성 시 자막이 strip 아래 흐름에 잠기지 않도록
          strip 상단 경계에 absolute로 얹는다 (#311 '입력 콘솔 위 배치' 계약 유지). */}
      {stageActive ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: voiceStageHeight(viewportHeight), zIndex: 90 }}>
          <RelayCaptionStrip caption={relay} />
        </View>
      ) : (
        <RelayCaptionStrip caption={relay} />
      )}
      {/* 하단 입력 영역 (t_91cb659c): 첨부 스테이지 + 음성 콘솔(1차) + 키보드 입력바(2차) 조립은 ChatInputConsole 소유
          (초장문 안내 한 줄 포함).
          t_e735d936 요구 1 유지: 웹 모바일은 기본이 음성 콘솔(조이스틱 홀드-투-톡), 입력창은 키보드를
          열었을 때만 나타나는 2차 UI. PC/네이티브/데모는 기존 입력창 상시. */}
      {/* 답글 발송 대기 인용 바 (t_62897e88 백로그④) — 입력 콘솔 바로 위, ✕로 취소(발행 중단) */}
      {draftQuote && <ReplyDraftBar quote={draftQuote} onCancel={() => setDraftQuote(null)} />}
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
        level={ptt.level}
        pttError={ptt.error}
        pttPending={ptt.pending}
        viewportHeight={viewportHeight}
        onPressHoldStart={ptt.startHold}
        onHoldEnd={ptt.endHold}
        onHoldAbort={ptt.abortHold}
        onSendAck={sendAck}
        ackActive={!!ackChip}
        onStageActiveChange={setStageActive}
        forceOpenKeyboard={composeNonce}
      />
      {/* #52: 스레드 바텀시트 — 카드 탭 시 디텐트 시트로 열림 (전체 화면 라우트 아님) */}
      <ThreadSheet ref={threadSheet} navigation={navigation} />
      {/* 내 질문 트래커 모바일 대체 경로 (t_fd869e5b 요구3 확장) — wide 미만(패널 미렌더)에서
          앱바 '현황' 버튼 → 하단 시트. 행 탭=카드 점프, 답글 칩=스레드 열기, 실패=재발화. */}
      <QuestionTrackerModal
        visible={trackerOpen}
        onClose={() => setTrackerOpen(false)}
        messages={messages}
        pendingReplies={pendingReplies}
        streams={streams}
        queue={queue}
        onJump={(id) => { setTrackerOpen(false); requestJump(id); }}
        onOpenThread={(id) => { setTrackerOpen(false); openThreadOf(id); }}
        onRetry={retryFromTracker}
      />
      {/* 즐겨찾기 상단 모달 (t_fd869e5b 요구3) — 컨텍스트 패널 '전체' 링크 진입점 */}
      <FavoritesModal visible={favoritesOpen} onClose={() => setFavoritesOpen(false)} navigation={navigation} />
      {/* 사진 편집기 시트 (t_4497cfce P0-1) — 첨부 선택 후 자동 오픈, 저장 시 스테이지 교체 */}
      <PhotoEditorSheet visible={!!editing} source={editing?.source ?? null} onClose={() => setEditing(null)} onSave={onEditSave} />
    </KeyboardAvoidingView>
    {/* PC wide(≥1100): 우측 컨텍스트 패널 상시 노출 — 모바일/태블릿에서는 렌더 제외(단일 컬럼 유지,
        트래커는 앱바 '현황' 버튼 → 하단 시트로 대체: QuestionTrackerModal) */}
    {wide && Platform.OS === 'web' && (
      <ContextPanel
        sessionId={sessionId ?? null}
        messages={messages}
        onOpenFavorites={() => setFavoritesOpen(true)}
        pendingReplies={pendingReplies}
        streams={streams}
        queue={queue}
        onJump={requestJump}
        onOpenThread={openThreadOf}
        onRetry={retryFromTracker}
      />
    )}
    </View>
  );
}

