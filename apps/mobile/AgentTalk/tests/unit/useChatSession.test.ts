import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type * as ReactTypes from 'react';
import { useChatSession, UseChatSessionReturn } from '../../src/hooks/useChatSession';
import { ApiEnvelope, SendMessageResult, VoiceSocketHandlers } from '../../src/lib/api';

// React의 훅 경계만 모의하고 실제 useChatSession의 비동기/WS/상태 전이를 실행한다.
// 추가 렌더러 의존성 없이 node:test에서 effect 정리와 재렌더를 명시적으로 구동한다.
const react = require('react') as typeof ReactTypes;
const apiModule = require('../../src/lib/api') as typeof import('../../src/lib/api');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness(t: TestContext, sid: string | null = 'session') {
  const slots: { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  let result: UseChatSessionReturn;
  const sockets: VoiceSocketHandlers[] = [];
  const closed: boolean[] = [];
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  t.mock.method(react, 'useState', ((initial: unknown) => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
    return [slots[i].value, (update: unknown) => {
      slots[i].value = typeof update === 'function' ? update(slots[i].value) : update;
    }];
  }) as typeof react.useState);
  t.mock.method(react, 'useRef', ((initial: unknown) => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: { current: initial } };
    return slots[i].value;
  }) as typeof react.useRef);
  t.mock.method(react, 'useCallback', ((callback: unknown, deps: readonly unknown[]) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: callback, deps };
    return slots[i].value;
  }) as typeof react.useCallback);
  t.mock.method(react, 'useEffect', ((effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) {
      const old = slots[i]?.cleanup;
      slots[i] = { deps };
      effects.push(() => { old?.(); slots[i].cleanup = effect() || undefined; });
    }
  }) as typeof react.useEffect);
  t.mock.method(apiModule.api, 'getMessages', async () => ({ ok: true, data: [] }));
  t.mock.method(apiModule, 'connectVoiceSocket', (_sid: string | null, handlers: VoiceSocketHandlers) => {
    const i = sockets.length;
    sockets.push(handlers); closed.push(false);
    return { ready: true, send: () => true, close: () => { closed[i] = true; } };
  });
  const render = () => {
    index = 0;
    result = useChatSession(sid);
    const queued = effects; effects = [];
    queued.forEach((effect) => effect());
    return result;
  };
  t.after(() => slots.forEach((slot) => slot.cleanup?.()));
  return { render, sockets, closed, changeSession: (next: string) => { sid = next; } };
}
function confirm(id: string): ApiEnvelope<SendMessageResult> {
  return { ok: true, data: {
    user_message_id: id, empathy_message_id: null, answer_message_id: null,
    empathy_response: null, answer_response: null, dialogue_type: 'casual',
  } };
}

test('send 실패 원문/메시지 보존 → retryLastSend 성공 시 sent', async (t) => {
  const h = harness(t); h.render(); await flush();
  const calls: string[] = [];
  t.mock.method(apiModule.api, 'sendMessage', async (_sid: string, content: string) => {
    calls.push(content);
    if (calls.length === 1) throw new Error('전송 실패 모의');
    return confirm('server-user');
  });
  assert.deepEqual(await h.render().send('  다시 보내기  '), { ok: false, error: '전송 실패 모의' });
  let state = h.render();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].status, 'failed');
  assert.equal(state.lastError, '전송 실패 모의');
  assert.equal(state.typing, false);
  assert.equal(state.mode, 'live');
  assert.deepEqual(await state.retryLastSend(), { ok: true });
  state = h.render();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].status, 'sent');
  assert.equal(state.lastError, null);
  assert.deepEqual(calls, ['다시 보내기', '다시 보내기']);
});

