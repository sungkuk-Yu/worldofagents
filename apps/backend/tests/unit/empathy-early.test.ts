/**
 * 공감 재질문 선(先)영속·선노출 회귀 (t_f46d1d7a, 김비서 9/29 라이브 flake 판정)
 *
 * flake의 실체는 생성 비결정성이 아니라 **노출 시점**이었다 (라이브 DB read-back:
 * 발화→empathy 행 착지가 답변 LLM/브리지 지연과 같은 초에 일어나 15s~186스로 편차,
 * 프론트 예/아니오 칩 창은 발화 후 2.5s 고정 → B/C/F 구간이 갈림). 봉인 계약:
 *  1. message.new(empathy)가 답변 LLM fetch **이전**에 발행 — 칩 창이 답변 지연과 무관.
 *  2. 순서: message.new(user) < message.new(empathy) < answer.delta ≤ answer.done < run.completed.
 *  3. 같은 empathy id의 message.new는 런당 정확히 1회 (선발행 + post-loop 재발행 억제).
 *  4. 재질문 생성 결정성: 같은 발화 → 같은 문장·같은 template_id, 회전 시드는 pool 규칙.
 *  5. EMPATHY_EARLY=false 롤백: 구동작(LLM 이후 배치 발행)으로 1:1 복귀.
 *  6. 기본값 ON (t_fa37420e 9/30, frontdev A/B 재측 게이트 충족): 플래그 미설정 시
 *     early 경로. 옵트아웃(=false)에만 구동작.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { buildEmpathyRequestion, EMPATHY_REQUESTION_TEMPLATES } from '../../src/neurons/graph';
import { SessionsRow } from '../../src/types/db';
import { DbClient } from '../../src/lib/supabase';

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
  // 기본 ON(t_fa37420e 9/30 전환): early 경로가 기본값 — 스파이는 계약 고정용(거동 무관 동일값).
  // 옵트아웃(EMPATHY_EARLY=false) 롤백 경로는 아래 명시적 mockReturnValue(false) 테스트가 봉쇄.
  vi.spyOn(config.protocol, 'empathyEarly', 'get').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 스트리밍 답변 fetch 모크 — 호출 시점의 emit 이벤트를 기록해 선행 계약을 검증한다. */
