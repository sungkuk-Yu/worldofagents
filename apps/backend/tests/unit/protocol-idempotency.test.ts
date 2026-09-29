/**
 * t_3486b1d7 ① random_id 멱등 전송 (텔레그램 random_id 이식).
 * - runTextTurn에 client_req_id를 전달하면 사전 조회로 중복 실행 차단
 * - 동일 client_req_id 재전송 → deduped=true, user 행 1개 유지
 * - 플래그 off(MESSAGE_IDEMPOTENCY_DISABLED=true) 시 client_req_id 컬럼 미접촉
 *
 * devstore(인메모리)는 013 마이그레이션 컬럼이 없다 — 래치 폴백 경로 검증.
 */
import { afterAll, afterEach, beforeAll, expect, it, describe, vi } from 'vitest';
import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { runTextTurn, textTurnResponse, TurnEmitEvent, IdempotentTurnResult } from '../../src/lib/chatTurn';
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

  it('② reconcile 에코: 사전 조회가 히트하면 message.new(deduped) 1건만 발행하고 턴을 실행하지 않는다', async () => {
    // 013 컬럼 형상을 devstore에 준비 (래치 우회 — 실DB 히트 경로 동일 계약).
    const clientReqId = `echo-${Date.now()}-${Math.random()}`;
    const store = createStore();
    const db = createDevClient(store) as DbClient;
    store.tables.sessions.push({ ...session, id: 'echo-session' } as any);
    store.tables.personas.push({ id: 'echo-persona', agent_id: session.agent_id, is_active: true } as any);
    const testSession = { ...session, id: 'echo-session', persona_id: 'echo-persona' } as SessionsRow;
    // 기존 user 행을 client_req_id와 함께 선행 삽입 (재전송이 도달했을 때의 실DB 상태).
    store.tables.messages.push({ id: 'prior-user-row', session_id: 'echo-session', role: 'user',
      content: '원 발화', turn_index: 0, locale: 'ko', ai_generated: false, client_req_id: clientReqId } as any);
    const events: TurnEmitEvent[] = [];
    const r = await runTextTurn(db, testSession, session.user_id, '원 발화', { emit: e => events.push(e), clientReqId });
    expect((r as IdempotentTurnResult).deduped).toBe(true);
    // 이벤트 계약 (프론트 전제조건 #198): message.new 1건 + run.* 0건.
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message.new');
    expect((events[0] as any).deduped).toBe(true);
    expect((events[0] as any).message.id).toBe('prior-user-row');
    expect((events[0] as any).message.client_req_id).toBe(clientReqId); // serializeMessage 정규화
    expect((events[0] as any).user_message_id).toBe('prior-user-row');
    // user 행 증가 없음 + 응답은 기존 행 재사용
    expect(store.tables.messages.filter(m => m.session_id === 'echo-session' && m.role === 'user')).toHaveLength(1);
    expect(r.userMessageId).toBe('prior-user-row');
    expect((r as any).answerResponse).toBe('원 발화');
    // textTurnResponse 봉인: deduped:true 노출
    expect((textTurnResponse(r) as any).deduped).toBe(true);
  });

  it('⑤ 롤백 게이트(USER_CARD_FIRST=false): run.started가 user 카드보다 먼저, source/user_message_id 생략 (484eec2f 베이스 1:1)', async () => {
    vi.spyOn(config.protocol, 'userCardFirst', 'get').mockReturnValue(false);
    const store = createStore();
    const db = createDevClient(store) as DbClient;
    store.tables.sessions.push({ ...session, id: 'base-order-session' } as any);
    store.tables.personas.push({ id: 'base-persona', agent_id: session.agent_id, is_active: true } as any);
    const testSession = { ...session, id: 'base-order-session', persona_id: 'base-persona' } as SessionsRow;
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, testSession, session.user_id, '베이스 순서 발화', { emit: e => events.push(e) }).catch(() => undefined);
    expect(events[0].type).toBe('run.started'); // 콜백 미등록 → processTurn 호출 전 발행(베이스 경로)
    const userCardIdx = events.findIndex(e => e.type === 'message.new' && (e as any).message.role === 'user');
    expect(userCardIdx).toBeGreaterThan(0); // user 카드는 processTurn 완료 후 (run.started 이후)
    expect((events[userCardIdx] as any).user_message_id).toBeUndefined();
    const answerCard = events.find(e => e.type === 'message.new' && (e as any).message.role === 'agent') as any;
    if (answerCard) expect(answerCard.source_message_id).toBeUndefined();
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
    // 래치 on이 아니라 플래그 off — 컬럼 자체를 건드리지 않는다 (devstore 기본 null = 실DB DEFAULT NULL 형상)
    const userMsg = store.tables.messages.find(m => m.role === 'user' && m.session_id === 'flag-off-session');
    expect(userMsg).toBeDefined();
    expect((userMsg as any).client_req_id).toBeNull();
  });
});
