/**
 * t_20746efa two-speed 답변 구조 (대표님 10/10 확정 계약)
 *  ① front desk: 평상 발화 = 기본 모델(flash) 무검색 즉시 답변 — 고모델/선행검색 없음
 *  ② depth lane: 규칙 classifyExpertise(법률/세무/의료/시사) 발화만 백스테이지 승격
 *     — deepModel 설정 시 고모델, Perplexity opt-in 설정 시에만 검색
 *  ③ Stage 2 LLM deep 보강: 규칙 미잡은 깊이 발화도 llmClassify deep=true로 승격
 *  ④ 게이트: front desk 리드 상한 frontDeskFirstTokenMs (ack 후 첫 글자 ≤1.5s)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import * as perplexity from '../../src/lib/perplexity';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  store.tables.sessions.push({ ...session });
  store.tables.personas.push({ id: 'persona', tone_config: {} });
  store.tables.agents.push({ id: 'agent', name: '일정 비서', owner_id: 'user', category: 'general', config: {} });
  db = createDevClient(store) as DbClient;
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
  // front 모델명을 고정 — .env 드리프트와 무관하게 lane 모델 비교를 결정적으로 만든다.
  vi.spyOn(config.chatLlm, 'model', 'get').mockReturnValue('front-test-model');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** fetch 모크 — 요청 body(model/스트림 여부) 수집 + 분류(system에 classify) 분기. */
function captureFetch(opts: { classifyJson?: string } = {}) {
  const calls: Array<{ model: string; stream: boolean; system: string }> = [];
  const fetchSpy = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    const sys = String(body.messages?.[0]?.content || '');
    calls.push({ model: body.model, stream: Boolean(body.stream), system: sys });
    if (body.stream) {
      return new Response('data: {"model":"ans-model","choices":[{"delta":{"content":"답변 본문"}}]}\n\ndata: [DONE]\n');
    }
    if (opts.classifyJson && sys.includes('classify the user')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: opts.classifyJson } }] }));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님' } }] }));
  });
  vi.stubGlobal('fetch', fetchSpy);
  return calls;
}

/** answer 스트림 요청(첫 system=페르소나, stream=true)의 model. */
function answerModel(calls: Array<{ model: string; stream: boolean }>) {
  return calls.filter(c => c.stream).map(c => c.model);
}

describe('① front desk — 평상 발화', () => {
  it('일반 발화는 기본 모델로 답하고 검색을 호출하지 않는다 (선행검색 영구 폐기)', async () => {
    const calls = captureFetch();
    const search = vi.spyOn(perplexity, 'searchGrounding').mockResolvedValue({
      status: 'grounded', findings: 'x', citations: [], sources: [], model: 'sonar-pro', durationMs: 0,
    } as any);
    vi.spyOn(perplexity, 'isPerplexityConfigured').mockReturnValue(true);
    await runTextTurn(db, session, 'user', '주말 등산 가는데 날씨 어때?', { locale: 'ko', emit: () => undefined });
    const models = answerModel(calls);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toBe(config.chatLlm.model); // front 모델 — deepModel 아님
    expect(search).not.toHaveBeenCalled();
  });

  it('코드 기본값 강등: CHAT_LLM_MODEL 미설정 시 qwen3-max 금지 → flash 기본', async () => {
    // .env/테스트 env의 스파이와 무관하게 'config.ts 소스 기본값' 자체를 검증한다.
    vi.resetModules();
    vi.stubEnv('CHAT_LLM_MODEL', '');
    const fresh = (await import('../../src/config')).config;
    expect(fresh.chatLlm.model).toBe('qwen3.8-flash');
    expect(fresh.chatLlm.deepModel).toBe(''); // 승격은 opt-in
    expect(fresh.perplexity.enabled).toBe(false); // 검색 기본 off
    vi.unstubAllEnvs();
  });
});

