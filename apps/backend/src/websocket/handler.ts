import { FastifyRequest } from 'fastify';
import { config } from '../config';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../utils/logger';

type SocketStream = {
  socket: any;
  send: (data: string) => void;
  on: (event: string, handler: (data: any) => void) => void;
};

// WebSocket message types
type WSMessage =
  | { type: 'audio_chunk'; data: ArrayBuffer; session_id: string }
  | { type: 'transcript'; text: string; is_final: boolean; session_id: string }
  | { type: 'agent_response'; content: string; segment_type: string; session_id: string }
  | { type: 'neuron_event'; neuron_id: string; event: string; data: any; session_id: string }
  | { type: 'error'; message: string };

export async function websocketHandler(connection: any, request: FastifyRequest) {
  const socket = connection.socket;
  const sessionId = (request.query as any).session_id;
  const userId = (request.query as any).user_id;

  logger.info(`WebSocket connected: user=${userId}, session=${sessionId}`);

  // Send connection acknowledgment
  socket.send(JSON.stringify({
    type: 'connected',
    session_id: sessionId,
    timestamp: new Date().toISOString(),
  }));

  // Handle incoming messages
  socket.on('message', async (rawMessage: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const message = JSON.parse(rawMessage.toString()) as WSMessage;

      switch (message.type) {
        case 'audio_chunk':
          await handleAudioChunk(socket, message, sessionId, userId);
          break;

        case 'transcript':
          await handleTranscript(socket, message, sessionId);
          break;

        default:
          logger.warn(`Unknown message type: ${(message as any).type}`);
      }
    } catch (error) {
      logger.error('WebSocket message error:', error);
      socket.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format',
      }));
    }
  });

  socket.on('close', () => {
    logger.info(`WebSocket disconnected: user=${userId}, session=${sessionId}`);
  });
}

// Handle audio streaming for STT
async function handleAudioChunk(
  socket: WebSocket,
  message: WSMessage,
  sessionId: string,
  userId: string
) {
  if (message.type !== 'audio_chunk') return;

  // In production: send to Whisper v3 Turbo API
  // For now: acknowledge receipt
  socket.send(JSON.stringify({
    type: 'audio_received',
    timestamp: new Date().toISOString(),
  }));
}

// Handle transcript from STT
async function handleTranscript(
  socket: WebSocket,
  message: WSMessage,
  sessionId: string
) {
  if (message.type !== 'transcript') return;

  // Store in raw_transcripts table
  if (message.is_final) {
    await supabaseAdmin.from('raw_transcripts').insert({
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
export async function classifyDialogueType(text: string): Promise<string> {
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
