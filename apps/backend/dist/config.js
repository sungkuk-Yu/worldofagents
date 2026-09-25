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
        origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:8081'],
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
        whisperModel: 'whisper-1', // Whisper v3 Turbo (OpenAI API에서는 whisper-1이 최신)
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'agenttalk-dev-secret-change-in-production',
        expiresIn: '7d',
    },
};
//# sourceMappingURL=config.js.map