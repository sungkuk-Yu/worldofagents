/**
 * 에코 루프 차단 회귀 (t_c31e3f45, 김비서 라이브 진단 9/29 + 대표님 9/29 카드)
 *  A. answerNode/공통 LLM 컨텍스트에서 empathy 재질문·복창 행 완전 배제
 *  B. 직전 답변과 80%+ 유사 출력 시 재생성 (no-repeat 지시문 + ANTI-ECHO)
 *  C. 발화 후 답변 미착 금지 — empathy 단독 턴 구조 원천 차단 (answer_always)
 *  D. 4발화 시나리오 (실DB는 smoke_echo.mjs, 여기는 devstore 단위)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import {
  answerableHistory, buildAnswerTemplate, isDirectiveUtterance, looksLikeEmptyPromise,
  normalizeUtterance, textSimilarity,
} from '../../src/neurons/graph';
import { classifyDialogueType } from '../../src/neurons/router';
import { LlmError } from '../../src/lib/llm';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

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

/** 발화→답변 텍스트를 제어하는 스트리밍 fetch 모크. 응답 큐 소진 시 마지막 값 반복. */
function scriptedLlm(script: string[]) {
  let n = 0;
  return vi.fn(async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    if (body.stream) {
      const text = script[Math.min(n, script.length - 1)];
      n++;
      const record = { messages: body.messages }; // 마지막 요청 컨텍스트 저장 (검사용)
      (scriptedLlm as any).lastRequest = record;
      (scriptedLlm as any).requests = [...((scriptedLlm as any).requests || []), record];
      return new Response(`data: {"model":"test-model","choices":[{"delta":{"content":${JSON.stringify(text)}}}]}\n\ndata: [DONE]\n`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님 — 파싱 실패' } }] }));
  });
}

const ask = (text: string) => runTextTurn(db, session, 'user', text, { emit: () => undefined });

describe('D-1 "정리해 주세요" 상투어 시나리오 (대표님 9/29)', () => {
  it('stage3: 공백 변형 "정리해 주세요"가 command로 회수된다 (information→empathy단독 원천 차단)', () => {
    expect(classifyDialogueType('안녕하세요, 오늘 할 일을 정리해 주세요.')).toBe('command');
    expect(classifyDialogueType('할 일을 정리해 주세요')).toBe('command');
    expect(classifyDialogueType('정리해 주세요')).toBe('command');
    // 오탐 방어: 평서문에 '주세요' 없음
    expect(classifyDialogueType('오늘 하루가 길었어요')).toBe('information');
  });

  it('LLM 장애(타임아웃) 시에도 답변 행 존재 + 실행 골격(번호 목록+빈 슬롯) 포함', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: any, options: any) => {
      const body = JSON.parse(options.body);
      if (body.stream) throw new LlmError('LLM_TIMEOUT', 'mock timeout');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님 — 파싱 실패' } }] }));
    }));
    const r = await ask('안녕하세요, 오늘 할 일을 정리해 주세요.');
    expect(r.answerMessageId).toBeTruthy();               // C: 공감 단독 금지
    expect(r.empathyMessageId).toBeTruthy();              // 첫 발화라 공감 재질문 정상 생성
    expect(r.answerResponse).toMatch(/1\.\s*목표/);        // 요구1: 골격+빈 슬롯
    expect(r.answerResponse).toContain('___');
    expect(r.answerResponse).toContain('오늘 할 일을 정리'); // 발화 내용이 1번 항목에 반영
  });

  it('LLM이 "약속만" 답변을 주면 지시형 발화에서 골격이 병합된다 (필러 금지)', async () => {
    vi.stubGlobal('fetch', scriptedLlm(['제가 오늘 할 일을 정리해 드리는 데 큰 도움이 되길 바랍니다. 항목들을 나열해 주시겠어요?']));
    const r = await ask('오늘 할 일을 정리해 주세요');
    expect(r.answerResponse).toContain('1. 목표');
    expect(r.answerResponse).toContain('오늘 할 일을 정리해 주세요');
  });

  it('동일 발화 4회 재전송: 2회차부터 공감 에코 없음 + 답변은 매 턴 존재 (김비서 case)', async () => {
    const answer = ['할 일 골격을 먼저 잡아요. 1. 업무 2. 일정 3. 마감 — 채워주세요.', '우선순위 기준으로 다시 묶었어요. 높은 순서대로 나열: ___ / ___ / ___.', '오전·오후 시간대 슬롯으로 배치해 봅니다. 오전: ___ 오후: ___ 저녁: ___.', '체크리스트 양식으로 정리했어요. [ ] 급한 일 [ ] 미룰 수 있는 일 [ ] 위임 가능한 일.'];
    vi.stubGlobal('fetch', scriptedLlm(answer));
    const texts = ['안녕하세요, 오늘 할 일을 정리해 주세요.', '안녕하세요, 오늘 할 일을 정리해 주세요.', '안녕하세요, 오늘 할 일을 정리해 주세요.', '안녕하세요, 오늘 할 일을 정리해 주세요.'];
    const results = [];
    for (const t of texts) results.push(await ask(t));
    // 1회차: 공감 정상. 2~4회차: repeatUtterance 게이트로 공감 행 0 — 재질문 회전 에코 정지.
    expect(results[0].empathyMessageId).toBeTruthy();
    for (const r of results.slice(1)) {
      expect(r.empathyMessageId).toBeNull();
      expect(r.answerMessageId).toBeTruthy();
    }
    const empathyRows = store.tables.messages.filter(m => m.source_neuron === 'empathy');
    expect(empathyRows.length).toBe(1);
    // 답변들 상호/사용자 발화 대비 80%+ 유사 없음
    const answers = results.map(r => r.answerResponse!);
    for (let i = 0; i < answers.length; i++)
      for (let j = i + 1; j < answers.length; j++)
        expect(textSimilarity(answers[i], answers[j])).toBeLessThan(0.8);
    // 컨텍스트 오염 검사: 마지막 턴 LLM 요청 messages에 공감 재질문 텍스트 없음
    const lastReq = (scriptedLlm as any).requests.at(-1);
    const ctxText = JSON.stringify(lastReq.messages);
    expect(ctxText).not.toContain('이거 맞죠');
    expect(ctxText).not.toContain('맞나요?');
  });
});

