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
function harness(t: TestContext, sid: string | null = 'session', options: import('../../src/hooks/useChatSession').UseChatSessionOptions = {}) {
  const slots: { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  let result: UseChatSessionReturn;
  const sockets: VoiceSocketHandlers[] = [];
  const closed: boolean[] = [];
  const sent: Record<string, unknown>[][] = [];
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
  // t_eded715c: useChatSession의 talk 브리프는 useMemo — 하네스는 useCallback과 동일 수법으로 모의
  t.mock.method(react, 'useMemo', ((factory: () => unknown, deps?: readonly unknown[]) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: factory(), deps };
    return slots[i].value;
  }) as typeof react.useMemo);
  t.mock.method(react, 'useEffect', ((effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) {
      const old = slots[i]?.cleanup;
      slots[i] = { deps };
      effects.push(() => { old?.(); slots[i].cleanup = effect() || undefined; });
    }
  }) as typeof react.useEffect);
  t.mock.method(apiModule.api, 'getMessages', async () => ({ ok: true, data: [] }));
  // t_17edbc88 ③ diff-sync: 기본 하네스는 구 서버(404)로 흉내 — 재접속은 'gap' 페이지 갱신 폴백.
  // 개별 테스트가 api.getSessionEvents를 재모의해 차등 리플레이/에포크 전환 경로를 검증한다.
  t.mock.method(apiModule.api, 'getSessionEvents', async () => { throw new Error('errors.unsupported'); });
  t.mock.method(apiModule, 'connectVoiceSocket', (_sid: string | null, handlers: VoiceSocketHandlers) => {
    const i = sockets.length;
    sockets.push(handlers); closed.push(false); sent.push([]);
    return { ready: true, send: (data: string | ArrayBuffer) => { sent[i].push(JSON.parse(String(data))); return true; }, close: () => { closed[i] = true; } };
  });
  const render = () => {
    index = 0;
    result = useChatSession(sid, options);
    const queued = effects; effects = [];
    queued.forEach((effect) => effect());
    return result;
  };
  t.after(() => slots.forEach((slot) => slot.cleanup?.()));
  return { render, sockets, closed, sent, changeSession: (next: string) => { sid = next; } };
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
  assert.deepEqual(await h.render().send('  다시 보내기  '), { ok: false, error: 'errors.request' });
  let state = h.render();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].status, 'failed');
  assert.equal(state.lastError, 'errors.request');
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
  assert.equal(h.render().quip, 'quip.default');
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

test('구독 last_seq와 중복 제거, 서버 재시작 시 0으로 재구독 및 전체 조회', async (t) => {
  const h = harness(t); let reads = 0;
  t.mock.method(apiModule.api, 'getMessages', async () => { reads++; return { ok: true, data: [] }; });
  h.render(); await flush();
  h.sockets[0].onStatusChange?.('connected');
  assert.deepEqual(h.sent[0][0], { type: 'subscribe', session_id: 'session', last_seq: 0, device: 'mobile-web' }); // t_eded715c presence: device 라벨 동봉
  const message = { id: 'a', role: 'agent', content: '복구', turn_index: 1 };
  h.sockets[0].onRaw?.({ type: 'message.new', session_id: 'session', seq: 10, message });
  h.sockets[0].onRaw?.({ type: 'message.new', session_id: 'session', seq: 10, message: { ...message, id: '중복' } });
  assert.equal(h.render().messages.length, 1);
  h.render().retryConnection();
  h.sockets[1].onStatusChange?.('connected');
  assert.equal(h.sent[1][0].last_seq, 10);
  h.sockets[1].onRaw?.({ type: 'subscribed', session_id: 'session', current_seq: 1 });
  await flush();
  assert.equal(h.sent[1][1].last_seq, 0);
  assert.ok(reads >= 3);
  h.sockets[1].onRaw?.({ type: 'message.new', session_id: 'session', seq: 1, message: { ...message, id: '재시작' } });
  assert.equal(h.render().messages.length, 2);
});

test('명시적 인증 오류는 자동 재연결을 멈추고 수동 재시도만 허용', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.render(); await flush();
  h.sockets[0].onError?.({ type: 'error', code: 'FORBIDDEN', message: '접근 권한이 없습니다' });
  t.mock.timers.tick(60000);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.render().connection, 'offline');
  assert.equal(h.render().mode, 'live');
  h.render().retryConnection();
  assert.equal(h.sockets.length, 2);
});

