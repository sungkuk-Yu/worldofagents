import { Locale, resolveLocale } from '../lib/locale';
import { getOwnedMessage, serializeMessage } from '../lib/helpers';
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
import { recordEvent, currentSeq, replaySince, cancelRun, hasActiveRun, isDuplicateIngress, currentEpoch, eventSyncState } from './eventlog';
import { config } from '../config';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../utils/logger';
import { AudioStreamBuffer, transcribeAudio, hasVoiceActivity } from '../lib/stt';
import { normalizePttMode, normalizeDeviceLabel, isPttIdleTimeout, isPttHoldOverflow, PttMode } from '../lib/pushToTalk';
import { runTextTurn, persistUserUtteranceEarly } from '../lib/chatTurn';
import { randomUUID } from 'node:crypto';
import { queueJoinLine } from '../lib/personaVoice';
import { parseAttachmentIds } from '../lib/attachments';
import { enqueueQuestion, listQueue, queueSnapshot, isQueueKnownUnavailable } from '../lib/questionQueue';
import { MessagesRow, SessionsRow } from '../types/db';
import { sendJson, ClientMessage, ServerMessage, WSChannel, PresenceDevice } from './protocol';

export interface WSSocket {
  send: (data: string) => void;
  ping?: () => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
  terminate?: () => void;
  readyState?: number;
}

// ── 세션 허브: session_id → 연결 집합 ───────────────────
const sessionHub = new Map<string, Set<WSSocket>>();
// ── presence: 소켓 → 연결 메타, session_id → 라벨 변경 감지용 ──
interface SocketMeta { device: string; joinedAt: number }
const socketMeta = new WeakMap<WSSocket, SocketMeta>();

function presenceOf(sessionId: string): PresenceDevice[] {
  const byDevice = new Map<string, number>();
  for (const socket of sessionHub.get(sessionId) || []) {
    const meta = socketMeta.get(socket);
    if (!meta) continue;
    const prev = byDevice.get(meta.device);
    if (prev === undefined || meta.joinedAt < prev) byDevice.set(meta.device, meta.joinedAt);
  }
  return [...byDevice.entries()]
    .map(([device, since]) => ({ device, since }))
    .sort((a, b) => a.since - b.since);
}

/** 외부(REST /resume)에서 조회 — 이 세션에 실시간 접속 중인 디바이스 라벨 목록. */
export function sessionPresence(sessionId: string): string[] {
  return presenceOf(sessionId).map(entry => entry.device);
}

function broadcastPresence(sessionId: string, except?: WSSocket): void {
  const message: ServerMessage = { type: 'presence.update', session_id: sessionId, devices: presenceOf(sessionId) };
  for (const socket of sessionHub.get(sessionId) || []) {
    if (socket !== except) sendJson(socket, message);
  }
}

export function registerConnection(sessionId: string, socket: WSSocket): void {
  if (!sessionHub.has(sessionId)) sessionHub.set(sessionId, new Set());
  const set = sessionHub.get(sessionId)!;
  const fresh = !set.has(socket);
  set.add(socket);
  if (fresh) {
    if (!socketMeta.get(socket)) socketMeta.set(socket, { device: 'unknown', joinedAt: Date.now() });
    // 가입자 본인에게는 알리지 않는다 — subscribed 응답의 devices로 전달된다
    // (handshake 이벤트 순서를 presence가 교란하지 않는다, ws-contract 회귀 방지).
    broadcastPresence(sessionId, socket);
  }
}

export function unregisterConnection(sessionId: string, socket: WSSocket): void {
  const set = sessionHub.get(sessionId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) sessionHub.delete(sessionId);
  else broadcastPresence(sessionId);
}

export function broadcastToSession(sessionId: string, message: ServerMessage): void {
  const stamped = recordEvent(sessionId, message);
  const set = sessionHub.get(sessionId);
  if (!set) return;
  for (const socket of set) sendJson(socket, stamped);
}

