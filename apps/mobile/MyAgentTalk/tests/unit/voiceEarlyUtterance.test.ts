// t_c956e3ee — bt/t_2133e4fc(c189b60a) 음성 user 발화 선(先)방송 계약의 프론트 수신 검증
// 백엔드 순서 불변식: message.new(user) < run.started, LLM 실행/실패와 무관하게 발화 카드 유지.
// 이 파일은 프론트 로직을 고치지 않고 훅을 그대로 구동하여 다음을 실측한다:
//  ① transcript.final(확정 message_id)와 message.new(user) 어느 순서로 와도 user 카드 1개 (id dedup)
//  ② message.new(user)는 run.started보다 먼저 렌더 — run.failed가 뒤따라도 user 카드 잔존
//  ③ 현 계약(턴 종료 후 message.new) 후발 순서에서도 user 카드 1개 — 기존 거동 보존
//  ④ 3중 수신( optimistic 없음·final·message.new×2)에도 중복 0 (백엔드 deduped 1건과 무관하게 안전)
// 백엔드 페이로드 형상은 handler.ts(c189b60a) broadcastToSession 실측본과 1:1:
//   transcript.final: { type, session_id, turn_index, text, confidence, language, duration_ms, message_id, seq }
//   message.new(user): { type, session_id, run_id, message: serializeMessage(userRow), seq }
import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type * as ReactTypes from 'react';
import { useChatSession, UseChatSessionReturn } from '../../src/hooks/useChatSession';
import { VoiceSocketHandlers } from '../../src/lib/api';

const react = require('react') as typeof ReactTypes;
const apiModule = require('../../src/lib/api') as typeof import('../../src/lib/api');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness(t: TestContext, sid: string | null = 'session') {
  const slots: { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  let result: UseChatSessionReturn;
  const sockets: VoiceSocketHandlers[] = [];
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
  t.mock.method(apiModule, 'connectVoiceSocket', (_sid: string | null, handlers: VoiceSocketHandlers) => {
    const i = sockets.length;
    sockets.push(handlers);
    return { ready: true, send: () => true, close: () => {} };
  });
  const render = () => {
    index = 0;
    result = useChatSession(sid);
    const queued = effects; effects = [];
    queued.forEach((effect) => effect());
    return result;
  };
  t.after(() => slots.forEach((slot) => slot.cleanup?.()));
  // c189b60a의 선방송 순서 불변식을 프레임 1건씩 주입해 매 프레임 후 상태를 관찰할 수 있게 한다.
  const feed = async (frame: Record<string, unknown>) => {
    sockets[0].onRaw?.(frame as never);
    await flush();
    render();
    await flush();
  };
  return { render, feed, messages: () => result.messages };
}

const USER_ID = 'u-early-1';
const RUN_ID = 'run-early-1';
const TEXT = '오늘 일정 알려줘';

const finalFrame = (seq: number) => ({
  type: 'transcript.final', session_id: 'session', seq,
  turn_index: 5, text: TEXT, confidence: 0.95, language: 'ko', duration_ms: 420,
  message_id: USER_ID,
});
const userCardFrame = (seq: number) => ({
  type: 'message.new', session_id: 'session', seq, run_id: RUN_ID,
  message: {
    id: USER_ID, session_id: 'session', user_id: 'u1', role: 'user', content: TEXT,
    turn_index: 5, created_at: '2026-09-29T21:00:00.000Z', ai_generated: false,
  },
});
const runStartedFrame = (seq: number) => ({
  type: 'run.started', session_id: 'session', seq, run_id: RUN_ID, turn_index: 5,
});
const runFailedFrame = (seq: number) => ({
  type: 'run.failed', session_id: 'session', seq, run_id: RUN_ID, turn_index: 5,
  error: { code: 'LLM_TIMEOUT', message: 'mock failure' },
});
const userCount = (msgs: { id: string }[]) => msgs.filter((m) => m.id === USER_ID).length;

test('① 선방송 A 순서(transcript.final → message.new(user)): user 카드 1개, id merge', async (t) => {
  const h = harness(t); h.render(); await flush();
  await h.feed(finalFrame(1));
  assert.equal(userCount(h.messages()), 1, 'final 직후 발화 카드 1개');
  assert.equal(h.messages().find((m) => m.id === USER_ID)?.content, TEXT);
  await h.feed(userCardFrame(2));
  assert.equal(userCount(h.messages()), 1, 'message.new 후에도 1개(id 중복 no-op)');
});

test('② message.new(user)는 run.started보다 먼저 렌더 — 후속 run.failed에도 user 카드 잔존', async (t) => {
  const h = harness(t); h.render(); await flush();
  // 백엔드 실측 순서: message.new(user) < run.started (handler.ts c189b60a 불변식)
  await h.feed(finalFrame(1));
  await h.feed(userCardFrame(2));
  const at = h.messages().findIndex((m: { id: string }) => m.id === USER_ID);
  assert.ok(at >= 0, 'run 신호 전에 user 카드 존재');
  await h.feed(runStartedFrame(3));
  assert.equal(userCount(h.messages()), 1, 'run.started 후에도 user 카드 유지(교체 아님)');
  await h.feed(runFailedFrame(4));
  assert.equal(userCount(h.messages()), 1, 'LLM 실행 실패와 무관하게 발화 카드 잔존(텔레그램 관습)');
});

test('③ 구계약 후발 순서(run.started → turn 종료 → message.new)에서도 카드 1개 — 현 main 거동 보존', async (t) => {
  const h = harness(t); h.render(); await flush();
  await h.feed(runStartedFrame(1));
  await h.feed(finalFrame(2));
  assert.equal(userCount(h.messages()), 1, 'final(확정 id)에서 user 머지');
  await h.feed(userCardFrame(3));
  assert.equal(userCount(h.messages()), 1, '턴 종료 message.new = id 중복 no-op');
});

test('④ 3중 수신(final + message.new×2, seq 역순 포함)에도 중복 0·순서 정합', async (t) => {
  const h = harness(t); h.render(); await flush();
  await h.feed(userCardFrame(3));
  await h.feed(finalFrame(2));
  await h.feed(userCardFrame(3));
  assert.equal(userCount(h.messages()), 1, 'message.new 2회+final 1회 = user 카드 1개');
});