test('두 run 역순 완료 — WS 선행 및 REST run_id로 확정 병합', async (t) => {
  const h = harness(t); h.render(); await flush();
  const resolves: ((result: ApiEnvelope<SendMessageResult>) => void)[] = [];
  t.mock.method(apiModule.api, 'sendMessage', () => new Promise<ApiEnvelope<SendMessageResult>>((resolve) => resolves.push(resolve)));
  const a = h.render().send('첫째'); const b = h.render().send('둘째');
  h.sockets[0].onRaw?.({ type: 'run.started', run_id: 'a', seq: 1 });
  h.sockets[0].onRaw?.({ type: 'run.started', run_id: 'b', seq: 2 });
  assert.equal(h.render().activeCount, 2);
  resolves[1]({ ...confirm('ub'), data: { ...confirm('ub').data!, run_id: 'b' } }); await b;
  assert.equal(h.render().activeCount, 1);
  h.sockets[0].onRaw?.({ type: 'run.completed', run_id: 'b', seq: 3 });
  assert.equal(h.render().typing, true);
  resolves[0]({ ...confirm('ua'), data: { ...confirm('ua').data!, run_id: 'a' } }); await a;
  assert.equal(h.render().typing, false);
});

test('메시지별 실패 재전송과 삭제, 길이 초과는 네트워크 전 차단', async (t) => {
  const h = harness(t); h.render(); await flush(); let calls = 0;
  t.mock.method(apiModule.api, 'sendMessage', async () => { calls++; throw new Error('실패'); });
  assert.equal((await h.render().send('가'.repeat(4001))).ok, false);
  assert.equal(calls, 0);
  await h.render().send('보존할 초안');
  const failed = h.render().messages[0];
  await h.render().retryMessage(failed.id);
  assert.equal(h.render().messages[0].content, '보존할 초안');
  assert.equal(h.render().messages.length, 1);
  assert.equal(calls, 2);
  h.render().deleteMessage(failed.id);
  assert.equal(h.render().messages.length, 0);
});

test('진행 quip을 스트림에 유지하고 최종 행 도착 시 임시 답변 제거', async (t) => {
  const h = harness(t); h.render(); await flush();
  h.sockets[0].onRaw?.({ type: 'run.started', run_id: 'r', seq: 1 });
  h.sockets[0].onRaw?.({ type: 'run.progress', run_id: 'r', seq: 2, quip: '거의 다 정리했어요', stage: 'finalizing' });
  h.sockets[0].onRaw?.({ type: 'answer.delta', run_id: 'r', seq: 3, delta: '초안', index: 0 });
  assert.equal(h.render().streams[0].quip, 'quip.finalizing');
  assert.equal(h.render().quip, 'quip.finalizing');
  h.sockets[0].onRaw?.({ type: 'message.new', run_id: 'r', seq: 4, message: { id: 'a', role: 'agent', content: '최종', source_neuron: 'answer', turn_index: 0 } });
  h.sockets[0].onRaw?.({ type: 'answer.done', run_id: 'r', seq: 5, text: '최종 교체', message_id: 'a' });
  assert.equal(h.render().streams.length, 0);
  assert.equal(h.render().messages[0].content, '최종 교체');
  assert.equal(h.render().typing, true);
  h.sockets[0].onRaw?.({ type: 'run.completed', run_id: 'r', seq: 6 });
  assert.equal(h.render().typing, false);
});

test('seq 리셋은 모든 REST 페이지를 조회해 재시작 전후 이력을 복구한다', async (t) => {
  const h = harness(t); h.render(); await flush();
  const cursors: (number | undefined)[] = [];
  t.mock.method(apiModule.api, 'getMessages', async (_sid: string, opts?: { before?: number }) => {
    cursors.push(opts?.before);
    const turn = opts?.before === undefined ? 2 : opts.before - 1;
    return { ok: true, data: [{ id: `m${turn}`, role: 'agent', content: '복구된 이력', turn_index: turn }], meta: { has_more: turn > 0 } };
  });
  h.sockets[0].onRaw?.({ type: 'queue.update', seq: 50 });
  h.sockets[0].onRaw?.({ type: 'subscribed', session_id: 'session', current_seq: 0 });
  await flush();
  assert.deepEqual(cursors, [undefined, 2, 1]);
  assert.deepEqual(h.render().messages.map((m) => m.id), ['m0', 'm1', 'm2']);
});

