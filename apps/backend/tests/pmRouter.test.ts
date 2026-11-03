// tests/pmRouter.test.ts — P1 PM 라우터: 우선순위(@멘션>답글>모델)·명시경로 모델 0회·fail-closed·고정 계약
import { describe, it, expect, afterEach } from 'vitest';
import {
  routePmTurn,
  normalizeMentions,
  makePmRouteDecider,
  type PmRouterRequest,
} from '../src/lib/pmRouter';
import { LlmError } from '../src/lib/llm';
import { OWNER, A1, A2, ROOM } from './fakeDb';

const A3 = '00000000-0000-4000-8000-000000000005';
const A4 = '00000000-0000-4000-8000-000000000006';
const cards = [
  { agent_id: A1, name: 'Alpha', card: '코딩' },
  { agent_id: A2, name: 'Beta', card: '법무' },
  { agent_id: A3, name: 'Gamma', card: '디자인' },
  { agent_id: A4, name: 'Delta', card: '운영' },
];

function req(over: Partial<PmRouterRequest> = {}): PmRouterRequest {
  return {
    roomId: ROOM,
    ownerId: OWNER,
    messageId: 'msg-1',
    message: '오늘 배포 일정이 어떻게 돼?',
    mentions: [],
    replyTo: null,
    roleCards: cards,
    ...over,
  };
}

type FakeRes = { text?: string; throwErr?: Error; tokens?: number };
function fakeChat(script: FakeRes[]) {
  const calls: any[] = [];
  const fn = async (opts: any) => {
    calls.push(opts);
    const s = script[Math.min(calls.length - 1, script.length - 1)];
    if (s.throwErr) throw s.throwErr;
    return { text: s.text ?? '', model: 'fake-model', usage: { total_tokens: s.tokens ?? 7 } };
  };
  return { fn, calls };
}

const savedEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined) {
  savedEnv[k] ??= process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('명시 경로: @멘션 (모델 호출 0회)', () => {
  it('멘션 1명 → single, confidence 1, route_source mention, 모델 미호출', async () => {
    const chat = fakeChat([]);
    const out = await routePmTurn(req({ mentions: [A1] }), { chat: chat.fn as any });
    expect(chat.calls).toHaveLength(0);
    expect(out.route_source).toBe('mention');
    expect(out.degraded).toBeNull();
    expect(out.model).toBeNull();
    expect(out.usage).toBeNull();
    expect(Object.keys(out.decision!).sort()).toEqual(['confidence', 'mode', 'responders']);
    expect(out.decision).toEqual({ responders: [A1], mode: 'single', confidence: 1 });
  });

  it('멘션 2명 → parallel; @ 접두·중복 정규화', async () => {
    const out = await routePmTurn(req({ mentions: [`@${A2}`, A1, A1] }), { chat: fakeChat([]).fn as any });
    expect(out.decision).toEqual({ responders: [A2, A1], mode: 'parallel', confidence: 1 });
    expect(out.audit.dropped_mentions).toEqual([A1]); // 중복 드랍 감사가드
  });

  it('멘션 4명 → MAX_RESPONDERS 3로 자르고 audit.truncated', async () => {
    const out = await routePmTurn(req({ mentions: [A1, A2, A3, A4] }), { chat: fakeChat([]).fn as any });
    expect(out.decision!.responders).toHaveLength(3);
    expect(out.audit.truncated).toBe(true);
  });

  it('멘션 전원 미등록 → fail-closed(빈 responders), 되물음 아님', async () => {
    const out = await routePmTurn(req({ mentions: ['ghost-1', 'ghost-2'] }), { chat: fakeChat([]).fn as any });
    expect(out.decision).toEqual({ responders: [], mode: 'single', confidence: 0 });
    expect(out.degraded).toBe('invalid_output');
    expect(out.clarify).toBe(false);
    expect(out.route_source).toBe('mention');
    expect(out.audit.dropped_mentions).toEqual(['ghost-1', 'ghost-2']);
  });

  it('normalizeMentions 단위: 접두 제거·trim·화이트리스트·중복', () => {
    const r = normalizeMentions(['@@a', ' a ', 'b', 'x'], new Set(['a', 'b']));
    expect(r.ids).toEqual(['a', 'b']);
    expect(r.dropped).toContain('x');
  });
});

describe('명시 경로: 답글 (모델 호출 0회)', () => {
  it('에이전트 발화 답글 → reply, single, 0시도', async () => {
    const chat = fakeChat([]);
    const out = await routePmTurn(req({ replyTo: { authorType: 'agent', authorId: A2 } }), { chat: chat.fn as any });
    expect(chat.calls).toHaveLength(0);
    expect(out.route_source).toBe('reply');
    expect(out.decision).toEqual({ responders: [A2], mode: 'single', confidence: 1 });
  });

  it('답글 대상이 화이트리스트 밖/사용자 → 모델 경로로 폴스루', async () => {
    const chat = fakeChat([{ text: `{"responders":["${A1}"],"mode":"single","confidence":0.9}` }]);
    const out = await routePmTurn(
      req({ replyTo: { authorType: 'agent', authorId: 'not-a-member' } }),
      { chat: chat.fn as any },
    );
    expect(out.route_source).toBe('model');
    expect(chat.calls).toHaveLength(1);
  });
});

describe('모델 경로', () => {
  it('후보 없음 → no_candidates fail-closed, 모델 0시도', async () => {
    const chat = fakeChat([]);
    const out = await routePmTurn(req({ roleCards: [] }), { chat: chat.fn as any });
    expect(chat.calls).toHaveLength(0);
    expect(out.degraded).toBe('no_candidates');
    expect(out.attempts).toBe(0);
    expect(out.decision!.responders).toEqual([]);
  });

  it('고정 JSON 계약 파싱 → route_source model, decision 3키만', async () => {
    const chat = fakeChat([{ text: `별말 없이 {"responders":["${A1}","${A2}"],"mode":"parallel","confidence":0.82} 뒤에 설명` }]);
    const out = await routePmTurn(req(), { chat: chat.fn as any });
    expect(out.route_source).toBe('model');
    expect(out.decision).toEqual({ responders: [A1, A2], mode: 'parallel', confidence: 0.82 });
    expect(Object.keys(out.decision!)).toHaveLength(3);
    expect(out.model).toBe('fake-model');
    expect(out.message_chars).toBe(req().message.length);
    expect(out.candidate_count).toBe(4);
  });

  it('출력 쓰레기 → invalid_output fail-closed (D5: 빈 responders로 발화 금지)', async () => {
    const out = await routePmTurn(req(), { chat: fakeChat([{ text: '에이전트를 골라드릴게요!' }]).fn as any });
    expect(out.degraded).toBe('invalid_output');
    expect(out.decision!.responders).toEqual([]);
  });

  it('빈 responders + 저신뢰(0.3) → 되물음 우선 (invalid_output 아님, D5 금지 유지)', async () => {
    const out = await routePmTurn(req(), { chat: fakeChat([{ text: '{"responders":[],"mode":"single","confidence":0.3}' }]).fn as any });
    expect(out.route_source).toBe('clarify');
    expect(out.clarify).toBe(true);
    expect(out.degraded).toBeNull();
    expect(out.decision!.responders).toEqual([]);
  });

  it('미등록 ID만 반환 → invalid_output, dropped_invalid 감사', async () => {
    const out = await routePmTurn(req(), { chat: fakeChat([{ text: '{"responders":["ghost"],"mode":"single","confidence":0.9}' }]).fn as any });
    expect(out.degraded).toBe('invalid_output');
    expect(out.audit.dropped_invalid).toEqual(['ghost']);
    expect(out.decision!.confidence).toBe(0);
  });

  it('단독 재시도: retryable LlmError 1회 후 모델 호출 성공 (총 2시도)', async () => {
    const err = new LlmError('LLM_TIMEOUT', 'timeout');
    const chat = fakeChat([{ throwErr: err }, { text: `{"responders":["${A1}"],"mode":"single","confidence":0.9}` }]);
    const out = await routePmTurn(req(), { chat: chat.fn as any });
    expect(chat.calls).toHaveLength(2);
    expect(out.attempts).toBe(2);
    expect(out.route_source).toBe('model');
    expect(out.degraded).toBeNull();
  });

  it('2회 연속 실패 → model_unavailable fail-closed (무한 재시도 금지)', async () => {
    const err = new LlmError('LLM_UNAVAILABLE', 'down');
    const chat = fakeChat([{ throwErr: err }, { throwErr: err }, { text: 'x' }]);
    const out = await routePmTurn(req(), { chat: chat.fn as any });
    expect(chat.calls).toHaveLength(2);
    expect(out.degraded).toBe('model_unavailable');
    expect(out.decision!.responders).toEqual([]);
  });

  it('비retryable LlmError → 즉시 실패(1시도)', async () => {
    const err = new LlmError('LLM_BAD_REQUEST', '4xx');
    err.retryable = false;
    const chat = fakeChat([{ throwErr: err }, { text: 'y' }]);
    const out = await routePmTurn(req(), { chat: chat.fn as any });
    expect(chat.calls).toHaveLength(1);
    expect(out.degraded).toBe('model_unavailable');
  });

  it('저신뢰(0.3 < 0.5) 기본 → clarify: responders 빈 채로 되물음, 발화 후보 없음(D5)', async () => {
    const out = await routePmTurn(req(), { chat: fakeChat([{ text: `{"responders":["${A1}"],"mode":"single","confidence":0.3}` }]).fn as any });
    expect(out.route_source).toBe('clarify');
    expect(out.clarify).toBe(true);
    expect(out.clarify_utterance).toBeTruthy();
    expect(out.low_confidence).toBe(true);
    expect(out.decision!.responders).toEqual([]);
  });

  it('PM_ROUTER_LOW_CONF_ACTION=single_top → 저신뢰에도 수석 1명 single', async () => {
    setEnv('PM_ROUTER_LOW_CONF_ACTION', 'single_top');
    const out = await routePmTurn(req(), { chat: fakeChat([{ text: `{"responders":["${A1}","${A2}"],"mode":"parallel","confidence":0.3}` }]).fn as any });
    expect(out.route_source).toBe('model');
    expect(out.low_confidence).toBe(true);
    expect(out.decision).toEqual({ responders: [A1], mode: 'single', confidence: 0.3 });
  });

  it('신뢰도 clamp: 1.7 → 1 (raw 보존), -0.5 → 음수 처리 후 저신뢰', async () => {
    const over = await routePmTurn(req(), { chat: fakeChat([{ text: `{"responders":["${A1}"],"mode":"single","confidence":1.7}` }]).fn as any });
    expect(over.decision!.confidence).toBe(1);
    expect(over.audit.raw_confidence).toBe(1.7);
    expect(over.route_source).toBe('model');
    const neg = await routePmTurn(req(), { chat: fakeChat([{ text: `{"responders":["${A1}"],"mode":"single","confidence":-0.5}` }]).fn as any });
    expect(neg.audit.raw_confidence).toBe(-0.5);
    expect(neg.route_source).toBe('clarify');
  });

  it('mode=single인데 2명 → parallel 정규화(audit.mode_normalized)', async () => {
    const out = await routePmTurn(req(), { chat: fakeChat([{ text: `{"responders":["${A1}","${A2}"],"mode":"single","confidence":0.9}` }]).fn as any });
    expect(out.decision!.mode).toBe('parallel');
    expect(out.audit.mode_normalized).toBe(true);
  });

  it('env 임계값 PM_ROUTER_LOW_CONF=0.95 반영', async () => {
    setEnv('PM_ROUTER_LOW_CONF', '0.95');
    const out = await routePmTurn(req(), { chat: fakeChat([{ text: `{"responders":["${A1}"],"mode":"single","confidence":0.9}` }]).fn as any });
    expect(out.route_source).toBe('clarify');
  });

  it('LLM 호출 파라미터: enableThinking false, temperature 0', async () => {
    const chat = fakeChat([{ text: `{"responders":["${A1}"],"mode":"single","confidence":0.9}` }]);
    await routePmTurn(req(), { chat: chat.fn as any });
    expect(chat.calls[0].enableThinking).toBe(false);
    expect(chat.calls[0].temperature).toBe(0);
    expect(chat.calls[0].model).toBeTruthy();
  });
});

describe('makePmRouteDecider 결합 어댑터', () => {
  it('RouterInput(동결 계약) → RouteDecision 3키만 반환', async () => {
    const chat = fakeChat([{ text: `{"responders":["${A1}"],"mode":"single","confidence":0.9}` }]);
    const decider = makePmRouteDecider({ chat: chat.fn as any });
    const d = await decider({
      roomId: ROOM, ownerId: OWNER, messageId: 'm', userText: '질문',
      roleCards: cards, threadSummary: null,
    });
    expect(chat.calls).toHaveLength(1); // 명시 정보 없는 일반 질문 → 모델 경로
    expect(Object.keys(d).sort()).toEqual(['confidence', 'mode', 'responders']);
    expect(d).toEqual({ responders: [A1], mode: 'single', confidence: 0.9 });
  });
});
