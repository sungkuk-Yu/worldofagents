// t_616e9abf — 조이스틱 →편집 프론트 실행 배선 단위 게이트.
// ① usePushToTalk.endHoldDraft = talk.end(true)(audio.end{draft:true}) 단독 / endHold = talk.end(false)
//    회귀 잠금 — 두 경로가 뒤섞이면 '→편집' 릴리스가 위장전송(t_55e92e7e 결정2 위반)이 된다.
// ② useChatSession.talk.end(draft) WS 스니프 — draft=true는 {type:'audio.end',draft:true},
//    absent/false는 무draft 프레임 1:1 (하위호환).
// ③ transcript.draft 수신 → onTranscriptDraft(text) 콜버, text:''(무음) no-op,
//    user 행 영속 0(머지 없음)·seq 필터 앞 휘발성 처리.
import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type * as ReactTypes from 'react';

const react = require('react') as typeof ReactTypes;

// ── 공용 해니스 (pttPendingStart.test.ts 동일 수법: 훅 경부 모의 + 브라우저 스텁) ──
function stubModule(t: TestContext, name: string, exports: Record<string, unknown>) {
  let p: string;
  try { p = require.resolve(name); } catch { return; }
  const prev = require.cache[p];
  require.cache[p] = { exports } as unknown as NodeModule;
  t.after(() => { if (prev) require.cache[p] = prev; else delete require.cache[p]; });
}

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
function hookHarness(t: TestContext) {
  const slots: Slot[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  t.mock.method(react, 'useState', ((initial: unknown) => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? (initial as () => unknown)() : initial };
    return [slots[i].value, (u: unknown) => { slots[i].value = typeof u === 'function' ? (u as (p: unknown) => unknown)(slots[i].value) : u; }];
  }) as typeof react.useState);
  t.mock.method(react, 'useRef', ((initial: unknown) => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: { current: initial } };
    return slots[i].value;
  }) as typeof react.useRef);
  t.mock.method(react, 'useCallback', ((cb: unknown, deps: readonly unknown[]) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: cb, deps };
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
  const runEffects = () => { const q = effects; effects = []; q.forEach((e) => e()); };
  t.after(() => slots.forEach((s) => s.cleanup?.()));
  return { resetIndex: () => { index = 0; }, runEffects };
}

function stubBrowserCaptureEnv() {
  const g = globalThis as any;
  g.window = {
    scrollX: 0, scrollY: 0,
    addEventListener: () => {}, removeEventListener: () => {},
    AudioContext: class {
      state = 'running'; sampleRate = 16000; destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() { return { onaudioprocess: null, connect() {}, disconnect() {} }; }
    },
  };
  Object.defineProperty(g, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
}

test('usePushToTalk: endHoldDraft=talk.end(true) 단독, endHold=talk.end(false) 회귀 — pending은 폐기', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  stubModule(t, 'react-native', { Platform: { OS: 'web' } });
  stubModule(t, 'expo-secure-store', { getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} });
  stubBrowserCaptureEnv();
  const h = hookHarness(t);

  const calls: string[] = [];
  const bridge = {
    ready: true,
    start: (m?: string) => calls.push(`start:${m ?? 'hold'}`),
    frame: () => { calls.push('frame'); },
    end: (draft?: boolean) => { calls.push(draft ? 'end:draft' : 'end'); },
    cancel: () => calls.push('cancel'),
  };
  const { usePushToTalk } = require('../../src/hooks/usePushToTalk') as typeof import('../../src/hooks/usePushToTalk');
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  let result!: ReturnType<typeof usePushToTalk>;
  const render = () => { h.resetIndex(); result = usePushToTalk(bridge, { active: true }); h.runEffects(); return result; };

  // E1: 캡처 중 endHoldDraft → talk.end(true) — audio.end{draft:true} 실행자 단독
  render();
  render().startHold();
  await flush(); render();
  assert.deepEqual(calls, ['start:hold']);
  render().endHoldDraft();
  render();
  assert.deepEqual(calls, ['start:hold', 'end:draft'], 'draft 릴리스는 talk.end(true) — cancel/무draft 없음');

  // E2: 캡처 중 endHold → talk.end(false) — 기존 전송 경로 회귀(무draft)
  calls.length = 0;
  render().startHold();
  await flush(); render();
  render().endHold();
  render();
  assert.deepEqual(calls, ['start:hold', 'end'], '전송 릴리스는 무draft talk.end(false)');

  // E3: pending(미시작) 상태 endHoldDraft = endHold와 동일 폐기 — draft 위장 호출 0
  bridge.ready = false;
  calls.length = 0;
  render().startHold();
  render();
  assert.equal(result.pending, true);
  render().endHoldDraft();
  render();
  assert.equal(result.pending, false);
  assert.deepEqual(calls, [], '미시작 폐기 = end/cancel 무호출(전송·draft 위장 금지)');
});

// ── useChatSession talk WS 스니프 + transcript.draft 수신 ──────────────
import { useChatSession, UseChatSessionReturn } from '../../src/hooks/useChatSession';
import { ApiEnvelope, SendMessageResult, VoiceSocketHandlers } from '../../src/lib/api';

