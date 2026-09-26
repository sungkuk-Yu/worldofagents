/** 실제 외부 호출 없이 턴의 동시성, 실패 전이, 엔진별 LLM 연결을 검증한다. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, validateConfig } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { processTurn } from '../../src/neurons/graph';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;
beforeEach(() => {
  store = createStore();
  db = createDevClient(store) as DbClient;
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(false);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const run = (events: TurnEmitEvent[] = []) => runTextTurn(db, session, 'user', '왜 그런가요?', { emit: e => events.push(e) });

describe('공유 턴 실행', () => {
  it('동시 전송도 번호가 겹치지 않고 접수·처리·완료를 순서대로 발행한다', async () => {
    const events: TurnEmitEvent[] = [];
    const results = await Promise.all([run(events), run(events), run(events)]);
    expect(store.tables.messages.map(m => m.turn_index)).toEqual([0,1,2,3,4,5,6,7,8]);
    expect(new Set(results.map(r => r.turnId)).size).toBe(3);
    for (const r of results) {
      const own = events.filter((e: any) => e.run_id === r.turnId) as any[];
      expect(own[0].type).toBe('run.started');
      expect(own[1].type).toBe('run.progress');
      expect(own.at(-1).type).toBe('run.completed');
      expect(own.at(-2).type).toBe('answer.done');
      expect(r.messages.answer?.content).toBe(r.answerResponse);
    }
    expect(events.filter(e => e.type === 'message.new')).toHaveLength(9);
  });

  it.each(['user', 'empathy', 'answer'])('%s 저장 실패는 failed로 끝나고 후속 턴은 계속 실행된다', async target => {
    const original = db.from.bind(db);
    const spy = vi.spyOn(db, 'from').mockImplementation(table => {
      const q = original(table);
      if (table === 'messages') {
        const insert = q.insert.bind(q);
        q.insert = (row: any) => row.role === target || row.source_neuron === target
          ? { select: () => ({ single: async () => ({ data: null, error: { message: '저장 실패' } }) }) }
          : insert(row);
      }
      return q;
    });
    const events: TurnEmitEvent[] = [];
    await expect(run(events)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(events.at(-1)).toMatchObject({ type: 'run.failed' });
    expect(events.some((e: any) => e.type === 'run.progress')).toBe(true);
    expect(events.some((e: any) => e.type === 'run.completed')).toBe(false);
    spy.mockRestore();
    await expect(run()).resolves.toHaveProperty('userMessageId');
  });

  it('사용자 저장 unique 충돌은 한 번 재시도한다', async () => {
    const original = db.from.bind(db);
    let failed = false;
    vi.spyOn(db, 'from').mockImplementation(table => {
      const q = original(table);
      if (table === 'messages') {
        const insert = q.insert.bind(q);
        q.insert = (row: any) => {
          if (row.role === 'user' && !failed) {
            failed = true;
            return { select: () => ({ single: async () => ({ data: null, error: { message: 'duplicate unique' } }) }) };
          }
          return insert(row);
        };
      }
      return q;
    });
    await expect(run()).resolves.toHaveProperty('answerMessageId');
    expect(failed).toBe(true);
    expect(store.tables.messages).toHaveLength(3);
  });

  it.each(['simple', 'langgraph'])('%s 엔진에서 실행 중 델타·이력·가드 결과가 전달된다', async engine => {
    vi.spyOn(config, 'neuronEngine', 'get').mockReturnValue(engine);
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    store.tables.personas.push({ id: 'persona', name: '테스트', style_guide: { forbidden_expressions: ['금지어'] } });
    store.tables.messages.push(
      { session_id: 'session', turn_index: 0, role: 'user', content: '이전 질문' },
      { session_id: 'session', turn_index: 1, role: 'agent', source_neuron: 'empathy', content: '이전 공감' },
      { session_id: 'session', turn_index: 2, role: 'agent', source_neuron: 'answer', content: '이전 답변' },
    );
    const events: TurnEmitEvent[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      expect(events.some((e: any) => e.type === 'neuron.status' && e.neuron.slug === 'empathy')).toBe(true);
      const messages = JSON.parse(options.body).messages;
      expect(messages.map((m: any) => m.content)).toContain('이전 답변');
      expect(messages.map((m: any) => m.content)).not.toContain('이전 공감');
      expect(store.tables.messages.at(-1)?.role).toBe('user');
      return new Response('data: {"model":"test-model","choices":[{"delta":{"content":"금지어 답변"}}]}\n\ndata: [DONE]\n');
    }));
    const result = await run(events);
    expect(result.engine).toBe(engine);
    expect(result.structured).toMatchObject({ dialogue_type: 'info_card', classifier: 'rules' });
    expect(result.messages.answer?.structured_payload).toEqual(result.structured.structured_payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.llm).toMatchObject({ used: true, model: 'test-model', fallback: false });
    expect(result.answerResponse).not.toContain('금지어');
    expect(result.messages.answer?.content).toBe(result.answerResponse);
    expect(events.find(e => e.type === 'answer.delta')).toMatchObject({ index: 0, delta: '금지어 답변' });
  });

  it.each(['simple', 'langgraph'])('%s 엔진의 구조화 추출은 텍스트 델타와 분리되어 저장·발행된다', async engine => {
    vi.spyOn(config, 'neuronEngine', 'get').mockReturnValue(engine);
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    const card = { dialogue_type: 'spreadsheet', structured_payload: { title: '재고', columns: ['품목'], rows: [['사과']] } };
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => JSON.parse(options.body).stream
      ? new Response('data: {"choices":[{"delta":{"content":"재고 답변"}}]}\n\ndata: [DONE]\n')
      : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(card) } }] }))));
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '표로 보여줘', { emit: e => events.push(e) });
    expect(result.engine).toBe(engine);
    expect(result.structured).toEqual({ ...card, classifier: 'llm' });
    expect(result.messages.answer).toMatchObject(card);
    expect(events.filter(e => e.type === 'answer.delta')).toEqual([expect.objectContaining({ delta: '재고 답변', index: 0 })]);
    expect(events.find(e => e.type === 'message.new' && e.message.source_neuron === 'answer')).toMatchObject({ message: card });
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', structured: card });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['simple', 'langgraph'])('%s 엔진은 분류 중 취소에도 규칙 카드와 답변을 저장한다', async engine => {
    vi.spyOn(config, 'neuronEngine', 'get').mockReturnValue(engine);
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      if (JSON.parse(options.body).stream) {
        return new Response('data: {"choices":[{"delta":{"content":"파일 답변"}}]}\n\ndata: [DONE]\n');
      }
      controller.abort();
      throw new DOMException('취소', 'AbortError');
    }));
    const result = await processTurn(db, 'session', 'user', 'agent', null, '파일 주세요', { signal: controller.signal });
    expect(result.engine).toBe(engine);
    expect(result.structured).toEqual({ dialogue_type: 'file', structured_payload: { files: [] }, classifier: 'rules' });
    expect(result.messages.answer).toMatchObject({ content: '파일 답변', dialogue_type: 'file', structured_payload: { files: [] } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('협업 요청도 답변 카드 경로에 진입한다', async () => {
    const result = await processTurn(db, 'session', 'user', 'agent', null, '함께 협업해줘');
    expect(result.messages.answer).toMatchObject({ dialogue_type: 'multi_agent', structured_payload: { agents: [] } });
  });

  it('LLM 실패는 템플릿으로 완료하고 답변 뉴런 실패 사용량을 기록한다', async () => {
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('제한', { status: 429 })));
    const events: TurnEmitEvent[] = [];
    const r = await run(events);
    expect(r.llm).toMatchObject({ used: false, fallback: true, reason: 'LLM_RATE_LIMITED' });
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
    expect(store.tables.neurons.find(n => n.slug === 'answer')?.failure_count).toBe(1);
  });

  it('processTurn 자체도 락 대기 전에 received를 알린다', async () => {
    const status: string[] = [];
    const promise = processTurn(db, 'session', 'user', 'agent', null, '질문?', { onTurnStatus: s => status.push(s) });
    expect(status).toEqual(['received']);
    await promise;
    expect(status.at(-1)).toBe('completed');
  });

  it('운영 필수 설정 누락과 기본 비밀값을 거부한다', () => {
    vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
    vi.stubEnv('SUPABASE_URL', '');
    expect(validateConfig).toThrow('SUPABASE_URL');
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'mock-key');
    expect(validateConfig).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    vi.stubEnv('JWT_SECRET', 'agenttalk-dev-secret-change-in-production');
    expect(validateConfig).toThrow('JWT_SECRET');
    vi.stubEnv('JWT_SECRET', 'test-secret');
    expect(validateConfig).not.toThrow();
  });
});
