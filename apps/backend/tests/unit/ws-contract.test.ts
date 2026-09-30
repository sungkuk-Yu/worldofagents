/** 실제 네트워크 없이 WS 티켓·재생·취소 계약을 검증한다. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { consumeTicket, issueTicket } from '../../src/routes/wsTicket';
import { websocketHandler, broadcastToSession } from '../../src/websocket/handler';
import { currentSeq, replaySince } from '../../src/websocket/eventlog';
import { signup, createFullStack, bearer } from '../helpers';
import { supabaseAdmin as db } from '../../src/lib/supabase';

let token: string;
let userId: string;
let session: any;
const sockets: any[] = [];

beforeAll(async () => {
  await build();
  ({ token, userId } = await signup(app));
  ({ session } = await createFullStack(app, token));
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.handlers.close?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(async () => { await app.close(); });

async function connect(query: Record<string, string> = {}, headerToken?: string) {
  const socket = {
    events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
    terminate: vi.fn(),
  };
  sockets.push(socket);
  const request: any = { query, server: app, jwtVerify: async () => {
    if (!headerToken) throw new Error('헤더 없음');
    request.user = app.jwt.verify(headerToken);
  } };
  await websocketHandler({ socket }, request);
  return { socket, send: (message: unknown) => socket.handlers.message(JSON.stringify(message), false) };
}

it('티켓은 32자리 hex이며 한 번만 소비되고 30초에 만료된다', () => {
  vi.useFakeTimers();
  const issued = issueTicket(userId);
  expect(issued).toMatchObject({ ticket: expect.stringMatching(/^[a-f0-9]{32}$/), expiresIn: 30 });
  expect(consumeTicket(issued.ticket)).toBe(userId);
  expect(consumeTicket(issued.ticket)).toBeNull();
  const expired = issueTicket(userId);
  vi.advanceTimersByTime(30_000);
  expect(consumeTicket(expired.ticket)).toBeNull();
  expect(consumeTicket('없음')).toBeNull();
});

it('티켓 REST 발급은 인증이 필요하고 운영 쿼리 JWT는 거부한다', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/ws-ticket' })).statusCode).toBe(401);
  const issued = await app.inject({ method: 'POST', url: '/api/ws-ticket', headers: bearer(token) });
  expect(issued.json()).toMatchObject({ ok: true, data: { expires_in: 30 } });
  vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
  const rejected = await connect({ token });
  expect(rejected.socket.events).toEqual([{ type: 'error', code: 'AUTH_REQUIRED', message: expect.any(String) }]);
  expect(rejected.socket.terminate).toHaveBeenCalledOnce();
  const ticket = issued.json().data.ticket;
  const accepted = await connect({ ticket });
  await accepted.send({ type: 'subscribe', session_id: session.id });
  expect(accepted.socket.events.at(-1)).toMatchObject({ type: 'subscribed', current_seq: expect.any(Number) });
  expect((await connect({ ticket })).socket.terminate).toHaveBeenCalledOnce();
});

it('개발 모드의 일반 쿼리 JWT는 익명으로만 연결된다', async () => {
  const client = await connect({ token });
  await client.send({ type: 'subscribe', session_id: session.id });
  expect(client.socket.events.at(-1)).toMatchObject({ code: 'AUTH_REQUIRED' });
});

it('재구독은 current_seq 이후 안내된 버퍼 이벤트를 원래 seq 순서대로 재생한다', async () => {
  const first = await connect({}, token);
  await first.send({ type: 'message.send', session_id: session.id, content: '왜 그런가요?' });
  const recorded = first.socket.events.filter(e => e.seq !== undefined);
  expect(recorded.some(e => e.type === 'run.completed')).toBe(true);
  expect(recorded.some(e => e.type === 'message.new' && e.run_id)).toBe(true);
  expect(recorded.map(e => e.seq)).toEqual(recorded.map((_, i) => recorded[0].seq + i));
  const second = await connect({}, token);
  await second.send({ type: 'subscribe', session_id: session.id, last_seq: 0 });
  expect(second.socket.events[1]).toMatchObject({ type: 'subscribed', current_seq: recorded.at(-1).seq });
  expect(second.socket.events.slice(2)).toEqual(replaySince(session.id, 0));
  second.socket.events.length = 0;
  await second.send({ type: 'subscribe', session_id: session.id, last_seq: recorded.at(-1).seq });
  expect(second.socket.events).toHaveLength(1);
});

it('연결이 없어도 최근 500개를 보관하며 다른 세션과 번호가 독립적이다', () => {
  for (let i = 0; i < 503; i++) broadcastToSession('버퍼', { type: 'run.started', session_id: '버퍼', run_id: String(i), quip: '접수' });
  expect(replaySince('버퍼', 0)).toHaveLength(500);
  expect(replaySince('버퍼', 0)[0].seq).toBe(4);
  broadcastToSession('버퍼', { type: 'ping', ts: 0 });
  expect(currentSeq('버퍼')).toBe(503);
  expect(currentSeq('다른 세션')).toBe(0);
});

it.each(['simple', 'langgraph'])('%s 스트림 취소는 부분 텍스트만 종료 이벤트로 보내고 답변을 저장하지 않는다', async engine => {
  vi.spyOn(config, 'neuronEngine', 'get').mockReturnValue(engine);
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
    signal = opts.signal;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"부분 답변"}}]}\n\n'));
        const abort = () => controller.error(new DOMException('취소', 'AbortError'));
        if (signal!.aborted) abort();
        else signal!.addEventListener('abort', abort, { once: true });
      },
    }));
  }));
  const { session: target } = await createFullStack(app, token);
  const client = await connect({}, token);
  const pending = client.send({ type: 'message.send', session_id: target.id, content: '왜 그런가요?' });
  await vi.waitFor(() => expect(client.socket.events.some(e => e.type === 'answer.delta')).toBe(true));
  const runId = client.socket.events.find(e => e.type === 'run.started').run_id;
  await client.send({ type: 'run.cancel', session_id: target.id, ...(engine === 'simple' ? { run_id: runId } : {}) });
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(client.socket.events.at(-1)).toMatchObject({ type: 'run.cancelled', run_id: runId, partial_text: '부분 답변', seq: expect.any(Number) });
  expect(client.socket.events.some(e => ['run.failed', 'run.completed', 'session.error', 'answer.done'].includes(e.type))).toBe(false);
  const messages = await app.inject({ method: 'GET', url: `/api/sessions/${target.id}/messages`, headers: bearer(token) });
  expect(messages.json().data.map((m: any) => m.role)).toEqual(['user']);
  await client.send({ type: 'run.cancel', session_id: target.id, run_id: runId });
  expect(client.socket.events.at(-1)).toMatchObject({ type: 'error', code: 'NOT_FOUND' });
});

it('없는 실행 취소와 타 사용자 세션 취소를 거부한다', async () => {
  const client = await connect({}, token);
  await client.send({ type: 'run.cancel', session_id: session.id, run_id: '없음' });
  expect(client.socket.events.at(-1)).toMatchObject({ type: 'error', code: 'NOT_FOUND', message: '취소할 실행이 없습니다.' });
  const other = await connect({}, app.jwt.sign({ sub: 'other-user' }));
  await other.send({ type: 'run.cancel', session_id: session.id });
  expect(other.socket.events.at(-1)).toMatchObject({ code: 'FORBIDDEN' });
});

// t_b89df485 (김비서 지시): 즐겨찾기 변경의 세션 허브 브로드캐스트 — 2탭 실시간 동기화 계약
it('favorite PATCH는 세션 소켓에 favorite.updated를 전파하고 eventlog에 채번되지 않는다', async () => {
  const { data: msg } = await db.from('messages').insert({
    session_id: session.id, turn_index: 99, role: 'agent', message_type: 'text',
    content: '즐겨찾기 브로드캐스트 검증', dialogue_type: 'text', structured_payload: {},
    attachments: [], persona_guard: {}, locale: 'ko', ai_generated: true, favorite: false,
    created_at: '2026-09-26T01:00:00.000Z',
  }).select().single();
  const client = await connect({}, token);
  await client.send({ type: 'subscribe', session_id: session.id });
  const seqBefore = currentSeq(session.id);
  client.socket.events.length = 0;
  const res = await app.inject({ method: 'PATCH', url: `/api/messages/${(msg as any).id}/favorite`, headers: bearer(token), payload: { favorite: true } });
  expect(res.statusCode).toBe(200);
  expect(client.socket.events).toEqual([{ type: 'favorite.updated', session_id: session.id, message_id: (msg as any).id, favorite: true }]);
  // seq 미채번 — 재접속 재생 버퍼에 섞이지 않는다 (재조회는 GET /api/favorites 책임)
  expect(currentSeq(session.id)).toBe(seqBefore);
  expect(replaySince(session.id, 0).some(e => e.type === 'favorite.updated')).toBe(false);
});
