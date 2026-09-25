"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    devMode: process.env.DEV_MODE === 'true' || !process.env.SUPABASE_URL,
    cors: {
        origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:8081', 'http://localhost:5173'],
    },
    supabase: {
        url: process.env.SUPABASE_URL || 'http://localhost:54321',
        anonKey: process.env.SUPABASE_ANON_KEY || 'mock-anon-key',
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-key',
    },
    streamChat: {
        apiKey: process.env.STREAM_CHAT_API_KEY || '',
        apiSecret: process.env.STREAM_CHAT_API_SECRET || '',
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        whisperModel: process.env.WHISPER_MODEL || 'whisper-1', // Whisper v3 Turbo (OpenAI API에서는 whisper-1이 최신)
        // STT 오디오 기본 설정 (클라이언트는 16kHz PCM s16le 전송)
        stt: {
            sampleRate: 16000,
            encoding: 'pcm_s16le',
            vadThreshold: 0.01,
            silenceBoundaryMs: 700,
            partialIntervalMs: 500,
        },
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'agenttalk-dev-secret-change-in-production',
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },
    /**
     * 뉴런 오케스트레이션 엔진 선택:
     * - 'langgraph': LangGraph StateGraph 기반 (설치/런타임 정상 시)
     * - 'simple'   : 동일 노드 로직을 순차 파이프라인으로 실행 (폴백)
     */
    neuronEngine: process.env.NEURON_ENGINE || 'langgraph',
    ws: {
        pingIntervalMs: 30000,
        pongTimeoutMs: 60000,
        // 오디오 세션당 최대 청크 버퍼 (10초 ≈ 320KB @16kHz/16bit)
        maxAudioBufferMs: 10000,
    },
};
//# sourceMappingURL=config.js.map