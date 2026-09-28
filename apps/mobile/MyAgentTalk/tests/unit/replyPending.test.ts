// 답변 대기 프론트 계약 (t_363c0faa) — 정규화·배지 카운트·WS 스냅샷 리듀스
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReplyPending, normalizeReplyKind, EMPTY_PENDING_REPLIES } from '../../src/lib/chatLogic';

test('normalizeReplyPending — {count,items} 객체와 raw 배열 양쪽 수신, turn_index 오름', () => {
  const snap = normalizeReplyPending({
    count: 2,
    items: [
      { message_id: 'a2', turn_index: 4, excerpt: '견적 보내도 될까요?', reply_kind: 'yesno' },
      { message_id: 'a1', turn_index: 2, excerpt: '어느 지점으로 보낼까요?', reply_kind: 'freeform' },
    ],
  });
  assert.deepEqual(snap.map((r) => [r.messageId, r.turnIndex, r.replyKind]), [['a1', 2, 'freeform'], ['a2', 4, 'yesno']]);
  // raw 배열 수신 (queue.updated 관례)
  assert.equal(normalizeReplyPending([{ message_id: 'x', turn_index: 1, excerpt: 'e', reply_kind: 'both' }]).length, 1);
});

test('normalizeReplyPending — 방어: 형태 아니면 빈 배열, 결측 필드 강등', () => {
  assert.deepEqual(normalizeReplyPending(undefined), EMPTY_PENDING_REPLIES);
  assert.deepEqual(normalizeReplyPending(null), []);
  assert.deepEqual(normalizeReplyPending('nope'), []);
  assert.deepEqual(normalizeReplyPending({ items: 'nope' }), []);
  assert.deepEqual(normalizeReplyPending([{ id: 'message_id 없음 → 스킵' }]), []);
  const one = normalizeReplyPending([{ message_id: 'm', excerpt: 123 as unknown }]);
  assert.deepEqual(one, [{ messageId: 'm', turnIndex: 0, excerpt: '', replyKind: 'freeform' }]);
});

test('normalizeReplyKind — 3종 수락, 그 외 freeform 안전 강등 (자유의사 발화로 해소 가능)', () => {
  assert.equal(normalizeReplyKind('yesno'), 'yesno');
  assert.equal(normalizeReplyKind('both'), 'both');
  assert.equal(normalizeReplyKind('constructor'), 'freeform');
  assert.equal(normalizeReplyKind(undefined), 'freeform');
});

// WS reply.pending.updated 리듀스 — useChatSession 하네스 (queue.updated 관례 재사용)
import { useChatSession } from '../../src/hooks/useChatSession';
import type * as ReactTypes from 'react';
const react = require('react') as typeof ReactTypes;
const apiModule = require('../../src/lib/api') as typeof import('../../src/lib/api');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness(t: import('node:test').TestContext, sid: string | null = 'session') {
  const slots: { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  const sockets: import('../../src/lib/api').VoiceSocketHandlers[] = [];
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  t.mock.method(react, 'useState', ((initial: unknown) => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
    return [slots[i].value, (update: unknown) => { slots[i].value = typeof update === 'function' ? update(slots[i].value) : update; }];
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
  t.mock.method(apiModule, 'connectVoiceSocket', (_sid: string | null, handlers: import('../../src/lib/api').VoiceSocketHandlers) => {
    sockets.push(handlers);
    return { ready: true, send: () => true, close: () => {} };
  });
  const render = () => {
    index = 0;
    const result = useChatSession(sid, {});
    const queued = effects; effects = [];
    queued.forEach((run) => run());
    return { result, runEffects: () => queued.forEach((run) => run()) };
  };
  t.after(() => slots.forEach((slot) => slot.cleanup?.()));
  return { render, sockets };
}

test('WS reply.pending.updated — 배지 카운트(정규화 후 length) 갱신·전체 교체·count 0 해소', async (t) => {
  const h = harness(t);
  const { result: first } = h.render(); await flush();
  assert.deepEqual(first.pendingReplies, [], '초기 빈 스냅샷 = 배지 없음(최소 노출)');
  h.sockets[0].onRaw?.({ type: 'reply.pending.updated', session_id: 'session', count: 1, items: [{ message_id: 'a1', turn_index: 3, excerpt: '보내도 될까요?', reply_kind: 'yesno' }] });
  h.render();
  assert.equal(h.render().result.pendingReplies.length, 1, '수신 후 카운트 1');
  h.sockets[0].onRaw?.({ type: 'reply.pending.updated', session_id: 'session', count: 2, items: [
    { message_id: 'a1', turn_index: 3, excerpt: '보내도 될까요?', reply_kind: 'yesno' },
    { message_id: 'a2', turn_index: 5, excerpt: '일정은 언제?', reply_kind: 'freeform' },
  ] });
  assert.equal(h.render().result.pendingReplies.length, 2, '전체 교체 스냅샷');
  h.sockets[0].onRaw?.({ type: 'reply.pending.updated', session_id: 'session', count: 0, items: [] });
  assert.equal(h.render().result.pendingReplies.length, 0, '발화 해소 → 배지 0');
});

test('applyPendingSnapshot — 보조 폴링 적용기는 WS와 동일 단일 상태원천을 교체한다', async (t) => {
  const h = harness(t);
  h.render(); await flush();
  h.render().result.applyPendingSnapshot(normalizeReplyPending({ items: [{ message_id: 'p1', turn_index: 1, excerpt: '확인?', reply_kind: 'both' }] }));
  const state = h.render().result;
  assert.equal(state.pendingReplies.length, 1);
  assert.equal(state.pendingReplies[0].replyKind, 'both');
});