test('재연결 복구는 저장된 메시지에 닿으면 불필요한 과거 페이지 조회를 멈춘다', async (t) => {
  const h = harness(t);
  const row = (turn: number) => ({ id: `m${turn}`, role: 'agent', content: '이력', turn_index: turn });
  t.mock.method(apiModule.api, 'getMessages', async () => ({ ok: true, data: [row(1)] }));
  h.render(); await flush(); h.sockets[0].onStatusChange?.('connected');
  const cursors: (number | undefined)[] = [];
  t.mock.method(apiModule.api, 'getMessages', async (_sid: string, opts?: { before?: number }) => {
    cursors.push(opts?.before);
    return { ok: true, data: [row(opts?.before === undefined ? 2 : 1)], meta: { has_more: true } };
  });
  h.render().retryConnection(); h.sockets[1].onStatusChange?.('connected'); await flush();
  assert.deepEqual(cursors, [undefined, 2]);
  assert.deepEqual(h.render().messages.map((m) => m.id), ['m1', 'm2']);
});


test('명시적 데모 전송은 번역 키 응답을 만들고 네트워크를 호출하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, null, { deferConnection: true });
  const network = t.mock.method(apiModule.api, 'sendMessage', async () => { throw new Error('네트워크 호출 금지'); });
  h.render().enterDemo(); h.render();
  const sending = h.render().send('hello');
  assert.equal(h.render().typing, true);
  t.mock.timers.tick(899);
  assert.equal(h.render().messages.length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(await sending, { ok: true });
  const state = h.render();
  assert.equal(state.messages[1].contentKey, 'chat.demoReply');
  assert.deepEqual(state.messages[1].contentParams, { content: 'hello' });
  assert.equal(state.typing, false);
  assert.equal(network.mock.callCount(), 0);
  assert.equal(h.sockets.length, 0);
  assert.equal((apiModule.api.getMessages as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);
});

test('스레드 조회와 전송은 부모 범위를 유지하고 타 스레드 이벤트를 제외한다', async (t) => {
  const h = harness(t, 'session', { rootMessageId: 'root' });
  const row = (id: string, parent?: string) => ({ id, role: 'agent', content: id, turn_index: 1, parent_message_id: parent });
  t.mock.method(apiModule.api, 'getThread', async () => ({ ok: true, data: { root: row('root'), replies: [row('old', 'root')] } }));
  const calls: unknown[] = [];
  t.mock.method(apiModule.api, 'sendMessage', async (_sid: string, _text: string, _exec?: string, options?: { parent_message_id?: string; client_req_id?: string }) => {
    calls.push(options);
    return { ...confirm('user'), data: { ...confirm('user').data!, answer_response: 'answer', answer_message_id: 'answer', run_id: 'own' } };
  });
  h.render(); await flush();
  assert.equal(h.render().rootMessage?.id, 'root');
  assert.deepEqual(h.render().messages.map((m) => m.id), ['old']);
  h.sockets[0].onRaw?.({ type: 'message.new', seq: 1, message: row('other', 'elsewhere') });
  h.sockets[0].onRaw?.({ type: 'run.started', seq: 2, run_id: 'elsewhere', parent_message_id: 'elsewhere' });
  assert.equal(h.render().typing, false);
  h.sockets[0].onRaw?.({ type: 'run.started', seq: 3, run_id: 'thread-run', parent_message_id: 'root' });
  h.sockets[0].onRaw?.({ type: 'run.progress', seq: 4, run_id: 'thread-run', stage: 'finalizing' });
  assert.equal(h.render().quip, 'quip.finalizing');
  h.sockets[0].onRaw?.({ type: 'message.new', seq: 5, message: row('new', 'root') });
  h.sockets[0].onRaw?.({ type: 'run.completed', seq: 6, run_id: 'thread-run' });
  assert.equal(h.render().typing, false);
  await h.render().send('reply');
  // t_17edbc88 ①: 발화 payload에 uuid v4 client_req_id 동봉 (서버 멱등 키) — 부모 범위와 공존.
  assert.equal(calls.length, 1);
  const sent = calls[0] as { parent_message_id?: string; client_req_id?: string };
  assert.equal(sent.parent_message_id, 'root');
  assert.match(sent.client_req_id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(h.render().messages.every((m) => m.parentMessageId === 'root'));
  assert.ok(!h.render().messages.some((m) => m.id === 'other'));
});

test('미지원 스레드는 오류만 표시하고 데모나 전송 가능한 루트를 만들지 않는다', async (t) => {
  const h = harness(t, 'session', { rootMessageId: 'root' });
  t.mock.method(apiModule.api, 'getThread', async () => { throw new Error('errors.unsupported'); });
  h.render(); await flush();
  const state = h.render();
  assert.equal(state.error, 'errors.unsupported');
  assert.equal(state.rootMessage, null);
  assert.equal(state.mode, 'live');
  assert.deepEqual(state.messages, []);
  assert.equal(h.sockets.length, 0);
});

test('메인 대화는 스레드 답변을 중복 표시하지 않는다', async (t) => {
  const h = harness(t);
  h.render(); await flush();
  h.sockets[0].onRaw?.({ type: 'message.new', seq: 1, message: { id: 'reply', role: 'agent', content: 'reply', turn_index: 1, parent_message_id: 'root' } });
  assert.deepEqual(h.render().messages, []);
});

test('메인 히스토리가 스레드 답변뿐인 페이지도 다음 커서를 유지한다', async (t) => {
  const h = harness(t);
  const cursors: (number | undefined)[] = [];
  t.mock.method(apiModule.api, 'getMessages', async (_sid: string, opts?: { before?: number }) => {
    cursors.push(opts?.before);
    return { ok: true, data: opts?.before === undefined
      ? [{ id: 'reply', role: 'agent', content: 'reply', turn_index: 5, parent_message_id: 'root' }]
      : [{ id: 'root', role: 'agent', content: 'root', turn_index: 1 }], meta: { has_more: opts?.before === undefined } };
  });
  h.render(); await flush();
  assert.deepEqual(h.render().messages, []);
  assert.equal(h.render().hasOlder, true);
  await h.render().loadOlder();
  assert.deepEqual(cursors, [undefined, 5]);
  assert.equal(h.render().messages[0].id, 'root');
  assert.equal(h.render().hasOlder, false);
});

// ── 비서실 릴레이 자막 (t_961ca593 Phase B) — 전용 onRelay 경로 + 커튼 + 런 종료/done 홀드 ──
test('relay.updated — onRelay 수신 시 최신 1줄 갱신, 역주행·중복 무시, 피드 메시지 무영향', async (t) => {
  const h = harness(t); h.render(); await flush();
  assert.equal(h.render().relay, null, '이벤트 0건(비서 외 페르소나 관측) = null');
  const before = h.render().messages.length;
  h.sockets[0].onRelay?.({ type: 'relay.updated', session_id: 'session', run_id: 'r1', stage: 'briefing', quip: '접수했어요' } as never);
  assert.deepEqual(h.render().relay, { runId: 'r1', stage: 'briefing', quip: '접수했어요' });
  h.sockets[0].onRelay?.({ type: 'relay.updated', session_id: 'session', run_id: 'r1', stage: 'research', quip: '자료 검색' } as never);
  assert.equal(h.render().relay?.stage, 'research');
  // 중복·역주행(재접속 eventlog 이중 도착 시뮬) — 같은 객체 유지(리렌더 소스 안정)
  const cur = h.render().relay;
  h.sockets[0].onRelay?.({ type: 'relay.updated', session_id: 'session', run_id: 'r1', stage: 'research', quip: '자료 검색' } as never);
  assert.equal(h.render().relay, cur);
  h.sockets[0].onRelay?.({ type: 'relay.updated', session_id: 'session', run_id: 'r1', stage: 'briefing', quip: '접수' } as never);
  assert.equal(h.render().relay, cur);
  // 휘발성 연출 계약: messages 병합 절대 금지
  assert.equal(h.render().messages.length, before);
  // 세션 다른 이벤트 혼재 무해 — onRaw relay.updated early-return (coordinator/streams 유입 없음)
  h.sockets[0].onRaw?.({ type: 'relay.updated', session_id: 'session', run_id: 'r1', stage: 'drafting', quip: 'x' });
  assert.equal(h.render().relay, cur, 'onRaw 경로는 커튼 갱신 없이 조용히 무시(전용 경로 단일 원천)');
  assert.equal(h.render().typing, false, 'relay가 타이핑 상태를 켜지 않는다');
});

test('run.completed — 일반 stage 즉시 정리, done은 홀드 후 제로잔류', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.render(); await flush();
  h.sockets[0].onRelay?.({ type: 'relay.updated', session_id: 'session', run_id: 'r1', stage: 'wrapping', quip: '정리 중' } as never);
  assert.equal(h.render().relay?.stage, 'wrapping');
  h.sockets[0].onRaw?.({ type: 'run.completed', session_id: 'session', run_id: 'r1' });
  assert.equal(h.render().relay, null, 'done 미도달 = 런 종료 즉시 정리');
  // done 홀드 경로
  h.sockets[0].onRelay?.({ type: 'relay.updated', session_id: 'session', run_id: 'r2', stage: 'done', quip: '끝' } as never);
  h.sockets[0].onRaw?.({ type: 'run.completed', session_id: 'session', run_id: 'r2' });
  assert.equal(h.render().relay?.stage, 'done', 'done 자막은 홀드 유지(0프레임 소실 방지)');
  t.mock.timers.runAll();
  h.render();
  assert.equal(h.render().relay, null, '홀드 만료 = 제로잔류');
  // 남의 run 종료는 현 자막 무해
  h.sockets[0].onRelay?.({ type: 'relay.updated', session_id: 'session', run_id: 'r3', stage: 'research', quip: 'x' } as never);
  h.sockets[0].onRaw?.({ type: 'run.completed', session_id: 'session', run_id: 'other' });
  assert.equal(h.render().relay?.runId, 'r3');
});

// ── t_cc232982: answer.delta 배칭 발행 + 이탈 정합성 ──

test('t_cc232982 #1: delta 배칭 — 선행 즉시 발행 후 창 내 토큰은 state 미변, 만료 시 누적본 1회 발행', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.render(); await flush();
  h.sockets[0].onRaw?.({ type: 'answer.delta', run_id: 'r', seq: 1, delta: '가', index: 0 });
  assert.equal(h.render().streams[0].text, '가', '선행 delta는 즉시 반영(성장 카드 즉시 시작)');
  h.sockets[0].onRaw?.({ type: 'answer.delta', run_id: 'r', seq: 2, delta: '나', index: 1 });
  h.sockets[0].onRaw?.({ type: 'answer.delta', run_id: 'r', seq: 3, delta: '다', index: 2 });
  assert.equal(h.render().streams[0].text, '가', '창 내 후속 delta는 렌더 상태 미변(토큰마다 재렌더 금지)');
  t.mock.timers.runAll();
  h.render();
  assert.equal(h.render().streams[0].text, '가나다', '만료 시 창 내 누적본 통합 발행');
  // answer.done은 배칭 창 무시(즉시): done 카드 확정 → 이후 delta는 수락되지 않는다
  h.sockets[0].onRaw?.({ type: 'answer.done', run_id: 'r', seq: 4, text: '가나다', message_id: 'a1' });
  const done = h.render().streams.find((s) => s.runId === 'r');
  assert.ok(done && done.done === true, 'done 즉시 반영(잔여 창 폐기)');
  h.sockets[0].onRaw?.({ type: 'answer.delta', run_id: 'r', seq: 5, delta: '라', index: 4 });
  assert.equal(h.render().streams.find((s) => s.runId === 'r')?.text, '가나다', 'done 후 지각 delta 무시(누적 정지)');
});

