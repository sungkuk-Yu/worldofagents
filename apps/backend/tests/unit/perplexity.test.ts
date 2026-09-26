/**
 * 법률·전문가 답변 Perplexity 그라운딩 (t_d54bc456) — 외부 네트워크 없이 검증한다.
 * 1) normalizeGroundingResponse: citations/search_results 정규화
 * 2) searchGrounding: fetch 모킹 성공/실패 경로 (절대 throw 금지)
 * 3) processTurn 통합: 법률 카테고리에만 검색 주입, 출처 카드, 실패 시 정직 표기
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config';
import { normalizeGroundingResponse, searchGrounding, GROUNDING_NOTES } from '../../src/lib/perplexity';
import * as perplexity from '../../src/lib/perplexity';
import * as llm from '../../src/lib/llm';
import { DISCLAIMERS } from '../../src/lib/persona';
import { app, build } from '../../src/index';
import { supabaseAdmin } from '../../src/lib/supabase';
import { bearer, createFullStack, signup } from '../helpers';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { try { await app.close(); } catch { /* already closed */ } });

describe('normalizeGroundingResponse', () => {
  const base = { startedAt: Date.now(), maxSources: 3 };
  it('citations 우선 + search_results 메타 병합, maxSources 상한', () => {
    const r = normalizeGroundingResponse({
      model: 'sonar-pro',
      choices: [{ message: { content: '근거 답변 [1][2]' } }],
      citations: ['https://a.law/1', 'https://b.law/2'],
      search_results: [
        { url: 'https://b.law/2', title: 'B 판례', snippet: 'sab', date: '2026-01-02' },
        { url: 'https://a.law/1', title: 'A 법령', snippet: 'sa' },
        { url: 'https://c.law/3', title: 'C 논문', snippet: 'sc' },
        { url: 'notaurl', title: '잘림' },
      ],
      usage: { total_tokens: 5 },
    }, base);
    expect(r.status).toBe('grounded');
    expect(r.findings).toContain('근거 답변');
    expect(r.sources.map(s => s.url)).toEqual(['https://a.law/1', 'https://b.law/2', 'https://c.law/3']);
    expect(r.sources[1].title).toBe('B 판례');
    expect(r.sources[1].date).toBe('2026-01-02');
    expect(r.citations).toHaveLength(2);
    expect(r.model).toBe('sonar-pro');
  });
  it('출처 0건이면 NO_CITATIONS 실패, 빈 응답이면 EMPTY_RESPONSE', () => {
    expect(normalizeGroundingResponse({ choices: [{ message: { content: '기억 답변' } }], citations: [] }, base).reason).toBe('NO_CITATIONS');
    const empty = normalizeGroundingResponse({ choices: [{ message: { content: '' } }], citations: ['https://x'] }, base);
    expect(empty.status).toBe('failed');
    expect(empty.reason).toBe('EMPTY_RESPONSE');
  });
});

