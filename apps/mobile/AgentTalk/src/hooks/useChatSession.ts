// useChatSession — 채팅 MVP 세션 훅 (REST 실연결 + WebSocket + 히스토리 페이지네이션)
// 설계: apps/backend/docs/api-design.md §3.4 (GET/POST /api/sessions/:id/messages) + §4 (WS)
// 원칙:
//   - demo 폴백은 "연결 실패 시에만" — health/ensure 실패 시 데모 모드로 강등
//   - typing(처리중) 상태는 소스 카운터 기반 단일 진실: REST pending과 WS neuron.status가
//     겹쳐도 "활성 소스 ≥ 1개"면 예외 없이 표시 — 깜빡임/소실 재현 금지 (공통 규칙: 100% 신뢰 가능한 상태 표시)
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, connectVoiceSocket, VoiceSocket } from '../lib/api';
import {
  appendOptimistic,
  confirmTurn,
  createTypingTracker,
  DEFAULT_QUIP,
  mergeIncoming,
  nextTurnIndex,
  normalizeServerMessages,
  oldestCursor,
  prependPage,
  ServerMessageRow,
} from '../lib/chatLogic';
import { ChatMessage } from '../types';

export const PAGE_SIZE = 30;

export interface UseChatSessionOptions {
  /** 확보된 세션 id — 없으면 agentId로 ensure 시도 */
  sessionId?: string | null;
  agentId?: string | null;
}

export interface UseChatSessionReturn {
  sessionId: string | null;
  messages: ChatMessage[];
  /** 에이전트 처리 중 — true인 동안 UI는 예외 없이 상태 표시 (100% 신뢰 규칙) */
  typing: boolean;
  /** 지연 시 자연어 안내 — WS neuron.status quip 우선, 없으면 기본 대화체 문구 */
  typingQuip: string | null;
  isDemo: boolean;
  error: string | null;
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  ready: boolean;
  send: (content: string) => Promise<void>;
  loadOlder: () => Promise<void>;
}

// 데모 폴백 응답 — 백엔드 연결 실패 시에만 사용 (카드 지침: 연결 실패 시에만 demo 유지)
// 에이전트는 도구가 아닌 인격체 — 데모 응답도 대화체 톤으로
function demoReply(content: string): { empathy: string; answer: string } {
  return {
    empathy: `"${content.slice(0, 24)}" — 네, 말씀하신 내용 잘 받았어요.`,
    answer:
      `지금 백엔드와 연결되지 않아서 제가 온전히 능력을 발휘할 수 없는 상태예요.\n\n` +
      `서버가 연결되면 "${content.slice(0, 40)}" 요청을 실제로 처리해서 결과를 보여드릴게요. 조금만 기다려주세요!`,
  };
}

