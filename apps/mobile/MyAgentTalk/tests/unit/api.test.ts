import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { VoiceSocketHandlers } from '../../src/lib/api';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function setup(t: TestContext) {
  const storage = { get: async () => 'stored-token', set: async () => {}, delete: async () => {} };
  const storagePath = require.resolve('../../src/lib/secureStorage');
  const apiPath = require.resolve('../../src/lib/api');
  const previous = require.cache[storagePath];
  require.cache[storagePath] = { exports: { secureStorage: storage } } as NodeModule;
  delete require.cache[apiPath];
  const client = require('../../src/lib/api') as typeof import('../../src/lib/api');
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    sent: string[] = [];
    closed = false;
    constructor(readonly url: string) { sockets.push(this); }
    send(data: string) { this.sent.push(data); }
    close() { this.closed = true; }
  }
  t.mock.method(globalThis, 'WebSocket', (function (url: string) { return new FakeSocket(url); }) as unknown as typeof WebSocket);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('모의하지 않은 네트워크 요청'); });
  t.after(() => {
    if (previous) require.cache[storagePath] = previous; else delete require.cache[storagePath];
    delete require.cache[apiPath];
  });
  return { client, storage, sockets };
}

test('티켓 인증 — 재연결마다 새 티켓, URL에는 JWT 없음', async (t) => {
  const { client, sockets } = setup(t);
  const requests: { url: string; headers: Headers }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ ok: true, data: { ticket: `일회용-${requests.length}`, expires_in: 30 } }));
  });
  const first = client.connectChatSocket('s', {}); await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.get('Authorization'), 'Bearer stored-token');
  assert.equal(requests[0].headers.get('Accept-Language'), 'ko'); // i18n→setApiLocale 푸시 (t_46a5431d)
  assert.ok(requests[0].url.endsWith('/api/ws-ticket'));
  assert.equal(new URL(sockets[0].url).searchParams.get('ticket'), '일회용-1');
  assert.equal(new URL(sockets[0].url).searchParams.has('token'), false);
  assert.equal(sockets[0].url.includes('저장된'), false);
  first.close();
  const second = client.connectChatSocket('s', {}); await flush();
  assert.equal(requests.length, 2);
  assert.equal(new URL(sockets[1].url).searchParams.get('ticket'), '일회용-2');
  second.close();
});

test('티켓 401 실패는 오류 콜백, 소켓을 생성하지 않는다', async (t) => {
  const { client, sockets } = setup(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  const errors: string[] = [];
  const handlers: VoiceSocketHandlers = { onError: (error) => errors.push(error.code) };
  const socket = client.connectChatSocket('s', handlers); await flush();
  assert.deepEqual(errors, ['WS_AUTH_FAILED']);
  assert.equal(sockets.length, 0); socket.close();
});

test('토큰 없는 개발 연결 — 티켓 및 JWT 없이 연결', async (t) => {
  const { client, storage, sockets } = setup(t);
  t.mock.method(storage, 'get', async () => null);
  const socket = client.connectChatSocket('s', {}); await flush();
  assert.equal(sockets.length, 1);
  assert.equal(new URL(sockets[0].url).searchParams.has('ticket'), false);
  socket.close();
});

test('부트스트랩 — 토큰 로딩 전 REST 요청을 보류한다', async (t) => {
  const { client, storage } = setup(t);
  let resolve!: (token: string) => void;
  t.mock.method(storage, 'get', () => new Promise<string>((done) => { resolve = done; }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer loaded-token');
    return new Response(JSON.stringify({ ok: true, data: [] }));
  });
  const request = client.api.listAgents(); await flush();
  assert.equal(calls, 0);
  resolve('loaded-token'); await request;
  assert.equal(calls, 1);
});

test('티켓 발급 중 정리하면 뒤늦은 소켓 생성 없음', async (t) => {
  const { client, sockets } = setup(t);
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>((done) => { resolve = done; }));
  const socket = client.connectChatSocket('s', {}); await flush(); socket.close();
  resolve(new Response(JSON.stringify({ ok: true, data: { ticket: '늦은-티켓' } }))); await flush();
  assert.equal(sockets.length, 0);
});

