/**
 * t_45256c7a [한글 문법①-백] — 어문 규칙 프롬프트 + 나라맞춤법(PNU) 후처리 게이트 계약.
 *  ① parseSpellerResponse: speller-api 규격(suggestions/candidates[])과 신엔드 errInfo(candWord 'a|b') 흡수
 *  ② applySuggestions: 첫 후보만 adopt·오프셋 역순·text 불일치 항목 스킵(과교정/엉뚱 교체 방지)
 *  ③ applyNaraSpeller: 미구성/실패/타임아웃/빈 제안 → null(원문 유지). 절대 throw 금지.
 *  ④ answerNode 게이트: ko 답변 확정 텍스트 교정 → answer.done·messages.answer.content·
 *     structured_payload.orthography 계약. 봉인 환경(미구성)에서는 speller fetch 0회.
 *  ⑤ 브리지(t_620d5549) 원문 저장 계약 — 후처리 면제.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import {
  applyNaraSpeller, applySuggestions, orthographyRules, parseSpellerResponse,
} from '../../src/lib/koreanOrthography';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const SPELLER_URL = 'https://speller.test/check';
const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  store.tables.sessions.push({ ...session });
  store.tables.personas.push({ id: 'persona', tone_config: {} });
  db = createDevClient(store) as DbClient;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('① 파서 — 두 상류 규격 흡수', () => {
  it('speller-api 규격(suggestions, candidates 배열)을 정규화한다', () => {
    const out = parseSpellerResponse({
      suggestions: [
        { description: '조사가 바르지 않습니다.', start: 4, end: 10, text: '이해오 했', candidates: ['이해도 했', '이해와 했'] },
        { start: 20, end: 24, text: '되는', candidates: ['되는'] },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out![0].candidates[0]).toBe('이해도 했');
  });
  it('nara /api/check errInfo 규격(candWord 문자열)을 흡수한다 — 9/30 실측 응답 형태', () => {
    const out = parseSpellerResponse({
      str: 'x',
      errInfo: [
        { errorIdx: 0, correctMethod: 2, start: 4, end: 11, orgStr: '이해오 했으니', candWord: '이해도 했으니|이해와 했으니', help: '조사가 바르지 않습니다.' },
        { errorIdx: 1, start: 16, end: 23, orgStr: '정리해드릴게요', candWord: '정리해 드릴게요' },
        { errorIdx: 2, start: 1, end: 2, orgStr: 'x', candWord: '' },
      ],
    });
    expect(out).toHaveLength(2); // candWord 빈 항목 = 후보 없음 → 제외
    expect(out![0].text).toBe('이해오 했으니');
    expect(out![0].candidates).toEqual(['이해도 했으니', '이해와 했으니']);
  });
  it('모양이 엉성하면 null (턴에 영향 금지)', () => {
    expect(parseSpellerResponse({})).toBeNull();
    expect(parseSpellerResponse({ suggestions: 'no' })).toBeNull();
    expect(parseSpellerResponse(null)).toBeNull();
  });
});

describe('② applySuggestions — 첫 후보만, 역순, 방어적', () => {
  const base = '김비서 이해오 했으니 보고서 정리해드릴게요';
  it('첫 후보만 adopt하고 역순 적용으로 앞 항목 오프셋을 보존한다', () => {
    const { corrected, adopted } = applySuggestions(base, [
      { start: 4, end: 11, text: '이해오 했으니', candidates: ['이해도 했으니', '이해와 했으니'] },
      { start: 16, end: 23, text: '정리해드릴게요', candidates: ['정리해 드릴게요'] },
    ]);
    expect(adopted).toBe(2);
    expect(corrected).toBe('김비서 이해도 했으니 보고서 정리해 드릴게요');
  });
  it('text가 오프셋 슬라이스와 불일치하면 그 항목을 건너뛴다 (경합/모킹 안전판)', () => {
    const { corrected, adopted } = applySuggestions(base, [
      { start: 4, end: 10, text: '완전다른문자', candidates: ['X'] },
      { start: 16, end: 23, text: '정리해드릴게요', candidates: ['정리해 드릴게요'] },
    ]);
    expect(adopted).toBe(1);
    expect(corrected).toBe('김비서 이해오 했으니 보고서 정리해 드릴게요');
  });
  it('후보가 원문과 같거나 빈 문자열이면 교체하지 않는다', () => {
    expect(applySuggestions(base, [{ start: 4, end: 7, text: '이해오', candidates: ['이해오'] }]).adopted).toBe(0);
    expect(applySuggestions(base, [{ start: 4, end: 7, text: '이해오', candidates: ['  '] }]).adopted).toBe(0);
  });
});

describe('③ applyNaraSpeller — 실패는 원문, 절대 throw 금지', () => {
  // timeoutMs는 여기서 spy하지 않는다 — 인자 없는 config 실값(2500) 사용. 타임아웃 테스트가
  // 같은 프로퍼티를 이중 spy하면 vitest restore 역순으로 이후 테스트가 undefined를 읽는다(9/30 함정).
  beforeEach(() => {
    vi.spyOn(config.naraSpeller, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.naraSpeller, 'url', 'get').mockReturnValue(SPELLER_URL);
  });
  it('미구성(enabled=false)이면 fetch를 호출하지 않고 null', async () => {
    vi.spyOn(config.naraSpeller, 'enabled', 'get').mockReturnValue(false);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await applyNaraSpeller('이해오 했어요')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('suggestions[0] 우선 교정본을 반환한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      suggestions: [{ start: 0, end: 3, text: '이해오', candidates: ['이해도', '이해와'] }],
    }))));
    const r = await applyNaraSpeller('이해오 했어요');
    expect(r?.text).toBe('이해도 했어요');
    expect(r?.suggestions).toHaveLength(1);
  });
  it('오류 없음(빈 배열)·비200·HTML(봇월)·던지는 fetch 모두 null (원문 유지)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ suggestions: [] }))));
    expect(await applyNaraSpeller('괜찮은 문장이에요')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    expect(await applyNaraSpeller('이해오 했어요')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Cloudflare challenge</html>')));
    expect(await applyNaraSpeller('이해오 했어요')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    expect(await applyNaraSpeller('이해오 했어요')).toBeNull();
  });
  it('타임아웃 시 null — 대기하지 않는다', async () => {
    vi.spyOn(config.naraSpeller, 'timeoutMs', 'get').mockReturnValue(20);
    vi.stubGlobal('fetch', vi.fn((_url: any, opts: any) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new Error('aborted')));
    })));
    expect(await applyNaraSpeller('이해오 했어요')).toBeNull();
  });
});

describe('④ answerNode 게이트 + 어문 규칙', () => {
  it('orthographyRules: ko에만 주입, en은 빈 문자열', () => {
    expect(orthographyRules('ko')).toContain('[ORTHOS]');
    expect(orthographyRules('ko')).toContain('이해도');
    expect(orthographyRules('en')).toBe('');
  });

  it('봉인 상태(미구성)의 ko 턴은 speller fetch 없이 원문 확정 — 기존 계약 1:1', async () => {
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    const f = vi.fn(async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      if (body.stream) return new Response('data: {"model":"test-model","choices":[{"delta":{"content":"이해오 했어요"}}]}\n\ndata: [DONE]\n');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님 — 파싱 실패' } }] }));
    });
    vi.stubGlobal('fetch', f);
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '정리해줘', { locale: 'ko', emit: e => events.push(e) });
    expect(f.mock.calls.filter(c => String(c[0]).includes('speller') || String(c[0]).includes('nara'))).toHaveLength(0);
    expect(result.answerResponse).toBe('이해오 했어요'); // 미구성은 원문 유지(现状 불변)
    const done = events.find(e => e.type === 'answer.done') as any;
    expect(done.text).toBe(result.answerResponse);
    expect(store.tables.messages.find(m => m.source_neuron === 'answer')?.content).toBe(result.answerResponse);
  });

  it('게이트 ON: 확정 답변·answer.done·저장 행·structured_payload.orthography가 교정본으로 일치', async () => {
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    vi.spyOn(config.naraSpeller, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.naraSpeller, 'url', 'get').mockReturnValue(SPELLER_URL);
    const f = vi.fn(async (url: any, options: any) => {
      if (String(url) === SPELLER_URL) {
        return new Response(JSON.stringify({
          suggestions: [{ start: 0, end: 4, text: '이해오 ', candidates: ['이해도 '] }],
        }));
      }
      const body = JSON.parse(options.body);
      if (body.stream) return new Response('data: {"model":"test-model","choices":[{"delta":{"content":"이해오 했어요"}}]}\n\ndata: [DONE]\n');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님' } }] }));
    });
    vi.stubGlobal('fetch', f);
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '보고서 어때', { locale: 'ko', emit: e => events.push(e) });
    const spellerCalls = f.mock.calls.filter(c => String(c[0]) === SPELLER_URL);
    expect(spellerCalls).toHaveLength(1);
    expect((spellerCalls[0][1] as any).method).toBe('POST');
    expect(JSON.parse((spellerCalls[0][1] as any).body).text).toBe('이해오 했어요'); // 교정 대상 = 원문(스트림과 동일 소스)
    expect(result.answerResponse).toBe('이해도 했어요');
    const done = events.find(e => e.type === 'answer.done') as any;
    expect(done.text).toBe('이해도 했어요'); // 프론트 카드 교체본 = 교정본 (reduceStreams done.text 확정)
    const row = store.tables.messages.find(m => m.source_neuron === 'answer');
    expect(row?.content).toBe('이해도 했어요');
    expect((row?.structured_payload as any).orthography).toMatchObject({ corrected: true, count: 1, items: [{ from: '이해오 ', to: '이해도 ' }] });
    // run.completed는 여전히 마지막 (phase2-contract 불변).
    expect(events.at(-1)!.type).toBe('run.completed');
  });

  it('en 턴은 speller 미호출 (게이트 ko 전용)', async () => {
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    vi.spyOn(config.naraSpeller, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.naraSpeller, 'url', 'get').mockReturnValue(SPELLER_URL);
    const f = vi.fn(async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      if (body.stream) return new Response('data: {"model":"test-model","choices":[{"delta":{"content":"Noted."}}]}\n\ndata: [DONE]\n');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'no' } }] }));
    });
    vi.stubGlobal('fetch', f);
    await runTextTurn(db, session, 'user', 'summarize it', { locale: 'en', emit: () => undefined });
    expect(f.mock.calls.filter(c => String(c[0]) === SPELLER_URL)).toHaveLength(0);
  });
});

describe('⑤ 김비서 브리지 원문 — 후처리 면제 (t_620d5549 계약)', () => {
  it('브리지 답변은 speller 미경유, 원문 그대로 저장', async () => {
    // devstore 기본 'agent'는 이름 '김비서' — 브리지 매칭은 이름 기준(secretary-bridge-turn 관례).
    const kim = store.tables.agents.find(a => a.id === 'agent');
    if (!kim || kim.name !== '김비서') store.tables.agents.push({ id: 'agent', name: '김비서' });
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
    vi.spyOn(config.naraSpeller, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.naraSpeller, 'url', 'get').mockReturnValue(SPELLER_URL);
    vi.spyOn(config.secretaryBridge, 'endpoint', 'get').mockReturnValue('http://127.0.0.1:9902');
    vi.spyOn(config.secretaryBridge, 'timeoutMs', 'get').mockReturnValue(5000);
    vi.spyOn(config.secretaryBridge, 'maxTurns', 'get').mockReturnValue(15);
    const reply = '이해오 했어요 (브리지 원문)';
    const f = vi.fn(async (url: any) => {
      if (String(url).includes('127.0.0.1')) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0', id: 'x',
          result: {
            id: 'task-1', contextId: 'ctx-1',
            status: { state: 'TASK_STATE_COMPLETED', message: { role: 'ROLE_AGENT', parts: [{ text: reply }] } },
            artifacts: [{ artifactId: 'a', parts: [{ text: reply }] }],
          },
        }));
      }
      return new Response(JSON.stringify({ suggestions: [{ start: 0, end: 3, text: '이해오', candidates: ['이해도'] }] }));
    });
    vi.stubGlobal('fetch', f);
    const result = await runTextTurn(db, session, 'user', '이해오 맞지?', { locale: 'ko', emit: () => undefined });
    expect(result.llm.provider).toBe('secretary-bridge');
    expect(result.answerResponse).toContain('브리지 원문'); // 교정되지 않은 원문
    expect(result.answerResponse).not.toContain('이해도');
    expect(f.mock.calls.filter(c => String(c[0]) === SPELLER_URL)).toHaveLength(0);
  });
});