/** 유실 메커니즘 (t_83946f45 실측 재현): @fastify/websocket 8.3.1은 handleUpgrade 직후
 *  createWebSocketStream으로 raw 소켓에 자기 'message' 리스너를 선점 붙인다. handshake의
 *  awaited 왕복(JWT·티켓·소유권 실DB 수백 ms) 끝에 리스너를 붙이면, 그 사이에 도착한
 *  프레임은 이미 스트림 래퍼가 삼켜 orphan 버퍼로 폐기된다 — 무한 버퍼가 아니라 유실.
 *  따라서 리스너는 websocketHandler 첫 동기 라인에 붙이고(창 0), 검증 완료 전 프레임만
 *  아래 큐로 보류했다가 순서대로 처리한다. */
const pendingIngress = new WeakMap<object, Array<{ raw: Buffer | string; isBinary?: boolean }>>();
/** 16 캡: 초과 시 가장 오래된 것부터 폐기 (무한 메모리·순서 왜곡 방지). */
const INGRESS_QUEUE_CAP = 16;

function queueIngress(socket: WSSocket, raw: Buffer | string, isBinary?: boolean): void {
  const q = pendingIngress.get(socket) || [];
  q.push({ raw, isBinary });
  if (q.length > INGRESS_QUEUE_CAP) q.shift();
  pendingIngress.set(socket, q);
}

/** 테스트 훅 (t_5cba9ebb 드레인 순서 회귀) — 실 소켓 대신 plain object로 큐를 채운다. */
export const __ingressTestHooks = {
  queue: (socket: object, raw: string) => queueIngress(socket as WSSocket, raw),
  drain: (socket: object, deliver: (raw: Buffer | string, isBinary?: boolean) => Promise<unknown> | void) =>
    drainIngress(socket as WSSocket, deliver),
};

function drainIngress(socket: WSSocket, deliver: (raw: Buffer | string, isBinary?: boolean) => Promise<unknown> | void): Promise<void> {
  const q = pendingIngress.get(socket);
  if (!q || q.length === 0) return Promise.resolve();
  pendingIngress.delete(socket);
  // 도착 순서 보장 = 체이닝 (t_5cba9ebb 실측 결함): 병렬 fire-and-forget은 각 프레임의
  // assertSessionOwnership DB 왕복 완료 순이 비결정적이라 handshake 보류분에서
  // audio.end가 audio.start(state.audio 미설정)보다 먼저 실행될 수 있다
  // — 재현: 실DB WS 음성 발화 '활성 오디오 스트림이 없습니다'. 주석 계약("도착 순서대로")을
  // 구현이 위반하고 있던 것. 개별 프레임 실패가 후속 프레임을 막지 않는다.
  return (async () => {
    for (const item of q) {
      try { await deliver(item.raw, item.isBinary); } catch { /* per-frame swallow */ }
    }
  })();
}

/** subscribed 회신 단일 지점 — send 후 state.subscribedSent 기록 (t_83946f45:
 *  ack-less message.send의 implicit subscribe 판정이 이 플래그에 의존한다).
 *  seq_epoch (t_3486b1d7 ③): 클라이언트 보관 에포크와 다르면 재기동 감지 → 전량 캐치업. */
function sendSubscribed(socket: WSSocket, state: ConnState): void {
  state.subscribedSent = true;
  sendJson(socket, { type: 'subscribed', session_id: state.sessionId!, channels: state.channels, current_seq: currentSeq(state.sessionId!), seq_epoch: config.protocol.seqDiffSync ? currentEpoch() : undefined, devices: presenceOf(state.sessionId!) });
}

interface AudioSession {
  buffer: AudioStreamBuffer;
  startedAt: number;
  language: string;
  /** PTT (t_d75ca81c): hold=누르는 동안 / toggle=한 번 더 눌러 종료. 기본 hold. */
  pttMode: PttMode;
  device: string;
  /** 마지막 음성 활동 시각 — 릴리스 미도달 runaway 세그먼트의 무음 타임아웃용 */
  lastVoiceAt: number;
}

interface ConnState {
  locale: Locale;
  sessionId: string | null;
  userId: string;
  channels: WSChannel[];
  audio: AudioSession | null;
  lastActivity: number;
  /** subscribed 회신을 보냈는지 (t_83946f45 ack-less message.send → implicit subscribe 판정). */
  subscribedSent: boolean;
}

