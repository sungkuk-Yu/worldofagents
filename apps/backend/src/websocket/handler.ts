import { getOwnedMessage } from '../lib/helpers';
/**
 * WebSocket 핸들러 — api-design.md §4 프로토콜 구현.
 * - 구독 (subscribe/subscribed)
 * - 오디오 스트리밍 (audio.start → binary PCM → audio.end) → STT → 뉴런 그래프 → 브로드캐스트
 * - 실시간 트랜스크립트 (transcript.partial/final)
 * - 뉴런 상태 업데이트 (neuron.status), 작업/큐 상태 (task.status, queue.update)
 * - 핑/퐁 연결 유지
 */
import { FastifyRequest } from 'fastify';
import { consumeTicket } from '../routes/wsTicket';
import { recordEvent, currentSeq, replaySince, cancelRun } from './eventlog';
import { config } from '../config';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../utils/logger';
import { AudioStreamBuffer, transcribeAudio, hasVoiceActivity } from '../lib/stt';
import { runTextTurn } from '../lib/chatTurn';
import { SessionsRow } from '../types/db';
import { sendJson, ClientMessage, ServerMessage, WSChannel } from './protocol';

export interface WSSocket {
  send: (data: string) => void;
  ping?: () => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
  terminate?: () => void;
  readyState?: number;
}

// ── 세션 허브: session_id → 연결 집합 ───────────────────
const sessionHub = new Map<string, Set<WSSocket>>();

export function registerConnection(sessionId: string, socket: WSSocket): void {
  if (!sessionHub.has(sessionId)) sessionHub.set(sessionId, new Set());
  sessionHub.get(sessionId)!.add(socket);
}

export function unregisterConnection(sessionId: string, socket: WSSocket): void {
  const set = sessionHub.get(sessionId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) sessionHub.delete(sessionId);
}

export function broadcastToSession(sessionId: string, message: ServerMessage): void {
  const stamped = recordEvent(sessionId, message);
  const set = sessionHub.get(sessionId);
  if (!set) return;
  for (const socket of set) sendJson(socket, stamped);
}

interface AudioSession {
  buffer: AudioStreamBuffer;
  startedAt: number;
  language: string;
}

interface ConnState {
  sessionId: string | null;
  userId: string;
  channels: WSChannel[];
  audio: AudioSession | null;
  lastActivity: number;
}

