"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.websocketHandler = websocketHandler;
exports.classifyDialogueType = classifyDialogueType;
const supabase_1 = require("../lib/supabase");
const logger_1 = require("../utils/logger");
async function websocketHandler(connection, request) {
    const socket = connection.socket;
    const sessionId = request.query.session_id;
    const userId = request.query.user_id;
    logger_1.logger.info(`WebSocket connected: user=${userId}, session=${sessionId}`);
    // Send connection acknowledgment
    socket.send(JSON.stringify({
        type: 'connected',
        session_id: sessionId,
        timestamp: new Date().toISOString(),
    }));
    // Handle incoming messages
    socket.on('message', async (rawMessage) => {
        try {
            const message = JSON.parse(rawMessage.toString());
            switch (message.type) {
                case 'audio_chunk':
                    await handleAudioChunk(socket, message, sessionId, userId);
                    break;
                case 'transcript':
                    await handleTranscript(socket, message, sessionId);
                    break;
                default:
                    logger_1.logger.warn(`Unknown message type: ${message.type}`);
            }
        }
        catch (error) {
            logger_1.logger.error('WebSocket message error:', error);
            socket.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format',
            }));
        }
    });
    socket.on('close', () => {
        logger_1.logger.info(`WebSocket disconnected: user=${userId}, session=${sessionId}`);
    });
}
// Handle audio streaming for STT
async function handleAudioChunk(socket, message, sessionId, userId) {
    if (message.type !== 'audio_chunk')
        return;
    // In production: send to Whisper v3 Turbo API
    // For now: acknowledge receipt
    socket.send(JSON.stringify({
        type: 'audio_received',
        timestamp: new Date().toISOString(),
    }));
}
// Handle transcript from STT
async function handleTranscript(socket, message, sessionId) {
    if (message.type !== 'transcript')
        return;
    // Store in raw_transcripts table
    if (message.is_final) {
        await supabase_1.supabaseAdmin.from('raw_transcripts').insert({
            session_id: sessionId,
            text: message.text,
            is_final: true,
            created_at: new Date().toISOString(),
        });
    }
    // Broadcast to session subscribers
    socket.send(JSON.stringify({
        type: 'transcript',
        text: message.text,
        is_final: message.is_final,
        timestamp: new Date().toISOString(),
    }));
}
// Classify dialogue type and route to appropriate neuron
async function classifyDialogueType(text) {
    // Simple keyword-based classification (MVP)
    // Stage 1: Pattern matching (0ms)
    const patterns = [
        { type: 'data', keywords: ['스프레드시트', '표', '데이터', '차트', '그래프', '계산'] },
        { type: 'file', keywords: ['파일', 'PDF', '이미지', '문서', '다운로드', '업로드'] },
        { type: 'task', keywords: ['작업', '실행', '예약', '알림', '설정', '삭제', '추가'] },
        { type: 'multi', keywords: ['여러', '함께', '협업', '다른 에이전트', '비교'] },
    ];
    for (const pattern of patterns) {
        if (pattern.keywords.some(kw => text.includes(kw))) {
            return pattern.type;
        }
    }
    // Default: information
    return 'information';
}
//# sourceMappingURL=handler.js.map