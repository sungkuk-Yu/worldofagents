/**
 * t_3486b1d7 ③ per-conversation 단조 seq diff sync (텔레그램 pts/getDifferences 이식).
 * - 모든 record 대상 WS 이벤트에 세션별 단조 seq 채번 (기존 eventlog, 회귀 방지)
 * - GET /api/sessions/:id/events?after_seq=N → N 이후 버퍼 이벤트를 원래 seq 순서로
 * - seq_epoch: 프로세스당 하나 (재기동 = 새 에포크 → 클라이언트 전량 캐치업 신호)
 * - 롤백 게이트: EVENT_SYNC_DISABLED(config.protocol.seqDiffSync=false) → 404
 */
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { broadcastToSession, websocketHandler } from '../../src/websocket/handler';
import { currentSeq, currentEpoch } from '../../src/websocket/eventlog';
import { signup, createFullStack, bearer } from '../helpers';

let token: string;
let session: any;
const sockets: any[] = [];

beforeAll(async () => {
  await build();
  ({ token } = await signup(app));
  ({ session } = await createFullStack(app, token));
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.handlers.close?.();
  vi.restoreAllMocks();
});
afterAll(async () => { await app.close(); });

it('이벤트는 세션별 단조 seq로 채번되고 after_seq 이후만 원래 순서로 반환된다', async () => {
  const base = currentSeq(session.id);
  broadcastToSession(session.id, { type: 'queue.updated', session_id: session.id, pending_count: 1, items: [] } as any);
  broadcastToSession(session.id, { type: 'relay.updated', session_id: session.id, run_id: 'r1', stage: 'searching', quip: 'q' } as any);
  const res = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/events?after_seq=${base}`, headers: bearer(token) });
  expect(res.statusCode).toBe(200);
  const body = res.json().data;
  expect(body.truncated).toBe(false);
  expect(body.seq_epoch).toBe(currentEpoch());
  expect(body.current_seq).toBe(base + 2);
  expect(body.events.map((e: any) => e.seq)).toEqual([base + 1, base + 2]);
  expect(body.events.map((e: any) => e.type)).toEqual(['queue.updated', 'relay.updated']);
});

it('모든 버퍼 이벤트를 담도록 after_seq=0이면 처음부터, 미래 seq면 빈 배열', async () => {
  const fromZero = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/events?after_seq=0`, headers: bearer(token) })).json().data;
  expect(fromZero.events[0].seq).toBe(1);
  const future = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/events?after_seq=999999`, headers: bearer(token) })).json().data;
  expect(future.events).toEqual([]);
});

it('after_seq 누락/음수는 400, 타인 세션은 404 (소유권)', async () => {
  expect((await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/events`, headers: bearer(token) })).statusCode).toBe(400);
  expect((await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/events?after_seq=-1`, headers: bearer(token) })).statusCode).toBe(400);
  expect((await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/events?after_seq=0` })).statusCode).toBe(401);
});

it('subscribed 회신에 current_seq와 seq_epoch가 실린다 (재기동 감지 시드)', async () => {
  const socket = {
    events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
    terminate: vi.fn(),
  };
  sockets.push(socket);
  const request: any = { query: { session_id: session.id }, server: app, jwtVerify: async () => { request.user = app.jwt.verify(token); } };
  await websocketHandler({ socket }, request);
  await socket.handlers.message(JSON.stringify({ type: 'subscribe', session_id: session.id }), false);
  const sub = socket.events.find(e => e.type === 'subscribed');
  expect(sub.seq_epoch).toBe(currentEpoch());
  expect(typeof sub.current_seq).toBe('number');
});

it('롤백 게이트: EVENT_SYNC_DISABLED면 /events는 404, subscribed의 seq_epoch는 생략', async () => {
  vi.spyOn(config.protocol, 'seqDiffSync', 'get').mockReturnValue(false);
  const res = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/events?after_seq=0`, headers: bearer(token) });
  expect(res.statusCode).toBe(404);
  const socket = {
    events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
    terminate: vi.fn(),
  };
  sockets.push(socket);
  const request: any = { query: { session_id: session.id }, server: app, jwtVerify: async () => { request.user = app.jwt.verify(token); } };
  await websocketHandler({ socket }, request);
  await socket.handlers.message(JSON.stringify({ type: 'subscribe', session_id: session.id }), false);
  const sub = socket.events.find(e => e.type === 'subscribed');
  expect(sub.seq_epoch).toBeUndefined();
});