export function useChatSession(opts: UseChatSessionOptions = {}): UseChatSessionReturn {
  const [sessionId, setSessionId] = useState<string | null>(opts.sessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [typingQuip, setTypingQuip] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [ready, setReady] = useState(false);

  const socketRef = useRef<VoiceSocket | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const initRef = useRef(false);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const trackerRef = useRef(
    createTypingTracker((active, quip) => {
      setTyping(active);
      setTypingQuip(quip);
    })
  );

  // WS neuron.status 처리 — processing 계열이면 소스 활성화, idle/완료면 해제
  const handleNeuronStatus = useCallback((neuronSlug: string, status: string, quip: string | null) => {
    const tracker = trackerRef.current;
    const source = `ws:${neuronSlug}`;
    const processing = status === 'processing' || status === 'running' || status === 'active';
    if (processing) tracker.begin(source, quip);
    else tracker.end(source);
  }, []);

  // ── 초기화: 세션 확보 → 히스토리 로드 → WS 연결 ──
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const tracker = trackerRef.current;

    let cancelled = false;

    async function init() {
      // 1) 세션 확보
      let sid = opts.sessionId ?? null;
      try {
        if (!sid && opts.agentId) {
          const env = await api.ensureSession(opts.agentId);
          sid = env?.data?.id ?? null;
        }
        // 서버 생존 확인 (토큰 만료 등 조기 감지)
        if (sid) await api.health();
      } catch {
        if (cancelled) return;
        // 연결 실패 → 데모 폴백
        setIsDemo(true);
        setError(null);
        setReady(true);
        return;
      }

      if (cancelled) return;
      if (!sid) {
        setIsDemo(true);
        setReady(true);
        return;
      }
      setSessionId(sid);
      setIsDemo(false);

      // 2) 히스토리 최초 로드
      try {
        const env = await api.getMessages(sid, { limit: PAGE_SIZE });
        if (cancelled) return;
        const rows = normalizeServerMessages((env?.data ?? []) as ServerMessageRow[]);
        setMessages(rows);
        setHasMoreHistory(Boolean(env?.meta?.has_more) && rows.length > 0);
      } catch (e) {
        if (cancelled) return;
        setError(`히스토리를 불러오지 못했습니다: ${(e as Error).message}`);
      }

      // 3) WS 연결 — neuron.status(처리중 quip) 및 미래 message 이벤트 수신
      socketRef.current?.close();
      socketRef.current = connectVoiceSocket(sid, {
        onNeuronStatus: (msg) => {
          if (cancelled) return;
          handleNeuronStatus(msg.neuron?.slug || 'unknown', msg.status, msg.quip || null);
        },
        onRaw: (raw) => {
          if (cancelled) return;
          // forward-compatible: 백엔드가 WS로 확정 메시지를 브로드캐스트하면 머지
          const type = raw?.type as string;
          if (type === 'message.new' || type === 'message.created') {
            const row = (raw.message ?? raw.data) as ServerMessageRow | undefined;
            if (row && row.id) {
              const [incoming] = normalizeServerMessages([row]);
              if (incoming) setMessages((prev) => mergeIncoming(prev, [incoming]));
            }
          }
        },
        onError: (msg) => {
          if (!cancelled) setError(msg.message || '연결 오류');
        },
      });

      if (!cancelled) setReady(true);
    }

    void init();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
      tracker.endAll();
      for (const t of demoTimers.current) clearTimeout(t);
      demoTimers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 이전 히스토리 페이지 로드 (turn_index 커서) ──
  const loadOlder = useCallback(async () => {
    const sid = sessionId;
    if (!sid || isDemo || loadingHistory || !hasMoreHistory) return;
    const cursor = oldestCursor(messagesRef.current);
    if (cursor === null || cursor <= 0) {
      setHasMoreHistory(false);
      return;
    }
    setLoadingHistory(true);
    try {
      const env = await api.getMessages(sid, { before: cursor, limit: PAGE_SIZE });
      const older = normalizeServerMessages((env?.data ?? []) as ServerMessageRow[]);
      setMessages((prev) => prependPage(prev, older));
      setHasMoreHistory(older.length >= PAGE_SIZE);
    } catch (e) {
      setError(`이전 대화를 불러오지 못했습니다: ${(e as Error).message}`);
      setHasMoreHistory(false);
    } finally {
      setLoadingHistory(false);
    }
  }, [sessionId, isDemo, loadingHistory, hasMoreHistory]);

  // ── 메시지 전송 ──
  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text) return;
      setError(null);
      const tracker = trackerRef.current;

      // 데모 모드: 로컬 에코 (연결 실패 시에만 이 경로)
      if (isDemo || !sessionId) {
        const base = nextTurnIndex(messagesRef.current);
        const draft: ChatMessage = { id: `demo-user-${Date.now()}`, role: 'user', content: text, turnIndex: base };
        setMessages((prev) => appendOptimistic(prev, { ...draft, pending: true }));
        tracker.begin('rest:send', '생각 중이에요…');
        const t = setTimeout(() => {
          const reply = demoReply(text);
          setMessages((prev) =>
            confirmTurn(
              prev,
              draft.id,
              {
                user_message_id: draft.id,
                empathy_message_id: `demo-empathy-${Date.now()}`,
                answer_message_id: `demo-answer-${Date.now()}`,
                empathy_response: reply.empathy,
                answer_response: reply.answer,
              },
              text,
              base
            )
          );
          tracker.end('rest:send');
        }, 900);
        demoTimers.current.push(t);
        return;
      }

      // 실연결: 낙관적 추가 → POST 동기 응답으로 확정
      // REST pending과 WS neuron.status가 동시에 들어와도 트래커가 상태 소실을 막는다.
      const base = nextTurnIndex(messagesRef.current);
      const optimisticId = `local-${Date.now()}`;
      setMessages((prev) =>
        appendOptimistic(prev, { id: optimisticId, role: 'user', content: text, turnIndex: base, pending: true })
      );
      tracker.begin('rest:send', DEFAULT_QUIP);

      try {
        const env = await api.sendMessage(sessionId, text);
        const data = env?.data;
        if (!env?.ok || !data) {
          throw new Error(env?.error?.message || '응답이 비어 있습니다');
        }
        setMessages((prev) => confirmTurn(prev, optimisticId, data, text, base));
      } catch (e) {
        // 전송 실패 — 낙관적 메시지 회수 + 시스템 오류 카드
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticId),
          {
            id: `err-${Date.now()}`,
            role: 'system',
            content: `전송 실패: ${(e as Error).message}`,
            turnIndex: base,
          },
        ]);
        setError((e as Error).message);
      } finally {
        tracker.end('rest:send');
      }
    },
    [sessionId, isDemo]
  );

  return {
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
  };
}

export default useChatSession;
