/**
 * WebSocket 프로토콜 정의 — api-design.md §4
 * 서버→클라이언트 이벤트 빌더 및 타입.
 */
export type WSChannel = 'audio' | 'transcript' | 'neuron_status' | 'task';
export type ClientMessage = {
    type: 'subscribe';
    session_id: string;
    channels?: WSChannel[];
} | {
    type: 'audio.start';
    session_id: string;
    config?: {
        sample_rate?: number;
        encoding?: string;
        language?: string;
    };
} | {
    type: 'audio.end';
    session_id: string;
} | {
    type: 'audio.cancel';
    session_id: string;
} | {
    type: 'transcript';
    text: string;
    session_id: string;
    is_final?: boolean;
} | {
    type: 'ping';
    ts?: number;
} | {
    type: 'pong';
    ts?: number;
};
export type ServerMessage = {
    type: 'connected';
    session_id: string | null;
    timestamp: string;
} | {
    type: 'subscribed';
    session_id: string;
    channels: WSChannel[];
} | {
    type: 'error';
    code: string;
    message: string;
} | {
    type: 'audio.started';
    session_id: string;
    config: Record<string, unknown>;
} | {
    type: 'audio.received';
    bytes: number;
    timestamp: string;
} | {
    type: 'audio.vad';
    session_id: string;
    active: boolean;
} | {
    type: 'transcript.partial';
    session_id: string;
    text: string;
    confidence: number;
    language: string;
} | {
    type: 'transcript.final';
    session_id: string;
    turn_index: number;
    text: string;
    confidence: number;
    language: string;
    duration_ms: number;
    message_id: string | null;
} | {
    type: 'neuron.status';
    session_id: string;
    neuron: {
        slug: string;
        name: string;
    };
    status: string;
    stage: string;
    quip: string;
} | {
    type: 'task.status';
    session_id: string;
    task_id: string;
    status: string;
    progress: number;
    message: string;
} | {
    type: 'queue.update';
    session_id: string;
    pending_count: number;
    current_task: string | null;
    next_tasks: string[];
} | {
    type: 'session.archived';
    session_id: string;
} | {
    type: 'session.error';
    code: string;
    message: string;
} | {
    type: 'pong';
    ts: number;
} | {
    type: 'ping';
    ts: number;
};
export declare const NEURON_NAMES: Record<string, string>;
export declare function sendJson(socket: {
    send: (data: string) => void;
}, message: ServerMessage): void;
//# sourceMappingURL=protocol.d.ts.map