describe('searchGrounding (fetch 모킹)', () => {
  it('키 미설정 시 skipped NOT_CONFIGURED — 네트워크 호출 0', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await searchGrounding('계약 위반 손해배상', 'ko');
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('성공 응답 → grounded + citations, request body에 sonar 모델/검색 컨텍스트', async () => {
    vi.spyOn(config.perplexity, 'apiKey', 'get').mockReturnValue('pplx-test');
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'sonar-pro',
      choices: [{ message: { content: '근거 [1]' } }],
      citations: ['https://law.example/act'],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await searchGrounding('근로기준법 해고예고', 'ko');
    expect(r.status).toBe('grounded');
    expect(r.sources[0].url).toBe('https://law.example/act');
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(body.model).toBe(config.perplexity.model);
    expect(body.search_context_size).toBe('medium');
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${config.perplexity.baseUrl}/chat/completions`);
  });
  it('429/401/네트워크 오류도 throw 없이 failed 정규화', async () => {
    vi.spyOn(config.perplexity, 'apiKey', 'get').mockReturnValue('pplx-test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate', { status: 429 })));
    expect((await searchGrounding('q', 'ko')).reason).toBe('RATE_LIMITED');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
    expect((await searchGrounding('q', 'ko')).reason).toBe('AUTH_FAILED');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const r = await searchGrounding('q', 'ko');
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('UNAVAILABLE');
  });
});

describe('processTurn 그라운딩 통합 (검색·LLM 모킹)', () => {
  let token = '';
  let sessionId = '';
  let personaId = '';
  let seq = 0;
  beforeAll(async () => { await build(); });

  async function sendMessage(content: string) {
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/messages`,
      headers: bearer(token), payload: { content },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data;
  }

  beforeEach(async () => {
    const s = await signup(app, `ground${++seq}@test.io`);
    token = s.token;
    const stack = await createFullStack(app, token);
    sessionId = stack.session.id;
    personaId = stack.personaId;
    // 페르소나 이름을 법률 전문가로 — classifyExpertise가 legal로 판정한다.
    await supabaseAdmin.from('personas').update({ name: '내 변호사' }).eq('id', stack.personaId);
    vi.spyOn(llm, 'isLlmConfigured').mockReturnValue(true);
    vi.spyOn(llm, 'chatCompletion').mockImplementation(async (o: any) => ({
      text: o.messages[0].content.includes('실시간 검색 근거') ? 'GROUNDED_ANSWER' : 'PLAIN_ANSWER',
      model: 'mock', usage: null, streamed: false, durationMs: 1,
    }));
  });

  const groundedResult = {
    status: 'grounded' as const,
    findings: '해고예고 위반 시 30일분 통상임금 [1]',
    citations: ['https://labour.law/26'],
    sources: [{ url: 'https://labour.law/26', title: '근로기준법 제26조', snippet: 's', date: '2026-05-01' }],
    model: 'sonar-pro', durationMs: 100,
  };

  it('법률 카테고리에만 검색이 발동하고 출처가 프롬프트·응답·카드에 실린다', async () => {
    const search = vi.spyOn(perplexity, 'searchGrounding').mockResolvedValue(groundedResult as any);
    vi.spyOn(perplexity, 'isPerplexityConfigured').mockReturnValue(true);
    const data = await sendMessage('해고예고수당 위반이면 어떻게 되나요?');
    expect(search).toHaveBeenCalledTimes(1);
    const sys = ((llm.chatCompletion as any).mock.calls[0][0].messages[0].content) as string;
    expect(sys).toContain('실시간 검색 근거');
    expect(sys).toContain('https://labour.law/26');
    expect(data.answer_response).toBe(`GROUNDED_ANSWER\n\n${DISCLAIMERS.legal.ko}`);
    expect(data.grounding).toMatchObject({ status: 'grounded', engine: 'perplexity-sonar', citations_total: 1 });
    expect(data.grounding.sources[0].url).toBe('https://labour.law/26');
    expect(data.messages.answer.structured_payload.grounding).toMatchObject({
      engine: 'perplexity-sonar', status: 'grounded',
      sources: [{ url: 'https://labour.law/26', title: '근로기준법 제26조' }],
    });
  });

  it('일반 카테고리는 검색을 호출하지 않는다 (종량제 비용 게이트)', async () => {
    await supabaseAdmin.from('personas').update({ name: '일정 비서' }).eq('id', personaId);
    vi.spyOn(perplexity, 'searchGrounding').mockResolvedValue(groundedResult as any);
    vi.spyOn(perplexity, 'isPerplexityConfigured').mockReturnValue(true);
    const data = await sendMessage('오늘 일정 정리해줘');
    expect(perplexity.searchGrounding).not.toHaveBeenCalled();
    expect(data.grounding).toBeNull();
  });

  it('검색 실패 시 "검색 기반 아님" 정직 표기가 답변에 붙는다', async () => {
    vi.spyOn(perplexity, 'isPerplexityConfigured').mockReturnValue(true);
    vi.spyOn(perplexity, 'searchGrounding').mockResolvedValue({ ...groundedResult, status: 'failed', findings: null, sources: [], reason: 'RATE_LIMITED' } as any);
    const data = await sendMessage('계약서 특약 효력은?');
    expect(data.grounding).toMatchObject({ status: 'failed', reason: 'RATE_LIMITED' });
    expect(data.answer_response).toContain(GROUNDING_NOTES.UNAVAILABLE.ko);
    expect(data.answer_response).toContain(DISCLAIMERS.legal.ko);
  });

  it('메인 LLM 장애 + 검색 성공 → 무근거 템플릿 대신 Sonar 근거 자체가 답변이 된다', async () => {
    vi.spyOn(perplexity, 'isPerplexityConfigured').mockReturnValue(true);
    vi.spyOn(perplexity, 'searchGrounding').mockResolvedValue(groundedResult as any);
    const { LlmError } = await import('../../src/lib/llm');
    vi.spyOn(llm, 'chatCompletion').mockRejectedValue(new LlmError('LLM_RATE_LIMITED', 'down'));
    const data = await sendMessage('산재 승인 기준이 어떻게 되나요?');
    expect(data.answer_response).toContain('해고예고 위반 시 30일분 통상임금');
    expect(data.answer_response).toContain('https://labour.law/26');
    expect(data.llm.fallback).toBe(true);
    expect(data.grounding?.status).toBe('grounded');
  });
});
