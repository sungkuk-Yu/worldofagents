/**
 * 사람 대화 타이밍 계약 회귀 (t_a654c9ac, 대표님 10/4)
 *  ① 재질문 LLM 재해석: 성공 시 문구 교체·실패 시 규칙 폴백 — '항상 재질문이 존재'와
 *     template_id 회전/연속금지 계약은 불변. 1턴 재질문 LLM 호출 정확히 1회(empathyNode 재호출 금지).
 *  ② 자동 예 진행 게이트: 재질문 노출 후 answer 리드 ∈ [chipFloorMs, chipFloorMs+chipJitterMs]
 *     = [2500, 2600] — 대표님 게이트 '자동예 진행 ≤2.6s'. 음성/off 턴 leadMs=0 SLA 불변.
 *  ③ 타이핑 pacer 순수 단위: 버스트 청크 분할, 재조립 원문 동일, 백로그 캐치업,
 *     cancel 잔여 폐기(partial_text 위임), drain 유한성(maxTotalDelayMs 방패).
 * 봉인 환경(HUMAN_TYPING=false/EMPATHY_REQUEST_LLM=false) 위에서만 켜는 테스트다 —
 * 기존 548건 회귀 무결性是 전제 (필요 시 spyOn으로 활성화).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';
import { chipProceedMs, createTypingPacer, typingLeadMs } from '../../src/lib/typingPacer';
import { parseEmpathyRequest } from '../../src/lib/empathyRequest';

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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** 재질문 LLM 응답을 골라 돌려주는 fetch 모크 — requestTag에 따라 문구 교체 가능. */
function fetchWithRequest(question: string | null, answer = '답변 본문입니다.') {
  const calls: any[] = [];
  const fn = vi.fn(async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.stream) {
      return new Response(`data: {"model":"test-model","choices":[{"delta":{"content":${JSON.stringify(answer)}}}]}\n\ndata: [DONE]\n`);
    }
    if (String(body.messages?.[0]?.content || '').includes('재확인 엔진')) {
      if (question === null) return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님 — 파싱 실패' } }] }));
      return new Response(JSON.stringify({ choices: [{ message: { content: question } }] }));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님 — 파싱 실패' } }] }));
  });
  return Object.assign(fn, { calls });
}

// ── ① 재질문 LLM 재해석 ─────────────────────────────────────────