const apiModule = require('../../src/lib/api') as typeof import('../../src/lib/api');
const flush2 = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function sessionHarness(t: TestContext, options: import('../../src/hooks/useChatSession').UseChatSessionOptions = {}) {
  const slots: Slot[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  let result: UseChatSessionReturn;
  const sockets: VoiceSocketHandlers[] = [];
  const sent: Record<string, unknown>[][] = [];
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  t.mock.method(react, 'useState', ((initial: unknown) => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? (initial as () => unknown)() : initial };
    return [slots[i].value, (u: unknown) => { slots[i].value = typeof u === 'function' ? (u as (p: unknown) => unknown)(slots[i].value) : u; }];
  }) as typeof react.useState);
  t.mock.method(react, 'useRef', ((initial: unknown) => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: { current: initial } };
    return slots[i].value;
  }) as typeof react.useRef);
  t.mock.method(react, 'useCallback', ((cb: unknown, deps: readonly unknown[]) => {
    const i = index++;
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: cb, deps };
    return slots[i].value;
  }) as typeof react.useCallback);
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
  t.mock.method(apiModule.api, 'getSessionEvents', async () => { throw new Error('errors.unsupported'); });
  t.mock.method(apiModule, 'connectVoiceSocket', (_sid: string | null, handlers: VoiceSocketHandlers) => {
    const i = sockets.length;
    sockets.push(handlers); sent.push([]);
    return { ready: true, send: (data: string | ArrayBuffer) => { sent[i].push(JSON.parse(String(data))); return true; }, close: () => {} };
  });
  const render = () => {
    index = 0;
    result = useChatSession('session', options);
    const queued = effects; effects = [];
    queued.forEach((e) => e());
    return result;
  };
  t.after(() => slots.forEach((s) => s.cleanup?.()));
  return { render, sockets, sent };
}

function confirmEnvelope(): ApiEnvelope<SendMessageResult> {
  return { ok: true, data: {
    user_message_id: 'u1', empathy_message_id: null, answer_message_id: null,
    empathy_response: null, answer_response: null, dialogue_type: 'casual',
  } };
}

test('talk.end(draft) WS 스니프 — draft=true는 audio.end{draft:true}, false/absent는 무draft 1:1', async (t) => {
  const h = sessionHarness(t);
  h.render(); await flush2();
  h.sockets[0].onStatusChange?.('connected');
  h.render().talk.start('hold');
  h.render().talk.end(true);
  const ends = h.sent[0].filter((f) => f.type === 'audio.end');
  assert.equal(ends.length, 1, 'draft 릴리스 = audio.end 1프레임');
  assert.deepEqual(ends[0], { type: 'audio.end', session_id: 'session', draft: true }, 'audio.end{draft:true}');
  // 전송 경로 회귀: start→end(무인자) = draft 키 없는 기존 프레임
  h.render().talk.start('hold');
  h.render().talk.end();
  const ends2 = h.sent[0].filter((f) => f.type === 'audio.end');
  assert.equal(ends2.length, 2);
  assert.deepEqual(ends2[1], { type: 'audio.end', session_id: 'session' }, 'absent = 무draft 하위호환');
});

test('transcript.draft 수신 → onTranscriptDraft(text, durationMs), text=no-op, user 행 영속 0', async (t) => {
  const drafts: [string, number | undefined][] = [];
  t.mock.method(apiModule.api, 'sendMessage', async () => confirmEnvelope());
  const h = sessionHarness(t, { onTranscriptDraft: (text, durationMs) => drafts.push([text, durationMs]) });
  h.render(); await flush2();
  h.sockets[0].onStatusChange?.('connected');
  const msgsBefore = h.render().messages.length;
  // 휘발성 회신: seq 없는 프레임도 처리되어야 한다(seq 필터 앞 — presence/favorite와 동일 원칙)
  h.sockets[0].onRaw?.({ type: 'transcript.draft', session_id: 'session', text: '수정할 전문', confidence: 0.9, language: 'ko', duration_ms: 2100 });
  assert.deepEqual(drafts, [['수정할 전문', 2100]], '콜백 전달');
  assert.equal(h.render().messages.length, msgsBefore, 'user 행 영속 0 (전송 경로 아님)');
  // 무음 릴리스 text:'' = 프론트 no-op (백엔드 계약 대칭)
  h.sockets[0].onRaw?.({ type: 'transcript.draft', session_id: 'session', text: '', confidence: 0, language: 'ko', duration_ms: 120 });
  assert.equal(drafts.length, 1, 'text:no-op');
  // 공백만도 no-op
  h.sockets[0].onRaw?.({ type: 'transcript.draft', session_id: 'session', text: '   ', confidence: 0, language: 'ko', duration_ms: 120 });
  assert.equal(drafts.length, 1, 'whitespace-only no-op');
  // duration_ms 수치경계: NaN/미공급 → undefined (콜백은 유지)
  h.sockets[0].onRaw?.({ type: 'transcript.draft', session_id: 'session', text: '경계', confidence: 0.5, language: 'ko', duration_ms: NaN });
  assert.deepEqual(drafts[1], ['경계', undefined], 'NaN duration → undefined');
});

test('onTranscriptDraft 미장착 클라이언트는 transcript.draft를 무해 무시 (하위호환)', async (t) => {
  const h = sessionHarness(t); // 옵션 없음 = 구 배선
  h.render(); await flush2();
  h.sockets[0].onStatusChange?.('connected');
  const before = h.render().messages.length;
  h.sockets[0].onRaw?.({ type: 'transcript.draft', session_id: 'session', text: '미배선 회신', confidence: 0.9, language: 'ko', duration_ms: 900 });
  assert.equal(h.render().messages.length, before, '영속 0·에러 0 — default 무해 경로');
  assert.equal(h.render().lastError, null);
});
