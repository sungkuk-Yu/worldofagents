/**
 * LLM 클라이언트 단위 테스트 — 실제 네트워크 없이 fetch 모킹.
 * (실제 DashScope 호출 검증은 tests/smoke_chat.mjs에서 수행)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSseChunkEvents, LlmError } from '../../src/lib/llm';

// config는 env에서 읽히므로 모킹 — chatCompletion 경로는 config.chatLlm 소비
vi.mock('../../src/config', () => ({
  config: {
    chatLlm: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1',
      model: 'test-model',
      maxTokens: 128,
      timeoutMs: 5000,
      temperature: 0.7,
      enableThinking: false,
      historyTurns: 20,
    },
    devMode: true,
  },
}));

const { chatCompletion, isLlmConfigured } = await import('../../src/lib/llm');

function sseResponse(events: string[], status = 200): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

describe('parseSseChunkEvents', () => {
  it('delta/usage/model 추출', () => {
    const deltas: string[] = [];
    let usage: unknown = null;
    let model = '';
    parseSseChunkEvents(
      'data: {"model":"m1","choices":[{"delta":{"content":"안녕"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"하세요"}}]}\n' +
      'data: {"usage":{"total_tokens":10}}\n' +
      'data: [DONE]\n',
      { onDelta: (d) => deltas.push(d), onUsage: (u) => { usage = u; }, onModel: (m) => { model = m; } }
    );
    expect(deltas).toEqual(['안녕', '하세요']);
    expect((usage as any).total_tokens).toBe(10);
    expect(model).toBe('m1');
  });

  it('비JSON/빈 라인 무시', () => {
    const deltas: string[] = [];
    parseSseChunkEvents('data: not-json\n\ndata:\n\n: keep-alive\n', { onDelta: (d) => deltas.push(d) });
    expect(deltas).toEqual([]);
  });
});

describe('chatCompletion', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('isLlmConfigured — 키 있으면 true', () => {
    expect(isLlmConfigured()).toBe(true);
  });

  it('비스트리밍 — message.content 반환', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      model: 'test-model',
      choices: [{ message: { content: '  답변입니다  ' } }],
      usage: { total_tokens: 5 },
    }));
    const r = await chatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('답변입니다');
    expect(r.streamed).toBe(false);
    expect(r.usage?.total_tokens).toBe(5);
    // 요청 검증
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://llm.test/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('test-model');
    expect(body.enable_thinking).toBe(false);
  });

  it('스트리밍 — 델타 누적 + onDelta 호출', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([
      '{"choices":[{"delta":{"content":"가"}}]}',
      '{"choices":[{"delta":{"content":"나"}}]}',
      '{"choices":[{"delta":{"content":"다"}}],"usage":{"total_tokens":9}}',
    ]));
    const seen: string[] = [];
    const r = await chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (d) => seen.push(d),
    });
    expect(r.text).toBe('가나다');
    expect(seen).toEqual(['가', '나', '다']);
    expect(r.streamed).toBe(true);
    expect(r.usage?.total_tokens).toBe(9);
  });

  it('HTTP 429 → LLM_RATE_LIMITED', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'slow down' } }, 429));
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'LLM_RATE_LIMITED' });
  });

  it('HTTP 401 → LLM_UNAVAILABLE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'bad key' } }, 401));
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(LlmError);
  });

  it('빈 응답 → LLM_BAD_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' } }] }));
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'LLM_BAD_RESPONSE' });
  });

  it('타임아웃 → LLM_TIMEOUT', async () => {
    fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    );
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 50 })).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
  }, 10000);
});
