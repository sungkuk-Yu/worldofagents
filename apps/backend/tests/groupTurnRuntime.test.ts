// tests/groupTurnRuntime.test.ts — P2 턴제어: 예산(발화/handoff/토큰)·반복 차단·open|closed|halted·sequence 전용 handoff·침묵
import { describe, it, expect, afterEach } from 'vitest';
import { runAgentTurns, turnBudget, dispatchEnabled, type RunTurnInput } from '../src/lib/groupTurnRuntime';
import { fakeDb, envelope, OWNER, A1, A2, ROOM } from './fakeDb';

const A3 = '00000000-0000-4000-8000-000000000005';

function freshStore() {
  return {
    group_turns: [{ id: 'turn-1', room_id: ROOM, status: 'open', utterance_count: 0, handoff_count: 0, token_count: 0 }] as any[],
    group_messages: [] as any[],
  };
}

type SpeakRes = { text: string; tokens?: number; pass_to?: string };

function baseInput(over: Partial<RunTurnInput> = {}): RunTurnInput {
  return {
    roomId: ROOM,
    ownerId: OWNER,
    turnId: 'turn-1',
    anchorMessageId: 'anchor',
    mode: 'single',
    envelopes: [envelope(A1)],
    agentIds: new Set([A1, A2, A3]),
    budget: { maxUtterances: 6, maxHandoffs: 2, tokenCap: 2500 },
    speak: async () => ({ text: '' }),
    summarize: async () => ({ text: 'SUMMARY-TEXT', tokens: 3 }),
    ...over,
  };
}

function scriptedSpeak(script: Record<string, SpeakRes[]>) {
  const seen: Record<string, number> = {};
  const calls: string[] = [];
  const fn = async (agentId: string) => {
    calls.push(agentId);
    const arr = script[agentId] ?? [{ text: '', tokens: 1 }];
    const i = seen[agentId] ?? 0;
    seen[agentId] = i + 1;
    const r = arr[Math.min(i, arr.length - 1)];
    return { text: r.text, tokens: r.tokens ?? 10, pass_to: r.pass_to };
  };
  return { fn, calls };
}

const agentMsgs = (store: any) => store.group_messages.filter((m: any) => m.author_type === 'agent');
const summaryMsgs = (store: any) => store.group_messages.filter((m: any) => m.kind === 'summary');

describe('정상 종료 (closed)', () => {
  it('발화 1건 저장 → closed, counter 라이브 반영, 요약 없음', async () => {
    const store = freshStore();
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({
      speak: scriptedSpeak({ [A1]: [{ text: '배포는 3시입니다.' }] }).fn,
    }));
    expect(out.status).toBe('closed');
    expect(out.stop_reason).toBe('closed');
    expect(out.utterances).toBe(1);
    expect(out.summary).toBeNull();
    expect(agentMsgs(store)).toHaveLength(1);
    const msg = agentMsgs(store)[0];
    expect(msg).toMatchObject({ room_id: ROOM, turn_id: 'turn-1', author_type: 'agent', author_id: A1, kind: 'text', mentions: [] });
    expect(store.group_turns[0].status).toBe('closed');
    expect(store.group_turns[0].utterance_count).toBe(1);
    expect(store.group_turns[0].closed_at).toBeTruthy();
  });

  it('빈 응답(침묵)은 발화 카운트·저장 없음', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({ [A1]: [{ text: '   ' }] });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({ speak: sp.fn }));
    expect(out.utterances).toBe(0);
    expect(agentMsgs(store)).toHaveLength(0);
    expect(out.status).toBe('closed');
  });
});

describe('예산 중단 (halted + PM 요약 반환)', () => {
  it('발화 예산 2 초과 → budget_utterances halted, 3번째 발화 없음, 요약 kind=summary', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({
      [A1]: [{ text: 'alpha 첫 번째 고유 문장 가나다' }],
      [A2]: [{ text: 'beta 두 번째 다른 문장 라마바' }],
      [A3]: [{ text: 'gamma 세 번째 또 다른 문장 사아차' }],
    });
    let summaryReason = '';
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({
      mode: 'parallel',
      envelopes: [envelope(A1), envelope(A2), envelope(A3)],
      budget: { maxUtterances: 2, maxHandoffs: 2, tokenCap: 2500 },
      speak: sp.fn,
      summarize: async (arg: any) => { summaryReason = arg.reason; return { text: 'SUMMARY-TEXT', tokens: 3 }; },
    }));
    expect(out.stop_reason).toBe('budget_utterances');
    expect(out.status).toBe('halted');
    expect(out.utterances).toBe(2);
    expect(sp.calls).toHaveLength(2); // 초과 실행 0
    expect(summaryReason).toBe('budget_utterances');
    expect(summaryMsgs(store)).toHaveLength(1);
    expect(summaryMsgs(store)[0]).toMatchObject({ author_type: 'user', author_id: OWNER, kind: 'summary', content: 'SUMMARY-TEXT' });
    expect(store.group_turns[0]).toMatchObject({ status: 'halted', utterance_count: 2 });
  });

  it('토큰 상한 초과 → budget_tokens halted, 발화 후 합산 검사', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({ [A1]: [{ text: '긴 답변입니다 고유1', tokens: 90 }], [A2]: [{ text: '두 답변 고유2', tokens: 90 }] });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({
      mode: 'parallel',
      envelopes: [envelope(A1), envelope(A2)],
      budget: { maxUtterances: 6, maxHandoffs: 2, tokenCap: 100 },
      speak: sp.fn,
    }));
    expect(out.stop_reason).toBe('budget_tokens');
    expect(out.status).toBe('halted');
    expect(sp.calls).toHaveLength(2); // 첫 발화 실행 후 합산 중단
    expect(summaryMsgs(store)).toHaveLength(1);
  });
});