test('t_cc232982 요구4: 이탈 후 재조회 복구 — 확정 answer 행이 오면 구 스트림 카드 제거(고아 커서 잔존 금지)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t); h.render(); await flush();
  h.sockets[0].onStatusChange?.('connected'); // connectedOnce=true — 이후 재접속이 gap refresh를 타게
  h.sockets[0].onRaw?.({ type: 'answer.delta', run_id: 'r', seq: 1, delta: '중간', index: 0 });
  assert.equal(h.render().streams.length, 1);
  // 이탈 시뮬: done/message.new 없이 소켓 절단 → 백오프 재연결 → 연결 성공 시 gap refresh.
  t.mock.method(apiModule.api, 'getMessages', async () => ({
    ok: true,
    data: [{ id: 'a1', role: 'agent', content: '최종 전문', source_neuron: 'answer', run_id: 'r', turn_index: 0, created_at: new Date().toISOString() }],
  }));
  h.sockets[0].onStatusChange?.('disconnected');
  t.mock.timers.runAll(); // backoff → close + connect(sid) → sockets[1]
  assert.equal(h.sockets.length, 2);
  h.sockets[1].onStatusChange?.('connected');
  await flush();
  const st = h.render();
  assert.equal(st.streams.length, 0, '확정 행과 같은 run의 스트림 제거');
  assert.equal(st.messages.find((m) => m.id === 'a1')?.content, '최종 전문', '본문은 서버 진실로 수렴(전체 텍스트 유지)');
});