describe('② depth lane — 규칙 판정(법률/시사) 발화만 승격', () => {
  it('deepModel 설정 시: 법률 발화만 고모델 승격, 일반 발화는 front 유지', async () => {
    vi.spyOn(config.chatLlm, 'deepModel', 'get').mockReturnValue('deep-test-model');
    const calls = captureFetch();
    vi.spyOn(perplexity, 'isPerplexityConfigured').mockReturnValue(false); // 검색 opt-in OFF(기본)
    await runTextTurn(db, session, 'user', '해고예고수당 안 주면 법률적으로 어떻게 되나요?', { locale: 'ko', emit: () => undefined });
    expect(answerModel(calls)[0]).toBe('deep-test-model');
    calls.length = 0;
    await runTextTurn(db, session, 'user', '내일 일정 정리해줘', { locale: 'ko', emit: () => undefined });
    expect(answerModel(calls)[0]).toBe(config.chatLlm.model);
  });

  it('deepModel 미설정(기본)이면 깊이 발화도 front 모델 — 승격은 운영 opt-in', async () => {
    const calls = captureFetch();
    await runTextTurn(db, session, 'user', '이 계약서 법률 검토 도와줄래?', { locale: 'ko', emit: () => undefined });
    expect(answerModel(calls)[0]).toBe(config.chatLlm.model);
  });

  it('깊이 발화는 검색 설정(opt-in) 시에만 그라운딩이 발동한다', async () => {
    const calls = captureFetch();
    const search = vi.spyOn(perplexity, 'searchGrounding').mockResolvedValue({
      status: 'grounded', findings: '해고예고 위반 시 30일분 [1]', citations: ['https://labour.law/26'],
      sources: [{ url: 'https://labour.law/26', title: '근로기준법', snippet: 's', date: null }], model: 'sonar-pro', durationMs: 1,
    } as any);
    vi.spyOn(perplexity, 'isPerplexityConfigured').mockReturnValue(true);
    await runTextTurn(db, session, 'user', '근로기준법 해고예고 위반 시 법률적 불이익이 뭔가요?', { locale: 'ko', emit: () => undefined });
    expect(search).toHaveBeenCalledTimes(1);
    expect(answerModel(calls).length).toBeGreaterThan(0);
  });

  it('시사(current) 발화가 새로 판정된다 — classifyExpertise 확장', async () => {
    const { classifyExpertise } = await import('../../src/lib/persona');
    expect(classifyExpertise('이번 주 국정감사 주요 뉴스 정리해줘')).toBe('current');
    expect(classifyExpertise('breaking news about the election')).toBe('current');
    expect(classifyExpertise('오늘 저녁 뭐 먹지')).toBe('general');
  });

  it('세목 파생어 규칙 씨앗 — 상속세/증여세/양도세/영문 세목이 accounting 판정 (t_a546fb54)', async () => {
    // 실측 실패 발화(카드 지정) + precision-first: 단독 '세/세금' 오탐은 general 유지.
    const { classifyExpertise } = await import('../../src/lib/persona');
    expect(classifyExpertise('상속세 신고 기한이 언제야')).toBe('accounting');
    expect(classifyExpertise('증여세 절세 방법이 궁금해')).toBe('accounting');
    expect(classifyExpertise('양도세 비과세 요건 알려줘')).toBe('accounting');
    expect(classifyExpertise('종합소득세 신고 기간이 언제까지야')).toBe('accounting');
    expect(classifyExpertise('capital gains tax on my house')).toBe('accounting');
    expect(classifyExpertise('inheritance tax filing deadline')).toBe('accounting');
    expect(classifyExpertise('estate tax threshold')).toBe('accounting');
    // 오탐 확인: 세목 아닌 일반 발화는 front 유지
    expect(classifyExpertise('세금 납부 영수증 어디갔지')).toBe('general');
    expect(classifyExpertise('오늘 일정 정리해줘')).toBe('general');
  });

  it('상속세 발화 end-to-end 승격 — 규칙 씨앗이 deepLane → deepModel (t_a546fb54 실측 회귀)', async () => {
    vi.spyOn(config.chatLlm, 'deepModel', 'get').mockReturnValue('deep-test-model');
    const calls = captureFetch();
    vi.spyOn(perplexity, 'isPerplexityConfigured').mockReturnValue(false);
    await runTextTurn(db, session, 'user', '상속세 신고 기한이 언제야', { locale: 'ko', emit: () => undefined });
    expect(answerModel(calls)[0]).toBe('deep-test-model');
  });
});

