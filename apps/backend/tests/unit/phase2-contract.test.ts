/** REST·WS 공유 계약과 세션 소유권 경계를 외부 네트워크 없이 검증한다. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { build, app } from '../../src/index';
import { config } from '../../src/config';
import { signup, createFullStack, bearer } from '../helpers';
import { websocketHandler, __hubInfo } from '../../src/websocket/handler';
import { parseRangeUpper } from '../../src/routes/sessions';
import { supabaseAdmin } from '../../src/lib/supabase';

let token: string;
let session: any;
const sockets: any[] = [];
beforeAll(async () => {
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(false);
  await build();
  ({ token } = await signup(app));
  ({ session } = await createFullStack(app, token));
});
afterAll(async () => {
  for (const socket of sockets) socket.handlers.close?.();
  vi.restoreAllMocks();
  await app.close();
});

async function connect(queryToken?: string, id?: string, headerToken?: string) {
  const socket = {
    events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
    terminate: vi.fn(),
  };
  sockets.push(socket);
  const request: any = { query: { token: queryToken, session_id: id }, server: app,
    jwtVerify: async () => { if (!headerToken) throw new Error('헤더 없음'); request.user = app.jwt.verify(headerToken); },
  };
  await websocketHandler({ socket }, request);
  return { socket, send: async (message: unknown) => socket.handlers.message(JSON.stringify(message), false) };
}

it('운영 모드 헤더 JWT 인증과 REST→WS 확정 메시지 계약이 일치한다', async () => {
  const dev = vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
  const { socket } = await connect(undefined, session.id, token);
  dev.mockRestore();
  const response = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: bearer(token), payload: { content: '왜 그런가요?' } });
  expect(response.statusCode).toBe(201);
  const result = response.json().data;
  expect(result.messages.answer.content).toBe(result.answer_response);
  expect(socket.events.filter(e => e.type === 'message.new').map(e => e.message.id)).toEqual([result.user_message_id, result.empathy_message_id, result.answer_message_id]);
  expect(result.structured).toMatchObject({ dialogue_type: 'info_card', classifier: 'rules' });
  const card = { dialogue_type: result.structured.dialogue_type, structured_payload: result.structured.structured_payload };
  expect(result.messages.answer).toMatchObject(card);
  expect(result.messages.user).toMatchObject({ dialogue_type: null, structured_payload: {} });
  expect(result.messages.empathy).toMatchObject({ dialogue_type: null, structured_payload: {} });
  expect(socket.events.find(e => e.type === 'message.new' && e.message.source_neuron === 'answer').message).toMatchObject(card);
  expect(socket.events.at(-1)).toMatchObject({ type: 'run.completed', run_id: result.run_id, structured: card });
  expect(socket.events.at(-1).structured).not.toHaveProperty('classifier');
  const history = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages`, headers: bearer(token) });
  expect(history.json().data.find((m: any) => m.id === result.answer_message_id)).toMatchObject({ ...card, router_dialogue_type: null });
  expect(history.json().data.find((m: any) => m.id === result.user_message_id)).toMatchObject({ dialogue_type: null, router_dialogue_type: 'question', structured_payload: {} });
});

it('다른 사용자의 초기 구독 및 모든 세션 명령을 거부한다', async () => {
  const other = app.jwt.sign({ sub: 'other-user' });
  const before = __hubInfo().connections;
  const { socket, send } = await connect(undefined, session.id, other);
  expect(socket.events.at(-1)).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
  for (const type of ['subscribe', 'audio.start', 'audio.end', 'transcript', 'message.send']) {
    await send({ type, session_id: session.id, text: '침입', content: '침입' });
    expect(socket.events.at(-1)).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
  }
  expect(__hubInfo().connections).toBe(before);
  expect(socket.terminate).not.toHaveBeenCalled();
});

it('익명 연결과 dev-test는 타 사용자 세션을 구독하지 못한다', async () => {
  const before = __hubInfo().connections;
  const anon = await connect(undefined, session.id);
  expect(anon.socket.events.map(e => e.type)).toEqual(['connected']);
  await anon.send({ type: 'subscribe', session_id: session.id });
  expect(anon.socket.events.at(-1)).toMatchObject({ code: 'AUTH_REQUIRED' });
  const dev = await connect('dev-test', session.id);
  expect(dev.socket.events.at(-1)).toMatchObject({ code: 'FORBIDDEN' });
  expect(__hubInfo().connections).toBe(before);
});

it('운영 모드의 잘못된 JWT와 개발 refresh를 거부한다', async () => {
  const dev = vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
  try {
    const { socket } = await connect('dev-test', session.id);
    expect(socket.events).toEqual([expect.objectContaining({ code: 'AUTH_REQUIRED' })]);
    expect(socket.terminate).toHaveBeenCalled();
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refresh_token: 'dev-refresh-user' } });
    expect(res.json().error.code).toBe('AUTH_INVALID');
  } finally { dev.mockRestore(); }
});

it('소유자의 WS 텍스트·음성 입력은 같은 상태 계약을 발행한다', async () => {
  const { socket, send } = await connect(undefined, undefined, token);
  await send({ type: 'message.send', session_id: session.id, content: '어떻게 하나요?' });
  expect(socket.events.at(-1)).toMatchObject({ type: 'run.completed' });
  socket.events.length = 0;
  await send({ type: 'transcript', session_id: session.id, text: '어떻게 하나요?', is_final: true });
  expect(socket.events.filter(e => e.type === 'message.new')).toHaveLength(3);
  expect(socket.events.find(e => e.type === 'run.completed')).toBeTruthy();
  expect(socket.events.find(e => e.type === 'transcript.final')?.message_id).toBeTruthy();
  await send({ type: 'message.send', session_id: session.id, content: '  ' });
  expect(socket.events.at(-1)).toMatchObject({ type: 'error', code: 'VALIDATION_ERROR' });
});

it('WS 저장 실패는 반드시 failed로 종료된다', async () => {
  const { socket, send } = await connect(undefined, session.id, token);
  const original = supabaseAdmin.from.bind(supabaseAdmin);
  const spy = vi.spyOn(supabaseAdmin, 'from').mockImplementation(table => {
    const q = original(table);
    if (table === 'messages') q.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { message: '저장 실패' } }) }) });
    return q;
  });
  try {
    await send({ type: 'message.send', session_id: session.id, content: '질문?' });
    expect(socket.events.filter(e => e.type.startsWith('run.')).map(e => e.type)).toEqual(['run.started', 'run.progress', 'run.failed']);
  } finally { spy.mockRestore(); }
});

it('페이지네이션 0 경계와 dialogue_type, 압축 상한 제외 범위를 보존한다', async () => {
  const first = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages?after=0`, headers: bearer(token) });
  expect(first.json().data.every((m: any) => m.turn_index > 0)).toBe(true);
  expect(first.json().data.every((m: any) => m.role === 'user' ? typeof m.router_dialogue_type === 'string' && m.dialogue_type === null : m.router_dialogue_type === null)).toBe(true);
  expect(first.json().data.every((m: any) => m.structured_payload && typeof m.structured_payload === 'object')).toBe(true);
  const before = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages?before=0`, headers: bearer(token) });
  expect(before.json().data).toEqual([]);
  const compact = () => app.inject({ method: 'POST', url: `/api/sessions/${session.id}/memories/compact`, headers: bearer(token) });
  const mem = (await compact()).json().data.memory;
  expect(mem.source_turn_range).toMatch(/^\[0,\d+\)$/);
  const upper = parseRangeUpper(mem.source_turn_range)!;
  expect((await compact()).json().data.compacted).toBe(false);
  await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: bearer(token), payload: { content: '다음 질문?' } });
  const next = (await compact()).json().data;
  expect(next.batch_size).toBe(3);
  expect(next.memory.source_turn_range).toBe(`[${upper},${upper + 3})`);
  expect(parseRangeUpper({ upper: 5 })).toBe(5);
  expect(parseRangeUpper('잘못된 범위')).toBeNull();
});
