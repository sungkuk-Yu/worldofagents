import { parseThread, mergeThread } from '../lib/cardLogic';
import { errorKey } from '../lib/errorKeys';
// 마이에이전트톡은 사람↔에이전트 대화 앱이다. 처리중 표시는 실행별 상태를 따르며,
// 지연 안내는 stage에 대응하는 번역 키로 전달한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, connectVoiceSocket, VoiceSocket } from '../lib/api';
import {
  appendOptimistic, ChatMessage, confirmTurn, createTurnCoordinator, createTypingTracker,
  mergeIncoming, nextBackoffMs, nextTurnIndex, normalizeServerMessages, oldestCursor,
  prependPage, ServerMessageRow, TurnEvent, createSequenceTracker, validateMessageInput, reduceStreams, StreamingAnswer,
} from '../lib/chatLogic';

export const PAGE_SIZE = 30;
export type SendResult = { ok: true } | { ok: false; error: string };
export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';
export interface UseChatSessionOptions { sessionId?: string | null; agentId?: string | null; rootMessageId?: string; deferConnection?: boolean }
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
  send: (content: string) => Promise<SendResult>;
  retryLastSend: () => Promise<SendResult>;
  loadOlder: () => Promise<void>;
  enterDemo: () => void;
  clearError: () => void;
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
      socket: null as VoiceSocket | null, stop: () => {},
      lastFailedContent: null as { content: string; id: string } | null,
      demoTimers: new Map<ReturnType<typeof setTimeout>, (result: SendResult) => void>(),
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
  const runtimeRef = useRef(createRuntime((active, text, count) => {
    setTyping(active); setQuip(text); setActiveCount(count);
  }));
  // 동시 전송도 최신 목록을 읽도록 렌더를 기다리지 않고 원자적으로 반영한다.
  const updateMessages = useCallback((update: (prev: ChatMessage[]) => ChatMessage[]) => {
    const runtime = runtimeRef.current;
    runtime.messages = update(runtime.messages);
    setMessages(runtime.messages);
  }, [runtimeRef]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const generation = ++runtime.generation;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let connectedOnce = false;
    let socketVersion = 0;
    const alive = () => !disposed && generation === runtime.generation;
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
    runtime.loadingOlder = false;
    runtime.historyCursor = null;
    // 외부 세션 리소스를 바꿀 때만 UI 상태를 초기화한다.
    setRootMessage(null);
    setLoadingOlder(false);
    setReady(false);
    setHasOlder(false);
    const stop = () => {
      disposed = true;
      ++runtime.generation;
      if (reconnectTimer) clearTimeout(reconnectTimer);
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
              runtime.socket?.send(JSON.stringify({ type: 'subscribe', session_id: sid, last_seq: runtime.sequence.lastSeq }));
              const recovering = connectedOnce || attempt > 0;
              connectedOnce = true;
              attempt = 0;
              if (recovering) void refresh(sid, false, 'gap').catch(() => {
                if (current()) setLastError('errors.recovery');
              });
            } else if (status === 'disconnected') reconnect();
          },
          onRaw: (raw) => {
            if (!current() || disconnected || (raw.session_id && raw.session_id !== sid)) return;
            const type = raw.type;
            if (type === 'subscribed') {
              if (runtime.sequence.subscribed(raw.current_seq)) {
                runtime.tracker.endAll();
                runtime.streams = []; setStreams([]);
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
            setStreams(runtime.streams);
            if (type === 'message.new' || type === 'message.created') {
              const row = (raw.message ?? raw.data ?? raw) as ServerMessageRow;
              if (row && row.id) updateMessages((prev) => mergeIncoming(prev, normalizeServerMessages([{ ...row, run_id: typeof raw.run_id === 'string' ? raw.run_id : undefined }])));
            } else if ((typeof type === 'string' && type.startsWith('run.')) || type === 'turn.status' || type === 'neuron.status' || type === 'answer.done' || type === 'answer.delta') {
              // delta도 실행 상태에 반영한다. 확정 본문은 message.new/REST/재조회에서 머지한다.
              runtime.coordinator.observe(streamEvent as unknown as TurnEvent, sid);
              if (type === 'run.failed') setLastError('errors.run');
              if (type === 'run.cancelled') setLastError('errors.cancelled');
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
        });
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
      setHasOlder(nextCursor !== null && nextCursor < cursor && (env.meta?.has_more ?? allRows.length >= PAGE_SIZE));
    } catch (e) {
      if (generation === runtime.generation) setLastError(errorText(e));
    } finally {
      if (generation === runtime.generation) { runtime.loadingOlder = false; setLoadingOlder(false); }
    }
  }, [runtimeRef, hasOlder, updateMessages, rootMessageId]);

  const performSend = useCallback(async (content: string, retryId?: string): Promise<SendResult> => {
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
    setLastError(null);
    updateMessages((prev) => appendOptimistic(prev, {
      id: optimisticId, role: 'user', content: text, draft: content, turnIndex: base, parentMessageId: rootMessageId, pending: true, status: 'pending', createdAt: new Date().toISOString(),
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
      const env = await api.sendMessage(sid, text, execId, rootMessageId ? { parent_message_id: rootMessageId } : undefined);
      if (!env.ok || !env.data) throw new Error('errors.response');
      if (generation !== runtime.generation) return { ok: false, error: 'errors.changed' };
      if (env.data.run_id) runtime.scopedRuns.add(env.data.run_id);
      updateMessages((prev) => {
        const confirmed = confirmTurn(prev, optimisticId, env.data!, text, env.data?.turn_index ?? base);
        const existing = new Set(prev.filter((m) => m.id !== optimisticId).map((m) => m.id));
        return rootMessageId ? confirmed.map((m) => existing.has(m.id) ? m : { ...m, parentMessageId: rootMessageId }) : confirmed;
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
        runtime.lastFailedContent = { content, id: optimisticId };
        setLastError(error);
      }
      coordinator.finish(execId, sid ?? '', undefined, true);
      return { ok: false, error };
    } finally {
      // 종료 WS가 누락되어도 REST 확정/실패는 반드시 해당 실행을 종료한다.
      coordinator.finish(execId, sid ?? '');
    }
  }, [runtimeRef, updateMessages, rootMessageId]);
  const send = useCallback((content: string) => performSend(content), [performSend]);
  const retryLastSend = useCallback((): Promise<SendResult> => {
    const runtime = runtimeRef.current;
    const failed = runtime.lastFailedContent;
    return failed ? performSend(failed.content, failed.id)
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
    return message ? performSend(message.draft ?? message.content, id) : Promise.resolve<SendResult>({ ok: false, error: 'errors.noRetry' });
  }, [performSend]);
  const deleteMessage = useCallback((id: string) => {
    if (runtimeRef.current.lastFailedContent?.id === id) runtimeRef.current.lastFailedContent = null;
    updateMessages((prev) => prev.filter((m) => m.id !== id || m.status !== 'failed'));
  }, [updateMessages]);
  const clearError = useCallback(() => setLastError(null), []);
  return {
    sessionId, rootMessage, messages, typing, quip, mode, connection, lastError, hasOlder, loadingOlder,
    activeCount, streams, retryConnection, retryMessage, deleteMessage,
    send, retryLastSend, loadOlder, enterDemo, clearError,
    typingQuip: quip, isDemo: mode === 'demo', error: lastError,
    hasMoreHistory: hasOlder, loadingHistory: loadingOlder, ready,
  };
}
