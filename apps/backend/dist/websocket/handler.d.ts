/**
 * WebSocket 핸들러 — api-design.md §4 프로토콜 구현.
 * - 구독 (subscribe/subscribed)
 * - 오디오 스트리밍 (audio.start → binary PCM → audio.end) → STT → 뉴런 그래프 → 브로드캐스트
 * - 실시간 트랜스크립트 (transcript.partial/final)
 * - 뉴런 상태 업데이트 (neuron.status), 작업/큐 상태 (task.status, queue.update)
 * - 핑/퐁 연결 유지
 */
import { FastifyRequest } from 'fastify';
import { ServerMessage } from './protocol';
export interface WSSocket {
    send: (data: string) => void;
    ping?: () => void;
    on: (event: string, handler: (...args: any[]) => void) => void;
    terminate?: () => void;
    readyState?: number;
}
/** 외부(REST /resume)에서 조회 — 이 세션에 실시간 접속 중인 디바이스 라벨 목록. */
export declare function sessionPresence(sessionId: string): string[];
export declare function registerConnection(sessionId: string, socket: WSSocket): void;
export declare function unregisterConnection(sessionId: string, socket: WSSocket): void;
export declare function broadcastToSession(sessionId: string, message: ServerMessage): void;
/** 테스트 훅 (t_5cba9ebb 드레인 순서 회귀) — 실 소켓 대신 plain object로 큐를 채운다. */
export declare const __ingressTestHooks: {
    queue: (socket: object, raw: string) => void;
    drain: (socket: object, deliver: (raw: Buffer | string, isBinary?: boolean) => Promise<unknown> | void) => Promise<void>;
};
export declare function websocketHandler(connection: any, request: FastifyRequest): Promise<void>;
/** 테스트용 — 허브 상태 검사 */
export declare function __hubInfo(): {
    sessions: number;
    connections: number;
};
/** 탈퇴한 세션의 기존 소켓도 종료한다. */
export declare function closeSessionConnections(sessionId: string): void;
//# sourceMappingURL=handler.d.ts.map