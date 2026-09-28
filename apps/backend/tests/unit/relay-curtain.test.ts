/**
 * 비서실 백스테이지 릴레이 자막 (t_583d9fed 案1) — 대표님 9/28 "일단 a이고 나머진 기획으로 가져가자".
 * 계약: ① secretary 페르소나 턴만 자막 발행(비서는 이벤트 0건) ② stage는 RELAY_ORDER 단조 증가·중복 0건
 * ③ run.completed는 항상 마지막 이벤트(기존 계약 보존) ④ 로케일 quip. 외부 LLM 호출 없이 규칙 폴백으로 완주.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { RELAY_QUIPS, RELAY_ORDER, RelayCurtain } from '../../src/lib/relay';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  store.tables.sessions.push({ ...session });
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(false); // 템플릿 폴백 경로 (fetch 0회)
});
afterEach(() => { vi.restoreAllMocks(); });

async function turnWithPersona(relationshipType: string | undefined, locale: 'ko' | 'en' = 'ko') {
  store.tables.personas.length = 0;
  store.tables.personas.push({ id: 'persona', tone_config: {}, ...(relationshipType ? { relationship_type: relationshipType } : {}) });
  const events: TurnEmitEvent[] = [];
  await runTextTurn(db, session, 'user', '계약 해지는 언제 가능한가요?', { locale, emit: e => events.push(e) });
  return events;
}

describe('릴레이 커튼 (단조 증가·dedup)', () => {
  it('역순·중복 stage는 소거, 정순 진행만 통과', () => {
    const curtain = new RelayCurtain('ko');
    expect(curtain.advance('drafting')).toBe(RELAY_QUIPS.drafting.ko);
    expect(curtain.advance('briefing')).toBeNull();   // 역순
    expect(curtain.advance('drafting')).toBeNull();   // 중복
    expect(curtain.advance('wrapping')).toBe(RELAY_QUIPS.wrapping.ko);
    expect(curtain.advance('done')).toBe(RELAY_QUIPS.done.ko);
    expect(curtain.advance('done')).toBeNull();
  });
  it('roster는 5비트 고정, 로케일 문구 완비', () => {
    expect(RELAY_ORDER).toEqual(['briefing', 'research', 'drafting', 'wrapping', 'done']);
    for (const stage of RELAY_ORDER) {
      expect(RELAY_QUIPS[stage].ko.length).toBeGreaterThan(0);
      expect(RELAY_QUIPS[stage].en.length).toBeGreaterThan(0);
    }
  });
});

describe('비서실 턴 vs 일반 턴', () => {
  beforeEach(() => { db = createDevClient(store) as DbClient; });

  it('secretary 페르소나: 4비트 자막이 순서대로 나가고 run.completed가 마지막이다', async () => {
    const events = await turnWithPersona('secretary');
    const relay = events.filter(e => e.type === 'relay.updated') as any[];
    expect(relay.map(e => e.stage)).toEqual(['briefing', 'research', 'drafting', 'wrapping', 'done']);
    // 휘발성 연출이라도 세션/런 식별자 보존 — 프론트가 현 실행에 붙인다.
    for (const e of relay) expect(e.session_id).toBe(session.id);
    expect(events.at(-1)!.type).toBe('run.completed');
    // 기존 계약 불변: answer.done 바로 앞에 wrapping이 있어도 이벤트 종류 순서가 깨지지 않는다.
    const runEvents = events.filter(e => e.type === 'run.completed' || e.type === 'answer.done').map(e => e.type);
    expect(runEvents).toEqual(['answer.done', 'run.completed']);
  });

  it('비서 외 페르소나(colleague/미설정): relay.updated 0건 — 기존 흐름과 동일', async () => {
    for (const rel of ['colleague', undefined]) {
      const events = await turnWithPersona(rel);
      expect(events.filter(e => e.type === 'relay.updated')).toHaveLength(0);
      expect(events.at(-1)!.type).toBe('run.completed');
    }
  });

  it('로케일=en이면 자막도 영문', async () => {
    const events = await turnWithPersona('secretary', 'en');
    const relay = events.filter(e => e.type === 'relay.updated') as any[];
    expect(relay.length).toBeGreaterThan(0);
    for (const e of relay) expect(e.quip).toBe((RELAY_QUIPS as any)[e.stage].en);
  });
});
