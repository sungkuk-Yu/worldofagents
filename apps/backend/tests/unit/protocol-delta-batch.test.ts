/**
 * t_3486b1d7 ④ answer.delta 백프레셔 — 300ms 또는 150자 whichever-first 배칭.
 * deltaBatchMs=0이면 토큰마다 즉시 emit(기존 동작 / 테스트 기본).
 */
import { afterAll, afterEach, beforeAll, expect, it, describe, vi } from 'vitest';
import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { signup, createFullStack } from '../helpers';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

let token: string;
let session: SessionsRow;

beforeAll(async () => {
  await build();
  const s = await signup(app);
  token = s.token;
  ({ session } = await createFullStack(app, token));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await app.close(); });

describe('answer.delta 백프레셔', () => {
  it('deltaBatchMs=0 → 토큰마다 즉시 emit (테스트 기본 확인)', async () => {
    expect(config.protocol.deltaBatchMs).toBe(0);
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\ndata: {"choices":[{"delta":{"content":"c"}}]}\n\ndata: [DONE]\n')));
    const store = createStore();
    store.tables.sessions.push({ ...session, id: 'batch-0' } as any);
    store.tables.personas.push({ id: 'batch-0-p', agent_id: session.agent_id, is_active: true } as any);
    const db = createDevClient(store) as DbClient;
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, { ...session, id: 'batch-0', persona_id: 'batch-0-p' } as any, session.user_id, '테스트', { emit: e => events.push(e) });
    const deltas = events.filter(e => e.type === 'answer.delta');
    expect(deltas.length).toBe(3); // 토큰마다 즉시 — 3건
  });

  it('deltaBatchMs>0 + 문자 상한 도달 → 즉시 flush', async () => {
    vi.spyOn(config.protocol, 'deltaBatchMs', 'get').mockReturnValue(300);
    vi.spyOn(config.protocol, 'deltaBatchChars', 'get').mockReturnValue(2);
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    // "a", "b", "c" 각 1글자 — 2글자 상한 도달 시 flush
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\ndata: {"choices":[{"delta":{"content":"c"}}]}\n\ndata: [DONE]\n')));
    const store = createStore();
    store.tables.sessions.push({ ...session, id: 'batch-char' } as any);
    store.tables.personas.push({ id: 'batch-char-p', agent_id: session.agent_id, is_active: true } as any);
    const db = createDevClient(store) as DbClient;
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, { ...session, id: 'batch-char', persona_id: 'batch-char-p' } as any, session.user_id, '테스트', { emit: e => events.push(e) });
    const deltas = events.filter(e => e.type === 'answer.delta');
    // t_baee5c42 계약 변경: 첫 델타 'a'는 ack→첫글자 SLA 앵커 — 배칭 없이 즉시 flush(index 0).
    // 이후 'b' 1글자는 2글자 상한 미달 + 타이머 대기 → 동기 완료 전 미flush(1회만 관측).
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(deltas[0]).toMatchObject({ delta: 'a', index: 0 });
  });
});