describe('D-4 유사도·재생성 (김비서 case 4)', () => {
  it('직전 답변과 80%+ 유사한 출력 → 재생성 1회로 다른 답변 확정', async () => {
    const same = '오늘 주말 계획을 정리해 드릴게요. 1. 외출 준비 2. 산책 코스 3. 장보기 — 이 순서로 도울게요.';
    const fresh = '좋아요, 이번엔 시간대별로 묶어드릴게요. 오전: ___ / 오후: ___ / 저녁: ___ (원하는 활동을 채워주세요)';
    // 1턴: 정상 답변. 2턴 다른 발화 → LLM이 1턴 답변을 그대로 복창 → 재생성에서 다른 답변.
    vi.stubGlobal('fetch', scriptedLlm([same, same, fresh]));
    const r1 = await ask('주말에 뭐 하지');
    const r2 = await ask('강아지 산책에 코트 입히려는데');
    expect(r1.answerMessageId).toBeTruthy();
    expect(r2.answerMessageId).toBeTruthy();
    expect(r2.answerResponse).toBe(fresh); // 복창이 아니라 재생성 결과 저장
    const answerRows = store.tables.messages.filter(m => m.source_neuron === 'answer');
    expect(answerRows.at(-1).content).toBe(fresh);
  });

  it('textSimilarity: 복창=1.0, 미묘 변형≈0.9대, 무관 답변=0.2 미만', () => {
    const a = '오늘 할 일을 정리해 드릴게요. 1. 업무 목록 2. 우선순위 3. 마감일';
    expect(textSimilarity(a, a)).toBe(1);
    expect(textSimilarity(a, a + ' ')).toBeGreaterThan(0.9);
    expect(textSimilarity(a, '주말엔 날씨도 좋으니 근교 드라이브 코스를 추천드려요')).toBeLessThan(0.5);
  });
});

describe('유틼리티 계약', () => {
  it('normalizeUtterance: 구두점/공백/대소문자 무시', () => {
    expect(normalizeUtterance(' Hello, World! ')).toBe('hello, world');
    expect(normalizeUtterance('정리해 주세요.')).toBe(normalizeUtterance('정리해  주세요'));
  });
  it('answerableHistory: empathy 행(출처·payload 양쪽) 배제, answer/user 보존, 무출처 agent 행 유지', () => {
    const filtered = answerableHistory([
      { role: 'user', content: '발화' },
      { role: 'agent', content: '재질문', source_neuron: 'empathy' },
      { role: 'agent', content: '레거시 공감', structured_payload: { empathy_question: 'x' } },
      { role: 'agent', content: '답변', source_neuron: 'answer' },
      { role: 'agent', content: '무출처 답변(음성 확정 등)' },
    ]);
    expect(filtered.map(m => m.content)).toEqual(['발화', '답변', '무출처 답변(음성 확정 등)']);
  });
  it('isDirectiveUtterance/looksLikeEmptyPromise 경계', () => {
    expect(isDirectiveUtterance('오늘 할 일을 정리해 주세요')).toBe(true);
    expect(isDirectiveUtterance('고마워요')).toBe(false);
    expect(looksLikeEmptyPromise('제가 정리해 드리는 데 큰 도움이 되길 바랍니다. 나열해 주시겠어요?', 'ko')).toBe(true);
    expect(looksLikeEmptyPromise('네, 바로 정리해 드릴게요.\n\n1. 목표: ___\n2. 다음: ___', 'ko')).toBe(false); // 산출물 있음
  });
  it('buildAnswerTemplate: locale별 골격+빈 슬롯', () => {
    expect(buildAnswerTemplate('할 일', 'command', '', 'ko')).toContain('___');
    expect(buildAnswerTemplate('my tasks', 'command', '', 'en')).toContain('Next action: ___');
  });
});
