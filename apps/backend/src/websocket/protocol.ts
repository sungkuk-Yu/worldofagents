import type { Locale } from '../lib/locale';
import type { DialogueCardType, DialogueType, MessagesRow } from '../types/db';
import type { GroundingSummary } from '../lib/perplexity';
import type { PttMode } from '../lib/pushToTalk';

export type SavedMessage = MessagesRow;

/**
 * WebSocket 프로토콜 정의 — api-design.md §4
 * 서버→클라이언트 이벤트 빌더 및 타입.
 */

export type WSChannel = 'audio' | 'transcript' | 'neuron_status' | 'task';

/** 세션에 동시 접속한 디바이스 항목 (presence.update) — t_d75ca81c 크로스 디바이스 연속성. */
export interface PresenceDevice {
  device: string;
  since: number;
}

// 클라이언트 → 서버
export type ClientMessage =
  | { type: 'message.send'; session_id: string; content: string; parent_message_id?: string }
  | { type: 'subscribe'; locale?: Locale; session_id: string; channels?: WSChannel[]; last_seq?: number; device?: string }
  | { type: 'run.cancel'; session_id: string; run_id?: string }
  | { type: 'audio.start'; session_id: string; config?: { sample_rate?: number; encoding?: string; language?: string; mode?: PttMode; device?: string } }
  | { type: 'audio.end'; session_id: string }
  | { type: 'audio.cancel'; session_id: string }
  | { type: 'transcript'; text: string; session_id: string; is_final?: boolean }
  | { type: 'ping'; ts?: number }
  | { type: 'pong'; ts?: number };

// 서버 → 클라이언트 (error/session.error/run.failed의 message는 폴백, code로 프론트 i18n 번역)
export type ServerMessage =
  | { type: 'message.new'; seq?: number; run_id: string; session_id: string; message: SavedMessage }
  | { type: 'run.started'; session_id: string; run_id: string; seq?: number; quip: string }
  | { type: 'run.progress'; session_id: string; run_id: string; seq?: number; stage: 'thinking' | 'organizing' | 'finalizing' | 'rendering'; quip: string }
  | { type: 'run.completed'; structured?: { dialogue_type: DialogueCardType; structured_payload: Record<string, unknown> }; classifier?: { type: DialogueType; stage: 1 | 2 | 3; confidence: number }; session_id: string; run_id: string; seq?: number; message_ids: { user: string; empathy: string | null; answer: string | null }; llm: { used: boolean; model: string | null; fallback: boolean }; grounding?: GroundingSummary | null }
  | { type: 'run.failed'; session_id: string; run_id: string; seq?: number; error: { code: string; message: string } }
  | { type: 'run.cancelled'; session_id: string; run_id: string; seq?: number; partial_text: string }
  | { type: 'answer.delta'; seq?: number; session_id: string; run_id: string; delta: string; index: number }
  | { type: 'answer.done'; ai_generated: true; locale: Locale; seq?: number; session_id: string; run_id: string; text: string; message_id: string | null; llm: { used: boolean; model: string | null; fallback: boolean; usage: unknown | null }; grounding?: GroundingSummary | null }
  | { type: 'connected'; session_id: string | null; timestamp: string }
  | { type: 'subscribed'; current_seq?: number; session_id: string; channels: WSChannel[]; devices?: PresenceDevice[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'audio.started'; session_id: string; config: Record<string, unknown> }
  | { type: 'audio.received'; bytes: number; timestamp: string }
  | { type: 'audio.vad'; session_id: string; active: boolean }
  | { type: 'presence.update'; session_id: string; devices: PresenceDevice[] }
  | { type: 'transcript.partial'; seq?: number; session_id: string; text: string; confidence: number; language: string }
  | { type: 'transcript.final'; seq?: number; session_id: string; turn_index: number; text: string; confidence: number; language: string; duration_ms: number; message_id: string | null }
  | { type: 'neuron.status'; seq?: number; session_id: string; neuron: { slug: string; name: string }; status: string; stage: string; quip: string }
  | { type: 'task.status'; session_id: string; task_id: string; status: string; progress: number; message: string }
  /** 즐겨찾기 토글 → 세션 허브 알림 (t_b89df485 김비서 지시). seq 미채번·eventlog 미기록 — 재접속 동기화는 GET /api/favorites. */
  | { type: 'favorite.updated'; session_id: string; message_id: string; favorite: boolean }
  | { type: 'queue.update'; seq?: number; session_id: string; pending_count: number; current_task: string | null; next_tasks: string[] }
  | { type: 'session.archived'; session_id: string }
  | { type: 'session.error'; code: string; message: string }
  | { type: 'pong'; ts: number }
  | { type: 'ping'; ts: number };

export const NEURON_NAMES: Record<string, string> = {
  empathy: '공감 에이뉴런',
  answer: '답변생성 에이뉴런',
  queue: '큐 에이뉴런',
  visual: '비주얼 에이뉴런',
  router: '라우터',
  grounding: '검색그라운딩',
};

export function sendJson(socket: { send: (data: string) => void }, message: ServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // 소켓 닫힘 무시
  }
}