export async function websocketHandler(connection: any, request: FastifyRequest) {
  const socket = connection.socket as WSSocket;
  const query = (request.query || {}) as { session_id?: string; token?: string; ticket?: string; locale?: string; device?: string };

  const state: ConnState = {
    locale: resolveLocale(query.locale, request.headers?.['accept-language']),
    sessionId: query.session_id || null,
    userId: '',
    channels: ['audio', 'transcript', 'neuron_status', 'task'],
    audio: null,
    lastActivity: Date.now(),
    subscribedSent: false,
  };

  // ── t_83946f45 첫 발화 유실 방지: 리스너를 첫 동기 경로에 붙여 유실 창을 0으로 만든다.
  // (아래 인증·소유권 검증의 await 왕복 실DB에서 수백 ms — 옛 구조는 그 뒤에 리스너를 붙여
  //  open 직후 도착한 subscribe/message.send가 스트림 래퍼에 삼켜져 폐기됐다.)
  // 검증 완료 전에 도착한 프레임만 큐에 보류하고 순서대로 처리한다.
  let handshakeDone = false;
  let closed = false;
  // 하트비트 인터벌은 handshake 완료 후 생성 — close/error가 그 전에 와도 cleanup이 안전하다.
  const timers: { ping?: ReturnType<typeof setInterval>; alive?: ReturnType<typeof setInterval> } = {};

  function cleanup(terminate = false) {
    clearInterval(timers.ping);
    clearInterval(timers.alive);
    if (state.sessionId) unregisterConnection(state.sessionId, socket);
    if (terminate) socket.terminate?.();
  }

  socket.on('message', (raw: Buffer | string, isBinary?: boolean) => {
    // handshake 후 Promise를 그대로 반환한다 — old 구조(async 리스너)와 동일하게
    // 'await send(...)'가 처리 완료를 기다리는 테스트·호출 관례를 보존 (t_83946f45).
    if (handshakeDone) return handleMessage(raw, isBinary);
    queueIngress(socket, raw, isBinary);
    return undefined;
  });
  socket.on('close', () => {
    closed = true;
    handshakeDone = true; // 종료 후 드레인 금지 — 큐는 약한 참조라 자동 소멸
    logger.info(`WebSocket disconnected: user=${state.userId}`);
    cleanup(false);
  });
  socket.on('error', () => { handshakeDone = true; cleanup(true); });

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

  // 연결 쿼리의 디바이스 라벨로 presence 메타를 먼저 심는다 (joinSession 이전 포함해 항상 존재).
  socketMeta.set(socket, { device: normalizeDeviceLabel(query.device), joinedAt: Date.now() });

  sendJson(socket, {
    type: 'connected',
    session_id: state.sessionId,
    timestamp: new Date().toISOString(),
  });

  // 검증·소유권 왕복이 끝나고 소켓이 이미 닫혔으면(클라이언트 즉시 재접속 등) 이후 작업을 하지 않는다.
  if (closed) return;

  if (state.sessionId) {
    const session = state.userId ? await assertSessionOwnership(state.sessionId, state.userId) : null;
    // 왕복 중에 소켓이 닫혔으면(joinSession 이후 close는 허브 등록 누수 방지) 여기서 중단한다.
    if (closed) return;
    if (session) joinSession(session.id);
    else state.sessionId = null;
  }

  // 프로토콜 레벨 ping → pong (ws 표준)
  timers.ping = setInterval(() => {
    try {
      socket.ping?.();
    } catch {
      /* noop */
    }
  }, config.ws.pingIntervalMs);

  timers.alive = setInterval(() => {
    if (Date.now() - state.lastActivity > config.ws.pongTimeoutMs) {
      logger.info(`WebSocket heartbeat timeout, closing: user=${state.userId}`);
      cleanup(true);
    }
  }, config.ws.pingIntervalMs);

  async function handleMessage(raw: Buffer | string, isBinary?: boolean): Promise<void> {
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
        case 'subscribe': {
          if (message.locale !== undefined) state.locale = resolveLocale(message.locale, request.headers?.['accept-language']);
          state.channels = message.channels || state.channels;
          // 디바이스 라벨 (t_d75ca81c presence): 'pc-web' | 'mobile-web' | 'ios' | 'android' — 미지정 'unknown'.
          // 연결 쿼리에 라벨이 없던 소켓만 subscribe로 보정한다.
          const meta = socketMeta.get(socket) || { device: 'unknown', joinedAt: Date.now() };
          socketMeta.set(socket, meta);
          if (message.device !== undefined && meta.device === 'unknown') {
            meta.device = normalizeDeviceLabel(message.device);
            broadcastPresence(state.sessionId!);
          }
          sendSubscribed(socket, state);
          if (typeof message.last_seq === 'number' && Number.isFinite(message.last_seq)) {
            for (const event of replaySince(state.sessionId!, message.last_seq)) sendJson(socket, event);
          }
          break;
        }

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
          // t_83946f45: ack 없이 message.send가 먼저 와도 성공한다. 위 공통 경로에서
          // 소유권 검증 + joinSession(허브 등록)이 끝났으므로, 아직 subscribed 회신이
          // 없으면 여기서 implicit subscribe로 보낸다 — 대기 창에 유실됐던 구구조와 달리
          // 첫 발화의 run.* 이벤트가 이 소켓으로 확실히 라우팅된다.
          if (!state.subscribedSent) sendSubscribed(socket, state);
          // 요구① (t_c31e3f45): 실행 중 짧은 창 동일 content 재발송(Enter+버튼 동시 탭)은
          // 드롭 — 큐 적재·드레인으로 user 중복 행이 되는 것을 막는다 (eventlog.isDuplicateIngress).
          if (isDuplicateIngress(session!.id, message.content.trim())) break;
          let thread;
          if (message.parent_message_id !== undefined) {
            if (typeof message.parent_message_id !== 'string' || !message.parent_message_id) {
              throw Object.assign(new Error('부모 메시지 ID가 올바르지 않습니다.'), { code: 'VALIDATION_ERROR' });
            }
            const { message: parent } = await getOwnedMessage(supabaseAdmin, state.userId, message.parent_message_id, session!.id);
            thread = { parentMessageId: parent.id, rootMessageId: parent.root_message_id || parent.id };
          }
          // ② 질문 큐 (t_344e047a): 실행 중 끼어든 메인 발화(스레드·첨부 아님)는 유실 방지용
          // message_queue에 적재하고 queue.updated 체크포인트를 발행한다. 답변은 현재 run
          // 완료 후 워커(drainSessionQueue)가 position 순서로 이어한다.
          // parseAttachmentIds를 먼저 호출해 형식 검증(VALIDATION_ERROR)이 큐 경보다 앞선다.
          // 답글 인용 발화(t_02f58030)도 큐를 우회 — message_queue 스키마는 메인 발화 전용이라
          // reply_to 컨텍스트가 드레인에서 소멸한다(스레드·첨부 우회 규칙과 동일 판정).
          // null/비문자열 reply_to_id는 무인용 발화 — 큐 경로 유지(프론트가 인용바 없이 null을
          // 보내는 경우까지 우회하면 ②가 죽는다).
          const hasAttachments = parseAttachmentIds(message).length > 0;
          const hasQuote = typeof message.reply_to_id === 'string' && !!message.reply_to_id.trim();
          if (!thread && !hasAttachments && !hasQuote && hasActiveRun(session!.id)) {
            const item = await enqueueQuestion(supabaseAdmin, { sessionId: session!.id, userId: state.userId, content: message.content.trim(), locale: state.locale });
            if (item) {
              const snap = queueSnapshot(await listQueue(supabaseAdmin, session!.id));
              broadcastToSession(session!.id, { type: 'queue.updated', session_id: session!.id, ...snap });
              // busy 입력 합류 고지 (t_5cba9ebb 보강 5항): 큐 뉴런이 1인칭 한 줄로 대신 말한다 —
              // "앞에 N개 있어요, 순서대로 챙기고 있어요" (무정보 ETA 금지).
              const join = queueJoinLine(snap.pending_count, state.locale);
              if (join) broadcastToSession(session!.id, { type: 'persona.line', session_id: session!.id, source: 'queue', line: join });
              break;
            }
            // null 원인 분기: 008 미적용(래치)이면 기존 직렬 실행으로 폴백, 아니면 대기 상한 429.
            if (!isQueueKnownUnavailable()) {
              throw Object.assign(new Error('대기 중인 질문이 너무 많습니다. 잠시 후 다시 시도해주세요.'), { code: 'RATE_LIMIT_EXCEEDED' });
            }
          }
          // 종료 상태는 공유 실행기의 finally에서 보장한다.
          await runTextTurn(supabaseAdmin, session!, state.userId, message.content.trim(), { locale: state.locale, thread, attachmentIds: parseAttachmentIds(message), replyToId: message.reply_to_id, clientReqId: message.client_req_id ?? null, emit: e => broadcastToSession(session!.id, e) });
          break;
        }

        case 'audio.start':
          await handleAudioStart(socket, state, message);
          break;

        case 'audio.end':
          // draft=true (t_8bac5645 '→편집' 릴리스): 전사만 하고 비영속 마감 — absent/false 는
          // 기존 전송 경로 1:1 (하위호환).
          await handleAudioEnd(socket, state, session!, state.userId, message.client_req_id ?? null, message.draft === true);
          break;

        case 'audio.cancel':
          if (state.audio) state.audio = null;
          sendJson(socket, { type: 'audio.vad', session_id: state.sessionId || '', active: false });
          break;

        case 'transcript':
          await handleTr({ locale: state.locale, text: message.text, isFinal: message.is_final !== false, session: session!, userId: state.userId, clientReqId: message.client_req_id ?? null });
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
  }

  // handshake 완료: 검증 중에 보류된 프레임을 도착 순서대로 처리한다 (t_83946f45).
  // deliver가 반환하는 Promise를 그대로 드림 — void하면 체이닝이 무의미해져
  // audio.start/audio.end가 병렬 DB 왕복 순으로 뒤집힌다 (t_5cba9ebb 실측 회귀 방지).
  handshakeDone = true;
  drainIngress(socket, (raw, isBinary) => handleMessage(raw, isBinary));
}