test('WS 기본 주소의 기존 token 쿼리도 제거한다', (t) => {
  const { client } = setup(t);
  client.setApiConfig({ wsUrl: 'wss://example.test/ws?token=노출금지&ticket=이전티켓' });
  const url = new URL(client.buildWsUrl(null));
  assert.equal(url.origin + url.pathname, 'wss://example.test/ws');
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(url.searchParams.has('ticket'), false);
  assert.equal(url.searchParams.get('locale'), 'ko'); // i18n→setApiLocale 기본값 (t_46a5431d)
});

test('초기화 중 새 토큰 설정이 저장된 과거 토큰으로 덮이지 않는다', async (t) => {
  const { client, storage } = setup(t);
  let resolve!: (token: string) => void;
  t.mock.method(storage, 'get', () => new Promise<string>((done) => { resolve = done; }));
  const loading = client.initializeApi(); await flush();
  await client.setToken('new-token');
  resolve('old-token'); await loading;
  assert.equal(client.getApiConfig().token, 'new-token');
});

test('로그인 토큰 저장 실패는 호출자에게 전달한다', async (t) => {
  const { client, storage } = setup(t);
  t.mock.method(storage, 'set', async () => { throw new Error('저장 오류'); });
  await assert.rejects(client.setToken('token'), /저장 오류/);
});

test('스레드 전송과 포크는 인코딩된 경로 및 계약 body를 사용한다', async (t) => {
  const { client } = setup(t);
  const requests: { url: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ ok: true, data: { id: 'new' } }));
  });
  await client.api.getThread('root/id');
  await client.api.sendMessage('session/id', 'reply', 'exec', { parent_message_id: 'root/id' });
  await client.api.forkSession('session/id', { from_message_id: 'root/id', new_session_title: 'New' });
  assert.ok(requests[0].url.endsWith('/api/messages/root%2Fid/thread'));
  assert.equal((requests[1].body as { parent_message_id: string }).parent_message_id, 'root/id');
  assert.ok(requests[2].url.endsWith('/api/sessions/session%2Fid/fork'));
  assert.deepEqual(requests[2].body, { from_message_id: 'root/id', new_session_title: 'New' });
});
test('404와 405는 미지원 번역 키를 반환한다', async (t) => {
  const { client } = setup(t);
  for (const status of [404, 405]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status }));
    await assert.rejects(client.api.getThread('root'), /errors.unsupported/);
    await assert.rejects(client.api.forkSession('session', {}), /errors.unsupported/);
  }
});

test('가입은 동의 5종과 연령 확인을 서버 계약으로 전송한다', async (t) => {
  const { client, storage } = setup(t);
  let stored = 0;
  t.mock.method(storage, 'set', async () => { stored++; });
  const { signupConsents, toggleRequiredConsents, emptyConsents } = await import('../../src/lib/consents');
  const consent = signupConsents(toggleRequiredConsents(emptyConsents));
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { email: 'test@example.com', password: 'password', ...consent });
    return new Response(JSON.stringify({ ok: true, data: { token: 'new-token' } }));
  });
  await client.api.signup('test@example.com', 'password', consent);
  assert.equal(stored, 0);
});
test('가입 동의 오류 코드는 번역 키로 변환하고 로그인으로 재시도하지 않는다', async (t) => {
  const { client } = setup(t);
  for (const [code, key] of [['CONSENT_REQUIRED', 'errors.consentRequired'], ['AGE_CONFIRM_REQUIRED', 'errors.ageConfirmRequired'], ['OTHER', 'errors.request']]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: { code } }), { status: 400 }); });
    await assert.rejects(client.api.signup('test@example.com', 'password', { consents: [], age_confirmed: false }), { message: key });
    assert.equal(calls, 1);
  }
});
