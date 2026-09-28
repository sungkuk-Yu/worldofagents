/**
 * t_620d5549 ④ — runTextTurn 통합 배선: 김비서 room 턴은 answerNode가 로컬 LLM을
 * 거치지 않고 Hermes 브리지로 나간다(원문 저장), 비(非)김비서 room은 브리지 미설정과
 * 동일하게 기존 흐름 1:1. 실패 시 폴백 문장이 답변 행으로 저장되고 턴은 살아 있다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const session = (agentId: string) => ({ id: 'session', user_id: 'user', agent_id: agentId, persona_id: 'persona', status: 'active' }) as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  store.tables.personas.push({ id: 'persona', tone_config: {} });
  // devstore가 'agent' id로 기본 '김비서'를 시드 — 브리지 매칭은 이름 기준이라 그대로 사용,
  // 대조군은 이름이 다른 별도 에이전트를 추가한다.
  const kim = store.tables.agents.find(a => a.id === 'agent');
  if (!kim || kim.name !== '김비서') store.tables.agents.push({ id: 'agent', name: '김비서' });
  store.tables.agents.push({ id: 'lawyer', name: '내 변호사' });
  store.tables.sessions.push(session('agent'));
  db = createDevClient(store) as DbClient;
  // 로컬 LLM은 실 키 없이 fetch 모크로 동작 — ack-queue-suggest와 동일한 열기 방식.
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function withBridge(endpoint: string) {
  vi.spyOn(config.secretaryBridge, 'endpoint', 'get').mockReturnValue(endpoint);
  vi.spyOn(config.secretaryBridge, 'timeoutMs', 'get').mockReturnValue(5000);
  vi.spyOn(config.secretaryBridge, 'maxTurns', 'get').mockReturnValue(15);
}

/** fetch 모크: 127.0.0.1 A2A 엔드는 브리지 응답, 나머지는 로컬 LLM(스트림) 응답. */
function bridgeFetch(reply: string, contextId = 'ctx-1') {
  return vi.fn(async (url: any, init?: any) => {
    if (String(url).includes('127.0.0.1')) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 'x',
        result: {
          id: 'task-1', contextId,
          status: { state: 'TASK_STATE_COMPLETED', message: { role: 'ROLE_AGENT', parts: [{ text: `💭 **Reasoning:**\n\`\`\`\n숨은 사고\`\`\`\n\n${reply}` }] } },
          artifacts: [{ artifactId: 'a', parts: [{ text: `💭 **Reasoning:**\n\`\`\`\n숨은 사고\n\`\`\`\n\n${reply}` }] }],
        },
      }));
    }
    return new Response('data: {"model":"test-model","choices":[{"delta":{"content":"로컬 답변"}}]}\n\ndata: [DONE]\n');
  });
}

describe('runTextTurn × 김비서 브리지 (t_620d5549)', () => {
  it('김비서 room + endpoint 설정: 답변 행은 브리지 원문(reasoning 제거), 채팅 LLM 미경유, provider 표기', async () => {
    withBridge('http://127.0.0.1:9902');
    const fetchMock = bridgeFetch('네, 바로 처리할게요.');
    vi.stubGlobal('fetch', fetchMock);
    const events: TurnEmitEvent[] = [];

    const result = await runTextTurn(db, session('agent'), 'user', '오늘 일정 정리해줘', { locale: 'ko', emit: e => events.push(e) });

    const answerRow = store.tables.messages.find(m => m.source_neuron === 'answer');
    expect(answerRow?.content).toContain('네, 바로 처리할게요.');
    expect(answerRow?.content).not.toContain('Reasoning');
    expect(answerRow?.content).not.toContain('숨은 사고');
    expect(result.llm).toMatchObject({ used: false, model: 'hermes:kimsecretary', provider: 'secretary-bridge', fallback: false });
    // 브리지 턴의 fetch는 A2A POST 정확히 1건 — 로컬 스트리밍 답변 LLM은 0건(원문 재작성 금지).
    const a2aCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('127.0.0.1'));
    const streamLlmCalls = fetchMock.mock.calls.filter(c => !String(c[0]).includes('127.0.0.1')
      && String((c[1] as RequestInit)?.body || '').includes('"stream":true'));
    expect(a2aCalls.length).toBe(1);
    expect(streamLlmCalls.length).toBe(0);
    // 브리지 뉴런 이벤트가 진행·완료가 보인다(체감: 뉴런 상태 표시 계약).
    expect(events.some(e => e.type === 'neuron.status' && (e as any).neuron.slug === 'bridge')).toBe(true);
    // 연속성 컨텍스트 영속.
    expect(store.tables.context_patches.some(p => p.key === 'secretary.bridge')).toBe(true);
    // run.completed는 마지막 이벤트 — 기존 계약 유지.
    expect(events.at(-1)!.type).toBe('run.completed');
  });

  it('실패 폴백: A2A 연결 거부 시 원인 문장 답변으로 저장되고 턴은 completed로 끝난다', async () => {
    withBridge('http://127.0.0.1:9999');
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }); }));
    const events: TurnEmitEvent[] = [];

    const result = await runTextTurn(db, session('agent'), 'user', '오늘 일정 정리해줘', { locale: 'ko', emit: e => events.push(e) });

    const answerRow = store.tables.messages.find(m => m.source_neuron === 'answer');
    expect(answerRow?.content).toContain('전달하지 못했어');
    expect(result.answerMessageId).toBeTruthy();
    expect(result.llm).toMatchObject({ used: false, fallback: true, reason: 'BRIDGE_TRANSPORT' });
    expect(events.at(-1)!.type).toBe('run.completed');
    // 실패 턴은 컨텍스트를 영속하지 않는다(다음 턴에 재시도).
    expect(store.tables.context_patches.some(p => p.key === 'secretary.bridge')).toBe(false);
  });

  it('비(非)김비서 room: endpoint가 켜져 있어도 기존 로컬 LLM 경로 1:1 (브리지 0호출)', async () => {
    withBridge('http://127.0.0.1:9902');
    store.tables.sessions.length = 0;
    store.tables.sessions.push(session('lawyer'));
    const fetchMock = bridgeFetch('不该出现');
    vi.stubGlobal('fetch', fetchMock);

    const result = await runTextTurn(db, session('lawyer'), 'user', '계약서 봐줘', { locale: 'ko', emit: () => undefined });

    const answerRow = store.tables.messages.find(m => m.source_neuron === 'answer');
    expect(answerRow?.content).toContain('로컬 답변');
    expect(result.llm).toMatchObject({ used: true });
    expect(store.tables.context_patches.some(p => p.key === 'secretary.bridge')).toBe(false);
  });

  it('브리지 미설정(기본): 김비서 room도 로컬 답변 — 배포 전 기존 동작 보존', async () => {
    vi.stubGlobal('fetch', bridgeFetch('unused'));
    const result = await runTextTurn(db, session('agent'), 'user', '오늘 일정 정리해줘', { locale: 'ko', emit: () => undefined });
    const answerRow = store.tables.messages.find(m => m.source_neuron === 'answer');
    expect(answerRow?.content).toContain('로컬 답변');
    expect(result.llm.used).toBe(true);
  });
});