function llmWithProbe(answer: string, probe: () => void) {
  return vi.fn(async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    if (body.stream) {
      probe();
      return new Response(`data: {"model":"test-model","choices":[{"delta":{"content":${JSON.stringify(answer)}}}]}\n\ndata: [DONE]\n`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님 — 파싱 실패' } }] }));
  });
}

describe('선발행 계약 (flake 교정 핵심)', () => {
  it('message.new(empathy)가 답변 LLM fetch 이전에 발행돼 있다 (칩 창=발화 직후)', async () => {
    const events: TurnEmitEvent[] = [];
    let userCardSeen = false, empathyCardSeen = false;
    const fetchMock = llmWithProbe('네, 주말 등산 일정 잡아드릴게요.', () => {
      userCardSeen = events.some(e => e.type === 'message.new' && e.message.role === 'user');
      empathyCardSeen = events.some(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy');
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await runTextTurn(db, session, 'user', '주말 등산 일정 잡아줄래?', { emit: e => events.push(e) });
    expect(userCardSeen).toBe(true);        // user 카드는 이미 선emit (t_3486b1d7 ⑤)
    expect(empathyCardSeen).toBe(true);     // 공감 카드도 LLM 시작 전 — 9/29 flake의 직접 교정
    expect(result.empathyMessageId).toBeTruthy();
  });

  it('순서 봉인: user < empathy(message.new) < answer.delta < answer.done < run.completed, empathy 발행 정확히 1회', async () => {
    const events: TurnEmitEvent[] = [];
    vi.stubGlobal('fetch', llmWithProbe('답변 본문입니다.', () => undefined));
    const result = await runTextTurn(db, session, 'user', '내일 아침 리마인더 걸어줘', { emit: e => events.push(e) });
    const seq = events.map(e => e.type);
    const idx = (pred: (e: TurnEmitEvent) => boolean) => events.findIndex(pred);
    const iUser = idx(e => e.type === 'message.new' && e.message.role === 'user');
    const iEmp = idx(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy');
    const iDelta = idx(e => e.type === 'answer.delta');
    const iDone = idx(e => e.type === 'answer.done');
    const iRunDone = idx(e => e.type === 'run.completed');
    expect(iUser).toBeGreaterThanOrEqual(0);
    expect(iUser).toBeLessThan(iEmp);
    expect(iEmp).toBeLessThan(iDelta);
    expect(iDelta).toBeLessThan(iDone);
    expect(iRunDone).toBe(events.length - 1);
    // 재발행 억제: 같은 empathy id message.new 정확히 1회 (post-loop 생략) + 행 1개.
    const empEvents = events.filter(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy');
    expect(empEvents).toHaveLength(1);
    expect(empEvents[0].message.id).toBe(result.empathyMessageId);
    expect(store.tables.messages.filter(m => m.source_neuron === 'empathy')).toHaveLength(1);
    // 선발행 페이로드 = 최종 계약 페이로드 (empathy_* payload 보존, t_44f8896c).
    expect((empEvents[0].message as any).structured_payload.empathy_question).toBe(result.empathyResponse);
    expect((empEvents[0].message as any).message_ids === undefined).toBe(true);
  });

  it('EMPATHY_EARLY=false 롤백: empathy 발행이 답변 LLM 이후(구동작)로 복귀', async () => {
    vi.spyOn(config.protocol, 'empathyEarly', 'get').mockReturnValue(false);
    const events: TurnEmitEvent[] = [];
    let empathySeenAtFetch = false;
    vi.stubGlobal('fetch', llmWithProbe('롤백 경로 답변.', () => {
      empathySeenAtFetch = events.some(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy');
    }));
    const result = await runTextTurn(db, session, 'user', '주간 보고 정리해줄래?', { emit: e => events.push(e) });
    expect(empathySeenAtFetch).toBe(false);          // 구동작: LLM 전에 empathy 카드 없음
    const iEmp = events.findIndex(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy');
    const iDelta = events.findIndex(e => e.type === 'answer.delta');
    expect(iEmp).toBeGreaterThan(iDelta);            // 배치 발행(run 종료 후)으로 복귀
    expect(events.filter(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy')).toHaveLength(1);
    expect(result.empathyMessageId).toBeTruthy();
  });
});

describe('기본값 ON 전환 (t_fa37420e 9/30 — 옵트아웃만 구동작)', () => {
  // config는 모듈 로드 시점에 process.env를 읽는다. 정적 config 바인딩은 beforeEach에서
  // 'get' 스파이가 깔려 있어(데이터 속성 스파이 복원 시 속성이 날아가는 vitest 1.6 규약)
  // 실제 기본값 증명은 resetModules + importActual로 새 인스턴스를 로드해서 한다.
  const loadFresh = async (envValue?: string) => {
    const saved = process.env.EMPATHY_EARLY;
    if (envValue === undefined) delete process.env.EMPATHY_EARLY;
    else process.env.EMPATHY_EARLY = envValue;
    try {
      vi.resetModules();
      const mod = await vi.importActual<typeof import('../../src/config')>('../../src/config');
      return mod.config.protocol.empathyEarly;
    } finally {
      if (saved === undefined) delete process.env.EMPATHY_EARLY;
      else process.env.EMPATHY_EARLY = saved;
      vi.resetModules();
    }
  };

  it('EMPATHY_EARLY 미설정(플래그 없음) → 기본 true (early 경로가 기본값)', async () => {
    expect(await loadFresh(undefined)).toBe(true);
  });

  it('EMPATHY_EARLY=true 하위호환 / 이상값도 ON 방향, 옵트아웃은 문자열 false 유일', async () => {
    expect(await loadFresh('true')).toBe(true);     // 기존 옵트인값 동작 불변
    expect(await loadFresh('garbage')).toBe(true);  // 오타 플래그는 새 계약(ON) 방향 유지
    expect(await loadFresh('false')).toBe(false);   // EMPATHY_EARLY=false 만이 유일한 롤백
  });

  // 참고: loadFresh의 resetModules는 이후 동적 import만 영향 — 파일 상단 정적 import 바인딩은
  // 원본 인스턴스를 유지하므로 후속 테스트(beforeEach 스파이 대상)와 무충돌.
});

describe('재질문 생성 결정성 (김비서 ① 판정 봉인)', () => {
  it('같은 발화 → 같은 재질문 문장·같은 template_id (시드 없음 = 해시 결정적)', () => {
    const a = buildEmpathyRequestion('주말 등산 일정 잡아줄래?', null, 'ko');
    const b = buildEmpathyRequestion('주말 등산 일정 잡아줄래?', null, 'ko');
    expect(a).toEqual(b);
    const pool = EMPATHY_REQUESTION_TEMPLATES;
    expect(pool.map(t => t.id)).toContain(a.templateId);
    expect(a.text).toContain('주말 등산 일정 잡아줄래'); // {요약} = 발화 키워드, LLM 무경유
  });

  it('회전 시드: 직전 template_id 다음 순서 확정 + 연속 재사용 금지', () => {
    const pool = EMPATHY_REQUESTION_TEMPLATES.map(t => t.id);
    for (let i = 0; i < pool.length; i++) {
      const r = buildEmpathyRequestion('그거 좀 정리해줘', pool[i], 'ko');
      expect(r.templateId).toBe(pool[(i + 1) % pool.length]); // prev+1 확정 회전 (pool 밖 아님)
    }
    // pool 밖 시드는 해시 폴백이되 prev와 겹치지 않는다.
    const r = buildEmpathyRequestion('그거 좀 정리해줘', 'eq_unknown', 'ko');
    expect(r.templateId).not.toBe('eq_unknown');
    expect(pool).toContain(r.templateId);
  });

  it('재질문 보장 발화 집합 (t_888c1669 전달): 텍스트+비확인+비재전송+echoMode on → empathy 1행, 음성/확인/재전송/off → 0행', async () => {
    vi.stubGlobal('fetch', llmWithProbe('네, 처리했어요.', () => undefined));
    // 보장: 일반 텍스트 신규 발화
    const ok = await runTextTurn(db, session, 'user', '주말 등산 일정 잡아줄래?', { emit: () => undefined });
    expect(ok.empathyMessageId).toBeTruthy();
    // 억제 ③: 짧은 확인 발화 + 직전 empathy 체인 (t_135a19b5) — ok의 [u,emp,a]가 최신 3행
    const confirm = await runTextTurn(db, session, 'user', '예', { emit: () => undefined });
    expect(confirm.empathyMessageId).toBeNull();
    expect(confirm.answerMessageId).toBeTruthy(); // 침묵 금지 — 답은 계속 온다
    // 보장+억제: 동일 발화 재전송 (t_c31e3f45) — 1회차 empathy, 2회차부터 repeat 게이트
    const r1 = await runTextTurn(db, session, 'user', '내일 아침 리마인더 걸어줘', { emit: () => undefined });
    expect(r1.empathyMessageId).toBeTruthy();
    const r2 = await runTextTurn(db, session, 'user', '내일 아침 리마인더 걸어줘', { emit: () => undefined });
    expect(r2.empathyMessageId).toBeNull();
    // 억제 ①: 음성 턴 (#325 — 전사 즉시 답변)
    const voice = await runTextTurn(db, session, 'user', '오늘 회의 일정 알려줘', { emit: () => undefined, sttMetadata: { service: 'mock' } });
    expect(voice.empathyMessageId).toBeNull();
    // 억제 ④: echoMode off (t_95ac521b)
    store.tables.users.push({ id: 'user', preferences: { echoMode: 'off' } } as any);
    const off = await runTextTurn(db, session, 'user', '별도 새 발화 테스트', { emit: () => undefined });
    expect(off.empathyMessageId).toBeNull();
    expect(off.answerMessageId).toBeTruthy();
  });
});
