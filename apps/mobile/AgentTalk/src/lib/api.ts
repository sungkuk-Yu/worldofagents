// AgentTalk API 클라이언트 — REST + WebSocket
// 설계: api-design.md §3(§4(WebSocket) — 백엔드 프로토콜과 정확히 대응
//   REST:  /api/sessions/ensure, /api/... (Fastify + JWT)
//   WebSocket: /ws?session_id=<id>&token=<jwt> (dev 모드: 토큰 없이 연결 허용)
// 참고: 네이티브/웹 모두 동작하도록 fetch + 글로벌 WebSocket 사용.
import { DialogueState } from '../store';

// ── 설정 ──────────────────────────────────────────
const DEFAULT_API_URL = 'http://localhost:3000';

export interface ApiConfig {
  apiUrl: string;
  wsUrl: string;
  token: string | null;
}

// 런타임에 EXPO_PUBLIC_API_URL 로 오버라이드 가능
function resolveConfig(): ApiConfig {
  const apiUrl =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL) ||
    DEFAULT_API_URL;
  return {
    apiUrl,
    wsUrl:
      (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WS_URL) ||
      apiUrl.replace(/^http/, 'ws') + '/ws',
    token: null,
  };
}

let config = resolveConfig();

export function setApiConfig(partial: Partial<ApiConfig>): ApiConfig {
  config = { ...config, ...partial };
  return config;
}

export function getApiConfig(): ApiConfig {
  return config;
}

// ── REST 유틸 ─────────────────────────────────────
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    ...(init?.headers as Record<string, string>),
  };
  const res = await fetch(`${config.apiUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      /* JSON 아님 */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

// ── 타입 (백엔드 api-design.md §3 응답 래퍼) ────────
export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface SessionSummary {
  id: string;
  agent_id: string;
  status: 'active' | 'suspended' | 'archived';
  last_activity_at?: string;
}

// ── REST API ──────────────────────────────────────
export const api = {
  /** 헬스 체크 — 연결 대상 서버 생존 여부 */
  health: () => request<{ status: string; timestamp: string; mode: string }>('/health'),
  /** 세션 조회(또는 자동 생성) — POST /api/sessions/ensure */
  ensureSession: (agentId: string) =>
    request<ApiEnvelope<SessionSummary>>('/api/sessions/ensure', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId }),
    }),
  /** 세션 목록 */
  listSessions: () => request<ApiEnvelope<SessionSummary[]>>('/api/sessions'),
};

// ── WebSocket (백엔드 protocol.ts 서버→클라이언트) ─
export type ServerMessage =
  | { type: 'connected'; session_id: string | null; timestamp: string }
  | { type: 'subscribed'; session_id: string; channels: string[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'transcript.partial'; session_id: string; text: string; confidence: number; language: string }
  | {
      type: 'transcript.final';
      session_id: string;
      turn_index: number;
      text: string;
      confidence: number;
      language: string;
      duration_ms: number;
      message_id: string | null;
    }
  | {
      type: 'neuron.status';
      session_id: string;
      neuron: { slug: string; name: string };
      status: string;
      stage: string;
      quip: string;
    }
  | {
      type: 'task.status';
      session_id: string;
      task_id: string;
      status: string;
      progress: number;
      message: string;
    }
  | { type: 'queue.update'; session_id: string; pending_count: number; current_task: string | null; next_tasks: string[] }
  | { type: 'session.archived'; session_id: string }
  | { type: 'session.error'; code: string; message: string }
  | { type: 'audio.started'; session_id: string; config: Record<string, unknown> }
  | { type: 'audio.received'; bytes: number; timestamp: string }
  | { type: 'audio.vad'; session_id: string; active: boolean }
  | { type: 'pong'; ts: number }
  | { type: 'ping'; ts: number };

export interface VoiceSocketHandlers {
  onConnected?: (msg: Extract<ServerMessage, { type: 'connected' }>) => void;
  onPartial?: (msg: Extract<ServerMessage, { type: 'transcript.partial' }>) => void;
  onFinal?: (msg: Extract<ServerMessage, { type: 'transcript.final' }>) => void;
  onNeuronStatus?: (msg: Extract<ServerMessage, { type: 'neuron.status' }>) => void;
  onTaskStatus?: (msg: Extract<ServerMessage, { type: 'task.status' }>) => void;
  onError?: (
    msg: Extract<ServerMessage, { type: 'error' }> | Extract<ServerMessage, { type: 'session.error' }>
  ) => void;
  onStatusChange?: (status: DialogueState['connectionStatus']) => void;
}

export interface VoiceSocket {
  send: (data: string | ArrayBuffer) => boolean;
  close: () => void;
  readonly ready: boolean;
}

/**
 * 음성 세션 WebSocket 연결.
 * dev 모드에서는 토큰 없이도 연결 허용 (백엔드 config.devMode).
 */
export function connectVoiceSocket(sessionId: string | null, handlers: VoiceSocketHandlers): VoiceSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const url = buildWsUrl(sessionId);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    // 브라우저/RN에서 WebSocket 미지원 시 fail 상태로
    handlers.onStatusChange?.('disconnected');
    handlers.onError?.({ type: 'error', code: 'WS_UNSUPPORTED', message: String(e) });
    return { send: () => false, close: () => {}, ready: false };
  }

  ws.onopen = () => {
    if (closed) return;
    handlers.onStatusChange?.('connected');
    // 주기 ping (프로토콜 §4.6)
    pingTimer = setInterval(() => {
      try {
        ws?.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      } catch {
        /* noop */
      }
    }, 25000);
  };

  ws.onmessage = (ev: MessageEvent) => {
    if (closed) return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return; // 비-JSON (오디오 바이너리 등) 무시
    }
    switch (msg.type) {
      case 'connected':
        handlers.onConnected?.(msg);
        break;
      case 'transcript.partial':
        handlers.onPartial?.(msg);
        break;
      case 'transcript.final':
        handlers.onFinal?.(msg);
        break;
      case 'neuron.status':
        handlers.onNeuronStatus?.(msg);
        break;
      case 'task.status':
        handlers.onTaskStatus?.(msg);
        break;
      case 'error':
      case 'session.error':
        handlers.onError?.(msg);
        break;
      default:
        break;
    }
  };

  ws.onerror = () => {
    if (!closed) handlers.onStatusChange?.('disconnected');
  };
  ws.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (!closed) handlers.onStatusChange?.('disconnected');
  };

  return {
    send: (data) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(data);
        return true;
      } catch {
        return false;
      }
    },
    close: () => {
      closed = true;
      if (pingTimer) clearInterval(pingTimer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    },
    ready: true,
  };
}

function buildWsUrl(sessionId: string | null): string {
  const base = config.wsUrl;
  const params: string[] = [];
  if (sessionId) params.push(`session_id=${encodeURIComponent(sessionId)}`);
  if (config.token) params.push(`token=${encodeURIComponent(config.token)}`);
  return params.length ? `${base}?${params.join('&')}` : base;
}