// ── 오디오 스트리밍 ────────────────────────────────────

function handleAudioChunk(socket: WSSocket, state: ConnState, chunk: Buffer) {
  // 크래시 안전망 (t_3a91fc08): VAD/버퍼 예외가 ws 리스너까지 새면 프로세스가
  // exit-code 크래시(systemd 재기동 루프)한다. 소켓/프로세스를 죽이지 않고
  // 해당 청크만 조용히 넘기되 사고 병기 원칙에 따라 원인을 남긴다.
  try {
    handleAudioChunkInner(socket, state, chunk);
  } catch (err: any) {
    logger.error(
      { err: err?.message, byteOffset: chunk.byteOffset, byteLength: chunk.byteLength },
      'audio chunk pipeline error (dropped, socket kept alive)'
    );
  }
}

function handleAudioChunkInner(socket: WSSocket, state: ConnState, chunk: Buffer) {
  if (!state.audio) {
    // 스트림 시작 전 도착 → 무시
    return;
  }
  const now = Date.now();
  // PTT 안전망 (t_d75ca81c): 릴리스(audio.end/cancel)가 도달하지 않는 세션 —
  // 홀드 상한 또는 장시간 무음이면 서버가 세그먼트를 종료하고 VAD off를 알린다.
  // (버퍼는 maxAudioBufferMs로 순환 중이지만 세션이 무한히 열려있지 않도록 한다.)
  if (isPttHoldOverflow(state.audio, now) || (state.audio.buffer.hasSignal && isPttIdleTimeout(state.audio, now))) {
    state.audio = null;
    sendJson(socket, { type: 'audio.vad', session_id: state.sessionId || '', active: false });
    return;
  }
  if (!hasVoiceActivity(chunk)) {
    // 무음 청크 — 버퍼에는 넣되 VAD 신호 전달
    state.audio.buffer.push(chunk);
    return;
  }
  state.audio.lastVoiceAt = now;
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
  // 이전 세그먼트가 아직 열려 있으면 (PTT 릴리스 누락) 새 start가 암묵적으로 종료 처리한다 —
  // 미전송 버퍼는 폐기(중복 전송 금지)하고 VAD off만 알린다.
  if (state.audio) {
    state.audio = null;
    sendJson(socket, { type: 'audio.vad', session_id: sessionId, active: false });
  }
  state.sessionId = sessionId;
  const now = Date.now();
  state.audio = {
    buffer: new AudioStreamBuffer(),
    startedAt: now,
    language: message.config?.language || 'auto',
    pttMode: normalizePttMode(message.config?.mode),
    device: normalizeDeviceLabel(message.config?.device),
    lastVoiceAt: now,
  };
  sendJson(socket, {
    type: 'audio.started',
    session_id: sessionId,
    config: {
      sample_rate: message.config?.sample_rate || config.openai.stt.sampleRate,
      encoding: message.config?.encoding || config.openai.stt.encoding,
      language: state.audio.language,
      mode: state.audio.pttMode,
      device: state.audio.device,
      max_hold_ms: config.pushToTalk.maxHoldMs,
      silence_timeout_ms: config.pushToTalk.silenceTimeoutMs,
    },
  });
}