describe('③ Stage 2 LLM deep 보강 — 규칙 미잡은 깊이 발화 승격', () => {
  it('deep=true 응답이면 (confidence 미채택이어도) deepModel 승격', async () => {
    vi.spyOn(config.classification, 'llmEnabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'deepModel', 'get').mockReturnValue('deep-test-model');
    // 규칙 classifyExpertise 미히트 발화 + LLM deep=true (type confidence는 임계 미달)
    const calls = captureFetch({ classifyJson: '{"type":"information","confidence":0.5,"deep":true,"domain":"legal"}' });
    await runTextTurn(db, session, 'user', '다음 달 임대 계약 만료인데 위약금 부담이 얼마나 커?', { locale: 'ko', emit: () => undefined });
    expect(answerModel(calls)[0]).toBe('deep-test-model');
  });

  it('deep 필드 없으면 front 유지 (구모델 응답 호환)', async () => {
    vi.spyOn(config.classification, 'llmEnabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'deepModel', 'get').mockReturnValue('deep-test-model');
    const calls = captureFetch({ classifyJson: '{"type":"information","confidence":0.5}' });
    await runTextTurn(db, session, 'user', '그냥 궁금한 게 있어서요', { locale: 'ko', emit: () => undefined });
    expect(answerModel(calls)[0]).toBe(config.chatLlm.model);
  });

  it('상속세 파생 발화 — 규칙 미히트여도 Stage2 OR(deep=true)로 승격 (t_a546fb54)', async () => {
    // classifyExpertise 패턴 밖 서술('물려받다' 등) → 규칙 씨앗 general.
    vi.spyOn(config.classification, 'llmEnabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'deepModel', 'get').mockReturnValue('deep-test-model');
    const { classifyExpertise } = await import('../../src/lib/persona');
    const utterance = '부모님 재산 물려받으면 신고는 언제까지 해야 해';
    expect(classifyExpertise(utterance)).toBe('general'); // 규칙 미확정 전제
    const calls = captureFetch({ classifyJson: '{"type":"information","confidence":0.5,"deep":true,"domain":"accounting"}' });
    await runTextTurn(db, session, 'user', utterance, { locale: 'ko', emit: () => undefined });
    expect(answerModel(calls)[0]).toBe('deep-test-model');
  });
});

describe('④ front desk TTFT 게이트 — ack 후 연출 리드 ≤frontDeskFirstTokenMs', () => {
  it('empathy 없는 front 텍스트 턴: 3s 리드라도 SLA−TTFT예산으로 컷 (1200−700→500)', async () => {
    vi.stubGlobal('fetch', captureFetch());
    vi.spyOn(config, 'answerLeadMs', 'get').mockReturnValue(3000);
    vi.spyOn(config.protocol, 'frontDeskFirstTokenMs', 'get').mockReturnValue(1200);
    vi.spyOn(config.protocol, 'frontDeskTtftBudgetMs', 'get').mockReturnValue(700);
    // 반복 발화 게이트로 empathy 억제 → empathyResponse 없음 → 리드 컷 대상
    store.tables.messages.push({ id: 'm1', session_id: session.id, role: 'user', content: '같은 말 반복', source_neuron: null, turn_index: 1 } as any);
    const events: TurnEmitEvent[] = [];
    const t0 = Date.now();
    await runTextTurn(db, session, 'user', '같은 말 반복', { locale: 'ko', emit: e => events.push(e) });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(400);  // 리드 0이 아니라 500ms (연출 유지)
    expect(elapsed).toBeLessThan(1100);           // 3000 리드는 불가 — SLA 컷 증명
    expect(events.some(e => e.type === 'answer.done')).toBe(true);
  });

  it('깊이 lane은 캡 대상 아님 (백스테이지 = 한 답의 지연)', async () => {
    vi.stubGlobal('fetch', captureFetch());
    vi.spyOn(config, 'answerLeadMs', 'get').mockReturnValue(600);
    vi.spyOn(config.protocol, 'frontDeskFirstTokenMs', 'get').mockReturnValue(50);
    // 반복 발화 게이트로 empathy 없이(front desk와 동일 조건) deepLane만 켠다:
    // '법률' 규칙 히트 → deepLane=true → 50ms 캡이 적용되면 500ms 미만으로 끝난다.
    store.tables.messages.push({ id: 'm1b', session_id: session.id, role: 'user', content: '상속세 법률 상담이 필요해', source_neuron: null, turn_index: 1 } as any);
    const t0 = Date.now();
    await runTextTurn(db, session, 'user', '상속세 법률 상담이 필요해', { locale: 'ko', emit: () => undefined });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500); // 600ms 리드 유지(50ms 캡 안 함)
  });
});
