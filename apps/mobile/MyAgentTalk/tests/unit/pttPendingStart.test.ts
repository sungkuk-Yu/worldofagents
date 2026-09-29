// t_5058e15f ② — 지연 시작 회귀: talk.ready=false 홀드는 '조용한 스킵'이 아니라
// pending('연결 중') → ready 도달 시 캡처 자동 시작 → 릴리스 전송. 대기 중 릴리스/타임아웃은
// 전송 위장 없는 폐기. lib/holdStart 순수 판정 + usePushToTalk 훅 상태기계(node:test 해니스).
import { test, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { holdGrantAction, pendingReleaseAction, HOLD_CONNECT_WAIT_MS } from '../../src/lib/holdStart';
import type { JoystickGesture } from '../../src/types';

test('holdGrantAction — ready면 즉시 캡처, 미ready면 startPending(스킵 아님)', () => {
  assert.equal(holdGrantAction(true), 'captureNow');
  assert.equal(holdGrantAction(false), 'startPending');
});

test('pendingReleaseAction — send만 cancel 강등(무음 전송 위장 금지), keyboard/ack/cancel 통과', () => {
  const g = (gesture: JoystickGesture | null, escaped = false, ackActive = false) =>
    pendingReleaseAction({ gesture, escaped, ackActive });
  assert.equal(g(null), 'cancel');                 // 제자리 릴리스(미전환 발화) = 폐기
  assert.equal(g('DIR_UP'), 'keyboard');           // ↑ = 키보드 전환 유지
  assert.equal(g('DIR_LEFT', false, true), 'ack'); // 재질문 좌 = 텍스트 발화 유지
  assert.equal(g('DIR_LEFT', false, false), 'cancel'); // 비활성 좌우 = send 후보 → cancel 강등
  assert.equal(g(null, true), 'cancel');           // 이탈 = cancel
});

// ── 훅 상태기계 ─────────────────────────────────────────────
// react/리액트 네이티브/브라우저 API는 useChatSession.test.ts 해니스 + exportLogic.test.ts 스텁 관례.
const react = require('react') as typeof import('react');

function stubModule(t: TestContext, name: string, exports: Record<string, unknown>) {
  let p: string;
  try { p = require.resolve(name); } catch { return; }
  const prev = require.cache[p];
  require.cache[p] = { exports } as unknown as NodeModule;
  t.after(() => { if (prev) require.cache[p] = prev; else delete require.cache[p]; });
}

async function main(t: TestContext) {
  stubModule(t, 'react-native', { Platform: { OS: 'web' } });
  stubModule(t, 'expo-secure-store', { getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} });

  // 브라우저 캡처 환경 스텁 — getUserMedia/AudioContext 최소 가짜
  const listeners = new Map<string, ((e: any) => void)[]>();
  const g: any = globalThis;
  const prevWindow = g.window; const prevNav = g.navigator;
  g.window = {
    scrollX: 0, scrollY: 0,
    addEventListener: (k: string, fn: (e: any) => void) => { (listeners.get(k) ?? listeners.set(k, []).get(k)!).push(fn); },
    removeEventListener: (k: string, fn: (e: any) => void) => { const a = listeners.get(k) ?? []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    AudioContext: class {
      state = 'running'; sampleRate = 16000; destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() { return { onaudioprocess: null, connect() {}, disconnect() {} }; }
    },
  };
  Object.defineProperty(g, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
  // 스텁 비복원 주의: effect cleanup이 window.removeEventListener를 호출 — node:test는 파일 단위 프로세스라 누수는 격리된다.
  void prevWindow; void prevNav;

  const calls: string[] = [];
  const bridge = {
    ready: false,
    start: (m?: string) => calls.push(`start:${m ?? 'hold'}`),
    frame: () => { calls.push('frame'); },
    end: () => calls.push('end'),
    cancel: () => calls.push('cancel'),
  };

  // ── react 훅 경계 해니스 (useChatSession.test.ts 동일 수법) ──
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
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

  const { usePushToTalk } = require('../../src/hooks/usePushToTalk') as typeof import('../../src/hooks/usePushToTalk');
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  let result!: ReturnType<typeof usePushToTalk>;
  const render = () => {
    index = 0;
    result = usePushToTalk(bridge, { active: true });
    const queued = effects; effects = [];
    queued.forEach((e) => e());
    return result;
  };
  t.after(() => slots.forEach((s) => s.cleanup?.()));

  const pressIn = listeners.get('mousedown') ?? []; void pressIn;
  // ── S1: 미ready 홀드 = pending 시작 — talk.start 없음, 에러 없음(조용한 스킵도 아님) ──
  render();
  bridge.ready = false;
  render().startHold();
  render();
  assert.equal(result.pending, true, 'pending = 연결 중 안내 신호');
  assert.equal(result.active, false, '캡처 미시작');
  assert.deepEqual(calls, [], 'talk.start 금지');
  assert.equal(result.error, null, '에러 토스트 금지');

  // ── S2: 대기 중 제자리 릴리스(endHold) = 조용한 폐기 — end/cancel 호출 없음 ──
  render().endHold();
  render();
  assert.equal(result.pending, false);
  assert.deepEqual(calls, [], '전송 위장(audio.end) 금지');

  // ── S3: 다시 홀드 → talk.ready 도달 → 캡처 자동 시작 → 릴리스로 전송 ──
  render().startHold();
  render();
  assert.equal(result.pending, true);
  bridge.ready = true;
  render(); // enabled 전환 → 자동 startCaptureIfIdle
  await flush();
  render();
  assert.equal(result.pending, false, 'ready 도달 = 안내 종료');
  assert.equal(result.active, true, '그랜트 보존 → 캡처 자동 시작');
  assert.deepEqual(calls, ['start:hold']);
  render().endHold();
  render();
  assert.equal(result.active, false);
  assert.deepEqual(calls, ['start:hold', 'end'], '정규 전송');

  // ── S4: 미ready 홀드 + 타임아웃(HOLD_CONNECT_WAIT_MS) = 안내 종료 조용한 폐기 ──
  bridge.ready = false;
  calls.length = 0;
  render().startHold();
  render();
  assert.equal(result.pending, true);
  t.mock.timers.tick(HOLD_CONNECT_WAIT_MS); // 20s 만료
  render();
  assert.equal(result.pending, false, '타임아웃 = 안내 종료');
  assert.deepEqual(calls, [], '타임아웃 폐기는 end/cancel 무호출(캡처自体 미시작)');
}
test('usePushToTalk 지연 시작 — pending/전환/폐기/타임아웃', async (t) => { t.mock.timers.enable({ apis: ['setTimeout'] }); await main(t); });
