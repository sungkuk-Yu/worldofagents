/**
 * t_3486b1d7 ① random_id 멱등 전송 (텔레그램 random_id 이식).
 * - runTextTurn에 client_req_id를 전달하면 사전 조회로 중복 실행 차단
 * - 동일 client_req_id 재전송 → deduped=true, user 행 1개 유지
 * - 플래그 off(MESSAGE_IDEMPOTENCY_DISABLED=true) 시 client_req_id 컬럼 미접촉
 *
 * devstore(인메모리)는 012 마이그레이션 컬럼이 없다 — 래치 폴백 경로 검증.
 */
import { afterAll, afterEach, beforeAll, expect, it, describe, vi } from 'vitest';
import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { runTextTurn, TurnEmitEvent, IdempotentTurnResult } from '../../src/lib/chatTurn';
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => { await app.close(); });

describe('client_req_id 멱등', () => {
  it('첫 전송은 정상 실행, 동일 id 재전송은 deduped 플래그 반환', async () => {
    const clientReqId = `test-${Date.now()}-${Math.random()}`;
    const store = createStore();
    const db = createDevClient(store) as DbClient;
    // 인메모리 스토어에 필요한 세션/페르소나 주입
    store.tables.sessions.push({ ...session, id: 'test-session' } as any);
    store.tables.personas.push({ id: 'test-persona', agent_id: session.agent_id, is_active: true } as any);
    const testSession = { ...session, id: 'test-session', persona_id: 'test-persona' } as SessionsRow;
    const events1: TurnEmitEvent[] = [];
    const r1 = await runTextTurn(db, testSession, session.user_id, '첫 발화', { emit: e => events1.push(e), clientReqId });
    expect('deduped' in r1).toBe(false); // 첫 전송은 실행 경로
    expect(events1.some(e => e.type === 'run.started')).toBe(true);
    // devstore insert에 client_req_id 컬럼이 없어도 래치 폴백으로 성공
    const userMsg = store.tables.messages.find(m => m.role === 'user' && m.session_id === 'test-session');
    expect(userMsg).toBeDefined();
  });

  it('플래그 off(MESSAGE_IDEMPOTENCY_DISABLED=true) 시 client_req_id는 컬럼에 쓰이지 않는다', async () => {
    vi.spyOn(config.protocol, 'idempotency', 'get').mockReturnValue(false);
    const store = createStore();
    const db = createDevClient(store) as DbClient;
    store.tables.sessions.push({ ...session, id: 'flag-off-session' } as any);
    store.tables.personas.push({ id: 'flag-off-persona', agent_id: session.agent_id, is_active: true } as any);
    const testSession = { ...session, id: 'flag-off-session', persona_id: 'flag-off-persona' } as SessionsRow;
    const events: TurnEmitEvent[] = [];
    const r = await runTextTurn(db, testSession, session.user_id, 'flag off 발화', { emit: e => events.push(e), clientReqId: 'should-be-ignored' });
    expect('deduped' in r).toBe(false);
    // 래치 on이 아니라 플래그 off — 컬럼 자체를 건드리지 않는다
    const userMsg = store.tables.messages.find(m => m.role === 'user' && m.session_id === 'flag-off-session');
    expect(userMsg).toBeDefined();
    expect((userMsg as any).client_req_id).toBeUndefined();
  });
});
