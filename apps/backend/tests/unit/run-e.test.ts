/** Run E: 동의/탈퇴 및 REST·WS 다국어 계약. 외부 네트워크 없이 검증한다. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { parseAcceptLanguage, resolveLocale, QUIPS } from '../../src/lib/locale';
import { REQUIRED_CONSENTS, validateSignupConsents } from '../../src/lib/consents';
import { classifyExpertise, DISCLAIMERS } from '../../src/lib/persona';
import { supabaseAdmin } from '../../src/lib/supabase';
import { websocketHandler } from '../../src/websocket/handler';
import { replaySince } from '../../src/websocket/eventlog';
import * as llm from '../../src/lib/llm';
import { bearer, createFullStack, signup } from '../helpers';

const consents = () => REQUIRED_CONSENTS.map(type => ({ type, version: '2026-09', consented: true }));
beforeAll(async () => { await build(); });
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await app.close(); });

describe('로케일 정규화', () => {
  it.each([
    ['ko-KR, en;q=0.9', 'ko'], ['EN-us;q=0.1,ko;q=1', 'en'], [' en-GB ', 'en'],
    ['ja,en;q=0.8', 'ko'], ['', 'ko'], [undefined, 'ko'], ['*', 'ko'], ['english', 'ko'],
    ['en_US', 'ko'], ['ko-kr-x-private', 'ko'],
  ])('%s 첫 태그를 정규화한다', (header, expected) => {
    expect(parseAcceptLanguage(header, 'ko')).toBe(expected);
  });
  it('설정 기본값 및 WS 우선순위를 적용한다', () => {
    vi.spyOn(config, 'defaultLocale', 'get').mockReturnValue('en');
    expect(parseAcceptLanguage(undefined)).toBe('en');
    expect(parseAcceptLanguage('ja')).toBe('en');
    expect(parseAcceptLanguage(['ko-KR', 'en'])).toBe('ko');
    expect(resolveLocale('ko', 'en')).toBe('ko');
    expect(resolveLocale(undefined, 'en-US')).toBe('en');
    expect(resolveLocale('fr', 'ko-KR')).toBe('ko');
  });
});

describe('동의 검증', () => {
  it('개발 생략만 자동 통과하며 운영 생략은 거부한다', () => {
    expect(validateSignupConsents({}, true)).toEqual(REQUIRED_CONSENTS.map(type => ({ type, version: 'dev-auto', consented: true })));
    expect(() => validateSignupConsents({}, false)).toThrow(expect.objectContaining({ code: 'CONSENT_REQUIRED', statusCode: 400 }));
    expect(() => validateSignupConsents({ age_confirmed: false }, true)).toThrow(expect.objectContaining({ code: 'AGE_CONFIRM_REQUIRED' }));
  });
  it.each([true, false])('명시 동의는 개발/운영(%s) 모두 strict하다', dev => {
    for (const invalid of [null, [], 'yes', [...consents(), consents()[0]], consents().map(c => ({ ...c, version: '' })), [{ type: 'unknown', version: '1', consented: true }]]) {
      expect(() => validateSignupConsents({ consents: invalid, age_confirmed: true }, dev)).toThrow(expect.objectContaining({ code: 'CONSENT_REQUIRED' }));
    }
    for (const type of REQUIRED_CONSENTS) {
      expect(() => validateSignupConsents({ consents: consents().filter(c => c.type !== type), age_confirmed: true }, dev)).toThrow();
      expect(() => validateSignupConsents({ consents: consents().map(c => ({ ...c, consented: c.type !== type })), age_confirmed: true }, dev)).toThrow();
    }
    expect(() => validateSignupConsents({ consents: consents() }, dev)).toThrow(expect.objectContaining({ code: 'AGE_CONFIRM_REQUIRED' }));
    expect(validateSignupConsents({ consents: consents(), age_confirmed: true }, dev)).toHaveLength(4);
  });
  it('운영 가입 거부 코드를 반환하고 정상 가입 시 IP 및 선택 동의 false를 기록한다', async () => {
    vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
    const base = { email: 'strict@test.io', password: 'password123' };
    const call = (payload: object) => app.inject({ method: 'POST', url: '/api/auth/signup', payload });
    const missing = await call(base);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('CONSENT_REQUIRED');
    const age = await call({ ...base, consents: consents() });
    expect(age.statusCode).toBe(400);
    expect(age.json().error.code).toBe('AGE_CONFIRM_REQUIRED');
    const success = await call({ ...base, age_confirmed: true, consents: [...consents(), { type: 'marketing', version: '1', consented: false }] });
    expect(success.statusCode).toBe(201);
    const rows = (await supabaseAdmin.from('consents').select('*').eq('user_id', success.json().data.user.id)).data;
    expect(rows).toHaveLength(5);
    expect(rows.every((r: any) => r.ip_or_device === '127.0.0.1')).toBe(true);
    expect(rows.find((r: any) => r.consent_type === 'marketing').consented).toBe(false);
  });
  it('동의 저장 실패 시 가입을 정리하고 토큰을 반환하지 않는다', async () => {
    const original = supabaseAdmin.from.bind(supabaseAdmin);
    vi.spyOn(supabaseAdmin, 'from').mockImplementation(table => table === 'consents' ? { insert: async () => ({ error: { message: '실패' } }) } : original(table));
    const response = await signup(app, 'rollback@test.io');
    expect(response.res.statusCode).toBe(500);
    expect(response.token).toBeUndefined();
    const login = await supabaseAdmin.auth.signInWithPassword({ email: 'rollback@test.io', password: 'password123' });
    expect(login.error).toBeTruthy();
  });
});

describe('전문가 디스클레이머', () => {
  it.each([
    ['법률 상담', 'legal'], ['변호사', 'legal'], ['LEGAL', 'legal'], ['세무 도우미', 'accounting'],
    ['회계', 'accounting'], ['tax assistant', 'accounting'], ['accountant', 'accounting'],
    ['의료', 'medical'], ['Medical assistant', 'medical'], ['일정 관리', 'general'],
  ])('%s를 %s로 판정한다', (text, type) => { expect(classifyExpertise(text)).toBe(type); });
  it('태그와 빈 입력도 처리한다', () => {
    expect(classifyExpertise(null, undefined)).toBe('general');
    expect(classifyExpertise(['medical'])).toBe('medical');
  });
});

async function connect(token: string, sessionId: string, locale?: string, header?: string) {
  const socket = {
    events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
    terminate: vi.fn(),
  };
  const request: any = { query: { session_id: sessionId, locale }, headers: { 'accept-language': header },
    jwtVerify: async () => { request.user = app.jwt.verify(token); } };
  await websocketHandler({ socket }, request);
  return { socket, send: (message: unknown) => socket.handlers.message(JSON.stringify(message), false) };
}

it('REST/WS/답글/히스토리에 로케일과 AI 표시를 보존하고 전문가 문구를 붙인다', async () => {
  const { token } = await signup(app, 'locale@test.io');
  const { agent, session, personaId } = await createFullStack(app, token);
  await supabaseAdmin.from('personas').update({ name: 'Legal Guide', style_guide: { system_prompt: 'Always answer in French.' } }).eq('id', personaId);
  const { socket, send } = await connect(token, session.id, 'en', 'ko');
  try {
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: { ...bearer(token), 'accept-language': 'en-US,ko;q=0.8' }, payload: { content: 'What is a contract?' } });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data).toMatchObject({ locale: 'en', ai_generated: true });
    expect(data.messages.user).toMatchObject({ locale: 'en', ai_generated: false });
    for (const role of ['empathy', 'answer']) expect(data.messages[role]).toMatchObject({ locale: 'en', ai_generated: true });
    expect(data.empathy_response).toMatch(/[a-z]/i);
    expect(data.answer_response.endsWith(DISCLAIMERS.legal.en)).toBe(true);
    expect(socket.events.find(e => e.type === 'answer.done')).toMatchObject({ locale: 'en', ai_generated: true, text: data.answer_response });
    expect(socket.events.filter(e => ['run.started', 'run.progress', 'neuron.status'].includes(e.type)).every(e => !/[가-힣]/.test(e.quip))).toBe(true);
    const history = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages`, headers: bearer(token) });
    expect(history.json().data.find((m: any) => m.id === data.answer_message_id)).toMatchObject({ locale: 'en', ai_generated: true });
    const reply = await app.inject({ method: 'POST', url: `/api/messages/${data.answer_message_id}/replies`, headers: { ...bearer(token), 'accept-language': 'en' }, payload: { content: 'Why?' } });
    expect(reply.json().data.messages.answer.locale).toBe('en');
    socket.events.length = 0;
    await send({ type: 'message.send', session_id: session.id, content: 'Why?' });
    expect(socket.events.find(e => e.type === 'answer.done').locale).toBe('en');
    socket.events.length = 0;
    await send({ type: 'subscribe', session_id: session.id, locale: 'ko' });
    await send({ type: 'transcript', session_id: session.id, text: '왜 그런가요?', is_final: true });
    expect(socket.events.find(e => e.type === 'answer.done')).toMatchObject({ locale: 'ko', ai_generated: true });
    expect(socket.events.find(e => e.type === 'run.started').quip).toBe(QUIPS.started.ko);

    // 실제 답변 노드가 페르소나 지시 뒤에 요청 언어를 붙이는지 검증한다.
    vi.spyOn(llm, 'isLlmConfigured').mockReturnValue(true);
    const complete = vi.spyOn(llm, 'chatCompletion').mockResolvedValue({ text: 'An agreement.', model: 'mock', usage: null, durationMs: 1, streamed: false });
    await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: { ...bearer(token), 'accept-language': 'en' }, payload: { content: 'Why?' } });
    const system = complete.mock.calls[0][0].messages[0].content;
    expect(system).toContain('Always answer in French.');
    expect(system.endsWith('Respond in English.')).toBe(true);

    // 복제는 프리셋 JSON만 복사하며 대화/동의 데이터는 추가하지 않는다.
    const before = (await supabaseAdmin.from('consents').select('*')).data.length;
    const clone = await app.inject({ method: 'POST', url: `/api/agents/${agent.id}/clone`, headers: bearer(token), payload: { name: 'Legal copy' } });
    expect(clone.statusCode).toBe(201);
    expect(clone.json().data.active_persona.style_guide.system_prompt).toBe('Always answer in French.');
    expect((await supabaseAdmin.from('sessions').select('*').eq('agent_id', clone.json().data.id)).data).toEqual([]);
    expect((await supabaseAdmin.from('consents').select('*')).data).toHaveLength(before);
  } finally { socket.handlers.close(); }
});

it('WS 연결 locale 생략 시 Accept-Language를 사용한다', async () => {
  const { token } = await signup(app, 'ws-header@test.io');
  const { session } = await createFullStack(app, token);
  const { socket, send } = await connect(token, session.id, undefined, 'en-GB');
  try {
    await send({ type: 'message.send', session_id: session.id, content: 'Why?' });
    expect(socket.events.find(e => e.type === 'answer.done').locale).toBe('en');
  } finally { socket.handlers.close(); }
});

it('DELETE /api/me는 인증을 요구하고 전사·동의·종속 데이터만 cascade 삭제한다', async () => {
  expect((await app.inject({ method: 'DELETE', url: '/api/me' })).statusCode).toBe(401);
  const owner = await signup(app, 'delete@test.io');
  const other = await signup(app, 'keep@test.io');
  const { agent, session } = await createFullStack(app, owner.token);
  const kept = await createFullStack(app, other.token);
  const db = supabaseAdmin;
  const task = (await db.from('tasks').insert({ session_id: session.id }).select().single()).data;
  await db.from('task_logs').insert({ task_id: task.id });
  const skill = (await db.from('skills').insert({ author_id: owner.userId }).select().single()).data;
  await db.from('skill_installations').insert({ user_id: owner.userId, agent_id: agent.id, skill_id: skill.id });
  for (const table of ['raw_transcripts', 'compressed_memories', 'neuron_connections']) await db.from(table).insert({ session_id: session.id });
  await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: bearer(owner.token), payload: { content: '왜?' } });
  expect(replaySince(session.id, 0).length).toBeGreaterThan(0);
  const response = await app.inject({ method: 'DELETE', url: '/api/me', headers: bearer(owner.token) });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true, data: { deleted: true } });
  for (const table of ['sessions', 'messages', 'raw_transcripts', 'compressed_memories', 'context_patches', 'tasks', 'neuron_instances', 'neuron_connections']) {
    expect((await db.from(table).select('*')).data.some((r: any) => r.session_id === session.id || r.id === session.id)).toBe(false);
  }
  for (const [table, field, value] of [['users', 'id', owner.userId], ['agents', 'id', agent.id], ['personas', 'agent_id', agent.id], ['consents', 'user_id', owner.userId], ['skills', 'id', skill.id], ['skill_installations', 'skill_id', skill.id], ['task_logs', 'task_id', task.id]]) {
    expect((await db.from(table).select('*').eq(field, value)).data).toEqual([]);
  }
  expect((await db.from('sessions').select('*').eq('id', kept.session.id)).data).toHaveLength(1);
  expect((await db.from('consents').select('*').eq('user_id', other.userId)).data).toHaveLength(4);
  expect((await db.auth.signInWithPassword({ email: 'delete@test.io', password: 'password123' })).error).toBeTruthy();
  expect(replaySince(session.id, 0)).toEqual([]);
});

it('관리자 삭제 실패는 INTERNAL_ERROR이며 데이터는 유지된다', async () => {
  const { token, userId } = await signup(app, 'delete-error@test.io');
  vi.spyOn(supabaseAdmin.auth.admin, 'deleteUser').mockResolvedValue({ data: null, error: { message: '실패' } });
  const response = await app.inject({ method: 'DELETE', url: '/api/me', headers: bearer(token) });
  expect(response.statusCode).toBe(500);
  expect(response.json().error.code).toBe('INTERNAL_ERROR');
  expect((await supabaseAdmin.from('users').select('*').eq('id', userId)).data).toHaveLength(1);
});
