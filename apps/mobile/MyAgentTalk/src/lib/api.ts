import type { SignupConsents } from './consents';
import { LocalizedError } from './errorKeys';
// MyAgentTalk API 클라이언트 — REST + WebSocket
// 설계: api-design.md §3(§4(WebSocket) — 백엔드 프로토콜과 정확히 대응
//   REST:  /api/sessions/ensure, /api/... (Fastify + JWT)
//   WebSocket: /ws?ticket=<일회용 티켓> (dev 모드: 토큰 없이 연결 허용)
// 참고: 네이티브/웹 모두 동작하도록 fetch + 글로벌 WebSocket 사용.
import type { ForkOrigin } from '../types';
import type { DialogueState } from '../store';
import type { TurnIdentity } from './chatLogic';
import type { BoardCardDto } from './kanbanLogic';

// ── 설정 ──────────────────────────────────────────
const DEFAULT_API_URL = 'http://localhost:3000';

export interface ApiConfig {
  apiUrl: string;
  wsUrl: string;
  token: string | null;
}

const TOKEN_KEY = 'at-web-v1.sess';
let tokenVersion = 0;
let initialization: Promise<void> | undefined;
let persistence: Promise<void> = Promise.resolve();
export function initializeApi(): Promise<void> {
  return initialization ??= (async () => {
    const version = tokenVersion;
    const { secureStorage } = await import('./secureStorage');
    const token = await secureStorage.get(TOKEN_KEY);
    if (version === 0 && version === tokenVersion) config = { ...config, token };
  })().catch((error) => { initialization = undefined; throw error; });
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
  if ('token' in partial) {
    tokenVersion++;
    const token = partial.token ?? null;
    persistence = persistence.catch(() => {}).then(async () => {
      const { secureStorage } = await import('./secureStorage');
      if (token) await secureStorage.set(TOKEN_KEY, token);
      else await secureStorage.delete(TOKEN_KEY);
    });
    // 다음 API 호출은 저장 실패를 명시적으로 전달한다.
    void persistence.catch(() => {});
  }
  return config;
}

/** JWT 토큰 설정/해제 — 로그인 성공 시 호출 (웹에서는 localStorage로 지속) */
export async function setToken(token: string | null): Promise<ApiConfig> {
  const next = setApiConfig({ token });
  await persistence;
  return next;
}

export function getApiConfig(): ApiConfig {
  return config;
}