test('스레드 전송 실패와 재전송도 원문 및 부모 ID를 보존한다', async (t) => {
  const h = harness(t, 'session', { rootMessageId: 'root' });
  t.mock.method(apiModule.api, 'getThread', async () => ({ root: { id: 'root', content: 'root' }, replies: [] }));
  let calls = 0;
  t.mock.method(apiModule.api, 'sendMessage', async (_sid: string, _text: string, _exec?: string, options?: { parent_message_id?: string }) => {
    assert.equal(options?.parent_message_id, 'root');
    if (++calls === 1) throw new Error('errors.response');
    return confirm('reply');
  });
  h.render(); await flush();
  await h.render().send('  draft  ');
  const failed = h.render().messages[0];
  assert.equal(failed.draft, '  draft  ');
  assert.equal(failed.status, 'failed');
  assert.equal(h.render().typing, false);
  await h.render().retryMessage(failed.id);
  assert.equal(h.render().messages.length, 1);
  assert.equal(h.render().messages[0].status, 'sent');
  assert.equal(h.render().messages[0].parentMessageId, 'root');
});

// ── t_4af94b1c ① — 동일 텍스트 in-flight 가드 + 백엔드 deduped 응답 분기 ──

test('동시 동일 텍스트 전송 — 2차는 낙관 행도 POST도 만들지 않는다 (in-flight 가드)', async (t) => {
  const h = harness(t); h.render(); await flush();
  const resolvers: ((value: ApiEnvelope<SendMessageResult>) => void)[] = [];
  let posts = 0;
  t.mock.method(apiModule.api, 'sendMessage', (_sid: string, _content: string, id?: string) => {
    posts++;
    return new Promise<ApiEnvelope<SendMessageResult>>((resolve) => resolvers.push(resolve));
  });
  const a = h.render().send('중복 테스트');
  const b = h.render().send('중복 테스트'); // Enter+전송 동시 탭의 2차 호출
  assert.deepEqual(await b, { ok: true }, '2차는 의미상 성공(복원 경로 차단)');
  assert.equal(posts, 1, 'POST는 1회만');
  let state = h.render();
  assert.equal(state.messages.length, 1, '낙관 행은 1개만');
  resolvers[0](confirm('u1')); await a;
  state = h.render();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].status, 'sent');
  // 가드 해제 후 동일 텍스트 재전송은 정당한 재요청 — 통과해야 한다.
  resolvers.length = 0;
  const c = h.render().send('중복 테스트');
  assert.equal(posts, 2, '완료 후 재전송은 가드 대상 아님');
  resolvers[0](confirm('u2')); await c;
});