describe('반복(핑퐁) 차단', () => {
  it('유사도 ≥ 임계 발화 → 저장 없이 repetition halted', async () => {
    const store = freshStore();
    const t = '저는 동일한 답변을 반복합니다 배포는 3시입니다';
    const sp = scriptedSpeak({ [A1]: [{ text: t }], [A2]: [{ text: t }] });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({
      mode: 'parallel',
      envelopes: [envelope(A1), envelope(A2)],
      speak: sp.fn,
    }));
    expect(out.stop_reason).toBe('repetition');
    expect(out.status).toBe('halted');
    expect(out.utterances).toBe(1); // 중복 발화 미저장
    expect(agentMsgs(store)).toHaveLength(1);
    expect(summaryMsgs(store)).toHaveLength(1); // 사용자 반환
  });

  it('침묵(빈 발화)은 반복 판정 대상 아님', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({ [A1]: [{ text: '유일한 발화 고유Z' }], [A2]: [{ text: '' }] });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({
      mode: 'parallel',
      envelopes: [envelope(A1), envelope(A2)],
      speak: sp.fn,
    }));
    expect(out.stop_reason).toBe('closed');
    expect(out.utterances).toBe(1);
  });
});

describe('handoff: sequence 전용 (D3)', () => {
  it('sequence + pass_to(이름 별칭) → kind=handoff, mentions=[대상], 후속 발화', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({
      [A1]: [{ text: '코드는 제가 봤습니다 넘김', pass_to: 'Beta' }],
      [A2]: [{ text: '법무 확인 완료 고유B' }],
    });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({
      mode: 'sequence',
      envelopes: [envelope(A1)],
      agentNames: { beta: A2 },
      speak: sp.fn,
    }));
    expect(out.status).toBe('closed');
    expect(out.handoffs).toBe(1);
    expect(sp.calls).toEqual([A1, A2]);
    expect(agentMsgs(store)[0]).toMatchObject({ kind: 'handoff', mentions: [A2] });
    expect(store.group_turns[0].handoff_count).toBe(1);
  });

  it('single 모드 pass_to → handoff 무시(kind text, 큐 추가 없음)', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({ [A1]: [{ text: '발화 고유S', pass_to: A2 }] });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({ mode: 'single', speak: sp.fn }));
    expect(out.handoffs).toBe(0);
    expect(sp.calls).toEqual([A1]);
    expect(agentMsgs(store)[0]).toMatchObject({ kind: 'text', mentions: [] });
  });

  it('자기 자신 패스는 무시 + 미실행 handoff 라벨 금지', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({ [A1]: [{ text: '고유X1', pass_to: A1 }] });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({
      mode: 'sequence',
      envelopes: [envelope(A1)],
      speak: sp.fn,
    }));
    expect(out.handoffs).toBe(0);
    expect(agentMsgs(store)[0].kind).toBe('text');
  });

  it('handoff 예산 0 → budget_handoffs halted', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({ [A1]: [{ text: '고유H1', pass_to: A2 }] });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({
      mode: 'sequence',
      budget: { maxUtterances: 6, maxHandoffs: 0, tokenCap: 2500 },
      speak: sp.fn,
    }));
    expect(out.stop_reason).toBe('budget_handoffs');
    expect(out.status).toBe('halted');
    expect(sp.calls).toEqual([A1]);
    expect(agentMsgs(store)[0].kind).toBe('text'); // 승인되지 않은 패스는 handoff로 기록하지 않음
  });

  it('미등록 pass_to는 조용히 무시', async () => {
    const store = freshStore();
    const sp = scriptedSpeak({ [A1]: [{ text: '고유G1', pass_to: 'nobody' }] });
    const out = await runAgentTurns(fakeDb(store) as any, baseInput({ mode: 'sequence', speak: sp.fn }));
    expect(out.handoffs).toBe(0);
    expect(out.status).toBe('closed');
  });
});

describe('turnBudget / dispatch 게이트', () => {
  const keys = ['GROUP_TURN_MAX_UTTERANCES', 'GROUP_TURN_MAX_HANDOFFS', 'GROUP_TURN_TOKEN_CAP', 'GROUP_TURN_DISPATCH'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it('기본값 6/2/2500, dispatch 게이트 기본 OFF', () => {
    delete process.env.GROUP_TURN_DISPATCH;
    expect(turnBudget()).toEqual({ maxUtterances: 6, maxHandoffs: 2, tokenCap: 2500 });
    expect(dispatchEnabled()).toBe(false);
  });

  it('env 반영·버려지는 값은 기본값 회수', () => {
    process.env.GROUP_TURN_MAX_UTTERANCES = '3';
    process.env.GROUP_TURN_MAX_HANDOFFS = '0';   // 0은 기본값 회수
    process.env.GROUP_TURN_TOKEN_CAP = 'abc';    // 비수치는 기본값 회수
    expect(turnBudget()).toEqual({ maxUtterances: 3, maxHandoffs: 2, tokenCap: 2500 });
    process.env.GROUP_TURN_DISPATCH = 'true';
    expect(dispatchEnabled()).toBe(true);
  });
});