test('동시 REST 전송과 종료 WS 누락 — 마지막 REST 확정까지 typing 유지', async (t) => {
  const h = harness(t); h.render(); await flush();
  const resolvers: ((value: ApiEnvelope<SendMessageResult>) => void)[] = [];
  const ids: (string | undefined)[] = [];
  t.mock.method(apiModule.api, 'sendMessage', (_sid: string, _content: string, id?: string) => {
    ids.push(id);
    return new Promise<ApiEnvelope<SendMessageResult>>((resolve) => resolvers.push(resolve));
  });
  const a = h.render().send('A'); const b = h.render().send('B');
  assert.notEqual(ids[0], ids[1]);
  h.sockets[0].onRaw?.({ type: 'neuron.status', session_id: 'session', status: 'processing', quip: '찾고 있어요' });
  assert.equal(h.render().quip, '찾고 있어요');
  resolvers[0](confirm('a')); await a;
  assert.equal(h.render().typing, true);
  resolvers[1](confirm('b')); await b;
  assert.equal(h.render().typing, false);
});

test('초기화 실패는 offline/lastError, demo는 enterDemo만 허용', async (t) => {
  const h = harness(t, null); h.render(); await flush();
  let state = h.render();
  assert.equal(state.mode, 'live');
  assert.equal(state.connection, 'offline');
  assert.ok(state.lastError);
  assert.equal((await state.send('입력 보존')).ok, false);
  assert.equal(h.render().messages[0].status, 'failed');
  state.enterDemo(); h.render();
  state = h.render();
  assert.equal(state.mode, 'demo');
  assert.equal(state.lastError, null);
});

test('WS 재연결 성공 시 최신 페이지 복구 및 중복 제거, 종료 후 재연결 취소', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.5);
  const h = harness(t);
  let reads = 0;
  t.mock.method(apiModule.api, 'getMessages', async () => ({ ok: true, data: [
    { id: 'a', turn_index: 0, role: 'user', content: 'a' },
    ...(reads++ ? [{ id: 'b', turn_index: 1, role: 'agent', content: 'b' }] : []),
  ] }));
  h.render(); await flush();
  h.sockets[0].onStatusChange?.('connected');
  assert.equal(h.render().connection, 'live');
  h.sockets[0].onStatusChange?.('disconnected');
  assert.equal(h.render().connection, 'reconnecting');
  t.mock.timers.tick(999); assert.equal(h.sockets.length, 1);
  t.mock.timers.tick(1); assert.equal(h.sockets.length, 2);
  h.sockets[1].onStatusChange?.('connected'); await flush();
  assert.equal(reads, 2);
  assert.deepEqual(h.render().messages.map((m) => m.id), ['a', 'b']);
  h.sockets[1].onRaw?.({ type: 'message.new', session_id: 'session', id: 'b', turn_index: 1, role: 'agent', content: 'b' });
  h.sockets[1].onRaw?.({ type: 'message.new', session_id: 'session', message: { id: 'c', turn_index: 2, role: 'agent', content: 'c' } });
  assert.deepEqual(h.render().messages.map((m) => m.id), ['a', 'b', 'c']);
  h.sockets[1].onRaw?.({ type: 'answer.delta', session_id: 'session', turn_id: 't', delta: '응답' });
  assert.equal(h.render().typing, true);
  h.sockets[1].onRaw?.({ type: 'answer.done', session_id: 'session', turn_id: 't' });
  assert.equal(h.render().typing, false);
  h.sockets[1].onStatusChange?.('disconnected');
  h.render().enterDemo(); h.render();
  t.mock.timers.tick(30000);
  assert.equal(h.sockets.length, 2);
  assert.ok(h.closed.every(Boolean));
});

test('세션 변경 뒤 늦은 REST 응답은 새 대화에 반영하지 않는다', async (t) => {
  const h = harness(t); h.render(); await flush();
  let resolve!: (value: ApiEnvelope<SendMessageResult>) => void;
  t.mock.method(apiModule.api, 'sendMessage', () => new Promise<ApiEnvelope<SendMessageResult>>((done) => { resolve = done; }));
  const sending = h.render().send('이전 대화');
  h.changeSession('other'); h.render(); await flush();
  resolve(confirm('old')); await sending;
  assert.deepEqual(h.render().messages, []);
  assert.equal(h.render().typing, false);
});
