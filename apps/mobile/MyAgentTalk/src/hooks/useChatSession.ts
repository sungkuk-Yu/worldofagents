import { parseThread, mergeThread } from '../lib/cardLogic';
import { errorKey } from '../lib/errorKeys';
// 마이에이전트톡은 사람↔에이전트 대화 앱이다. 처리중 표시는 실행별 상태를 따르며,
// 지연 안내는 stage에 대응하는 번역 키로 전달한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, connectVoiceSocket, VoiceSocket, PresenceDevice } from '../lib/api';
import { detectDeviceLabel, peersOf } from '../lib/deviceLabel';
import { readCursorFor, shouldSendCursor } from '../lib/resumeLogic';
import {
  appendOptimistic, ChatMessage, confirmTurn, createTurnCoordinator, createTypingTracker,
  mergeIncoming, nextBackoffMs, nextTurnIndex, normalizeServerMessages, oldestCursor,
  prependPage, ServerMessageRow, TurnEvent, createSequenceTracker, validateMessageInput, reduceStreams, StreamingAnswer, STREAM_FLUSH_DEBOUNCE_MS,
  normalizeQueueItems, QueueItem, normalizeSuggestedQuestions, SuggestedQuestion, EMPTY_QUEUE, isRecord, buildThreadIndex, mergeThreadIndex, ThreadIndexEntry, EMPTY_THREADS,
  normalizeReplyPending, PendingReplyItem, EMPTY_PENDING_REPLIES,
  RelayCaption, applyRelayEvent, clearRelayOnRunEnd,
} from '../lib/chatLogic';

export const PAGE_SIZE = 30;
export type SendResult = { ok: true } | { ok: false; error: string };
export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';
export interface UseChatSessionOptions { sessionId?: string | null; agentId?: string | null; rootMessageId?: string; deferConnection?: boolean; device?: string; /** WS favorite.updated 수신 시 카드 즐겨찾기 갱신 (t_b89df485) */ onFavoriteUpdated?: (messageId: string, favorite: boolean) => void }
export interface UseChatSessionReturn {
  sessionId: string | null;
  rootMessage: ChatMessage | null;
  messages: ChatMessage[];
  typing: boolean;
  activeCount: number;
  streams: StreamingAnswer[];
  retryConnection: () => void;
  retryMessage: (id: string) => Promise<SendResult>;
  deleteMessage: (id: string) => void;
  quip: string | null;
  mode: 'live' | 'demo';
  connection: Connection;
  lastError: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  send: (content: string, attachments?: { ids: string[]; previews: ChatMessage['pendingAttachments'] }) => Promise<SendResult>;
  retryLastSend: () => Promise<SendResult>;
  loadOlder: () => Promise<void>;
  enterDemo: () => void;
  clearError: () => void;
  // ── 크로스 디바이스 연속성 (t_eded715c / 백엔드 t_d75ca81c) ──
  /** 같은 세션을 실시간으로 보고 있는 다른 디바이스 라벨 (presence, 본인 제외) */
  peers: string[];
  /** 지금 이 세션이 PTT로 녹음 중인지 (audio.started 기준, 서버 안전망 종료 시 false) */
  talking: boolean;
  /** PTT 브리프 — audio.start→PCM 프레임→audio.end/cancel 캐리어 (데모/미연결 시 ready=false).
   *  mode는 호출자(화면)가 userPrefs에서 읽어 전달 — 이 훅은 preferences 의존 없이 캐리어만 담당. */
  talk: {
    ready: boolean;
    start: (mode?: 'hold' | 'toggle') => void;
    frame: (pcm: ArrayBuffer) => void;
    end: () => void;
    cancel: () => void;
  };
  // 질문 큐 체크포인트 (t_1797f432 ②): 세션 message_queue 스냅샷 — 빈 배열이면 표시 없음
  queue: QueueItem[];
  /** 비서실 릴레이 자막 (t_961ca593 Phase B): relay.updated 최신 1줄 — 이벤트 0건(비서 외 페르소나)이면 null → 렌더 없음 */
  relay: RelayCaption | null;
  /** GET /queue 보조 폴링이 쓰는 queue 스냅샷 적용기 (안정 ref, t_91cb659c 스트립 훅 응집) */
  applyQueueSnapshot: (items: QueueItem[]) => void;
  // 답변 대기 (t_363c0faa / 백엔드 t_811e176c): 회신 필요 메시지 스냅샷 — 빈 배열이면 배지/칩 렌더 없음
  pendingReplies: PendingReplyItem[];
  /** GET /pending 보조 폴링이 쓰는 스냅샷 적용기 (applyQueueSnapshot과 동일 단일 상태원천 원칙) */
  applyPendingSnapshot: (items: PendingReplyItem[]) => void;
  /** 답글 스레드 인덱스 (t_2f45ccb1 확장 3·4) — 현재 서버 로드 범위 */
  threads: ThreadIndexEntry[];
  /** 후속 질문 (t_1797f432 ③): 최근 run.completed의 suggested_questions (없으면 []) */
  suggested: SuggestedQuestion[];
  // 기존 화면과 병행 배포를 위한 호환 필드
  typingQuip: string | null;
  isDemo: boolean;
  error: string | null;
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  ready: boolean;
}
let executionCounter = 0;
const errorText = errorKey;

