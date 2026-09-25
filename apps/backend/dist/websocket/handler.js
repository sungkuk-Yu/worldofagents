"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerConnection = registerConnection;
exports.unregisterConnection = unregisterConnection;
exports.broadcastToSession = broadcastToSession;
exports.websocketHandler = websocketHandler;
exports.__hubInfo = __hubInfo;
const config_1 = require("../config");
const supabase_1 = require("../lib/supabase");
const logger_1 = require("../utils/logger");
const stt_1 = require("../lib/stt");
const graph_1 = require("../neurons/graph");
const protocol_1 = require("./protocol");
const persona_1 = require("../lib/persona");
// ── 세션 허브: session_id → 연결 집합 ───────────────────
const sessionHub = new Map();
function registerConnection(sessionId, socket) {
    if (!sessionHub.has(sessionId))
        sessionHub.set(sessionId, new Set());
    sessionHub.get(sessionId).add(socket);
}
function unregisterConnection(sessionId, socket) {
    const set = sessionHub.get(sessionId);
    if (!set)
        return;
    set.delete(socket);
    if (set.size === 0)
        sessionHub.delete(sessionId);
}
function broadcastToSession(sessionId, message) {
    const set = sessionHub.get(sessionId);
    if (!set)
        return;
    for (const socket of set)
        (0, protocol_1.sendJson)(socket, message);
}
async function websocketHandler(connection, request) {
    const socket = connection.socket;
    const query = (request.query || {});
    const state = {
        sessionId: query.session_id || null,
        userId: '',
        channels: ['audio', 'transcript', 'neuron_status', 'task'],
        audio: null,
        lastActivity: Date.now(),
    };
    // ── 인증 ──
    try {
        await request.jwtVerify();
        state.userId = request.user?.sub || '';
    }
    catch {
        // DEV_MODE: 토큰 없이도 연결 허용 (테스트 편의)
        if (!config_1.config.devMode) {
            (0, protocol_1.sendJson)(socket, { type: 'error', code: 'AUTH_REQUIRED', message: '인증 토큰이 필요합니다.' });
            socket.terminate?.();
            return;
        }
        state.userId = query.token === 'dev-test' ? 'dev-test-user' : '';
    }
    logger_1.logger.info(`WebSocket connected: user=${state.userId || '(anon)'}, session=${state.sessionId}`);
    (0, protocol_1.sendJson)(socket, {
        type: 'connected',
        session_id: state.sessionId,
        timestamp: new Date().toISOString(),
    });
    if (state.sessionId)
        registerConnection(state.sessionId, socket);
    // 프로토콜 레벨 ping → pong (ws 표준)
    const pingInterval = setInterval(() => {
        try {
            socket.ping?.();
        }
        catch {
            /* noop */
        }
    }, config_1.config.ws.pingIntervalMs);
    const checkAlive = setInterval(() => {
        if (Date.now() - state.lastActivity > config_1.config.ws.pongTimeoutMs) {
            logger_1.logger.info(`WebSocket heartbeat timeout, closing: user=${state.userId}`);
            cleanup(true);
        }
    }, config_1.config.ws.pingIntervalMs);
    function cleanup(terminate = false) {
        clearInterval(pingInterval);
        clearInterval(checkAlive);
        if (state.sessionId)
            unregisterConnection(state.sessionId, socket);
        if (terminate)
            socket.terminate?.();
    }
    socket.on('message', async (raw) => {
        state.lastActivity = Date.now();
        // 바이너리 프레임 = 오디오 청크
        if (Buffer.isBuffer(raw) || ArrayBuffer.isView(raw)) {
            handleAudioChunk(socket, state, Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
            return;
        }
        let message;
        try {
            message = JSON.parse(String(raw));
        }
        catch {
            (0, protocol_1.sendJson)(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'Invalid message format' });
            return;
        }
        try {
            switch (message.type) {
                case 'subscribe':
                    state.sessionId = message.session_id || state.sessionId;
                    state.channels = message.channels || state.channels;
                    if (state.sessionId)
                        registerConnection(state.sessionId, socket);
                    (0, protocol_1.sendJson)(socket, { type: 'subscribed', session_id: state.sessionId, channels: state.channels });
                    break;
                case 'audio.start':
                    await handleAudioStart(socket, state, message);
                    break;
                case 'audio.end':
                    await handleAudioEnd(socket, state, message.session_id || state.sessionId);
                    break;
                case 'audio.cancel':
                    if (state.audio)
                        state.audio = null;
                    (0, protocol_1.sendJson)(socket, { type: 'audio.vad', session_id: state.sessionId || '', active: false });
                    break;
                case 'transcript':
                    await handleTr({ text: message.text, isFinal: message.is_final !== false, sessionId: message.session_id || state.sessionId });
                    break;
                case 'ping':
                    (0, protocol_1.sendJson)(socket, { type: 'pong', ts: message.ts || Date.now() });
                    break;
                case 'pong':
                    break;
                default:
                    (0, protocol_1.sendJson)(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'Unknown message type' });
            }
        }
        catch (err) {
            logger_1.logger.error({ err: err?.message }, 'WS message handler error');
            (0, protocol_1.sendJson)(socket, {
                type: 'session.error',
                code: err?.code || 'INTERNAL_ERROR',
                message: err?.message || '처리 중 오류가 발생했습니다.',
            });
        }
    });
    socket.on('close', () => {
        logger_1.logger.info(`WebSocket disconnected: user=${state.userId}`);
        cleanup(false);
    });
    socket.on('error', () => cleanup(true));
}
// ── 오디오 스트리밍 ────────────────────────────────────
function handleAudioChunk(socket, state, chunk) {
    if (!state.audio) {
        // 스트림 시작 전 도착 → 무시
        return;
    }
    if (!(0, stt_1.hasVoiceActivity)(chunk)) {
        // 무음 청크 — 버퍼에는 넣되 VAD 신호 전달
        state.audio.buffer.push(chunk);
        return;
    }
    state.audio.buffer.push(chunk);
    if (state.audio.buffer.durationMs % 16000 < 100) {
        // 약 1초마다 수신 확인 신호
        (0, protocol_1.sendJson)(socket, { type: 'audio.received', bytes: chunk.length, timestamp: new Date().toISOString() });
    }
    // 문장 경계 후보 시 부분 트랜스크립트 훅 (실제 STT 연동 시 partial 발생 지점)
    if (state.audio.buffer.hasSilenceBoundary(chunk) && config_1.config.openai.apiKey) {
        // 실서비스: 이 시점에 최근 3초 윈도우 부분 트랜스크립션 수행
        // Phase 1에서는 final에서만 트랜스크립션 (비용/지연 절감)
    }
}
async function handleAudioStart(socket, state, message) {
    const sessionId = message.session_id || state.sessionId;
    if (!sessionId) {
        (0, protocol_1.sendJson)(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'session_id가 필요합니다.' });
        return;
    }
    state.sessionId = sessionId;
    registerConnection(sessionId, socket);
    state.audio = {
        buffer: new stt_1.AudioStreamBuffer(),
        startedAt: Date.now(),
        language: message.config?.language || 'auto',
    };
    (0, protocol_1.sendJson)(socket, {
        type: 'audio.started',
        session_id: sessionId,
        config: {
            sample_rate: message.config?.sample_rate || config_1.config.openai.stt.sampleRate,
            encoding: message.config?.encoding || config_1.config.openai.stt.encoding,
            language: state.audio.language,
        },
    });
}
async function handleAudioEnd(socket, state, sessionId) {
    const target = sessionId || state.sessionId;
    if (!target) {
        (0, protocol_1.sendJson)(socket, { type: 'error', code: 'VALIDATION_ERROR', message: 'session_id가 필요합니다.' });
        return;
    }
    const audio = state.audio;
    if (!audio) {
        (0, protocol_1.sendJson)(socket, { type: 'error', code: 'VALIDATION_ERROR', message: '활성 오디오 스트림이 없습니다.' });
        return;
    }
    state.audio = null;
    if (!audio.buffer.hasSignal) {
        (0, protocol_1.sendJson)(socket, { type: 'transcript.final', session_id: target, turn_index: -1, text: '', confidence: 0, language: audio.language, duration_ms: audio.buffer.durationMs, message_id: null });
        return;
    }
    (0, protocol_1.sendJson)(socket, { type: 'audio.vad', session_id: target, active: false });
    const result = await (0, stt_1.transcribeAudio)(audio.buffer.bundle);
    if (!result.text) {
        (0, protocol_1.sendJson)(socket, { type: 'transcript.final', session_id: target, turn_index: -1, text: '', confidence: 0, language: audio.language, duration_ms: result.durationMs, message_id: null });
        return;
    }
    await handleTr({
        text: result.text,
        isFinal: true,
        sessionId: target,
        stt: { confidence: result.confidence, language: result.language, duration_ms: result.durationMs, service: result.service },
    });
}
async function handleTr({ text, isFinal, sessionId, stt }) {
    if (!sessionId)
        throw Object.assign(new Error('session_id가 필요합니다.'), { code: 'VALIDATION_ERROR' });
    if (!text.trim())
        return;
    const db = supabase_1.supabaseAdmin;
    // 세션 조회 — 사용자/소유권 검증은 REST와 동일하게 JWT 기반
    const { data: session } = await db.from('sessions').select('*').eq('id', sessionId).maybeSingle();
    if (!session)
        throw Object.assign(new Error('세션을 찾을 수 없습니다.'), { code: 'SESSION_NOT_FOUND' });
    if (session.status === 'archived')
        throw Object.assign(new Error('아카이브된 세션입니다.'), { code: 'SESSION_ARCHIVED' });
    // 부분 트랜스크립트는 브로드캐스트만 (sentence 경계 아닌 경우)
    if (!isFinal) {
        broadcastToSession(sessionId, {
            type: 'transcript.partial',
            session_id: sessionId,
            text,
            confidence: 0.8,
            language: stt?.language || 'ko',
        });
        return;
    }
    // 페르소나 로드
    const { data: persona } = await db.from('personas').select('*').eq('id', session.persona_id).maybeSingle();
    const personaConfig = persona ? (0, persona_1.rowToPersonaConfig)(persona) : null;
    // 뉴런 상태 이벤트를 WS로 실시간 브로드캐스트
    const emitEvent = (event) => {
        broadcastToSession(sessionId, {
            type: 'neuron.status',
            session_id: sessionId,
            neuron: { slug: event.neuron, name: protocol_1.NEURON_NAMES[event.neuron] || event.neuron },
            status: event.status,
            stage: event.stage,
            quip: event.quip,
        });
    };
    const result = await (0, graph_1.processTurn)(db, sessionId, session.user_id, session.agent_id, personaConfig, text, {
        emitEvent: emitEvent,
        sttMetadata: stt || undefined,
    });
    // 최종 트랜스크립트 + 응답 브로드캐스트
    broadcastToSession(sessionId, {
        type: 'transcript.final',
        session_id: sessionId,
        turn_index: 0,
        text,
        confidence: stt?.confidence || 0.95,
        language: stt?.language || 'ko',
        duration_ms: stt?.duration_ms || 0,
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
function __hubInfo() {
    let connections = 0;
    for (const set of sessionHub.values())
        connections += set.size;
    return { sessions: sessionHub.size, connections };
}
//# sourceMappingURL=handler.js.map