test('백엔드 ingress 드롭 { deduped:true } — 유령 낙관 행 제거, 오류 없음, 성공 처리', async (t) => {
  const h = harness(t); h.render(); await flush();
  t.mock.method(apiModule.api, 'sendMessage', async () => ({
    ok: true,
    data: { deduped: true, message: '동일 발화가 방금 접수되었습니다.' } as unknown as SendMessageResult,
  }));
  const r = await h.render().send('방금 보낸 것과 같음');
  assert.deepEqual(r, { ok: true });
  const state = h.render();
  assert.equal(state.messages.length, 0, 'deduped 응답은 낙관 행을 남기지 않는다(서버에 없는 유령 행 방지)');
  assert.equal(state.lastError, null, 'deduped는 오류가 아니다');
  assert.equal(state.typing, false, '해당 실행은 종료된다');
});

// ── t_17edbc88 ① client_req_id 낙관 merge + ③ seq epoch diff sync 재접속 리플레이 ──

test('멱등 dedupe 응답(user_message_id 포함) — 유령 제거 대신 낙관 카드 in-place 확정', async (t) => {
  const h = harness(t); h.render(); await flush();
  let capturedReqId = '';
  t.mock.method(apiModule.api, 'sendMessage', async (_sid: string, _text: string, _exec?: string, options?: { client_req_id?: string }) => {
    capturedReqId = options?.client_req_id ?? '';
    return { ok: true, data: {
      deduped: true, user_message_id: 'srv-echo', turn_index: 0,
      messages: { user: { id: 'srv-echo', session_id: 'session', turn_index: 0, role: 'user', message_type: 'text', content: '재전송 문장', client_req_id: capturedReqId } },
      empathy_response: null, answer_response: null, dialogue_type: 'casual',
      answer_message_id: null, empathy_message_id: null,
    } as unknown as SendMessageResult } as ApiEnvelope<SendMessageResult>;
  });
  const r = await h.render().send('재전송 문장');
  assert.deepEqual(r, { ok: true });
  const state = h.render();
  assert.equal(state.messages.length, 1, '카드는 사라지지 않고 확정된다');
  assert.equal(state.messages[0].id, 'srv-echo', '서버 ID로 in-place 교체');
  assert.equal(state.messages[0].status, 'sent');
  assert.ok(!state.messages[0].pending, 'pending 해제(normalize 행은 필드 무 = falsy)');
  assert.equal(state.messages[0].clientReqId, capturedReqId, '발송 키 유지 — 이후 에코/재전송 연결 자국');
  assert.equal(state.typing, false);
});