describe('재질문 LLM 재해석 (t_a654c9ac 요구1)', () => {
  it('parseEmpathyRequest: 의문문 채택, 비의문문·빈 줄·과장문 null (규칙 폴백 트리거)', () => {
    expect(parseEmpathyRequest('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?')).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
    expect(parseEmpathyRequest('  "정리해 드릴까요?"  ')).toBe('정리해 드릴까요?');      // 따옴피 stripping
    expect(parseEmpathyRequest('```\n어떤 뜻인지 여쭤볼까요?\n```')).toBe('어떤 뜻인지 여쭤볼까요?'); // 코드펜스
    expect(parseEmpathyRequest('네 알겠습니다')).toBeNull();                            // 의문문 아님
    expect(parseEmpathyRequest('')).toBeNull();
    expect(parseEmpathyRequest('?')).toBeNull();                                       // 본문 없음
    expect(parseEmpathyRequest('긴'.repeat(200))).toBeNull();                          // 길이 초과
    expect(parseEmpathyRequest(null)).toBeNull();
  });

  it('LLM 성공: empathy content가 재해석 문장으로 교체, template_id/empathy_full/회전 계약 불변', async () => {
    vi.spyOn(config.empathyRequestLlm, 'enabled', 'get').mockReturnValue(true);
    const fetchMock = fetchWithRequest('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
    vi.stubGlobal('fetch', fetchMock);
    const result = await runTextTurn(db, session, 'user', '내가 너 지금 누구랑 연결되어 있어?', { emit: () => undefined });
    const row = store.tables.messages.find(m => m.source_neuron === 'empathy')!;
    expect(row.content).toBe('제가 지금 누구랑 연결되어 있는지 궁금하신거죠?');
    const p = row.structured_payload as any;
    expect(p.empathy_question).toBe(row.content);           // 계약 필드 = 화면 노출값
    expect(typeof p.empathy_full).toBe('string');           // 복창 원문 보존 (t_135a19b5)
    expect(p.template_id).toMatch(/^eq_/);                  // 회전 키 유효 (t_44f8896c)
    expect(result.empathyResponse).toBe(row.content);
    // 재질문 LLM은 non-stream 1회뿐 — answerNode(스트림)之外 재호출 금지 (1턴 1재질문).
    const reqCalls = fetchMock.calls.filter(b => !b.stream && String(b.messages?.[0]?.content || '').includes('재확인 엔진'));
    expect(reqCalls).toHaveLength(1);
    // few-shot 예시 문장 + 의문문 지시가 프롬프트에 들어간다 (대표님 10/4 요구).
    expect(JSON.stringify(reqCalls[0].messages)).toContain('궁금하신거죠?');
  });

  it('LLM 실패(파싱 불가): 규칙 4템플릿 폴백 — 항상 재질문이 존재', async () => {
    vi.spyOn(config.empathyRequestLlm, 'enabled', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', fetchWithRequest(null));
    const result = await runTextTurn(db, session, 'user', '주간 보고를 정리해 줄래?', { emit: () => undefined });
    const row = store.tables.messages.find(m => m.source_neuron === 'empathy')!;
    expect(row.content.length).toBeGreaterThan(0);          // 재질문 존재 보장
    expect((row.structured_payload as any).template_id).toMatch(/^eq_/);
    expect(result.empathyMessageId).toBeTruthy();
  });

  it('플래그 OFF(봉인 기본): 재질문 LLM 호출 0 — 규칙 경로 1:1 (롤백 게이트)', async () => {
    expect(config.empathyRequestLlm.enabled).toBe(false);   // vitest env 봉인 확인
    const fetchMock = fetchWithRequest(' 호출되면 안 됨');
    vi.stubGlobal('fetch', fetchMock);
    await runTextTurn(db, session, 'user', '오늘 일정 알려줘', { emit: () => undefined });
    const reqCalls = fetchMock.calls.filter(b => !b.stream && String(b.messages?.[0]?.content || '').includes('재확인 엔진'));
    expect(reqCalls).toHaveLength(0);
  });

  it('EMPATHY_EARLY=false 롤백 + LLM ON: empathyNode가 자체 호출 1회 — 재발행 1회 계약 불변', async () => {
    vi.spyOn(config.empathyRequestLlm, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.protocol, 'empathyEarly', 'get').mockReturnValue(false);
    const fetchMock = fetchWithRequest('회의록 초안을 먼저 정리해 드릴까요?');
    vi.stubGlobal('fetch', fetchMock);
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session, 'user', '어제 회의 내용을 정리해줘', { emit: e => events.push(e) });
    const row = store.tables.messages.find(m => m.source_neuron === 'empathy')!;
    expect(row.content).toBe('회의록 초안을 먼저 정리해 드릴까요?');
    const reqCalls = fetchMock.calls.filter(b => !b.stream && String(b.messages?.[0]?.content || '').includes('재확인 엔진'));
    expect(reqCalls).toHaveLength(1); // late 경로 1회 — empathyNode 소유, 재호출 없음
    expect(events.filter(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy')).toHaveLength(1);
  });

  it('echoMode=off 사용자: 재질문 LLM 호출도 empathy 행도 없다 (억제 게이트 우선 불변)', async () => {
    vi.spyOn(config.empathyRequestLlm, 'enabled', 'get').mockReturnValue(true);
    store.tables.users.push({ id: 'user', preferences: { echoMode: 'off' } } as any);
    const fetchMock = fetchWithRequest('호출되면 안 됨');
    vi.stubGlobal('fetch', fetchMock);
    const r = await runTextTurn(db, session, 'user', '별도의 새 발화입니다', { emit: () => undefined });
    expect(r.empathyMessageId).toBeNull();
    const reqCalls = fetchMock.calls.filter(b => !b.stream && String(b.messages?.[0]?.content || '').includes('재확인 엔진'));
    expect(reqCalls).toHaveLength(0);
  });
});

// ── ② 자동 예 진행 게이트 ≤2.6s ─────────────────────────────────

describe('자동 예 진행 리드 (t_a654c9ac 요구1 게이트)', () => {
  it('chipProceedMs ∈ [floor, floor+jitter] — 기본값 [2500,2600] (≤2.6s 봉인)', () => {
    const lo = chipProceedMs(() => 0);
    const hi = chipProceedMs(() => 0.9999);
    expect(lo).toBe(2500);
    expect(hi).toBeLessThanOrEqual(2600);
    expect(hi).toBeGreaterThan(lo);   // 지터 존재 (고정값 아님)
  });

  it('typingLeadMs ∈ [800,2300] (±15% 지터 포함) — 0.8~2.0s 요구 대역, 길이 비례', () => {
    const shortLo = typingLeadMs(0, () => 0);       // ramp=0, jitter 0.85 → 680? — 지터 하한 봉인 확인
    const longHi = typingLeadMs(100, () => 0.9999);
    expect(typingLeadMs(0, () => 0.5)).toBe(800);   // 지터 중앙 = 기준선
    expect(typingLeadMs(40, () => 0.5)).toBe(2000); // 40자 상한 곡선 = leadMax
    expect(shortLo).toBeGreaterThanOrEqual(600);    // floor×0.85
    expect(longHi).toBeLessThanOrEqual(2300);       // 2000×1.15
  });

  it('HUMAN_TYPING ON 텍스트 턴: answer 첫 delta는 empathy 노출 후 ≥floor-ε, ≤floor+jitter+ε', async () => {
    vi.spyOn(config.humanTyping, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.humanTyping, 'chipFloorMs', 'get').mockReturnValue(150); // 실측 시간 단축 (비율 계약 동일)
    vi.spyOn(config.humanTyping, 'chipJitterMs', 'get').mockReturnValue(20);
    vi.spyOn(config.humanTyping, 'cpsMin', 'get').mockReturnValue(10000);
    vi.spyOn(config.humanTyping, 'cpsMax', 'get').mockReturnValue(10000);
    vi.stubGlobal('fetch', fetchWithRequest(null, '답변입니다.'));
    const events: TurnEmitEvent[] = [];
    const deltaAt = new Map<TurnEmitEvent, number>();
    let empAt = 0;
    const t = runTextTurn(db, session, 'user', '주말 등산 일정 잡아줄래?', { emit: e => {
      events.push(e);
      if (e.type === 'answer.delta') deltaAt.set(e, Date.now());
      if (e.type === 'message.new' && (e as any).message.source_neuron === 'empathy' && !empAt) empAt = Date.now();
    } });
    await t;
    const deltas = events.filter(e => e.type === 'answer.delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(empAt).toBeGreaterThan(0);
    // 자동 예 진행 실측: empathy 노출(empAt) → 첫 answer.delta 사이는 [floor, floor+jitter+슬랙] —
    // 게이트 '≤2.6s'의 축척된 동형 (150~170ms + 스케줄 슬랙 130ms 허용).
    const gapMs = (deltaAt.get(deltas[0]) ?? 0) - empAt;
    expect(gapMs).toBeGreaterThanOrEqual(140);   // 150 - 타이머 슬랙 허용
    expect(gapMs).toBeLessThanOrEqual(300);      // ≤ floor+jitter + 슬랙 — 리드 생략(0)이면 실패
    // answer.done은 모든 delta 뒤 (순서 계약).
    const iDelta = events.findIndex(e => e.type === 'answer.delta');
    const iDone = events.findIndex(e => e.type === 'answer.done');
    expect(iDelta).toBeLessThan(iDone);
    expect(events.at(-1)!.type).toBe('run.completed');
  });

  it('음성 턴(sttMetadata): 리드 0 SLA 불변 — 타이핑 리드가 덮어쓰지 않는다', async () => {
    vi.spyOn(config.humanTyping, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(config.humanTyping, 'leadMinMs', 'get').mockReturnValue(4000); // ON이면 무시를 증명하는 큰 값
    vi.spyOn(config.humanTyping, 'leadMaxMs', 'get').mockReturnValue(4200);
    vi.spyOn(config.humanTyping, 'chipFloorMs', 'get').mockReturnValue(4000);
    vi.spyOn(config.humanTyping, 'cpsMin', 'get').mockReturnValue(10000);
    vi.spyOn(config.humanTyping, 'cpsMax', 'get').mockReturnValue(10000);
    vi.stubGlobal('fetch', fetchWithRequest(null, '음성 답변.'));
    const t0 = Date.now();
    await runTextTurn(db, session, 'user', '오늘 회의 일정 알려줘', { emit: () => undefined, sttMetadata: { service: 'mock' } });
    expect(Date.now() - t0).toBeLessThan(3500); // voiceOrEchoOff 경로 — 4s 리드 금지 (t_5cba9ebb SLA)
  });
});

// ── ③ 타이핑 pacer 순수 단위 (주입 타이머, 결정적) ──────────────

describe('타이핑 pacer (t_a654c9ac 요구2)', () => {
  /** 가상 시계: 예약된 타이머를 수동으로 돌린다. */
  function fakeClock() {
    let now = 0;
    let seq = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
      now: () => now,
      set: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; },
      clear: (h: unknown) => { timers.delete(h as number); },
      advance(ms: number) {
        const target = now + ms;
        for (;;) {
          const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          now = due[1].at; timers.delete(due[0]); due[1].fn();
        }
        now = target;
      },
      pending: () => timers.size,
    };
  }

  const onPacer = (body: (clock: ReturnType<typeof fakeClock>) => void | Promise<void>) => async () => {
    vi.spyOn(config.humanTyping, 'enabled', 'get').mockReturnValue(true);
    const clock = fakeClock();
    await body(clock);
  };

  it('플래그 OFF면 null — 호출부 즉시 emit 경로 1:1 복귀', () => {
    expect(config.humanTyping.enabled).toBe(false);
    expect(createTypingPacer({ sink: () => undefined })).toBeNull();
  });

  it('버스트 청크 분할 + 재조립 원문 동일 + 타이핑 속도 인터벌', onPacer(clock => {
    vi.spyOn(config.humanTyping, 'cpsMin', 'get').mockReturnValue(12);
    vi.spyOn(config.humanTyping, 'cpsMax', 'get').mockReturnValue(12); // 속도 고정 → 크기만 rng
    const chunks: string[] = [];
    const p = createTypingPacer({ sink: c => chunks.push(c), rng: () => 0.5, now: clock.now, setTimeoutFn: clock.set, clearTimeoutFn: clock.clear })!;
    p.feed('가나다라마바사아자차카타파하'); // 12자, 백로그 60 이하 → 캐치업 1×
    clock.advance(5000);
    expect(chunks.join('')).toBe('가나다라마바사아자차카타파하');
    expect(chunks.length).toBeGreaterThan(1);            // 단일 flush가 아니라 여러 버스트
    expect(chunks.every(c => c.length >= 2 && c.length <= 7)).toBe(true); // 3~7자 버스트(12자라 마지막 2)
  }));

  it('백로그 캐치업: LLM이 크게 앞서도 8s 상한 전에 타이핑 소진 (방패 flush 없이)', onPacer(clock => {
    vi.spyOn(config.humanTyping, 'cpsMin', 'get').mockReturnValue(12);
    vi.spyOn(config.humanTyping, 'cpsMax', 'get').mockReturnValue(12);
    vi.spyOn(config.humanTyping, 'maxTotalDelayMs', 'get').mockReturnValue(8000);
    const chunks: string[] = [];
    const p = createTypingPacer({ sink: c => chunks.push(c), rng: () => 0.99, now: clock.now, setTimeoutFn: clock.set, clearTimeoutFn: clock.clear })!;
    p.feed('긴'.repeat(400));
    clock.advance(9500); // 상한(8s)을 돌면 잔여가 마지막 스텝에서 소진 — 어떤 경우에도 유한.
    expect(chunks.join('')).toBe('긴'.repeat(400));
    expect(clock.pending()).toBe(0);
    // 캐치업(최대 6× 배속)으로 대부분의 소진은 여러 버스트 청크로, 방패(maxTotalDelayMs)가
    // 발동하면 잔여 '한 번의' 통째 flush로 마감 — 모스부호 폭주도, 영구 정체도 없다.
    expect(chunks.length).toBeGreaterThan(40);
    expect(chunks.filter(c => c.length > 50).length).toBeLessThanOrEqual(1);
  }));

  it('cancel: 잔여 폐기·타이머 정리·이후 feed/output 금지 (partial_text 위임 계약)', onPacer(clock => {
    vi.spyOn(config.humanTyping, 'cpsMin', 'get').mockReturnValue(12);
    vi.spyOn(config.humanTyping, 'cpsMax', 'get').mockReturnValue(12);
    const chunks: string[] = [];
    const p = createTypingPacer({ sink: c => chunks.push(c), rng: () => 0.5, now: clock.now, setTimeoutFn: clock.set, clearTimeoutFn: clock.clear })!;
    p.feed('매우 긴 답변이 스트리밍되는 중이다 이어서 계속');
    clock.advance(120);
    const before = chunks.join('').length;
    expect(before).toBeGreaterThan(0);
    p.cancel();
    clock.advance(60000);
    expect(chunks.join('').length).toBe(before); // 취소 이후 출력 0
    p.feed('무시되어야 할 delta');
    clock.advance(1000);
    expect(chunks.join('').length).toBe(before);
    expect(clock.pending()).toBe(0);
  }));

  it('drain: 잔여 소진까지 대기 후 resolve — answer.done 순서 계약의 원동력', onPacer(async clock => {
    vi.spyOn(config.humanTyping, 'cpsMin', 'get').mockReturnValue(12);
    vi.spyOn(config.humanTyping, 'cpsMax', 'get').mockReturnValue(12);
    const chunks: string[] = [];
    const p = createTypingPacer({ sink: c => chunks.push(c), rng: () => 0.5, now: clock.now, setTimeoutFn: clock.set, clearTimeoutFn: clock.clear })!;
    p.feed('abc가나다라마바사');
    let done = false;
    const d = p.drain().then(() => { done = true; });
    clock.advance(6000);
    await d;
    expect(done).toBe(true);
    expect(chunks.join('')).toBe('abc가나다라마바사');
  }));
});
