/**
 * 공감(echo) 모드 off 선호 회귀 (t_95ac521b, 대표님 9/29 지시)
 *  users.preferences.echoMode==='off' → empathy 미생성(행·message.new·empathy_response 없음),
 *  예/아니오 칩 소스인 공감 카드 부재, answerLeadMs 리드 지연 0(t_5cba9ebb 음성 선례 동일),
 *  답변 직결·answer_always 불변. 기본/미설정/그 외 값은 'on' = 기존 동작 1:1.
 * 저장 경로 = PATCH /me 딥 머지(t_d75ca81c) 재사용 — 게이트가 'off' 문자열만 인정하므로
 *  임의 값은 사실상 on(무시)이고 prefs.test의 딥머지 계약이 이미 키 보존을 보증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
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

function llmFetch() {
  return vi.fn(async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    if (body.stream) {
      return new Response('data: {"model":"test-model","choices":[{"delta":{"content":"답변 본문"}}]}\n\ndata: [DONE]\n');
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님 — 파싱 실패' } }] }));
  });
}

/** users.pref_user 행에 preferences 주입 (그 외 userId는 행 없음 = 'on' 강등 경로). */
function setEchoMode(prefs: Record<string, unknown>) {
  store.tables.users.push({ id: 'user', display_name: 'u', preferences: prefs, profile: {} });
}

describe('off 선호: empathy 미생성 + 답변 직결', () => {
  it('echoMode=off 텍스트 턴: 공감 행 0·empathy message.new 없음·empathyResponse null·answer 존재', async () => {
    vi.stubGlobal('fetch', llmFetch());
    setEchoMode({ echoMode: 'off' });
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '오늘 할 일을 정리해줘', { emit: e => events.push(e) });

    expect(store.tables.messages.filter(m => m.source_neuron === 'empathy').length).toBe(0);
    expect(result.empathyMessageId).toBeNull();
    expect(result.empathyResponse).toBeNull();
    expect(result.messages.empathy).toBeNull();
    expect(events.some(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy')).toBe(false);
    // 답변 직결 — 침묵 금지(answer_always) 불변.
    expect(result.answerMessageId).toBeTruthy();
    expect(result.answerResponse).toBe('답변 본문');
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', message_ids: { empathy: null } });
    // user·answer 행은 정상 (turn_index 인접 — empathy 슬롯 비어있음).
    const turns = store.tables.messages.filter(m => m.role === 'user' || m.source_neuron === 'answer').map(m => m.turn_index);
    expect(Math.max(...turns) - Math.min(...turns)).toBe(1);
  });

  it('off면 run.started 후 thinking ack 진행도와 무관하게 empathy 뉴런 이벤트가 없다', async () => {
    vi.stubGlobal('fetch', llmFetch());
    setEchoMode({ echoMode: 'off' });
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session, 'user', '회의록 초안 만들어줘', { emit: e => events.push(e) });
    expect(events.some(e => e.type === 'neuron.status' && (e as any).neuron.slug === 'empathy')).toBe(false);
  });

  it('answerLeadMs>0이어도 off면 리드 지연 없이 answer 첫 토큰 직진 (t_5cba9ebb 음성 선례 동일)', async () => {
    vi.stubGlobal('fetch', llmFetch());
    vi.spyOn(config, 'answerLeadMs', 'get').mockReturnValue(600);
    setEchoMode({ echoMode: 'off' });
    const t0 = Date.now();
    await runTextTurn(db, session, 'user', '날씨 어때', { emit: () => undefined });
    const offElapsed = Date.now() - t0;
    expect(offElapsed).toBeLessThan(450); // 600ms 대기는 존재할 수 없다

    // 대조: on(기본)은 리드 지연이 걸린다.
    // t_baee5c42: TTFT 예산 재산정(700→1100)으로 front desk 리드컷 기본이 400ms로
    // 내려와 600ms 리드가 컷된다 — 이 테스트의 계약('off와 달리 on은 리드가 걸림')은
    // 컷 무관하게 성립해야 하므로 SLA 상한을 리드보다 크게 고정(1500-200=컷1300).
    store.tables.users.length = 0;
    vi.spyOn(config.protocol, 'frontDeskFirstTokenMs', 'get').mockReturnValue(2000);
    vi.spyOn(config.protocol, 'frontDeskTtftBudgetMs', 'get').mockReturnValue(200);
    const t1 = Date.now();
    await runTextTurn(db, session, 'user', '날씨 어때', { emit: () => undefined });
    expect(Date.now() - t1).toBeGreaterThanOrEqual(550);
  });
});

describe('기본·이상 값은 on = 현행 1:1', () => {
  it('users 행 없음(레거시 계정의 preferences 미설정): 공감 재질문 정상 생성', async () => {
    vi.stubGlobal('fetch', llmFetch());
    const result = await runTextTurn(db, session, 'user', '왜 그런가요?', { emit: () => undefined });
    expect(result.empathyMessageId).toBeTruthy();
    expect(store.tables.messages.filter(m => m.source_neuron === 'empathy').length).toBe(1);
  });

  it('preferences에 echoMode 키 없음 / 임의 값(true·大写 OFF)은 무시하고 on', async () => {
    vi.stubGlobal('fetch', llmFetch());
    setEchoMode({ joystick_map: { a: 1 } });
    const r1 = await runTextTurn(db, session, 'user', '메모 좀 열어줘', { emit: () => undefined });
    expect(r1.empathyMessageId).toBeTruthy();
    store.tables.messages.length = 0; store.tables.users.length = 0;
    setEchoMode({ echoMode: 'OFF' }); // 문자열 일치만 인정 (스펙: 기본 'on')
    const r2 = await runTextTurn(db, session, 'user', '메모 좀 열어줘', { emit: () => undefined });
    expect(r2.empathyMessageId).toBeTruthy();
  });
});