async function handleAudioEnd(socket: WSSocket, state: ConnState, session: SessionsRow, userId: string, clientReqId: string | null = null, draft = false) {
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

  // hold-for-edit 브리지 (t_8bac5645, 대표님 10/4 '수정(녹음 완료하나 전송 전 텍스트 편집)'):
  // audio.end{draft:true}는 전사 회신만 보낸다 — user 행 영속 0·runTextTurn 0·transcript.final 0·
  // 멱등(client_req_id) 저장 0. 발화 소켓 회신 전용(sendJson)이라 seq 미채번·eventlog 미기록 —
  // last_seq diff 리플레이에 구 draft가 재폭주하지 않는다 (휘발성 연출). audio.cancel 폐기 계약 무영향.
  if (!audio.buffer.hasSignal) {
    // 무음 릴리스(draft)는 text:'' — 프론트 no-op. 기존 '' final 경로와 대칭.
    if (draft) {
      sendJson(socket, { type: 'transcript.draft', session_id: target, text: '', confidence: 0, language: audio.language, duration_ms: audio.buffer.durationMs });
      return;
    }
    sendJson(socket, { type: 'transcript.final', session_id: target, turn_index: -1, text: '', confidence: 0, language: audio.language, duration_ms: audio.buffer.durationMs, message_id: null });
    return;
  }

  sendJson(socket, { type: 'audio.vad', session_id: target, active: false });

  // 언어 힌트 전파 (t_827dcbcc, 'is' 오전사): 우선순위 client config.language > 세션/요청 locale
  // > config.defaultLocale (카드계약 #1, 기본 ko 강제) — 무힌트 자동감지는 짧은 한국어 발화를
  // 아이슬란드어로 오인해 화면까지 도달했다(10/10 08:43, message 435f61c3).
  const hintLang = audio.language !== 'auto' ? audio.language : (state.locale || config.defaultLocale);
  const result = await transcribeAudio(audio.buffer.bundle, hintLang);
  if (draft) {
    // 전사 실패·무결과도 draft는 영속하지 않고 회신으로 마감 (text:'' 은 프론트 no-op).
    sendJson(socket, { type: 'transcript.draft', session_id: target, text: result.text, confidence: result.confidence, language: result.language, duration_ms: result.durationMs });
    return;
  }
  if (!result.text) {
    sendJson(socket, { type: 'transcript.final', session_id: target, turn_index: -1, text: '', confidence: 0, language: audio.language, duration_ms: result.durationMs, message_id: null });
    return;
  }

  // 음성 확정 발화: 전사 직후 runTextTurn 실행 **이전**에 user 행 영속+transcript.final·
  // message.new 선방송 (t_2133e4fc, 대표님 #324 "질문은 텍스트로 내가 뭘 질문했는지는
  // 보여줬으면해"). 런이 37~300s 걸리거나 실패해도 발화 텍스트와 user message_id가 즉시
  // 확정된다. handleAudioEnd의 별도 브로드캐스트가 없던 구 구조(t_5cba9ebb의 message_id=null
  // pending 표식)는 폐기 — 확정 id를 실어 보낸다. runTextTurn은 같은 user message_id를
  // 재사용(persistedUser)해 중복 영속하지 않는다.
  await handleTr({
    locale: state.locale,
    text: result.text,
    isFinal: true,
    session,
    userId,
    stt: { confidence: result.confidence, language: result.language, duration_ms: result.durationMs, service: result.service },
    clientReqId,
  });
}