function createRuntime(onChange: (active: boolean, quip: string | null, count: number) => void) {
  const tracker = createTypingTracker(onChange, true);
    return {
      tracker, coordinator: createTurnCoordinator(tracker), messages: [] as ChatMessage[],
      historyCursor: null as number | null,
      generation: 0, sid: null as string | null, demo: false, initialized: false, loadingOlder: false,
      retry: () => {},
      scopedRuns: new Set<string>(),
      runStages: new Map<string, string>(),
      sequence: createSequenceTracker(), streams: [] as StreamingAnswer[],
      // 동일 텍스트 in-flight 가드 (t_4af94b1c①) — Enter+전송 동시 탭의 2차 호출은 낙관 행/POST 자체를 만들지 않는다.
      inflightSends: new Set<string>(),
      socket: null as VoiceSocket | null, stop: () => {},
      lastFailedContent: null as { content: string; id: string; attachments?: { ids: string[]; previews: ChatMessage['pendingAttachments'] } } | null,
      demoTimers: new Map<ReturnType<typeof setTimeout>, (result: SendResult) => void>(),
      // 연속성 (t_eded715c): 읽기 커서 PUT dedup / PTT 세그먼트 열림
      lastSentCursor: null as number | null,
      audioOpen: false,
    };
}

export function useChatSession(sessionId?: string | null, opts?: UseChatSessionOptions): UseChatSessionReturn;
export function useChatSession(opts?: UseChatSessionOptions): UseChatSessionReturn;
export function useChatSession(
  sessionOrOptions: string | null | UseChatSessionOptions | undefined = undefined, options: UseChatSessionOptions = {}
): UseChatSessionReturn {
  const opts = typeof sessionOrOptions === 'object' && sessionOrOptions !== null
    ? sessionOrOptions : { ...options, sessionId: sessionOrOptions ?? options.sessionId };
  const requestedSession = opts.sessionId;
  const agentId = opts.agentId;
  const rootMessageId = opts.rootMessageId;
  const deferConnection = opts.deferConnection;
  // favorite.updated 콜백은 소켓 클로저가 최초 렌더에 고착되지 않게 ref로 최신값 유지 (t_b89df485)
  const favoriteCbRef = useRef(opts.onFavoriteUpdated);
  favoriteCbRef.current = opts.onFavoriteUpdated;
  const [rootMessage, setRootMessage] = useState<ChatMessage | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(requestedSession ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [quip, setQuip] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const [connection, setConnection] = useState<Connection>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [streams, setStreams] = useState<StreamingAnswer[]>([]);
  // 연속성 상태 (t_eded715c): presence 피어 / PTT 녹음 중 표시
  const [peers, setPeers] = useState<string[]>([]);
  const [talking, setTalking] = useState(false);
  // 질문 큐 체크포인트 (t_1797f432 ②) — 서버 스냅샷 그대로 보유. 이벤트 미수신 시 [] → 렌더 없음.
  const [queue, setQueue] = useState<QueueItem[]>(EMPTY_QUEUE);
  // 답변 대기 (t_363c0faa) — reply.pending.updated 스냅샷 그대로 보유. [] → 배지/칩 렌더 없음.
  const [pendingReplies, setPendingReplies] = useState<PendingReplyItem[]>(EMPTY_PENDING_REPLIES);
  // 답글 스레드 인덱스 (t_2f45ccb1 확장 3·4) — 서버 로드 범위 내 스레드 목록/종료 배지/정렬.
  const [threads, setThreads] = useState<ThreadIndexEntry[]>(EMPTY_THREADS);
  // 후속 질문 (t_1797f432 ③) — run.completed의 structured_payload에서 최종 1세트만 유지.
  const [suggested, setSuggested] = useState<SuggestedQuestion[]>([]);
  // 비서실 릴레이 자막 (t_961ca593 Phase B) — 최신 1줄 휘발성 연출. 이벤트 0건(비서 외 페르소나)이면 항상 null → 렌더 없음.
  const [relay, setRelay] = useState<RelayCaption | null>(null);
  // 디바이스 라벨은 첫 감지값으로 고정(연결 유지 중 라벨이 바뀌면 presence가 요동침).
  // 화면이 opts.device를 주면 그 값을 쓰고, 없으면 창 폭/navigator 기반 순수 감지(RN import 없음).
  const deviceRef = useRef(opts.device ?? detectDeviceLabel(
    typeof globalThis !== 'undefined' && typeof (globalThis as { window?: { innerWidth?: number } }).window?.innerWidth === 'number'
      ? (globalThis as unknown as { window: { innerWidth: number } }).window.innerWidth : 390));
  const runtimeRef = useRef(createRuntime((active, text, count) => {
    setTyping(active); setQuip(text); setActiveCount(count);
  }));
  // 동시 전송도 최신 목록을 읽도록 렌더를 기다리지 않고 원자적으로 반영한다.
  const updateMessages = useCallback((update: (prev: ChatMessage[]) => ChatMessage[]) => {
    const runtime = runtimeRef.current;
    runtime.messages = update(runtime.messages);
    setMessages(runtime.messages);
  }, [runtimeRef]);

  // 큐 스냅샷 보조 폴링은 useQueueStrip(스트립 도메인 훅)으로 응집 (t_91cb659c 리팩터링).
  // 이 훅은 WS queue.updated / GET messages 스냅샷의 단일 queue 상태 원천만 유지하고,
  // 폴링의 동일 상태 적용은 applyQueueSnapshot(안정 ref)을 통해 이루어진다 (이중 상태원천 금지).
  const applyQueueSnapshot = useCallback((items: QueueItem[]) => setQueue(items), []);
  // 답변 대기 스냅샷 적용기 (t_363c0faa) — WS reply.pending.updated 우선, GET /pending은 부트스트랩/보조.
  const applyPendingSnapshot = useCallback((items: PendingReplyItem[]) => setPendingReplies(items), []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const generation = ++runtime.generation;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    // 'done' 자막 홀드 타이머 (t_961ca593) — 서버는 done과 run.completed를 같은 틱에 낸다;
    // 즉시 정리하면 마지막 자막이 0프레이드로 소실 → 홀드 후 페이드아웃(제로잔류).
    let relayHoldTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let connectedOnce = false;
    let socketVersion = 0;
    const alive = () => !disposed && generation === runtime.generation;
    // ── t_cc232982: answer.delta 배칭 발행기 (김비서 적용 게이트 1 — 토큰마다 재렌더 금지) ──
    // 선행 즉시 + STREAM_FLUSH_DEBOUNCE_MS 창 내 후행 통합: 창이 열려 있는 동안의 후속 delta는
    // runtime.streams에만 누적하고 만료 시 최종본을 1회 발행 → 렌더 주기가 ~80ms로 제한된다.
    // 터미널(answer.done/message.new/run.failed·cancelled·강제 재동기화·stop)은 무조건 즉시 플래시 —
    // 배칭 창이 확정 행을 덮거나 잔여 타이머가 세션 전환 후 소환되는 것을 막는다.
    let streamFlushTimer: ReturnType<typeof setTimeout> | undefined;
    let streamFlushOpen = false;
    const cancelStreamFlush = () => {
      if (streamFlushTimer) clearTimeout(streamFlushTimer);
      streamFlushTimer = undefined; streamFlushOpen = false;
    };
    const publishStreams = (type?: string) => {
      if (type !== 'answer.delta') { cancelStreamFlush(); setStreams(runtime.streams); return; }
      if (streamFlushOpen) return; // 창 내 누적 — 만료 시 최종본 1회 발행
      streamFlushOpen = true;
      setStreams(runtime.streams); // 선행 플래시 — 첫 delta는 즉시 보여 '성장하는 카드'가 즉시 시작된다
      streamFlushTimer = setTimeout(() => {
        streamFlushTimer = undefined; streamFlushOpen = false;
        if (!alive() || !runtime.streams.length) return;
        setStreams([...runtime.streams]); // 후행 통합 — 창 동안 쌓인 토큰을 한 번에
      }, STREAM_FLUSH_DEBOUNCE_MS);
    };
    runtime.demo = mode === 'demo';
    runtime.initialized = false;
    runtime.sid = null;
    runtime.tracker = createTypingTracker((active, text, count) => { setTyping(active); setQuip(text); setActiveCount(count); }, true);
    runtime.coordinator = createTurnCoordinator(runtime.tracker);
    runtime.sequence = createSequenceTracker();
    runtime.runStages.clear();
    runtime.scopedRuns.clear();
    runtime.streams = [];
    // 외부 세션이 바뀌면 이전 스트림 표시를 초기화한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStreams([]);
    setRelay(null); // 릴레이 자막도 세션 전환 잔류 금지 (t_961ca593) — 위 disable이 인접 setState 묶음을 커버
    setPeers([]);
    setTalking(false);
    runtime.audioOpen = false;
    runtime.lastSentCursor = null;
    runtime.loadingOlder = false;
    runtime.historyCursor = null;
    // 외부 세션 리소스를 바꿀 때만 UI 상태를 초기화한다.
    setRootMessage(null);
    setLoadingOlder(false);
    setReady(false);
    setHasOlder(false);
    // 세션 전환 시 큐/후속 질문 잔상 제거 (t_1797f432) — 이전 세션 스냅샷이 새 화면에 새면 안 된다.
    setQueue(EMPTY_QUEUE);
    setPendingReplies(EMPTY_PENDING_REPLIES); // 답변 대기 잔상 동일 원칙 (t_363c0faa)
    setThreads(EMPTY_THREADS);
    setSuggested([]);
    const stop = () => {
      disposed = true;
      ++runtime.generation;
      cancelStreamFlush(); // t_cc232982: 잔여 배칭 타이머 폐기 — 구 세션 스트림이 새 세션에 소환 금지
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (relayHoldTimer) clearTimeout(relayHoldTimer); // done 홀드도 화면 수명 내 자원 (t_961ca593)
      runtime.socket?.close();
      runtime.socket = null;
      runtime.tracker.endAll();
      for (const [timer, resolve] of runtime.demoTimers) {
        clearTimeout(timer);
        resolve({ ok: false, error: 'errors.closed' });
      }
      runtime.demoTimers.clear();
    };
    runtime.stop = stop;
    if (mode === 'demo') {
      updateMessages(() => []);
      setSessionId(null);
      setConnection('offline');
      setReady(true);
      runtime.initialized = true;
      return stop;
    }
    updateMessages(() => []);
    runtime.lastFailedContent = null;
    setSessionId(requestedSession ?? null);
    setLastError(null);
    setConnection('connecting');

    async function refresh(sid: string, initial: boolean, recovery: 'latest' | 'gap' | 'all' = 'latest') {
      if (rootMessageId) {
        const parsed = parseThread(await api.getThread(rootMessageId), rootMessageId);
        if (!alive()) return;
        setRootMessage(parsed.root);
        updateMessages((prev) => mergeThread(prev, parsed.replies, rootMessageId));
        return;
      }
      const env = await api.getMessages(sid, { limit: PAGE_SIZE });
      if (recovery !== 'latest' && env.ok && env.data) {
        let page = env;
        const rows = [...env.data];
        const known = new Set(runtime.messages.filter((message) => message.status === 'sent').map((message) => message.id));
        while (page.meta?.has_more && page.data?.length && alive() &&
          (recovery === 'all' || !page.data.some((message) => known.has(message.id)))) {
          const before = Math.min(...page.data.map((row) => row.turn_index));
          page = await api.getMessages(sid, { before, limit: PAGE_SIZE });
          if (!page.ok || !page.data) throw new Error('errors.recovery');
          rows.push(...page.data);
          if (!page.data.length || Math.min(...page.data.map((row) => row.turn_index)) >= before) break;
        }
        env.data = rows;
      }
      if (!env.ok || !env.data) throw new Error('errors.history');
      if (!alive()) return;
      const allRows = normalizeServerMessages(env.data);
      updateMessages((prev) => mergeIncoming(prev, allRows.filter((m) => !m.parentMessageId)));
      // t_cc232982 요구4 정합성: 재조회된 확정 answer 행(run_id 또는 message_id 일치)이 있으면
      // 그 런의 성장 중인 구(舊) 스트림 카드를 제거한다 — disconnect/reconnect 후 그 런의
      // answer.done·message.new가 영원히 안 와도 반쯤 쓰인 카드+커서가 고아로 남지 않는다.
      // (확정 행이 본문 원천 — 누적 텍스트 유실 없이 서버 진실로 수렴.)
      const confirmedRuns = new Set(allRows.filter((m) => m.role === 'agent' && m.sourceNeuron === 'answer' && m.runId).map((m) => m.runId as string));
      const confirmedIds = new Set(allRows.map((m) => m.id));
      if (runtime.streams.some((s) => (s.runId && confirmedRuns.has(s.runId)) || (s.messageId && confirmedIds.has(s.messageId)))) {
        runtime.streams = runtime.streams.filter((s) => !((s.runId && confirmedRuns.has(s.runId)) || (s.messageId && confirmedIds.has(s.messageId))));
        publishStreams();
      }
      // 답글 스레드 인덱스 (t_2f45ccb1 확장 3): 답글 행은 메시지에 넣지 않지만 root_message_id/답글 수로 인덱스 갱신.
      setThreads((prev) => mergeThreadIndex(prev, buildThreadIndex(allRows)));
      // 큐 스냅샷 복원 (t_1797f432 ②): 백엔드가 GET messages에 queue 배열을 실어주면 재진입 시에도
      // 체크포인트 표시가 유지된다. 필드 없으면 조용히 스킵(WS queue.updated만으로도 동작).
      const queueSnap = normalizeQueueItems((env as unknown as { queue?: unknown }).queue);
      if (queueSnap.length) setQueue(queueSnap);
      // 답변 대기 GET /pending 부트스트랩은 usePendingReplies(보조 폴링 훅)이 소유 (t_363c0faa) —
      // 이 훅은 WS reply.pending.updated 단일 상태원천만 유지 (useQueueStrip/applyQueueSnapshot 대칭).
      // 후속 질문 복원 (t_1797f432 ③): 마지막 에이전트 행 payload의 suggested_questions 세트 (없으면 빈 배열).
      const lastAgent = [...allRows].reverse().find((m) => m.role === 'agent' && m.payload?.suggested_questions !== undefined);
      if (lastAgent) setSuggested(normalizeSuggestedQuestions(lastAgent.payload?.suggested_questions));
      if (initial) {
        runtime.historyCursor = oldestCursor(allRows);
        setHasOlder(Boolean(env.meta?.has_more) && allRows.length > 0);
      }
    }
    function connect(sid: string) {
      if (!alive()) return;
      const version = ++socketVersion;
      const current = () => alive() && version === socketVersion;
      let disconnected = false;
      const reconnect = () => {
        if (!current() || disconnected) return;
        disconnected = true;
        setConnection('reconnecting');
        reconnectTimer = setTimeout(() => {
          runtime.socket?.close();
          connect(sid);
        }, nextBackoffMs(attempt++));
      };
      try {
        runtime.socket = connectVoiceSocket(sid, {
          onStatusChange: (status) => {
            if (!current()) return;
            if (status === 'connected' && !disconnected) {
              setConnection('live');
              runtime.socket?.send(JSON.stringify({ type: 'subscribe', session_id: sid, last_seq: runtime.sequence.lastSeq, device: deviceRef.current }));
              const recovering = connectedOnce || attempt > 0;
              connectedOnce = true;
              attempt = 0;
              if (recovering) void refresh(sid, false, 'gap').catch(() => {
                if (current()) setLastError('errors.recovery');
              });
            } else if (status === 'disconnected') reconnect();
          },
          // 릴레이 자막 전용 경로 (t_961ca593 Phase B): api.ts switch case 'relay.updated' → 여기.
          // seq 재생 필터와 무관한 휘발성 연출(presence/favorite/queue와 동일 원칙) — 커튼 멱등은
          // applyRelayEvent(단조·dedup)가 보장하므로 eventlog 재생 이중 도착도 안전하다.
          onRelay: (msg) => {
            if (!current() || disconnected || (msg.session_id && msg.session_id !== sid)) return;
            setRelay((prev) => applyRelayEvent(prev, msg as unknown as Record<string, unknown>));
          },
          onRaw: (raw) => {
            if (!current() || disconnected || (raw.session_id && raw.session_id !== sid)) return;
            const type = raw.type;
            // 연속성 이벤트 (t_d75ca81c): 허브 이벤트 로그 미기록 → seq 필터 앞에서 처리
            if (type === 'presence.update') {
              if (Array.isArray(raw.devices)) setPeers(peersOf(raw.devices as PresenceDevice[], deviceRef.current));
              return;
            }
            // 즐겨찾기 실시간 동기화 (t_b89df485 김비서 지시): 같은 계정의 다른 디바이스가 PATCH한
            // favorite.updated를 카드 로컬 상태에 반영. seq 미채번이라 필터 앞에서 처리한다.
            if (type === 'favorite.updated') {
              if (typeof raw.message_id === 'string' && typeof raw.favorite === 'boolean') favoriteCbRef.current?.(raw.message_id, raw.favorite);
              return;
            }
            // 질문 큐 스냅샷 (t_1797f432 ② / 백엔드 t_344e047a): queue.updated = 세션 큐 전체 교체.
            // 허브 이벤트 로그 미채번일 수 있어 seq 필터 앞에서 처리한다 (presence/favorite와 동일 원칙).
            // 배열 필드는 items|queue 어느 쪽으로도 수신 허용 — 백엔드 확정 시 한쪽으로 수렴 예정.
            if (type === 'queue.updated') {
              setQueue(normalizeQueueItems(raw.items ?? raw.queue));
              return;
            }
            // 답변 대기 스냅샷 (t_363c0faa / 백엔드 t_811e176c): reply.pending.updated = 회신 필요 전체 교체.
            // queue.updated와 동일 원칙 — 허브 로그 미채번일 수 있어 seq 필터 앞에서 처리.
            if (type === 'reply.pending.updated') {
              setPendingReplies(normalizeReplyPending(raw));
              return;
            }
            // 릴레이 자막 (t_961ca593 Phase B): 휘발성 연출 — seq 필터 앞의 전용 onRelay 경로에서만 처리한다.
            // 턴 파이프라인(run.*/streams/coordinator)에 넣지 않으며(계약: message 아님), 재생 이중 도착은
            // applyRelayEvent 커튼(단조·dedup)로 무해. 여기를 early-return해 default 분기 유입을 막는다.
            if (type === 'relay.updated') return;
            if (type === 'audio.started') { runtime.audioOpen = true; setTalking(true); return; }
            if (type === 'audio.vad') {
              // 서버 안전망(홀드 상한/무음 타임아웃)/릴리스 종료 → UI 녹음 상태 해제
              if (raw.active === false) { runtime.audioOpen = false; setTalking(false); }
              return;
            }
            if (type === 'transcript.final' && runtime.audioOpen && typeof raw.text === 'string' && raw.text.length === 0) {
              // 무음 릴리스 — 서버가 세그먼트를 닫았다 (hasSignal false 경로)
              runtime.audioOpen = false; setTalking(false);
              return;
            }
            if (type === 'transcript.final' && typeof raw.text === 'string' && raw.text.trim() && typeof raw.message_id === 'string' && raw.message_id) {
              // t_64e3edd6 #324: 전사문 = 발화 확정 처리 — transcript.final 자체에서 user 행을 머지한다.
              // 백엔드가 message.new(user)를 턴 종료 전(전사 직후)으로 앞당기면 그 순간 카드가 뜨고,
              // 현 계약(턴 종료 후 발행)에서는 message.new가 먼저 도착 → id 중복이라 no-op. 어느 순서든 안전.
              const uid = raw.message_id as string;
              if (!runtime.messages.some((m) => m.id === uid)) {
                updateMessages((prev) => mergeIncoming(prev, [{
                  id: uid, role: 'user', content: (raw.text as string).trim(),
                  turnIndex: typeof raw.turn_index === 'number' ? raw.turn_index : nextTurnIndex(prev),
                  createdAt: new Date().toISOString(), status: 'sent',
                  ...(rootMessageId ? { parentMessageId: rootMessageId } : {}),
                } as ChatMessage]));
              }
              return;
            }
            if (type === 'subscribed') {
              if (Array.isArray(raw.devices)) setPeers(peersOf(raw.devices as PresenceDevice[], deviceRef.current));
              if (runtime.sequence.subscribed(raw.current_seq)) {
                runtime.tracker.endAll();
                runtime.streams = []; publishStreams();
                runtime.socket?.send(JSON.stringify({ type: 'subscribe', session_id: sid, last_seq: 0 }));
                void refresh(sid, false, 'all').catch((e) => { if (current()) setLastError(errorText(e)); });
              }
              return;
            }
            if (!runtime.sequence.accept(raw.seq)) return;
            const incoming = (raw.message ?? raw.data ?? raw) as ServerMessageRow;
            const parent = incoming?.parent_message_id ?? raw.parent_message_id;
            if (rootMessageId) {
              const matches = parent === rootMessageId;
              const owned = [raw.run_id, raw.client_exec_id, raw.execution_id].some((id) => typeof id === 'string' && runtime.scopedRuns.has(id));
              if ((matches || owned) && typeof raw.run_id === 'string') runtime.scopedRuns.add(raw.run_id);
              if (type === 'message.new' || type === 'message.created') {
                if (!matches) return;
              } else if (!matches && !owned) return;
            } else if (typeof parent === 'string' && parent) return;
            if (typeof raw.run_id === 'string' && type === 'run.progress') runtime.runStages.set(raw.run_id, typeof raw.stage === 'string' ? raw.stage : '');
            const streamEvent = typeof raw.run_id === 'string' ? { ...raw, stage: runtime.runStages.get(raw.run_id) } : raw;
            runtime.streams = reduceStreams(runtime.streams, streamEvent, runtime.messages);
            if (type === 'answer.done' && typeof raw.message_id === 'string' && typeof raw.text === 'string') {
              updateMessages((prev) => prev.map((message) => message.id === raw.message_id ? { ...message, content: raw.text as string, aiGenerated: typeof raw.ai_generated === 'boolean' ? raw.ai_generated : message.aiGenerated } : message));
            }
            // t_cc232982: answer.delta는 배칭 발행(선행 즉시 + 창 내 후행 통합), 터미널은 즉시.
            publishStreams(typeof type === 'string' ? type : undefined);
            if (type === 'message.new' || type === 'message.created') {
              const row = (raw.message ?? raw.data ?? raw) as ServerMessageRow;
              if (row && row.id) updateMessages((prev) => mergeIncoming(prev, normalizeServerMessages([{ ...row, run_id: typeof raw.run_id === 'string' ? raw.run_id : undefined }])));
            } else if ((typeof type === 'string' && type.startsWith('run.')) || type === 'turn.status' || type === 'neuron.status' || type === 'answer.done' || type === 'answer.delta') {
              // delta도 실행 상태에 반영한다. 확정 본문은 message.new/REST/재조회에서 머지한다.
              runtime.coordinator.observe(streamEvent as unknown as TurnEvent, sid);
              if (type === 'run.failed') setLastError('errors.run');
              if (type === 'run.cancelled') setLastError('errors.cancelled');
              // 릴레이 자막 정리 (t_961ca593): run.completed/failed/cancelled = 백스테이지 종료.
              // 'done' 자막이 떠 있으면 1.2s 홀드 후 정리(서버는 done과 run.completed를 같은 틱에 보낸다 —
              // 즉시 정리 시 최종 자막이 0프레이드로 소실). 미도달/다름 stage는 즉시 정리 후 컴포넌트 페이드아웃.
              if (type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled') {
                const runIdEnd = typeof raw.run_id === 'string' ? raw.run_id : undefined;
                setRelay((prev) => {
                  const owned = prev && (runIdEnd === undefined || prev.runId === runIdEnd);
                  if (owned && prev!.stage === 'done') {
                    // 홀드 — 타이머가 만료 시점에도 같은 done 자막이면 정리(새 run이 덮었으면 스킵).
                    if (relayHoldTimer) clearTimeout(relayHoldTimer);
                    const doneRun = prev!.runId;
                    relayHoldTimer = setTimeout(() => {
                      if (!current()) return;
                      setRelay((cur) => (cur && cur.runId === doneRun && cur.stage === 'done' ? null : cur));
                    }, 1200);
                    return prev;
                  }
                  return clearRelayOnRunEnd(prev, runIdEnd);
                });
              }
              // 후속 질문 (t_1797f432 ③): run.completed의 structured_payload.suggested_questions [{id,text,locale}].
              // 필드 없거나 형태 다르면 [] → 마지막 세트만 유지, 생성 실패는 조용히 무시(사용자 체감 0).
              if (type === 'run.completed') {
                const sp = raw.structured_payload ?? (raw.message as ServerMessageRow | undefined)?.structured_payload;
                const next = normalizeSuggestedQuestions(isRecord(sp) ? sp.suggested_questions : undefined);
                if (next.length) setSuggested(next);
              }
              // 큐 상태 전이 반영 대기용: 런이 끝났으면 서버가 발행하는 queue.updated를 우선 쓰지만,
              // 미수신 시에도 마지막 스냅샷을 다시 읽지 않으므로 표시는 이벤트 의존(폴백=보수적 유지).
            }
          },
          onError: (msg) => {
            if (!current()) return;
            setLastError('errors.connection');
            // 명시적 서버/인증/지원 오류는 자동 재연결을 멈춘다.
            disconnected = true;
            ++socketVersion;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            runtime.socket?.close();
            setConnection('offline');
          },
        }, deviceRef.current);
      } catch (e) {
        if (current()) { setLastError(errorText(e)); setConnection('offline'); }
      }
    }
    async function init() {
      try {
        let sid = requestedSession ?? null;
        if (!sid && agentId) {
          const env = await api.ensureSession(agentId);
          if (!env.ok || !env.data?.id) throw new Error('errors.session');
          sid = env.data.id;
        }
        if (!sid) throw new Error('errors.session');
        if (!alive()) return;
        setSessionId(sid);
        runtime.sid = sid;
        await refresh(sid, true);
        if (!alive()) return;
        runtime.initialized = true;
        setReady(true);
        connect(sid);
      } catch (e) {
        if (alive()) { setLastError(errorText(e)); setConnection('offline'); setReady(true); }
      }
    }
    runtime.retry = () => {
      if (!alive()) return;
      runtime.socket?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setLastError(null); setConnection('connecting');
      if (runtime.initialized && runtime.sid) connect(runtime.sid);
      else void init();
    };
    if (!deferConnection) void init();
    return stop;
  }, [requestedSession, agentId, rootMessageId, deferConnection, mode, runtimeRef, updateMessages]);

  // ── 읽기 커서 (t_d75ca81c): 화면에 메시지가 보일 때마다(max 병합 멱등) 1.5s 디바운스 PUT.
  // 같은 디바이스도 커서를 올려야 다른 기기의 resume 미읽음 계산이 정확해진다.
  // 실패 삼킴 — 커서는 다음 메시지 확정 시점에 다시 올라가므로 유실 없다.
  useEffect(() => {
    const runtime = runtimeRef.current;
    const sid = sessionId;
    if (mode === 'demo' || !sid || runtime.sid !== sid) return;
    const cursor = readCursorFor(runtime.messages);
    if (!shouldSendCursor(runtime.lastSentCursor, cursor)) return;
    const timer = setTimeout(() => {
      if (runtime.sid !== sid) return; // 세션 전환 시 구 커서 전송 금지
      runtime.lastSentCursor = cursor;
      void api.putReadState(sid, { last_read_turn_index: cursor!, device: deviceRef.current }).catch(() => {
        runtime.lastSentCursor = null; // 실패 시 dedup 해제 — 다음 변경에 재시도
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [messages, sessionId, mode, runtimeRef]);

  const loadOlder = useCallback(async () => {
    const runtime = runtimeRef.current;
    const sid = runtime.sid;
    if (rootMessageId || !sid || runtime.demo || runtime.loadingOlder || !hasOlder) return;
    const cursor = runtime.historyCursor ?? oldestCursor(runtime.messages);
    if (cursor === null || cursor <= 0) { setHasOlder(false); return; }
    const generation = runtime.generation;
    runtime.loadingOlder = true;
    setLoadingOlder(true);
    try {
      const env = await api.getMessages(sid, { before: cursor, limit: PAGE_SIZE });
      if (!env.ok || !env.data) throw new Error('errors.older');
      if (generation !== runtime.generation) return;
      const allRows = normalizeServerMessages(env.data);
      const nextCursor = oldestCursor(allRows);
      runtime.historyCursor = nextCursor;
      updateMessages((prev) => prependPage(prev, allRows.filter((m) => !m.parentMessageId)));
      setThreads((prev) => mergeThreadIndex(prev, buildThreadIndex(allRows)));
      setHasOlder(nextCursor !== null && nextCursor < cursor && (env.meta?.has_more ?? allRows.length >= PAGE_SIZE));
    } catch (e) {
      if (generation === runtime.generation) setLastError(errorText(e));
    } finally {
      if (generation === runtime.generation) { runtime.loadingOlder = false; setLoadingOlder(false); }
    }
  }, [runtimeRef, hasOlder, updateMessages, rootMessageId]);

  const performSend = useCallback(async (content: string, retryId?: string, attachments?: { ids: string[]; previews: ChatMessage['pendingAttachments'] }): Promise<SendResult> => {
    const runtime = runtimeRef.current;
    const validation = validateMessageInput(content);
    if (!validation.ok) return { ok: false, error: validation.errorKey! };
    const text = validation.normalized!;
    const generation = runtime.generation;
    const coordinator = runtime.coordinator;
    const execId = `exec-${Date.now()}-${++executionCounter}`;
    const optimisticId = retryId ?? `local-${execId}`;
    const base = runtime.messages.find((m) => m.id === retryId)?.turnIndex ?? nextTurnIndex(runtime.messages);
    const sid = runtime.sid;
    // 동일 텍스트 in-flight 가드 (t_4af94b1c①): Enter+전송 버튼 동시 탭의 2차 performSend는
    // 낙관 행도 POST도 만들지 않는다 — 백엔드 isDuplicateIngress(3초 창+실행 중 드롭)의 프론트 선반영.
    // 첨부 발화는 백엔드 드롭 대상이 아니므로 가드도 제외(정당한 중복 첨부 전송 막지 않음).
    // 1차 발송이 실제로 발화를 운반 중이므로 의미상 ok:true(실패 복원 경로 차단 — 드래프트 중복 유입 방지).
    const guardKey = attachments?.ids?.length ? null : `${sid ?? ''}\u0000${text}`;
    if (guardKey && runtime.inflightSends.has(guardKey)) return { ok: true };
    setLastError(null);
    // 후속 질문 칩은 발화 확정 시 1회 소모 (탭/직접 입력 모두) — 이전 턴의 칩이 남지 않는다.
    setSuggested([]);
    updateMessages((prev) => appendOptimistic(prev, {
      id: optimisticId, role: 'user', content: text, draft: content, turnIndex: base, parentMessageId: rootMessageId, pending: true, status: 'pending', createdAt: new Date().toISOString(),
      // 첨부 낙관 프리뷰 — 서버 확정 시 message.new/confirm의 attachments 요약으로 대체된다 (t_4497cfce)
      ...(attachments?.previews?.length ? { pendingAttachments: attachments.previews, pendingAttachmentIds: attachments.ids, attachments: [] } : {}),
    }));
    coordinator.start(execId);
    runtime.scopedRuns.add(execId);
    if (runtime.demo) {
      return new Promise<SendResult>((resolve) => {
        const timer = setTimeout(() => {
          runtime.demoTimers.delete(timer);
          if (generation !== runtime.generation) { resolve({ ok: false, error: 'errors.changed' }); return; }
          updateMessages((prev) => [...prev.map((m) => m.id === optimisticId ? { ...m, pending: false, status: 'sent' as const } : m),
            { id: `demo-${execId}`, role: 'agent', content: text, contentKey: 'chat.demoReply', contentParams: { content: text },
              turnIndex: nextTurnIndex(runtime.messages), status: 'sent', dialogueType: 'text', createdAt: new Date().toISOString() }]);
          coordinator.finish(execId, '', undefined, true);
          resolve({ ok: true });
        }, 900);
        runtime.demoTimers.set(timer, resolve);
      });
    }
    try {
      if (!sid || !runtime.initialized) throw new Error('errors.notReady');
      if (guardKey) runtime.inflightSends.add(guardKey); // 가드 등록은 POST 직전 — demo 경로는 대상 아님(첨부 발화도 제외)
      const env = await api.sendMessage(sid, text, execId, {
        ...(rootMessageId ? { parent_message_id: rootMessageId } : {}),
        // 첨부 링크 (t_4497cfce): 업로드 완료 ID만 — 서버가 user 메시지에 링크 후 messages.attachments 요약 발행
        ...(attachments?.ids?.length ? { attachment_ids: attachments.ids } : {}),
      });
      if (!env.ok || !env.data) throw new Error('errors.response');
      if (generation !== runtime.generation) return { ok: false, error: 'errors.changed' };
      // 백엔드 ingress 드롭 (t_c31e3f45 / t_4af94b1c①): 3초 창 동일 content 재접수 → { deduped:true,
      // message } 만 내려온다(수용 행 없음). 낙관 행이 그대로 남으면 서버에 없는 유령 행이 된다 —
      // 첫 발송이 같은 발화를 이미 운반 중이므로 낙관 행을 제거하고 성공 처리한다(오류 배너 없음).
      if (env.data.deduped) {
        updateMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        if (runtime.lastFailedContent?.id === optimisticId) runtime.lastFailedContent = null;
        return { ok: true };
      }
      if (env.data.run_id) runtime.scopedRuns.add(env.data.run_id);
      updateMessages((prev) => {
        const confirmed = confirmTurn(prev, optimisticId, env.data!, text, env.data?.turn_index ?? base);
        const existing = new Set(prev.filter((m) => m.id !== optimisticId).map((m) => m.id));
        const userId = env.data!.user_message_id || optimisticId;
        return confirmed
          .map((m) => (rootMessageId && !existing.has(m.id) ? { ...m, parentMessageId: rootMessageId } : m))
          // 확정 user 행의 attachments 요약이 빈 배열이면(저장 직렬화 시점 경쟁) 낙관 프리뷰로 유지 (t_4497cfce)
          .map((m) => (m.id === userId && attachments?.previews?.length && !(m.attachments as unknown[] | undefined)?.length ? { ...m, pendingAttachments: attachments.previews } : m));
      });
      coordinator.finish(execId, sid, env.data);
      runtime.streams = runtime.streams.filter((stream) => stream.runId !== env.data?.run_id);
      setStreams(runtime.streams);
      if (runtime.lastFailedContent?.id === optimisticId) runtime.lastFailedContent = null;
      return { ok: true };
    } catch (e) {
      const error = errorText(e);
      if (generation === runtime.generation) {
        updateMessages((prev) => prev.map((m) => m.id === optimisticId ? { ...m, pending: false, status: 'failed' } : m));
        runtime.lastFailedContent = { content, id: optimisticId, attachments };
        setLastError(error);
      }
      coordinator.finish(execId, sid ?? '', undefined, true);
      return { ok: false, error };
    } finally {
      // 종료 WS가 누락되어도 REST 확정/실패는 반드시 해당 실행을 종료한다.
      if (guardKey) runtime.inflightSends.delete(guardKey); // 가드는 POST 수명 동안만 — 완료/실패 경로 무관 해제
      coordinator.finish(execId, sid ?? '');
    }
  }, [runtimeRef, updateMessages, rootMessageId]);
  const send = useCallback((content: string, attachments?: { ids: string[]; previews: ChatMessage['pendingAttachments'] }) => performSend(content, undefined, attachments), [performSend]);
  const retryLastSend = useCallback((): Promise<SendResult> => {
    const runtime = runtimeRef.current;
    const failed = runtime.lastFailedContent;
    return failed ? performSend(failed.content, failed.id, failed.attachments ?? undefined)
      : Promise.resolve({ ok: false, error: 'errors.noRetry' });
  }, [runtimeRef, performSend]);
  const enterDemo = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime.demo) return;
    runtime.stop();
    runtime.demo = true;
    setLastError(null);
    setMode('demo');
  }, [runtimeRef]);
  const retryConnection = useCallback(() => runtimeRef.current.retry(), []);
  const retryMessage = useCallback((id: string) => {
    const message = runtimeRef.current.messages.find((m) => m.id === id && m.status === 'failed');
    if (!message) return Promise.resolve<SendResult>({ ok: false, error: 'errors.noRetry' });
    const attachments = message.pendingAttachmentIds?.length
      ? { ids: message.pendingAttachmentIds, previews: message.pendingAttachments }
      : undefined;
    return performSend(message.draft ?? message.content, id, attachments);
  }, [performSend]);
  const deleteMessage = useCallback((id: string) => {
    if (runtimeRef.current.lastFailedContent?.id === id) runtimeRef.current.lastFailedContent = null;
    updateMessages((prev) => prev.filter((m) => m.id !== id || m.status !== 'failed'));
  }, [updateMessages]);
  const clearError = useCallback(() => setLastError(null), []);

  // ── PTT 캐리어 (t_d75ca81c/확정 ①②): audio.start → 바이너리 PCM → audio.end(전송)/audio.cancel(폐기).
  // usePushToTalk 훅이 이 브리프 위에 키/터치 입력과 캡처를 얹는다.
  const talk = useMemo(() => {
    const runtime = runtimeRef.current;
    const sendControl = (frame: Record<string, unknown>) => {
      const sid = runtime.sid;
      if (!sid || !runtime.socket?.ready) return false;
      return runtime.socket.send(JSON.stringify({ ...frame, session_id: sid }));
    };
    return {
      get ready() { return !!runtime.sid && !!runtime.socket?.ready && mode !== 'demo'; },
      start: (pttMode?: 'hold' | 'toggle') => {
        const sid = runtime.sid;
        if (!sid || !runtime.socket?.ready || runtime.audioOpen) return;
        runtime.audioOpen = true; // 낙관 열림 — audio.started 도달 전 릴리스(초단타 누름)도 end/cancel 가능하게
        runtime.socket.send(JSON.stringify({
          type: 'audio.start', session_id: sid,
          config: { mode: pttMode ?? 'hold', device: deviceRef.current },
        }));
      },
      frame: (pcm: ArrayBuffer) => { if (runtime.audioOpen) runtime.socket?.send(pcm); },
      end: () => {
        if (!runtime.audioOpen) return;
        runtime.audioOpen = false;
        sendControl({ type: 'audio.end' });
      },
      cancel: () => {
        if (!runtime.audioOpen) return;
        runtime.audioOpen = false;
        sendControl({ type: 'audio.cancel' });
      },
    };
  }, [runtimeRef, mode]);

  return {
    sessionId, rootMessage, messages, typing, quip, mode, connection, lastError, hasOlder, loadingOlder,
    activeCount, streams, retryConnection, retryMessage, deleteMessage,
    send, retryLastSend, loadOlder, enterDemo, clearError,
    peers, talking, talk,
    // 질문 큐 체크포인트 / 후속 질문 칩 (t_1797f432 ②③) — 서버 미배포 시 [] (렌더 없음)
    queue, suggested,
    // 비서실 릴레이 자막 (t_961ca593 Phase B) — 이벤트 없으면 null (렌더 없음)
    relay,
    /** 스트립 보조 폴링의 단일 queue 상태 적용기 (t_91cb659c) — useQueueStrip에 전달 */
    applyQueueSnapshot,
    // 답변 대기 (t_363c0faa) — reply.pending.updated 단일 상태원천 + GET /pending 보조 적용기
    pendingReplies,
    applyPendingSnapshot,
    // 답글 스레드 인덱스 (t_2f45ccb1 확장 3·4) — 현재 서버 로드 범위 기준
    threads,
    typingQuip: quip, isDemo: mode === 'demo', error: lastError,
    hasMoreHistory: hasOlder, loadingHistory: loadingOlder, ready,
  };
}
