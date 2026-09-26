// 에이전트톡은 사람↔에이전트 대화 앱이다. 처리중 표시는 실행별 상태를 따르며,
// 지연 안내는 자연어 quip으로 전달한다. 데모/목업은 enterDemo의 명시적 선택만 허용한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, connectVoiceSocket, VoiceSocket } from '../lib/api';
import {
  appendOptimistic, ChatMessage, confirmTurn, createTurnCoordinator, createTypingTracker,
  mergeIncoming, nextBackoffMs, nextTurnIndex, normalizeServerMessages, oldestCursor,
  prependPage, ServerMessageRow, TurnEvent,
} from '../lib/chatLogic';

export const PAGE_SIZE = 30;
export type SendResult = { ok: true } | { ok: false; error: string };
export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';
export interface UseChatSessionOptions { sessionId?: string | null; agentId?: string | null }
export interface UseChatSessionReturn {
  sessionId: string | null;
  messages: ChatMessage[];
  typing: boolean;
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
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function createRuntime(onChange: (active: boolean, quip: string | null) => void) {
  const tracker = createTypingTracker(onChange);
    return {
      tracker, coordinator: createTurnCoordinator(tracker), messages: [] as ChatMessage[],
      generation: 0, sid: null as string | null, demo: false, initialized: false, loadingOlder: false,
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
  const runtimeRef = useRef(createRuntime((active, text) => {
    setTyping(active); setQuip(text);
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
    runtime.tracker = createTypingTracker((active, text) => { setTyping(active); setQuip(text); });
    runtime.coordinator = createTurnCoordinator(runtime.tracker);
    runtime.loadingOlder = false;
    // 외부 세션 리소스를 바꿀 때만 UI 상태를 초기화한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        resolve({ ok: false, error: '대화가 종료되었습니다' });
      }
      runtime.demoTimers.clear();
    };
    runtime.stop = stop;
    if (mode === 'demo') {
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

    async function refresh(sid: string, initial: boolean) {
      const env = await api.getMessages(sid, { limit: PAGE_SIZE });
      if (!env.ok || !env.data) throw new Error(env.error?.message || '대화를 불러오지 못했습니다');
      if (!alive()) return;
      const rows = normalizeServerMessages(env.data);
      updateMessages((prev) => mergeIncoming(prev, rows));
      if (initial) setHasOlder(Boolean(env.meta?.has_more) && rows.length > 0);
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
              const recovering = connectedOnce || attempt > 0;
              connectedOnce = true;
              attempt = 0;
              if (recovering) void refresh(sid, false).catch((e) => {
                if (current()) setLastError(`누락된 대화를 복구하지 못했습니다: ${errorText(e)}`);
              });
            } else if (status === 'disconnected') reconnect();
          },
          onRaw: (raw) => {
            if (!current() || disconnected || (raw.session_id && raw.session_id !== sid)) return;
            const type = raw.type;
            if (type === 'message.new' || type === 'message.created') {
              const row = (raw.message ?? raw.data ?? raw) as ServerMessageRow;
              if (row && row.id) updateMessages((prev) => mergeIncoming(prev, normalizeServerMessages([row])));
            } else if (type === 'turn.status' || type === 'neuron.status' || type === 'answer.done' || type === 'answer.delta') {
              // delta도 실행 상태에 반영한다. 확정 본문은 message.new/REST/재조회에서 머지한다.
              runtime.coordinator.observe(raw as unknown as TurnEvent, sid);
            }
          },
          onError: (msg) => {
            if (!current()) return;
            setLastError(msg.message || '연결 오류');
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
          if (!env.ok || !env.data?.id) throw new Error(env.error?.message || '세션을 확보하지 못했습니다');
          sid = env.data.id;
        }
        if (!sid) throw new Error('대화할 세션을 확보하지 못했습니다');
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
    void init();
    return stop;
  }, [requestedSession, agentId, mode, runtimeRef, updateMessages]);

  const loadOlder = useCallback(async () => {
    const runtime = runtimeRef.current;
    const sid = runtime.sid;
    if (!sid || runtime.demo || runtime.loadingOlder || !hasOlder) return;
    const cursor = oldestCursor(runtime.messages);
    if (cursor === null || cursor <= 0) { setHasOlder(false); return; }
    const generation = runtime.generation;
    runtime.loadingOlder = true;
    setLoadingOlder(true);
    try {
      const env = await api.getMessages(sid, { before: cursor, limit: PAGE_SIZE });
      if (!env.ok || !env.data) throw new Error(env.error?.message || '이전 대화를 불러오지 못했습니다');
      if (generation !== runtime.generation) return;
      const older = normalizeServerMessages(env.data);
      updateMessages((prev) => prependPage(prev, older));
      setHasOlder(env.meta?.has_more ?? older.length >= PAGE_SIZE);
    } catch (e) {
      if (generation === runtime.generation) setLastError(errorText(e));
    } finally {
      if (generation === runtime.generation) { runtime.loadingOlder = false; setLoadingOlder(false); }
    }
  }, [runtimeRef, hasOlder, updateMessages]);

  const performSend = useCallback(async (content: string, retryId?: string): Promise<SendResult> => {
    const runtime = runtimeRef.current;
    const text = content.trim();
    if (!text) return { ok: false, error: '메시지를 입력해주세요' };
    const generation = runtime.generation;
    const coordinator = runtime.coordinator;
    const execId = `exec-${Date.now()}-${++executionCounter}`;
    const optimisticId = retryId ?? `local-${execId}`;
    const base = runtime.messages.find((m) => m.id === retryId)?.turnIndex ?? nextTurnIndex(runtime.messages);
    const sid = runtime.sid;
    setLastError(null);
    updateMessages((prev) => appendOptimistic(prev, {
      id: optimisticId, role: 'user', content: text, turnIndex: base, pending: true, status: 'pending',
    }));
    coordinator.start(execId);
    try {
      if (runtime.demo) {
        return await new Promise<SendResult>((resolve) => {
          const timer = setTimeout(() => {
            runtime.demoTimers.delete(timer);
            updateMessages((prev) => confirmTurn(prev, optimisticId, {
              user_message_id: optimisticId, answer_message_id: `demo-answer-${execId}`,
              answer_response: `“${text.slice(0, 40)}” — 말씀 잘 받았어요. 지금은 직접 선택하신 데모 대화예요.`,
            }, text, base));
            resolve({ ok: true });
          }, 900);
          runtime.demoTimers.set(timer, resolve);
        });
      }
      if (!sid || !runtime.initialized) throw new Error('대화 연결이 준비되지 않았습니다');
      const env = await api.sendMessage(sid, text, execId);
      if (!env.ok || !env.data) throw new Error(env.error?.message || '응답이 비어 있습니다');
      if (generation !== runtime.generation) return { ok: false, error: '대화가 변경되었습니다' };
      updateMessages((prev) => confirmTurn(prev, optimisticId, env.data!, text, env.data?.turn_index ?? base));
      coordinator.finish(execId, sid, env.data);
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
  }, [runtimeRef, updateMessages]);
  const send = useCallback((content: string) => performSend(content), [performSend]);
  const retryLastSend = useCallback((): Promise<SendResult> => {
    const runtime = runtimeRef.current;
    const failed = runtime.lastFailedContent;
    return failed ? performSend(failed.content, failed.id)
      : Promise.resolve({ ok: false, error: '재시도할 메시지가 없습니다' });
  }, [runtimeRef, performSend]);
  const enterDemo = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime.demo) return;
    runtime.stop();
    runtime.demo = true;
    setLastError(null);
    setMode('demo');
  }, [runtimeRef]);
  const clearError = useCallback(() => setLastError(null), []);
  return {
    sessionId, messages, typing, quip, mode, connection, lastError, hasOlder, loadingOlder,
    send, retryLastSend, loadOlder, enterDemo, clearError,
    typingQuip: quip, isDemo: mode === 'demo', error: lastError,
    hasMoreHistory: hasOlder, loadingHistory: loadingOlder, ready,
  };
}