// ── 최종 트랜스크립트 → 뉴런 파이프라인 → 브로드캐스트 ──

interface TrInput {
  locale: Locale;
  text: string;
  isFinal: boolean;
  session: SessionsRow;
  userId: string;
  stt?: Record<string, unknown>;
  /** 013 멱등 키 (t_3486b1d7, 재베이스 r2): audio.end/transcript 재전송 시 선영속 insert가
   *  사전 조회·유니크 사다리를 타게 한다. 미공급이면 기존 동작(멱등 없음) 그대로. */
  clientReqId?: string | null;
}

async function handleTr({ locale, text, isFinal, session, userId, stt, clientReqId }: TrInput) {
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
      language: (stt?.language as string) || locale,
    });
    return;
  }

  // 전사 확정 발화 선(先)방송 (t_2133e4fc, 대표님 #324): runTextTurn 실행 **이전**에
  // user 행을 영속하고 transcript.final+message.new(user)를 확정 turn_index/message_id로
  // 보낸다 — 런이 37~300s 걸리거나 실행 실패(run.failed)해도 발화는 화면에 남는다(텔레그램처럼).
  // 이벤트 순서: message.new(user) < run.started (선방송 run_id를 runTextTurn에 넘겨
  // 이후 run.*/message.new(empathy|answer)와 같은 run_id로 직렬 연결).
  // runTextTurn(persistedUser)은 같은 user message_id를 재사용 — 중복 영속·중복 message.new 없음.
  // 선영속 실패(저장 오류)는 행이 없다 → 구 흐름으로 폴백, runTextTurn이 자체 영속 후
  // run.started→run.failed로 마감한다(WS 저장 실패 계약 유지).
  const runId = randomUUID();
  let userRow: MessagesRow | null = null;
  let earlyDeduped = false;
  try {
    const early = await persistUserUtteranceEarly(supabaseAdmin, session, userId, text, {
      locale,
      sttMetadata: stt ?? null,
      clientReqId: clientReqId ?? null,
    });
    userRow = early.row;
    earlyDeduped = early.deduped;
  } catch (err: any) {
    if (err?.code === 'FORBIDDEN' || err?.code === 'SESSION_ARCHIVED') throw err;
    // CONFLICT(재전송 레이스가 사전 조회를 뚫음)/저장 오류는 행 없음으로 보고 구 흐름 폴백 —
    // runTextTurn의 client_req_id 사전 조회가 기존 행을 찾아 deduped로 마감한다(중복 영속 0).
    userRow = null;
  }
  // 재전송이 선영속 사전 조회에 걸린 경우(earlyDeduped): 선방송하지 않고 persistedUser도
  // 넘기지 않는다 — runTextTurn의 013 사전 조회가 같은 행을 찾아 deduped 메시지 1건(턴 미실행)으로
  // 마감한다. 선영속 경로가 "멱등인데 답변 재실행" 구멍이 되는 것 차단 (t_3486b1d7 재베이스 r2).
  if (userRow && !earlyDeduped) {
    broadcastToSession(sessionId, {
      type: 'transcript.final',
      session_id: sessionId,
      turn_index: userRow.turn_index,
      text,
      confidence: (stt?.confidence as number) || 0.95,
      language: (stt?.language as string) || locale,
      duration_ms: (stt?.duration_ms as number) || 0,
      message_id: userRow.id,
    });
    broadcastToSession(sessionId, {
      type: 'message.new',
      session_id: sessionId,
      run_id: runId,
      message: serializeMessage(userRow),
    });
  }

  const result = await runTextTurn(supabaseAdmin, session, userId, text, {
    locale,
    sttMetadata: stt,
    // 폴백(선영속 실패)/재전송 경로에서도 013 멱등 사전 조회·stamp가 텍스트 경로와 동일하게 돈다.
    clientReqId: clientReqId ?? null,
    ...(userRow && !earlyDeduped ? { turnId: runId, persistedUser: userRow } : {}),
    emit: e => broadcastToSession(sessionId, e),
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

/** 탈퇴한 세션의 기존 소켓도 종료한다. */
export function closeSessionConnections(sessionId: string): void {
  for (const socket of sessionHub.get(sessionId) || []) socket.terminate?.();
  sessionHub.delete(sessionId);
}