export async function websocketHandler(connection: any, request: FastifyRequest) {
  const socket = connection.socket as WSSocket;
  const query = (request.query || {}) as { session_id?: string; token?: string; ticket?: string };

  const state: ConnState = {
    sessionId: query.session_id || null,
    userId: '',
    channels: ['audio', 'transcript', 'neuron_status', 'task'],
    audio: null,
    lastActivity: Date.now(),
  };

  // 헤더 JWT 또는 일회용 티켓만 인증에 사용한다.
  try {
    await request.jwtVerify();
    const sub = (request.user as { sub?: unknown })?.sub;
    if (typeof sub === 'string') state.userId = sub;
  } catch {
    // 티켓 인증으로 이어진다.
  }
  if (!state.userId && typeof query.ticket === 'string') {
    state.userId = consumeTicket(query.ticket) || '';
  }
  if (!state.userId) {
    if (!config.devMode) {
      sendJson(socket, { type: 'error', code: 'AUTH_REQUIRED', message: '인증 토큰이 필요합니다.' });
      socket.terminate?.();
      return;
    }
    state.userId = query.token === 'dev-test' ? 'dev-test-user' : '';
  }

  async function assertSessionOwnership(sessionId: string | null, userId: string): Promise<SessionsRow | null> {
    if (!userId || !sessionId) {
      sendJson(socket, { type: 'error', code: !userId ? 'AUTH_REQUIRED' : 'VALIDATION_ERROR', message: !userId ? '인증이 필요합니다.' : 'session_id가 필요합니다.' });
      return null;
    }
    const { data: session, error } = await supabaseAdmin.from('sessions').select('*').eq('id', sessionId).maybeSingle();
    const code = error ? 'INTERNAL_ERROR' : !session ? 'SESSION_NOT_FOUND' : session.user_id !== userId ? 'FORBIDDEN' : null;
    if (code) {
      sendJson(socket, { type: 'error', code, message: code === 'FORBIDDEN' ? '세션 접근 권한이 없습니다.' : code === 'SESSION_NOT_FOUND' ? '세션을 찾을 수 없습니다.' : '세션 조회에 실패했습니다.' });
      return null;
    }
    return session as SessionsRow;
  }

  function joinSession(sessionId: string) {
    if (state.sessionId !== sessionId) {
      if (state.sessionId) unregisterConnection(state.sessionId, socket);
      state.audio = null;
    }
    state.sessionId = sessionId;
    registerConnection(sessionId, socket);
  }

  logger.info(`WebSocket connected: user=${state.userId || '(anon)'}, session=${state.sessionId}`);

  sendJson(socket, {
    type: 'connected',
    session_id: state.sessionId,
    timestamp: new Date().toISOString(),
  });

  if (state.sessionId) {
    const session = state.userId ? await assertSessionOwnership(state.sessionId, state.userId) : null;
    if (session) joinSession(session.id);
    else state.sessionId = null;
  }

  // 프로토콜 레벨 ping → pong (ws 표준)
  const pingInterval = setInterval(() => {
    try {
      socket.ping?.();
    } catch {
      /* noop */
    }
  }, config.ws.pingIntervalMs);

  const checkAlive = setInterval(() => {
    if (Date.now() - state.lastActivity > config.ws.pongTimeoutMs) {
      logger.info(`WebSocket heartbeat timeout, closing: user=${state.userId}`);
      cleanup(true);
    }
  }, config.ws.pingIntervalMs);

  function cleanup(terminate = false) {
    clearInterval(pingInterval);
    clearInterval(checkAlive);
    if (state.sessionId) unregisterConnection(state.sessionId, socket);
    if (terminate) socket.terminate?.();
  }

  socket.on('message', async (raw: Buffer | string, isBinary?: boolean) => {
    state.lastActivity = Date.now();

    // 바이너리 프레임 = 오디오 청크 (텍스트 JSON 프레임도 Buffer로 내려오므로 isBinary로 구분)
    if (isBinary === true && (Buffer.isBuffer(raw) || ArrayBuffer.isView(raw))) {
      handleAudioChunk(socket, state, Buffer.isBuffer(raw) ? raw : Buffer.from(raw as unknown as ArrayBuffer));
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      sendJson(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'Invalid message format' });
      return;
    }

    try {
      if (!message || typeof message !== 'object') throw Object.assign(new Error('메시지 형식이 올바르지 않습니다.'), { code: 'VALIDATION_ERROR' });
      let session: SessionsRow | null = null;
      if ('session_id' in message || ['subscribe', 'audio.start', 'audio.end', 'audio.cancel', 'transcript', 'message.send', 'run.cancel'].includes(message.type)) {
        const id = 'session_id' in message ? message.session_id : state.sessionId;
        session = await assertSessionOwnership(typeof id === 'string' ? id : state.sessionId, state.userId);
        if (!session) return;
        joinSession(session.id);
      }
      switch (message.type) {
        case 'subscribe':
          state.channels = message.channels || state.channels;
          sendJson(socket, { type: 'subscribed', session_id: state.sessionId!, channels: state.channels, current_seq: currentSeq(state.sessionId!) });
          if (typeof message.last_seq === 'number' && Number.isFinite(message.last_seq)) {
            for (const event of replaySince(state.sessionId!, message.last_seq)) sendJson(socket, event);
          }
          break;

        case 'run.cancel':
          if (!cancelRun(session!.id, message.run_id)) {
            sendJson(socket, { type: 'error', code: 'NOT_FOUND', message: '취소할 실행이 없습니다.' });
          }
          break;

        case 'message.send': {
          if (typeof message.content !== 'string' || !message.content.trim()) {
            sendJson(socket, { type: 'error', code: 'VALIDATION_ERROR', message: '메시지 내용(content)은 필수입니다.' });
            break;
          }
          let thread;
          if (message.parent_message_id !== undefined) {
            if (typeof message.parent_message_id !== 'string' || !message.parent_message_id) {
              throw Object.assign(new Error('부모 메시지 ID가 올바르지 않습니다.'), { code: 'VALIDATION_ERROR' });
            }
            const { message: parent } = await getOwnedMessage(supabaseAdmin, state.userId, message.parent_message_id, session!.id);
            thread = { parentMessageId: parent.id, rootMessageId: parent.root_message_id || parent.id };
          }
          // 종료 상태는 공유 실행기의 finally에서 보장한다.
          await runTextTurn(supabaseAdmin, session!, state.userId, message.content.trim(), { thread, emit: e => broadcastToSession(session!.id, e) });
          break;
        }

        case 'audio.start':
          await handleAudioStart(socket, state, message);
          break;

        case 'audio.end':
          await handleAudioEnd(socket, state, session!, state.userId);
          break;

        case 'audio.cancel':
          if (state.audio) state.audio = null;
          sendJson(socket, { type: 'audio.vad', session_id: state.sessionId || '', active: false });
          break;

        case 'transcript':
          await handleTr({ text: message.text, isFinal: message.is_final !== false, session: session!, userId: state.userId });
          break;

        case 'ping':
          sendJson(socket, { type: 'pong', ts: message.ts || Date.now() });
          break;

        case 'pong':
          break;

        default:
          sendJson(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'Unknown message type' });
      }
    } catch (err: any) {
      if (err?.code === 'RUN_CANCELLED') return;
      logger.error({ err: err?.message }, 'WS message handler error');
      sendJson(socket, {
        type: 'session.error',
        code: err?.code || 'INTERNAL_ERROR',
        message: err?.message || '처리 중 오류가 발생했습니다.',
      });
    }
  });

  socket.on('close', () => {
    logger.info(`WebSocket disconnected: user=${state.userId}`);
    cleanup(false);
  });
  socket.on('error', () => cleanup(true));
}

// ── 오디오 스트리밍 ────────────────────────────────────

