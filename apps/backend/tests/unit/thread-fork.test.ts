/** 스레드·포크의 저장 계약과 소유권을 외부 호출 없이 검증한다. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { getStore, supabaseAdmin as db } from '../../src/lib/supabase';
import { ensureSession } from '../../src/lib/helpers';
import { websocketHandler } from '../../src/websocket/handler';
import { signup, createFullStack, bearer } from '../helpers';

let token: string;
let userId: string;
let session: any;
beforeAll(async () => {
  await build();
  ({ token, userId } = await signup(app));
});
beforeEach(async () => {
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('외부 네트워크 호출 금지'); }));
  ({ session } = await createFullStack(app, token));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await app.close(); });

async function post(url: string, payload: unknown, auth = token) {
  return app.inject({ method: 'POST', url, headers: bearer(auth), payload: payload as any });
}
async function get(url: string, auth = token) {
  return app.inject({ method: 'GET', url, headers: bearer(auth) });
}
async function turn(id = session.id, content = '왜 그런가요?') {
  const res = await post(`/api/sessions/${id}/messages`, { content });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}
async function fork(id: string, point: string) {
  const res = await post(`/api/sessions/${id}/fork`, { from_message_id: point, new_session_title: '새 분기' });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}
const rows = (table: string, id = session.id) => getStore().tables[table].filter(row => row.session_id === id);

it('루트·중첩 답글은 전체 뉴런 턴과 같은 응답이며 트리와 요약을 공유한다', async () => {
  const root = await turn();
  expect(root.messages.answer).toMatchObject({ parent_message_id: null, root_message_id: null });
  const res = await post(`/api/messages/${root.answer_message_id}/replies`, { content: '더 설명해줘?' });
  expect(res.statusCode).toBe(201);
  const reply = res.json().data;
  expect(reply.thread).toEqual({ root_message_id: root.answer_message_id, parent_message_id: root.answer_message_id, reply_count: 3 });
  expect(reply.messages.user.parent_message_id).toBe(root.answer_message_id);
  for (const row of Object.values(reply.messages) as any[]) {
    expect(row.root_message_id).toBe(root.answer_message_id);
    if (row.role === 'agent') expect(row.parent_message_id).toBe(reply.user_message_id);
  }
  expect(reply.structured).toHaveProperty('dialogue_type');
  const nested = await post(`/api/messages/${reply.answer_message_id}/replies`, { content: '다음 설명은?' });
  expect(nested.statusCode).toBe(201);
  expect(nested.json().data.thread.reply_count).toBe(6);
  expect(nested.json().data.messages.user.parent_message_id).toBe(reply.answer_message_id);
  const thread = (await get(`/api/messages/${reply.user_message_id}/thread`)).json().data;
  expect(thread.root).toEqual(root.messages.answer);
  expect(thread.replies.map((row: any) => row.turn_index)).toEqual([3, 4, 5, 6, 7, 8]);
  expect(thread.reply_count).toBe(6);
  for (const id of [root.answer_message_id, reply.answer_message_id]) {
    const detail = (await get(`/api/messages/${id}`)).json().data;
    expect(detail.thread_summary).toEqual({ reply_count: 6, last_reply_at: thread.replies.at(-1).created_at });
  }
});

it.each(['simple', 'langgraph'])('%s 답글 LLM에는 루트·기존 답글만 전달된다', async engine => {
  vi.spyOn(config, 'neuronEngine', 'get').mockReturnValue(engine);
  const root = await turn(session.id, '루트 내용은?');
  const rootRow = rows('messages').find(row => row.id === root.answer_message_id)!;
  rootRow.content = '유일한 루트 답변';
  await post(`/api/messages/${rootRow.id}/replies`, { content: '기존 스레드 질문?' });
  await turn(session.id, '무관한 세션 질문?');
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
  const fetchMock = vi.fn(async (_url, options) => {
    const contents = JSON.parse(options.body).messages.map((row: any) => row.content);
    expect(contents).toContain('유일한 루트 답변');
    expect(contents).toContain('기존 스레드 질문?');
    expect(contents).not.toContain('무관한 세션 질문?');
    return new Response('data: {"choices":[{"delta":{"content":"스레드 응답"}}]}\n\ndata: [DONE]\n');
  });
  vi.stubGlobal('fetch', fetchMock);
  const res = await post(`/api/messages/${rootRow.id}/replies`, { content: '새 스레드 질문?' });
  expect(res.statusCode).toBe(201);
  expect(res.json().data.llm.used).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('세 턴의 중간을 포크하면 메시지 트리·기억·컨텍스트가 복제되고 독립 진화한다', async () => {
  const root = await turn();
  const reply = (await post(`/api/messages/${root.answer_message_id}/replies`, { content: '중간 질문?' })).json().data;
  await turn();
  for (const table of ['compressed_memories', 'raw_transcripts']) {
    const key = table === 'compressed_memories' ? 'source_turn_range' : 'turn_range';
    for (const range of ['[0,3)', { lower: 0, upper: 5 }, '[0,6)', { lower: 0, upper: 6 }, '잘못된 범위']) {
      await db.from(table).insert({ session_id: session.id, [key]: range, summary: '기억', content: [{ content: '원본' }] });
    }
  }
  const original = structuredClone(rows('messages'));
  const originalPatches = structuredClone(rows('context_patches'));
  const result = await fork(session.id, reply.answer_message_id);
  expect(result.copied).toEqual({ messages: 6, memories: 2, transcripts: 2, context_patches: originalPatches.length });
  expect(result.session).toMatchObject({ user_id: userId, agent_id: session.agent_id, persona_id: session.persona_id,
    metadata: { title: '새 분기' }, forked_from: { session_id: session.id, message_id: reply.answer_message_id, turn_index: 5 } });
  expect(result.session.forked_from.forked_at).toEqual(expect.any(String));
  const copied = (await get(`/api/sessions/${result.session.id}/messages`)).json().data;
  expect(copied).toHaveLength(6);
  const ids = new Map(original.slice(0, 6).map((row, i) => [row.id, copied[i].id]));
  copied.forEach((row: any, i: number) => {
    expect(row.id).not.toBe(original[i].id);
    expect(row).toMatchObject({ ...original[i], id: ids.get(original[i].id), session_id: result.session.id,
      parent_message_id: ids.get(original[i].parent_message_id) ?? null, root_message_id: ids.get(original[i].root_message_id) ?? null });
  });
  for (const table of ['compressed_memories', 'raw_transcripts', 'context_patches']) {
    expect(rows(table, result.session.id).every(copy => !rows(table).some(row => row.id === copy.id))).toBe(true);
  }
  for (const table of ['neuron_instances', 'neuron_connections', 'tasks', 'task_logs']) expect(rows(table, result.session.id)).toHaveLength(0);
  expect((await get(`/api/sessions/${result.session.id}/context`)).json().data)
    .toEqual((await get(`/api/sessions/${session.id}/context`)).json().data);
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
  const fetchMock = vi.fn(async (_url, options) => {
    expect(JSON.parse(options.body).messages.map((row: any) => row.content)).toContain('중간 질문?');
    return new Response('data: {"choices":[{"delta":{"content":"독립 응답"}}]}\n\ndata: [DONE]\n');
  });
  vi.stubGlobal('fetch', fetchMock);
  await turn(result.session.id);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(rows('messages')).toEqual(original);
  expect(rows('context_patches')).toEqual(originalPatches);
  expect(rows('messages', result.session.id)).toHaveLength(9);
  const copyMemory = rows('compressed_memories', result.session.id)[0];
  copyMemory.content[0].content = '분기에서 수정';
  expect(rows('compressed_memories')[0].content[0].content).toBe('원본');
});

it('계보는 가까운 조상부터 반환하며 ensure는 포크가 앞에 있어도 원본을 선택한다', async () => {
  const root = await turn();
  const a = await fork(session.id, root.answer_message_id);
  const aMessages = rows('messages', a.session.id);
  const b = await fork(a.session.id, aMessages.at(-1)!.id);
  const lineage = (await get(`/api/sessions/${b.session.id}/lineage`)).json().data;
  expect(lineage.ancestors.map((row: any) => row.session_id)).toEqual([a.session.id, session.id]);
  expect((await get(`/api/sessions/${session.id}/lineage`)).json().data.forks.map((row: any) => row.id)).toEqual([a.session.id]);
  getStore().tables.sessions.reverse();
  expect((await ensureSession(db, userId, session.agent_id)).id).toBe(session.id);
  const original = getStore().tables.sessions.find(row => row.id === session.id)!;
  original.forked_from = { session_id: b.session.id };
  expect((await get(`/api/sessions/${b.session.id}/lineage`)).json().data.ancestors).toHaveLength(2);
});

it('타 사용자·다른 세션·잘못된 입력과 아카이브된 답글을 거부한다', async () => {
  const root = await turn();
  const other = app.jwt.sign({ sub: '다른 사용자' });
  for (const path of ['', '/thread']) {
    const res = await get(`/api/messages/${root.answer_message_id}${path}`, other);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  }
  expect((await post(`/api/messages/${root.answer_message_id}/replies`, { content: '침입' }, other)).statusCode).toBe(404);
  expect((await post(`/api/sessions/${session.id}/fork`, { from_message_id: root.answer_message_id }, other)).statusCode).toBe(404);
  expect((await get(`/api/sessions/${session.id}/lineage`, other)).statusCode).toBe(404);
  const otherSession = (await createFullStack(app, token)).session;
  expect((await post(`/api/sessions/${otherSession.id}/fork`, { from_message_id: root.answer_message_id })).statusCode).toBe(404);
  for (const content of ['', '  ', 42, null]) {
    expect((await post(`/api/messages/${root.answer_message_id}/replies`, { content })).statusCode).toBe(400);
  }
  expect((await post(`/api/sessions/${session.id}/fork`, {})).statusCode).toBe(400);
  await post(`/api/sessions/${session.id}/archive`, {});
  expect((await post(`/api/messages/${root.answer_message_id}/replies`, { content: '질문?' })).statusCode).toBe(409);
});

it('WS 답글 이벤트에 트리가 포함되며 다른 세션의 부모는 거부한다', async () => {
  const root = await turn();
  const socket = { events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; } };
  const request: any = { query: { session_id: session.id }, user: { sub: userId }, jwtVerify: async () => undefined };
  await websocketHandler({ socket }, request);
  try {
    await socket.handlers.message(JSON.stringify({ type: 'message.send', session_id: session.id, content: '스레드 질문?', parent_message_id: root.answer_message_id }), false);
    const saved = socket.events.filter(row => row.type === 'message.new').map(row => row.message);
    expect(saved).toHaveLength(3);
    expect(saved.every(row => row.root_message_id === root.answer_message_id)).toBe(true);
    expect(saved[1].parent_message_id).toBe(saved[0].id);
    expect(socket.events.at(-1)).toMatchObject({ type: 'run.completed', message_ids: { user: saved[0].id, empathy: saved[1].id, answer: saved[2].id } });
    const other = (await createFullStack(app, token)).session;
    await socket.handlers.message(JSON.stringify({ type: 'message.send', session_id: other.id, content: '잘못된 부모', parent_message_id: root.answer_message_id }), false);
    expect(socket.events.at(-1)).toMatchObject({ type: 'session.error', code: 'NOT_FOUND' });
    expect(rows('messages', other.id)).toHaveLength(0);
  } finally { socket.handlers.close(); }
});

it('포크 복사 실패는 새 세션과 복사 행만 정리한다', async () => {
  const root = await turn();
  const original = structuredClone(rows('messages'));
  const sessionsBefore = getStore().tables.sessions.length;
  const from = db.from.bind(db);
  vi.spyOn(db, 'from').mockImplementation(table => {
    const query = from(table);
    if (table === 'context_patches') query.insert = () => Promise.resolve({ error: { message: '복사 실패' } });
    return query;
  });
  const res = await post(`/api/sessions/${session.id}/fork`, { from_message_id: root.answer_message_id });
  expect(res.statusCode).toBe(500);
  expect(getStore().tables.sessions).toHaveLength(sessionsBefore);
  expect(rows('messages')).toEqual(original);
});

it('두 자리 턴 번호와 500행을 넘는 메시지도 누락 없이 복제한다', async () => {
  await db.from('messages').insert(Array.from({ length: 505 }, (_, turn_index) => ({
    session_id: session.id, turn_index, role: 'user', content: `이력 ${turn_index}`, parent_message_id: null, root_message_id: null,
  })));
  const result = await fork(session.id, rows('messages').at(-1)!.id);
  expect(result.copied.messages).toBe(505);
  const next = await turn(result.session.id);
  expect(next.messages.user.turn_index).toBe(505);
  const history = (await get(`/api/sessions/${result.session.id}/messages?limit=3`)).json().data;
  expect(history.map((row: any) => row.turn_index)).toEqual([505, 506, 507]);
});