test('WS message.new(user) 에코 — client_req_id로 낙관 카드 병합, 중복 카드 0', async (t) => {
  const h = harness(t); h.render(); await flush();
  let reqId = '';
  t.mock.method(apiModule.api, 'sendMessage', (_sid: string, _text: string, _exec?: string, options?: { client_req_id?: string }) => {
    reqId = options?.client_req_id ?? '';
    return new Promise<ApiEnvelope<SendMessageResult>>(() => {}); // REST 미확정 — WS 에코가 먼저 온다 (⑤/user 카드 선행·지연 어느 쪽도 OK)
  });
  void h.render().send('안녕 병합');
  const localId = h.render().messages[0].id;
  h.sockets[0].onRaw?.({ type: 'message.new', session_id: 'session', seq: 1, user_message_id: 'srv-1',
    message: { id: 'srv-1', session_id: 'session', turn_index: 0, role: 'user', message_type: 'text', content: '안녕 병합', client_req_id: reqId } });
  const state = h.render();
  assert.deepEqual(state.messages.map((m) => m.id), ['srv-1'], '낙관 행 local-*가 서버 ID로 흡수 (중복 카드 소멸)');
  assert.equal(state.messages[0].status, 'sent');
  assert.equal(state.messages[0].clientReqId, reqId);
  assert.notEqual(localId, 'srv-1');
});

test('WS message.new(user) — req_id 없는 에코도 content 폴백으로 병합 (음성·드레인 경로, ②)', async (t) => {
  const h = harness(t); h.render(); await flush();
  t.mock.method(apiModule.api, 'sendMessage', () => new Promise<ApiEnvelope<SendMessageResult>>(() => {}));
  void h.render().send('이어해요');
  h.sockets[0].onRaw?.({ type: 'message.new', session_id: 'session', seq: 2,
    message: { id: 'srv-2', session_id: 'session', turn_index: 0, role: 'user', message_type: 'text', content: '이어해요' } });
  const state = h.render();
  assert.deepEqual(state.messages.map((m) => m.id), ['srv-2']);
  assert.equal(state.messages[0].status, 'sent');
});

test('재시도(retryMessage)는 같은 client_req_id 재전송 — 서버 멱등 에코가 실패 카드를 회수', async (t) => {
  const h = harness(t); h.render(); await flush();
  const seen: string[] = [];
  let boom = true;
  t.mock.method(apiModule.api, 'sendMessage', async (_sid: string, _text: string, _exec?: string, options?: { client_req_id?: string }) => {
    seen.push(options?.client_req_id ?? '');
    if (boom) { boom = false; throw new Error('네트워크 절단 모의'); }
    return { ok: true, data: {
      deduped: true, user_message_id: 'srv-r', turn_index: 0,
      messages: { user: { id: 'srv-r', session_id: 'session', turn_index: 0, role: 'user', message_type: 'text', content: '다시', client_req_id: seen[0] } },
      empathy_response: null, answer_response: null, dialogue_type: 'casual', answer_message_id: null, empathy_message_id: null,
    } as unknown as SendMessageResult } as ApiEnvelope<SendMessageResult>;
  });
  assert.deepEqual(await h.render().send('다시'), { ok: false, error: 'errors.request' });
  const failed = h.render();
  assert.equal(failed.messages[0].status, 'failed');
  const failedId = failed.messages[0].id;
  const retrying = failed.retryMessage(failedId);
  assert.deepEqual(await retrying, { ok: true });
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1], '재시도는 같은 키 재전송 (random_id 관습)');
  const state = h.render();
  assert.deepEqual(state.messages.map((m) => m.id), ['srv-r'], '실패 카드가 서버 행으로 회수');
  assert.equal(state.messages[0].status, 'sent');
});

