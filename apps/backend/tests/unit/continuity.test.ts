/**
 * 크로스 디바이스 연속성 단위 테스트 (t_d75ca81c).
 * 커버: PTT 상태머신 헬퍼 / preferences 딥머지 / read-state 커서 API / resume 집계 / presence.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { normalizePttMode, normalizeDeviceLabel, isPttIdleTimeout, isPttHoldOverflow } from '../../src/lib/pushToTalk';
import { deepMergePreferences } from '../../src/lib/prefs';
import { config } from '../../src/config';
import { websocketHandler } from '../../src/websocket/handler';
import { signup, createFullStack, bearer } from '../helpers';

let token: string;
let userId: string;
let session: any;
let agent: any;

beforeAll(async () => {
  await build();
  ({ token, userId } = await signup(app));
  ({ session, agent } = await createFullStack(app, token));
});
afterAll(async () => { await app.close(); });

// ── PTT 상태머신 ──────────────────────────────────────

describe('pushToTalk', () => {
  it('mode는 hold 기본, unknown 값도 hold로 정규화된다', () => {
    expect(normalizePttMode(undefined)).toBe('hold');
    expect(normalizePttMode('toggle')).toBe('toggle');
    expect(normalizePttMode('hold')).toBe('hold');
    expect(normalizePttMode('vtol')).toBe('hold');
  });

  it('device 라벨은 화이트리스트만 통과, 나머지는 unknown', () => {
    expect(normalizeDeviceLabel('PC-Web')).toBe('pc-web');
    expect(normalizeDeviceLabel('mobile-web')).toBe('mobile-web');
    expect(normalizeDeviceLabel('samsung-tv')).toBe('unknown');
    expect(normalizeDeviceLabel(undefined)).toBe('unknown');
  });

  it('무음 타임아웃·홀드 상한이 설정 기준으로 판정된다', () => {
    const activity = { lastVoiceAt: 1_000, startedAt: 0 };
    expect(isPttIdleTimeout(activity, 1_000 + config.pushToTalk.silenceTimeoutMs - 1)).toBe(false);
    expect(isPttIdleTimeout(activity, 1_000 + config.pushToTalk.silenceTimeoutMs)).toBe(true);
    expect(isPttHoldOverflow(activity, config.pushToTalk.maxHoldMs - 1)).toBe(false);
    expect(isPttHoldOverflow(activity, config.pushToTalk.maxHoldMs)).toBe(true);
  });

  it('audio.start는 mode/device를 echo하고 미종료 세그먼트 위 재시작이 암묵 종료한다', async () => {
    const socket = makeSocket();
    await connectWs(socket, { ticket: await issueWsTicket() });
    await sendWs(socket, { type: 'audio.start', session_id: session.id, config: { mode: 'toggle', device: 'pc-web' } });
    const started = socket.events.filter(e => e.type === 'audio.started').at(-1);
    expect(started.config).toMatchObject({ mode: 'toggle', device: 'pc-web', max_hold_ms: expect.any(Number) });
    // 두 번째 start — 이전 세그먼트 종료 신호(audio.vad off)가 먼저 나온다.
    await sendWs(socket, { type: 'audio.start', session_id: session.id, config: {} });
    const after = socket.events.slice(socket.events.indexOf(started) + 1);
    expect(after.find(e => e.type === 'audio.vad')).toMatchObject({ active: false });
    expect(after.filter(e => e.type === 'audio.started').at(-1)!.config).toMatchObject({ mode: 'hold', device: 'unknown' });
    // presence 테스트의 허브에 잔류 소켓을 남기지 않는다.
    socket.handlers.close?.();
  });
});

// ── preferences 딥 머지 ───────────────────────────────

describe('deepMergePreferences', () => {
  it('키 단위 병합: 남의 서브키를 지우지 않는다', () => {
    const base = { joystickMap: { up: 'mic' }, theme: 'dark' };
    const merged = deepMergePreferences(base, { pttKeymap: { main: 'KeyV' } });
    expect(merged).toEqual({ joystickMap: { up: 'mic' }, theme: 'dark', pttKeymap: { main: 'KeyV' } });
    const nested = deepMergePreferences(merged, { pttKeymap: { alt: 'Space' } });
    expect(nested.pttKeymap).toEqual({ main: 'KeyV', alt: 'Space' });
  });

  it('배열은 교체, null은 키 삭제', () => {
    const merged = deepMergePreferences({ tags: ['a'], pttKeymap: { main: 'V' }, old: 1 }, { tags: ['b'], pttKeymap: null });
    expect(merged).toEqual({ tags: ['b'], old: 1 });
  });

  it('PATCH /api/auth/me 딥머지 — 조이스틱 맵과 PTT 키맵이 공존한다', async () => {
    await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: bearer(token), payload: { preferences: { joystickMap: { up: 'mic' } } } });
    await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: bearer(token), payload: { preferences: { pttKeymap: { mode: 'hold', key: 'KeyV' } } } });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    expect(me.json().data.preferences).toMatchObject({ joystickMap: { up: 'mic' }, pttKeymap: { mode: 'hold', key: 'KeyV' } });
    // /api/me 경로도 동일 계약 (두 경로가 서로를 지우면 안 된다)
    await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(token), payload: { preferences: { pttKeymap: { key: 'KeyB' } } } });
    const both = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) });
    expect(both.json().data.preferences).toMatchObject({ joystickMap: { up: 'mic' }, pttKeymap: { mode: 'hold', key: 'KeyB' } });
  });
});

// ── read-state / resume API ───────────────────────────

describe('세션 이어보기 (read-state + resume)', () => {
  async function sendTurn(content: string) {
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: bearer(token), payload: { content } });
    expect(res.statusCode).toBe(201);
    return res.json().data;
  }

  it('read-state PUT은 UPSERT·멱등이고 커서는 되감기지 않는다', async () => {
    await sendTurn('이어보기 테스트 1');
    const first = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/read-state`, headers: bearer(token), payload: { last_read_turn_index: 1, device: 'mobile-web' } });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ session_id: session.id, last_read_turn_index: 1, last_device: 'mobile-web' });
    // 더 작은 커서로 갱신해도 유지 (max 병합)
    const rewind = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/read-state`, headers: bearer(token), payload: { last_read_turn_index: 0 } });
    expect(rewind.json().data.last_read_turn_index).toBe(1);
    const read = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/read-state`, headers: bearer(token) });
    expect(read.json().data).toMatchObject({ last_read_turn_index: 1, last_device: 'mobile-web' });
  });

  it('잘못된 커서 값·타인 세션은 거부된다', async () => {
    const bad = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/read-state`, headers: bearer(token), payload: { last_read_turn_index: 1.5 } });
    expect(bad.statusCode).toBe(400);
    const neg = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/read-state`, headers: bearer(token), payload: { last_read_turn_index: -2 } });
    expect(neg.statusCode).toBe(400);
    const other = await signup(app, 'intruder@test.io');
    const stolen = await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/read-state`, headers: bearer(other.token), payload: { last_read_turn_index: 9 } });
    expect(stolen.statusCode).toBe(404);
    const stolenResume = await app.inject({ method: 'GET', url: '/api/sessions/resume', headers: bearer(other.token) });
    expect(stolenResume.json().data.items).toHaveLength(0);
  });

  it('resume는 미읽음 수/첫 미읽음 turn/추천 세션을 반환한다', async () => {
    await sendTurn('이어보기 테스트 2'); // turn 2,3 (user+agent)
    const res = await app.inject({ method: 'GET', url: '/api/sessions/resume', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    const item = data.items.find((i: any) => i.session_id === session.id);
    expect(item).toMatchObject({
      agent_name: agent.name,
      last_read_turn_index: 1,
      unread_count: expect.any(Number),
    });
    expect(item.unread_count).toBeGreaterThan(0);
    expect(item.first_unread_turn_index).toBeGreaterThan(1); // 커서(1)보다 뒤에서 첫 미읽음
    expect(data.recommended_session_id).toBe(session.id);
    // 전부 읽음 처리하면 추천은 유지되되 unread 0
    await app.inject({ method: 'PUT', url: `/api/sessions/${session.id}/read-state`, headers: bearer(token), payload: { last_read_turn_index: item.latest_turn_index } });
    const after = await app.inject({ method: 'GET', url: '/api/sessions/resume', headers: bearer(token) });
    const afterItem = after.json().data.items.find((i: any) => i.session_id === session.id);
    expect(afterItem.unread_count).toBe(0);
    expect(afterItem.first_unread_turn_index).toBeNull();
  });
});

// ── presence (WS) ─────────────────────────────────────

const sockets: any[] = [];

function makeSocket() {
  const socket = {
    events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
    terminate: vi.fn(),
  };
  sockets.push(socket);
  return socket;
}

async function issueWsTicket() {
  const res = await app.inject({ method: 'POST', url: '/api/ws-ticket', headers: bearer(token) });
  return res.json().data.ticket as string;
}

async function connectWs(socket: any, query: Record<string, string>, headerToken?: string) {
  const request: any = { query, server: app, jwtVerify: async () => {
    if (!headerToken) throw new Error('헤더 없음');
    request.user = app.jwt.verify(headerToken);
  } };
  await websocketHandler({ socket }, request);
}

const sendWs = (socket: any, message: unknown) => socket.handlers.message(JSON.stringify(message), false);

afterAll(() => { for (const socket of sockets.splice(0)) socket.handlers.close?.(); });

describe('세션 presence', () => {
  it('디바이스 라벨을 단 소켓이 join하면 subscribed에 devices가 실리고 타 소켓에 presence.update가 브로드캐스트된다', async () => {
    const pc = makeSocket();
    await connectWs(pc, { ticket: await issueWsTicket(), device: 'pc-web' });
    await sendWs(pc, { type: 'subscribe', session_id: session.id });
    const subscribed = pc.events.find(e => e.type === 'subscribed');
    expect(subscribed.devices).toEqual([{ device: 'pc-web', since: expect.any(Number) }]);

    const mobile = makeSocket();
    await connectWs(mobile, { ticket: await issueWsTicket(), device: 'mobile-web' });
    await sendWs(mobile, { type: 'subscribe', session_id: session.id });
    // pc 소켓에 두 디바이스 presence가 도달한다
    const seen = pc.events.filter(e => e.type === 'presence.update').at(-1);
    expect(seen.devices.map((d: any) => d.device).sort()).toEqual(['mobile-web', 'pc-web']);

    // mobile 이탈 → pc에 최신 presence 도착
    mobile.handlers.close?.();
    const latest = pc.events.filter(e => e.type === 'presence.update').at(-1);
    expect(latest.devices).toEqual([{ device: 'pc-web', since: expect.any(Number) }]);
    pc.handlers.close?.();
  });
});
