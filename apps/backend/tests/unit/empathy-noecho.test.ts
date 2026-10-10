/**
 * 공감 재질문 복창 차단 회귀 (t_51f9fd01, 대표님 10/10 스크린샷 판정)
 *
 * "대답이 뭐 이거 맞죠야. 니가 분석해서 ~하는 거죠? 이렇게 보내"
 *  A. 규칙 폴백 풀: 어떤 ko/en 문구도 '이거 맞' 접두 복창 서식이 아니다 — 전부
 *     분석형 재해석 의문문으로 재설계 (eq_confirm 원서식 '이거 맞죠? {요약}' 폐기).
 *  B. LLM 출력 게이트(parseEmpathyRequest): '이거 맞…' 혼합/접두 출력 reject,
 *     발화 대비 textSimilarity ≥ 0.8(재귀 생성 판정과 동일 임계) 에코 reject —
 *     둘 다 null → 호출부가 규칙 폴백(비복창 풀)으로 내린다.
 *  C. E2E(LLM ON, 에코 출력): 화면에 나가는 empathy content는 규칙 폴백 문장이지
 *     '이거 맞죠? …'가 아니며, 발화 0.8+ 복창도 아니다.
 * 봉인 환경(HUMAN_TYPING=false/EMPATHY_REQUEST_LLM=false) 위에서 spyOn으로 켠다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn } from '../../src/lib/chatTurn';
import { parseEmpathyRequest } from '../../src/lib/empathyRequest';
import { textSimilarity } from '../../src/lib/textSimilarity';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';
import { EMPATHY_REQUESTION_TEMPLATES, buildEmpathyRequestion } from '../../src/neurons/graph';

const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  store.tables.sessions.push({ ...session });
  store.tables.personas.push({ id: 'persona', tone_config: {} });
  db = createDevClient(store) as DbClient;
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('A. 규칙 폴백 풀 비복창 봉인 (t_51f9fd01 요구3)', () => {
  it('4템플릿 어떤 ko/en에도 "이거 맞" 복창 서식 없음 — 전부 의문문, {요약} 슬롯 보존', () => {
    expect(EMPATHY_REQUESTION_TEMPLATES).toHaveLength(4);
    for (const t of EMPATHY_REQUESTION_TEMPLATES) {
      expect(t.ko).not.toMatch(/이\s*거\s*맞/);
      expect(t.en.toLowerCase()).not.toMatch(/is this right|quick check/);
      expect(t.ko).toContain('{요약}');
      expect(t.ko.endsWith('?')).toBe(true);   // 분석형 재해석 의문문 계약
      expect(t.en.trim().endsWith('?')).toBe(true);
    }
    // eq_confirm 서식 교체 실증: 대표님 폐기 지시 원문은 어디에도 없다.
    expect(EMPATHY_REQUESTION_TEMPLATES.map(t => t.ko + t.en).join()).not.toContain('이거 맞죠');
  });

  it('pool 전 템플릿 폴백 생성문이 복창 서식·0.8+ 에코 아님 (임계 안전마진)', () => {
    const utter = '오늘 아침에 뭘 하더라';
    const pool = EMPATHY_REQUESTION_TEMPLATES;
    for (const t of pool) {
      const prev = pool[(pool.indexOf(t) + pool.length - 1) % pool.length].id; // 회전상 직전 id
      const r = buildEmpathyRequestion(utter, prev, 'ko');
      expect(r.text).not.toMatch(/이\s*거\s*맞/);
      expect(textSimilarity(r.text, utter)).toBeLessThan(0.8);
      expect(r.text.endsWith('?')).toBe(true); // 폴백도 존댓말 의문문 (10/4 어미 계약 유지)
    }
  });
});

describe('B. LLM 출력 복창 게이트 (t_51f9fd01 요구1)', () => {
  const U = '오늘 아침에 뭘 하더라';

  it('"이거 맞죠?" 단독·접두·혼합 출력 전부 null(규칙 폴백 트리거)', () => {
    expect(parseEmpathyRequest('이거 맞죠?', U)).toBeNull();
    expect(parseEmpathyRequest('이거 맞죠? 오늘 아침 계획', U)).toBeNull();
    expect(parseEmpathyRequest('이거 맞죠, 아침 일정을 고민하신다는 말씀이신 건가요?', U)).toBeNull(); // 접두 혼합형
    expect(parseEmpathyRequest('"이거 맞나요?"', U)).toBeNull();
  });

  it('발화 0.8+ 에코(의문만 붙인 복창) null — 해석형(≤0.8 golden)은 통과', () => {
    // 진짜 에코형: 발화 원문 + 확인 꼬리표 → 유사도 0.8+ 실측 봉인.
    const echo = U + '라요?';
    expect(textSimilarity(echo, U)).toBeGreaterThanOrEqual(0.8);
    expect(parseEmpathyRequest(echo, U)).toBeNull();
    // 대표님 톤 요구 golden: 분석형 재해석은 통과.
    expect(parseEmpathyRequest('아침 일정을 어떻게 쓸지 고민이신 건가요?', U))
      .toBe('아침 일정을 어떻게 쓸지 고민이신 건가요?');
    // userMessage 미전달(레거시 1-인자 호출) 시 ① 게이트만 동작 — 후방호환.
    expect(parseEmpathyRequest('이거 맞죠? 트래커 확인')).toBeNull();
    expect(parseEmpathyRequest('트래커 상태가 궁금하신건가요?')).toBe('트래커 상태가 궁금하신건가요?');
  });

  it('기존 형식 계약不回退: 비의문문/빈 출력/90자 초과/null은 계속 null', () => {
    expect(parseEmpathyRequest('네 알겠습니다', U)).toBeNull();
    expect(parseEmpathyRequest('', U)).toBeNull();
    expect(parseEmpathyRequest(null, U)).toBeNull();
    expect(parseEmpathyRequest('긴'.repeat(200) + '?', U)).toBeNull();
  });
});

describe('C. E2E: LLM이 복창을 돌려도 화면은 비복창 규칙 폴백 (t_51f9fd01 요구1+2)', () => {
  /** 재질문 요청에는 항상 '이거 맞죠? …' 복창을 돌려주는 악성 LLM 모크. */
  function echoLLM(answer = '답변 본문입니다.') {
    return vi.fn(async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      if (body.stream) {
        return new Response(`data: {"model":"test-model","choices":[{"delta":{"content":${JSON.stringify(answer)}}}]}\n\ndata: [DONE]\n`);
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '이거 맞죠? 오늘 아침에 뭘 하더라' } }] }));
    });
  }

  it('empathy content는 "이거 맞" 없고 발화 0.8+ 유사 아닌 분석형 폴백 문장', async () => {
    vi.spyOn(config.empathyRequestLlm, 'enabled', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', echoLLM());
    const r = await runTextTurn(db, session, 'user', '오늘 아침에 뭘 하더라', { emit: () => undefined });
    const row = store.tables.messages.find(m => m.source_neuron === 'empathy')!;
    const p = row.structured_payload as any;
    expect(row.content).toBeTruthy();                       // 항상 재질문 존재 계약 불변
    expect(row.content).not.toMatch(/이\s*거\s*맞/);         // 폐기 서식 화면 금지
    expect(textSimilarity(row.content, '오늘 아침에 뭘 하더라')).toBeLessThan(0.8);
    expect(p.empathy_question).toBe(row.content);
    expect(p.template_id).toMatch(/^eq_/);                  // 회전 계약 불변
    expect(r.empathyMessageId).toBeTruthy();
  });

  it('early 경로(LLM 선호출)도 동일: 선노출 문장이 복창이면 규칙 폴백으로 착지', async () => {
    vi.spyOn(config.empathyRequestLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.protocol, 'empathyEarly', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', echoLLM());
    const events: any[] = [];
    await runTextTurn(db, session, 'user', '오늘 아침에 뭘 하더라', { emit: e => events.push(e) });
    const emp = events.filter(e => e.type === 'message.new' && e.message.source_neuron === 'empathy');
    expect(emp).toHaveLength(1);
    expect(emp[0].message.content).not.toMatch(/이\s*거\s*맞/);
    expect(textSimilarity(emp[0].message.content, '오늘 아침에 뭘 하더라')).toBeLessThan(0.8);
  });

  it('시스템 프롬프트에 복창형 금지 지시가 들어간다 (LLM 사전 차단)', async () => {
    vi.spyOn(config.empathyRequestLlm, 'enabled', 'get').mockReturnValue(true);
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.stream) {
        return new Response(`data: {"model":"test-model","choices":[{"delta":{"content":"답변"}}]}\n\ndata: [DONE]\n`);
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '일정을 고민하시는 건가요?' } }] }));
    }));
    await runTextTurn(db, session, 'user', '오늘 아침에 뭘 하더라', { emit: () => undefined });
    const empathyReq = calls.find(b => !b.stream && String(b.messages?.[0]?.content || '').includes('재확인 엔진'));
    expect(empathyReq).toBeTruthy();
    expect(empathyReq.messages[0].content).toContain('복창형 금지');
  });
});