test('diff sync 재접속 — GET events 갭 리플레이(onRaw 동일 경로), 전량 갱신 없이 배지 없음', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  t.mock.method(apiModule.api, 'getSessionEvents', async (_sid: string, after: number) => ({
    ok: true, data: {
      current_seq: after + 2, seq_epoch: 'E1', truncated: false,
      events: [
        { type: 'answer.delta', session_id: 'session', seq: after + 1, run_id: 'r9', delta: '갱', index: 0 },
        { type: 'message.new', session_id: 'session', seq: after + 2, message: { id: 'srv-x', session_id: 'session', turn_index: 3, role: 'agent', message_type: 'text', content: '갱' } },
      ],
    },
  }));
  h.render(); await flush();
  h.sockets[0].onStatusChange?.('connected'); // first connect — no catch-up
  h.sockets[0].onRaw?.({ type: 'subscribed', session_id: 'session', current_seq: 5, seq_epoch: 'E1' });
  // simulate the WS having advanced lastSeq, then a drop+reconnect
  h.sockets[0].onRaw?.({ type: 'message.new', session_id: 'session', seq: 9, message: { id: 'live', session_id: 'session', turn_index: 9, role: 'agent', message_type: 'text', content: 'live' } });
  const readsBefore = 1; // initial getMessages
  h.sockets[0].onStatusChange?.('disconnected');
  t.mock.timers.tick(1200); // backoff (~1s jitter 0.5 → 1000ms*±)
  assert.equal(h.sockets.length, 2);
  h.sockets[1].onStatusChange?.('connected');
  await flush();
  const state = h.render();
  assert.ok(state.messages.some((m) => m.id === 'srv-x'), '갭 이벤트가 WS와 같은 onRaw 경로로 리플레이되어 확정 행에 합류');
  assert.equal((apiModule.api.getMessages as unknown as { mock: { callCount(): number } }).mock.callCount(), readsBefore, '차등 리플레이 성공 시 전량 재조회 없음(배지·플리커 0)');
  assert.equal(state.lastError, null);
});

test('diff sync — epoch 불일치는 리셋+0 재구독+전체 재조회, 낮은 seq 리플레이 살아남', async (t) => {
  const h = harness(t);
  let reads = 0;
  t.mock.method(apiModule.api, 'getMessages', async () => { reads++; return { ok: true, data: [] }; });
  t.mock.method(apiModule.api, 'getSessionEvents', async () => ({
    ok: true, data: { current_seq: 1, seq_epoch: 'E2', truncated: false, events: [] },
  }));
  h.render(); await flush();
  h.sockets[0].onStatusChange?.('connected');
  h.sockets[0].onRaw?.({ type: 'subscribed', session_id: 'session', current_seq: 50, seq_epoch: 'E1' });
  h.sockets[0].onRaw?.({ type: 'message.new', session_id: 'session', seq: 50, message: { id: 'old', session_id: 'session', turn_index: 5, role: 'agent', message_type: 'text', content: 'old' } });
  const readsAtReconnect = reads;
  h.sockets[0].onStatusChange?.('disconnected');
  h.render().retryConnection();
  h.sockets[1].onStatusChange?.('connected');
  await flush();
  assert.ok(reads > readsAtReconnect, '전체 재조회 전환');
  assert.equal(h.sent[1].some((f) => f.type === 'subscribe' && f.last_seq === 0), true, 'last_seq=0 재구독');
  // 재기동 서버의 낮은 seq 리플레이가 accept 필터에 잘리지 않는다
  h.sockets[1].onRaw?.({ type: 'message.new', session_id: 'session', seq: 1, message: { id: 'low', session_id: 'session', turn_index: 6, role: 'agent', message_type: 'text', content: 'low' } });
  assert.ok(h.render().messages.some((m) => m.id === 'low'));
});

test('diff sync — 404(구 서버/EVENT_SYNC_DISABLED)는 기존 gap 페이지 갱신 폴백', async (t) => {
  const h = harness(t);
  h.render(); await flush();
  h.sockets[0].onStatusChange?.('connected');
  h.sockets[0].onStatusChange?.('disconnected');
  h.render().retryConnection();
  const readsBefore = (apiModule.api.getMessages as unknown as { mock: { callCount(): number } }).mock.callCount();
  h.sockets[1].onStatusChange?.('connected');
  await flush();
  assert.ok((apiModule.api.getMessages as unknown as { mock: { callCount(): number } }).mock.callCount() > readsBefore, 'gap refresh 폴백 실행');
  assert.equal(h.render().lastError, null);
});