function handleAudioChunk(socket: WSSocket, state: ConnState, chunk: Buffer) {
  if (!state.audio) {
    // 스트림 시작 전 도착 → 무시
    return;
  }
  if (!hasVoiceActivity(chunk)) {
    // 무음 청크 — 버퍼에는 넣되 VAD 신호 전달
    state.audio.buffer.push(chunk);
    return;
  }
  state.audio.buffer.push(chunk);
  if (state.audio.buffer.durationMs % 16000 < 100) {
    // 약 1초마다 수신 확인 신호
    sendJson(socket, { type: 'audio.received', bytes: chunk.length, timestamp: new Date().toISOString() });
  }
  // 문장 경계 후보 시 부분 트랜스크립트 훅 (실제 STT 연동 시 partial 발생 지점)
  if (state.audio.buffer.hasSilenceBoundary(chunk) && config.openai.apiKey) {
    // 실서비스: 이 시점에 최근 3초 윈도우 부분 트랜스크립션 수행
    // Phase 1에서는 final에서만 트랜스크립션 (비용/지연 절감)
  }
}

async function handleAudioStart(socket: WSSocket, state: ConnState, message: Extract<ClientMessage, { type: 'audio.start' }>) {
  const sessionId = message.session_id || state.sessionId;
  if (!sessionId) {
    sendJson(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'session_id가 필요합니다.' });
    return;
  }
  state.sessionId = sessionId;
  state.audio = {
    buffer: new AudioStreamBuffer(),
    startedAt: Date.now(),
    language: message.config?.language || 'auto',
  };
  sendJson(socket, {
    type: 'audio.started',
    session_id: sessionId,
    config: {
      sample_rate: message.config?.sample_rate || config.openai.stt.sampleRate,
      encoding: message.config?.encoding || config.openai.stt.encoding,
      language: state.audio.language,
    },
  });
}

async function handleAudioEnd(socket: WSSocket, state: ConnState, session: SessionsRow, userId: string) {
  const target = session.id;
  if (!target) {
    sendJson(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'session_id가 필요합니다.' });
    return;
  }

  const audio = state.audio;
  if (!audio) {
    sendJson(socket, { type: 'error', code: 'VALIDATION_ERROR', message: '활성 오디오 스트림이 없습니다.' });
    return;
  }
  state.audio = null;

  if (!audio.buffer.hasSignal) {
    sendJson(socket, { type: 'transcript.final', session_id: target, turn_index: -1, text: '', confidence: 0, language: audio.language, duration_ms: audio.buffer.durationMs, message_id: null });
    return;
  }

  sendJson(socket, { type: 'audio.vad', session_id: target, active: false });

  const result = await transcribeAudio(audio.buffer.bundle);
  if (!result.text) {
    sendJson(socket, { type: 'transcript.final', session_id: target, turn_index: -1, text: '', confidence: 0, language: audio.language, duration_ms: result.durationMs, message_id: null });
    return;
  }

  await handleTr({
    text: result.text,
    isFinal: true,
    session,
    userId,
    stt: { confidence: result.confidence, language: result.language, duration_ms: result.durationMs, service: result.service },
  });
}

// ── 최종 트랜스크립트 → 뉴런 파이프라인 → 브로드캐스트 ──

interface TrInput {
  text: string;
  isFinal: boolean;
  session: SessionsRow;
  userId: string;
  stt?: Record<string, unknown>;
}

async function handleTr({ text, isFinal, session, userId, stt }: TrInput) {
  const sessionId = session.id;
  if (typeof text !== 'string' || !text.trim()) return;
  if (session.status === 'archived') throw Object.assign(new Error('아카이브된 세션입니다.'), { code: 'SESSION_ARCHIVED' });

  // 부분 트랜스크립트는 브로드캐스트만 (sentence 경계 아닌 경우)
  if (!isFinal) {
    broadcastToSession(sessionId, {
      type: 'transcript.partial',
      session_id: sessionId,
      text,
      confidence: 0.8,
      language: (stt?.language as string) || 'ko',
    });
    return;
  }

  const result = await runTextTurn(supabaseAdmin, session, userId, text, {
    sttMetadata: stt,
    emit: e => broadcastToSession(sessionId, e),
  });

  // 최종 트랜스크립트 + 응답 브로드캐스트
  broadcastToSession(sessionId, {
    type: 'transcript.final',
    session_id: sessionId,
    turn_index: result.messages.user.turn_index,
    text,
    confidence: (stt?.confidence as number) || 0.95,
    language: (stt?.language as string) || 'ko',
    duration_ms: (stt?.duration_ms as number) || 0,
    message_id: result.userMessageId,
  });

  broadcastToSession(sessionId, {
    type: 'queue.update',
    session_id: sessionId,
    pending_count: 0,
    current_task: result.answerResponse ? '답변 생성 완료' : null,
    next_tasks: [],
  });
}

/** 테스트용 — 허브 상태 검사 */
export function __hubInfo(): { sessions: number; connections: number } {
  let connections = 0;
  for (const set of sessionHub.values()) connections += set.size;
  return { sessions: sessionHub.size, connections };
}