// ── REST 유틸 ─────────────────────────────────────
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await initializeApi();
  await persistence;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    ...(init?.headers as Record<string, string>),
  };
  const res = await fetch(`${config.apiUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    if (res.status === 400) {
      const body = await res.json().catch(() => null);
      const code = body?.error?.code ?? body?.code;
      if (code === 'CONSENT_REQUIRED') throw new LocalizedError('errors.consentRequired');
      if (code === 'AGE_CONFIRM_REQUIRED') throw new LocalizedError('errors.ageConfirmRequired');
    }
    throw new LocalizedError(res.status === 401 || res.status === 403 ? 'errors.auth' : res.status === 404 || res.status === 405 ? 'errors.unsupported' : 'errors.request', { status: res.status });
  }
  return (await res.json()) as T;
}

// ── 타입 (백엔드 api-design.md §3 응답 래퍼) ────────
export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  meta?: { cursor?: string; has_more?: boolean; total?: number };
  error?: { code: string; message: string };
}

export interface SessionSummary {
  title?: string;
  forked_from?: ForkOrigin;
  id: string;
  agent_id: string;
  status: 'active' | 'suspended' | 'archived';
  last_activity_at?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  preset?: { category?: string; titleKey?: string; subtitleKey?: string; subtitle?: string; icon?: string };
  description?: string | null;
  agent_type?: string;
  is_active?: boolean;
}

/** 백엔드 messages 행 (GET /api/sessions/:id/messages 응답 data[]) */
export interface ServerChatMessage {
  id: string;
  session_id: string;
  turn_index: number;
  role: 'user' | 'agent' | 'system';
  message_type: string;
  content: string;
  ai_generated?: boolean;
  favorite?: boolean;
  source_neuron?: string | null;
  attachments?: unknown[];
  structured_payload?: unknown;
  parent_message_id?: unknown;
  thread_reply_count?: unknown;
  created_at?: string;
  dialogue_type?: string | null;
}

/** POST /api/sessions/:id/messages 동기 응답 (api-design.md §3.4) */
export interface SendMessageResult {
  messages?: { user: ServerChatMessage | null; empathy: ServerChatMessage | null; answer: ServerChatMessage | null };
  llm?: { used: boolean; model: string | null; fallback: boolean; usage?: unknown };
  turn_id?: string;
  execution_id?: string;
  run_id?: string;
  turn_index?: number;
  client_exec_id?: string;
  user_message_id: string;
  empathy_message_id: string | null;
  answer_message_id: string | null;
  empathy_response: string | null;
  answer_response: string | null;
  dialogue_type: string;
  activation_plan?: { activate: string[]; reason: string; dialogue_type: string };
  neuron_events?: { neuron: string; status: string; stage: string; quip: string }[];
  persona_guard_passed?: boolean;
  engine?: string;
}

export interface AuthResult {
  token: string;
  user: { id: string; email?: string; display_name?: string };
}

// ── REST API ──────────────────────────────────────
export const api = {
  /** 헬스 체크 — 연결 대상 서버 생존 여부 */
  health: () => request<{ status: string; timestamp: string; mode: string }>('/health'),

  /** 회원가입 — POST /api/auth/signup (api-design.md §3.1) */
  signup: (email: string, password: string, consent: SignupConsents, displayName?: string) =>
    request<ApiEnvelope<AuthResult>>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name: displayName, ...consent }),
    }),

  /** 로그인 — POST /api/auth/login */
  login: (email: string, password: string) =>
    request<ApiEnvelope<AuthResult>>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  /** 내 에이전트 목록 — GET /api/agents */
  listAgents: () => request<ApiEnvelope<AgentSummary[]>>('/api/agents'),

  /** 에이전트 생성 — POST /api/agents */
  createAgent: (name: string, description?: string) =>
    request<ApiEnvelope<AgentSummary>>('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  /** 세션 조회(또는 자동 생성) — POST /api/sessions/ensure */
  ensureSession: (agentId: string) =>
    request<ApiEnvelope<SessionSummary>>('/api/sessions/ensure', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId }),
    }),
  /** 세션 목록 */
  listSessions: () => request<ApiEnvelope<SessionSummary[]>>('/api/sessions'),

  getSession: (id: string) => request<ApiEnvelope<SessionSummary>>(`/api/sessions/${encodeURIComponent(id)}`),
  getThread: (id: string) => request<unknown>(`/api/messages/${encodeURIComponent(id)}/thread`),
  forkSession: (id: string, body: { from_message_id?: string; new_session_title?: string }) =>
    request<ApiEnvelope<unknown>>(`/api/sessions/${encodeURIComponent(id)}/fork`, { method: 'POST', body: JSON.stringify(body) }),

  /** 메시지 히스토리 — GET /api/sessions/:id/messages (turn_index 커서 페이지네이션) */
  getMessages: (sessionId: string, opts?: { before?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.before !== undefined) params.set('before', String(opts.before));
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return request<ApiEnvelope<ServerChatMessage[]>>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ''}`
    );
  },

  /** 텍스트 메시지 전송 — POST /api/sessions/:id/messages (동기 전체 턴 결과 반환) */
  sendMessage: (sessionId: string, content: string, clientExecId?: string, options?: { parent_message_id?: string }) =>
    request<ApiEnvelope<SendMessageResult>>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ ...options, content, client_exec_id: clientExecId, message_type: 'text', attachments: [] }),
    }),

  /** 즐겨찾기 등록/해제 — PATCH /api/messages/:id/favorite (백엔드 t_219c4d36, boolean 필수) */
  setFavorite: (messageId: string, favorite: boolean) =>
    request<ApiEnvelope<ServerChatMessage>>(`/api/messages/${encodeURIComponent(messageId)}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ favorite }),
    }),

  /** 내 즐겨찾기 목록 — GET /api/favorites (created_at 내림차순 + offset 페이지네이션, 기본 50) */
  listFavorites: (opts?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<ApiEnvelope<FavoriteEntry[]>>(`/api/favorites${qs ? `?${qs}` : ''}`);
  },

  // ── 볼트(옵시디언식 노트) — 백엔드 t_3b38c9be /api/vault (마이그레이션 004) ──
  /** 노트 목록 — GET /api/vault/notes?folder=&tag=&limit=&offset= (updated_at 내림차순) */
  listNotes: (opts?: { folder?: string; tag?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.folder) params.set('folder', opts.folder);
    if (opts?.tag) params.set('tag', opts.tag);
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<ApiEnvelope<VaultNote[]>>(`/api/vault/notes${qs ? `?${qs}` : ''}`);
  },

  /** 폴더 트리 — GET /api/vault/tree (note_total 포함) */
  getVaultTree: () => request<ApiEnvelope<{ tree: VaultTreeNode; note_total: number }>>('/api/vault/tree'),

  /** 노트 검색 — GET /api/vault/search?q= (title/content 부분 일치, 스니펫 포함) */
  searchNotes: (q: string, opts?: { folder?: string; limit?: number }) => {
    const params = new URLSearchParams({ q });
    if (opts?.folder) params.set('folder', opts.folder);
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    return request<ApiEnvelope<VaultSearchHit[]>>(`/api/vault/search?${params.toString()}`);
  },

  /** 노트 상세 — GET /api/vault/notes/:id */
  getNote: (id: string) => request<ApiEnvelope<VaultNote>>(`/api/vault/notes/${encodeURIComponent(id)}`),

  /** 노트 생성 — POST /api/vault/notes */
  createNote: (body: { title: string; content?: string; folder?: string; tags?: string[]; backlinks?: VaultBacklink[] }) =>
    request<ApiEnvelope<VaultNote>>('/api/vault/notes', { method: 'POST', body: JSON.stringify(body) }),

  /** 노트 수정 — PATCH /api/vault/notes/:id (title/content/folder/tags/backlinks 부분 수정) */
  patchNote: (id: string, body: { title?: string; content?: string; folder?: string; tags?: string[]; backlinks?: VaultBacklink[] }) =>
    request<ApiEnvelope<VaultNote>>(`/api/vault/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** 노트 삭제 — DELETE /api/vault/notes/:id */
  deleteNote: (id: string) =>
    request<ApiEnvelope<{ deleted: boolean; id: string }>>(`/api/vault/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** 대화→노트 저장 — POST /api/vault/notes/from-message (from-message는 201) */
  noteFromMessage: (body: { message_id: string; title?: string; folder?: string; tags?: string[] }) =>
    request<ApiEnvelope<VaultNote>>('/api/vault/notes/from-message', { method: 'POST', body: JSON.stringify(body) }),

  // ── 칸반 보드 — 백엔드 t_3b38c9be /api/boards·/api/cards (마이그레이션 004) ──
  /** 보드 목록 — GET /api/boards */
  listBoards: () => request<ApiEnvelope<KanbanBoard[]>>('/api/boards'),

  /** 보드 생성 — POST /api/boards */
  createBoard: (body: { name: string; description?: string | null }) =>
    request<ApiEnvelope<KanbanBoard>>('/api/boards', { method: 'POST', body: JSON.stringify(body) }),

  /** 보드 상세(카드 포함) — GET /api/boards/:id */
  getBoard: (id: string) => request<ApiEnvelope<KanbanBoardDetail>>(`/api/boards/${encodeURIComponent(id)}`),

  /** 보드 수정/삭제 — PATCH/DELETE /api/boards/:id */
  patchBoard: (id: string, body: { name?: string; description?: string | null }) =>
    request<ApiEnvelope<KanbanBoard>>(`/api/boards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteBoard: (id: string) =>
    request<ApiEnvelope<{ deleted: boolean; id: string }>>(`/api/boards/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** 카드 생성 — POST /api/boards/:id/cards */
  createCard: (boardId: string, body: { title: string; body?: string; status?: string; priority?: number; assignee?: string | null; labels?: string[] }) =>
    request<ApiEnvelope<BoardCardDto>>(`/api/boards/${encodeURIComponent(boardId)}/cards`, { method: 'POST', body: JSON.stringify(body) }),

  /** 대화→카드 생성 — POST /api/boards/:id/cards/from-message */
  cardFromMessage: (boardId: string, body: { message_id: string; title?: string; status?: string; assignee?: string | null; labels?: string[]; priority?: number }) =>
    request<ApiEnvelope<BoardCardDto>>(`/api/boards/${encodeURIComponent(boardId)}/cards/from-message`, { method: 'POST', body: JSON.stringify(body) }),

  /** 카드 수정(드래그 이동 포함) — PATCH /api/cards/:cardId */
  patchCard: (cardId: string, body: { title?: string; body?: string; status?: string; position?: number; priority?: number; assignee?: string | null; labels?: string[] }) =>
    request<ApiEnvelope<BoardCardDto>>(`/api/cards/${encodeURIComponent(cardId)}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** 카드 삭제 — DELETE /api/cards/:cardId */
  deleteCard: (cardId: string) =>
    request<ApiEnvelope<{ deleted: boolean; id: string }>>(`/api/cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' }),
};

// ── 볼트/보드 DTO (백엔드 types/db.ts와 동일 셸) ────────
export interface VaultBacklink { id?: string; title?: string }
export interface VaultNote {
  id: string;
  user_id: string;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  backlinks: VaultBacklink[];
  source_session_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface VaultTreeNode { name: string; path: string; note_count: number; children: VaultTreeNode[] }
export interface VaultSearchHit { id: string; title: string; folder: string; tags: string[]; snippet: string; updated_at: string }
export interface KanbanBoard {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}
export interface KanbanBoardDetail extends KanbanBoard { cards: BoardCardDto[] }

/** GET /api/favorites 응답 행 — 메시지 + 소속 세션 요약 (백엔드 favorites.ts 수동 조인) */
export interface FavoriteEntry {
  message: ServerChatMessage;
  session: { id: string; title: string | null; agent_id: string | null; agent_name: string | null; status: string | null };
}

// ── WebSocket (백엔드 protocol.ts 서버→클라이언트) ─
export type ServerMessage = (
  | (TurnIdentity & { type: 'run.started' | 'run.progress' | 'run.completed' | 'run.failed' | 'run.cancelled'; session_id: string; run_id: string; quip?: string; stage?: string; error?: { code: string; message: string }; partial_text?: string })
  | (TurnIdentity & { type: 'turn.status'; session_id: string; status: 'received' | 'processing' | 'completed' | 'failed'; stage?: string; quip?: string })
  | (TurnIdentity & { type: 'answer.delta'; session_id: string; delta: string; index?: number })
  | (TurnIdentity & { type: 'answer.done'; ai_generated?: boolean; session_id: string; text?: string; message_id?: string | null })
  | { type: 'message.new'; session_id: string; message: ServerChatMessage }
  | (ServerChatMessage & { type: 'message.new' })
  | { type: 'connected'; session_id: string | null; timestamp: string }
  | { type: 'subscribed'; session_id: string; channels: string[]; current_seq?: number }
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
  | { type: 'ping'; ts: number }) & { seq?: number };

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
  /** 파싱된 모든 JSON 프레임 — 신규 이벤트 타입(백엔드 병행 개발)에 대한 forward-compatible 훅 */
  onRaw?: (msg: Record<string, unknown>) => void;
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

  void open();
  async function open() {
    try {
      await initializeApi();
    } catch {
      if (!closed) handlers.onError?.({ type: 'error', code: 'WS_AUTH_FAILED', message: 'errors.connection' });
      return;
    }
    let ticket: string | undefined;
    if (config.token) {
      try {
        // Fastify는 application/json + 빈 본문을 400으로 거부하므로 빈 객체를 명시한다.
        const env = await request<ApiEnvelope<{ ticket: string }>>('/api/ws-ticket', { method: 'POST', body: JSON.stringify({}) });
        if (!env.ok || !env.data?.ticket) throw new Error('errors.connection');
        ticket = env.data.ticket;
      } catch {
        // 티켓 발급 실패(인증/서버 오류)는 조용한 익명 재시도 금지 — 명시적 오류로 surfaced.
        if (!closed) handlers.onError?.({ type: 'error', code: 'WS_AUTH_FAILED', message: 'errors.connection' });
        return;
      }
    }
    if (closed) return;
    try {
      ws = new WebSocket(buildWsUrl(sessionId, ticket));
    } catch {
      // 브라우저/RN에서 WebSocket 미지원 시 fail 상태로
      if (closed) return;
      handlers.onError?.({ type: 'error', code: 'WS_UNSUPPORTED', message: 'errors.connection' });
      handlers.onStatusChange?.('disconnected');
      return;
    }

    ws.onopen = () => {
      if (closed) return;
      handlers.onStatusChange?.('connected');
      // 주기 ping (프로토콜 §4.6)
      pingTimer = setInterval(() => {
        try {
          ws?.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        } catch {
          /* 연결 정리 중 발생한 오류는 무시한다. */
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
      if (!msg || typeof msg !== 'object') return;
      handlers.onRaw?.(msg as unknown as Record<string, unknown>);
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

  }

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
        /* 연결 정리 중 발생한 오류는 무시한다. */
      }
    },
    get ready() { return !closed && ws?.readyState === WebSocket.OPEN; },
  };
}

export const connectChatSocket = connectVoiceSocket;

export function buildWsUrl(sessionId: string | null, ticket?: string): string {
  const url = new URL(config.wsUrl);
  url.searchParams.delete('token');
  url.searchParams.delete('ticket');
  if (sessionId) url.searchParams.set('session_id', sessionId);
  if (ticket) url.searchParams.set('ticket', ticket);
  return url.toString();
}
