/**
 * t_83946f45 — WS 첫 발화 유실 회귀 테스트.
 *
 * 실DB 전용 결함의 재현 구조: websocketHandler의 handshake은
 *   ① request.jwtVerify() await  ② 소유권 DB 왕복 await
 * 를 거친다. 인메모리 devstore는 이 왕복이 사실상 0ms라 유실이 invisible했고,
 * 실DB(수백 ms)에서는 그 사이에 도착한 subscribe/message.send가 리스너 미등록으로
 * 폐기됐다(ws stream 래퍼가 프레임을 선점 흡수 후 리스너 없음=폐기 —
 * scratch/ws-frame-drop-probe.cjs 실측: 지연 등록=폐기, 즉시 등록=전달).
 *
 * 이 테스트는 jwtVerify에 인위 지연을 주어 실DB 왕복을 흉내내고,
 * handshake pending 창에 프레임을 흘려 "유실 없음 + FIFO 처리"를 검증한다.
 */
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { websocketHandler, broadcastToSession } from '../../src/websocket/handler';
import { signup, createFullStack, bearer } from '../helpers';

let token: string;
let session: any;
const sockets: any[] = [];

beforeAll(async () => {
  await build();
  const s = await signup(app);
  token = s.token;
  ({ session } = await createFullStack(app, token));
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.handlers.close?.();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(async () => { await app.close(); });

function makeSocket() {
  const socket = {
    events: [] as any[],
    handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
    terminate: vi.fn(),
  };
  sockets.push(socket);
  return socket;
}

/** handshake(인증) 대기 창을 ms 단위로 늘린 connect — 실DB 왕복 흉내.
 *  반환 Promise는 handshake 완료(= 보류 큐 드레인 개시) 시점에 resolve된다. */
function connectWithLatency(socket: any, latencyMs: number, query: Record<string, string> = {}) {
  const request: any = {
    query, server: app,
    jwtVerify: async () => {
      await new Promise((r) => setTimeout(r, latencyMs));
      request.user = app.jwt.verify(token);
    },
  };
  const handler = websocketHandler({ socket }, request);
  return {
    /** handshake 미완료 상태에서 프레임을 흘린다 (구구조에서 폐기되던 바로 그 창). */
    fireDuringHandshake: (message: unknown) => {
      if (!socket.handlers.message) throw new Error('message 리스너가 handshake 전에 등록되지 않았다 — 유실 창 부활 (t_83946f45 회귀)');
      socket.handlers.message(JSON.stringify(message), false);
    },
    done: handler,
  };
}

function seen(socket: any, type: string) {
  return socket.events.find((e: any) => e.type === type);
}
async function waitForEvent(socket: any, type: string, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    const hit = seen(socket, type);
    if (hit) return hit;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting ${type} — got: ${socket.events.map((e: any) => e.type).join(',')}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

it('handshake 대기 창에 도착한 subscribe+message.send가 유실되지 않고 순서대로 처리된다', async () => {
  const socket = makeSocket();
  const c = connectWithLatency(socket, 120, { session_id: session.id });
  // connected 회신 이전(onopen 직후 프론트 발화 흉내): subscribe와 첫 발화를 동시에 흘린다.
  c.fireDuringHandshake({ type: 'subscribe', session_id: session.id, locale: 'ko' });
  c.fireDuringHandshake({ type: 'message.send', session_id: session.id, content: '첫 발화 유실 점검' });
  await c.done;

  // ① subscribed 회신 + ② 첫 발화 실행 — 유실됐으면 영영 안 온다.
  await waitForEvent(socket, 'subscribed');
  await waitForEvent(socket, 'run.started');
  const completed = await waitForEvent(socket, 'run.completed');
  expect(completed.session_id).toBe(session.id);

  // ③ user 메시지가 실제로 저장된 것을 REST read-back으로 확인.
  const rows = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages?limit=10`, headers: bearer(token) });
  expect(rows.json().data.some((m: any) => m.content === '첫 발화 유실 점검')).toBe(true);

  // ④ 순서 보존: 드레인 FIFO — subscribe가 message.send보다 먼저 처리되어 subscribed 정확히 1회,
  //    그리고 그 subscribed는 자기 run.started보다 앞서야 한다(implicit와 이중 ack 경쟁 없음).
  const types = socket.events.map((e: any) => e.type);
  expect(types.filter((t: string) => t === 'subscribed').length).toBe(1);
  expect(types.indexOf('subscribed')).toBeLessThan(types.indexOf('run.started'));
});

it('subscribe ack 없이 message.send만 먼저 도착해도 성공하고 subscribed 회신이 온다', async () => {
  const socket = makeSocket();
  const c = connectWithLatency(socket, 30);
  c.fireDuringHandshake({ type: 'message.send', session_id: session.id, content: 'ack 없는 첫 발화' });
  await c.done;

  await waitForEvent(socket, 'subscribed');
  expect(socket.events.filter((e: any) => e.type === 'subscribed').length).toBe(1); // implicit 1회만 (이중 ack 없음)
  await waitForEvent(socket, 'run.started');
  await waitForEvent(socket, 'run.completed');

  // content 저장 확인 — "발화 도달 + 실행 완결".
  const rows = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages?limit=50`, headers: bearer(token) });
  expect(rows.json().data.some((m: any) => m.content === 'ack 없는 첫 발화')).toBe(true);
});

it('handshake 완료 이후 프레임은 큐를 거치지 않고 즉시 처리된다 (이중 처리 없음)', async () => {
  const socket = makeSocket();
  const c = connectWithLatency(socket, 10);
  await c.done;
  // handshake 후 fire → handleMessage 직접 경로. ping 하나 → pong 하나만 (중복 회신 없음).
  socket.handlers.message(JSON.stringify({ type: 'ping', ts: 111 }), false);
  const pong = await waitForEvent(socket, 'pong');
  expect(pong.ts).toBe(111);
  expect(socket.events.filter((e: any) => e.type === 'pong').length).toBe(1);
});

it('보류 큐는 handshake 창 종료(close) 후 드레인되지 않는다', async () => {
  const socket = makeSocket();
  const request: any = {
    query: { session_id: session.id }, server: app,
    jwtVerify: async () => { await new Promise((r) => setTimeout(r, 20)); request.user = app.jwt.verify(token); },
  };
  const handler = websocketHandler({ socket }, request);
  socket.handlers.message(JSON.stringify({ type: 'message.send', session_id: session.id, content: '종료 전 도착 발화' }), false);
  socket.handlers.close?.(); // handshake 창에 클라이언트 종료 → 드레인 금지
  await handler;
  expect(seen(socket, 'run.started')).toBeUndefined();
  const rows = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages?limit=50`, headers: bearer(token) });
  expect(rows.json().data.some((m: any) => m.content === '종료 전 도착 발화')).toBe(false);
});

it('다른 세션 브로드캐스트는 첫 발화 라우팅에 영향을 주지 않는다 (허브 격리 보존)', async () => {
  const other = await createFullStack(app, token);
  const socket = makeSocket();
  const c = connectWithLatency(socket, 40, { session_id: session.id });
  c.fireDuringHandshake({ type: 'subscribe', session_id: session.id, locale: 'ko' });
  await c.done;
  await waitForEvent(socket, 'subscribed');
  // 세션 A 소켓이 열린 상태에서 세션 B로 이벤트 브로드캐스트 → A 소켓에 흐르지 않아야 한다.
  broadcastToSession(other.session.id, { type: 'queue.update', session_id: other.session.id, pending_count: 0, current_task: null, next_tasks: [] } as any);
  await new Promise((r) => setTimeout(r, 50));
  expect(socket.events.some((e: any) => e.session_id === other.session.id)).toBe(false);
});
