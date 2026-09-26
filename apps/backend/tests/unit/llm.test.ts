/**
 * LLM 클라이언트 단위 테스트 — 실제 네트워크 없이 fetch 모킹.
 * 프로바이더 풀(전원 DashScope → 비상전원 Anthropic) 전환 로직 포함.
 * (실제 DashScope/Anthropic 호출 검증은 tests/smoke_chat.mjs / smoke_llm_failover.mjs에서 수행)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSseChunkEvents, LlmError } from '../../src/lib/llm';

// config는 env에서 읽히므로 모킹 — chatCompletion 경로는 config.chatLlm + config.chatLlmFallback 소비
vi.mock('../../src/config', () => ({
  config: {
    chatLlm: {
      enabled: true,
      apiKey: 'mk1',
      baseUrl: 'https://llm.test/v1',
      model: 'test-model',
      maxTokens: 128,
      timeoutMs: 5000,
      temperature: 0.7,
      enableThinking: false,
      historyTurns: 20,
    },
    chatLlmFallback: {
      disabled: false,
      apiKey: 'mk2',
      baseUrl: 'https://anthropic.test/v1',
      model: 'claude-test',
      timeoutMs: 5000,
    },
    devMode: true,
  },
}));

const { chatCompletion, isLlmConfigured, llmProviderChain } = await import('../../src/lib/llm');

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

  it('HTTP 429 → LLM_RATE_LIMITED (전원+비상 모두 429이면 최종 코드 유지)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'slow down' } }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'slow down' } }, 429));
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'LLM_RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 풀 순회 후 소진
  });

  it('HTTP 401 → LLM_UNAVAILABLE', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'bad key' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'bad key' } }, 401));
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(LlmError);
  });

  it('빈 응답 → LLM_BAD_RESPONSE', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' } }] }));
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'LLM_BAD_RESPONSE' });
  });

  it('타임아웃 → 전원·비상 모두 타임아웃 시 LLM_TIMEOUT', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    );
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }], timeoutMs: 50 })).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
  }, 10000);

  it('외부 signal로 이미 취소된 요청은 프로바이더 호출 없이 AbortError 전파', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      chatCompletion({ messages: [{ role: 'user', content: 'hi' }], signal: ac.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('프로바이더 풀 — DashScope 장애 시 Anthropic 자동 전환 (t_67eaf475)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('풀 순서: dashscope → anthropic, provider id 노출', () => {
    const chain = llmProviderChain();
    expect(chain.map(p => p.id)).toEqual(['primary', 'fallback']);
    expect(chain[1].model).toBe('claude-test');
  });

  it('전원 429 → 비상전원 성공 시 자동 전환 + provider/fallback 반환', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'throned' } }, 429))
      .mockResolvedValueOnce(jsonResponse({
        model: 'claude-test',
        choices: [{ message: { content: ' Anthropic 답변 ' } }],
        usage: { total_tokens: 3 },
      }));
    const r = await chatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('Anthropic 답변');
    expect(r.provider).toBe('fallback');
    expect(r.fallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 2차 호출은 anthropic baseUrl + claude-test 모델 + Anthropic 키
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://anthropic.test/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('claude-test');
    expect(init.headers.Authorization).toBe('Bearer mk2');
  });

  it('전원 5xx → 비상전원 스트리밍 성공 — 델타 정상 전달', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'boom' } }, 503))
      .mockResolvedValueOnce(sseResponse([
        '{"model":"claude-test","choices":[{"delta":{"content":"비"}}]}',
        '{"model":"claude-test","choices":[{"delta":{"content":"상"}}]}',
      ]));
    const seen: string[] = [];
    const r = await chatCompletion({ messages: [{ role: 'user', content: 'hi' }], onDelta: d => seen.push(d) });
    expect(seen).toEqual(['비', '상']);
    expect(r.streamed).toBe(true);
    expect(r.fallback).toBe(true);
  });

  it('비retryable(400 invalid_request)는 폴백하지 않고 즉시 실패', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'Unsupported model', type: 'invalid_request_error' } }, 400));
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({ code: 'LLM_BAD_REQUEST' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 비상전원 호출 금지 (동일 파라미터 버그 재현 방지)
  });

  it('스트리밍 중 델타 출력 후 절단 → 재시도/폴백 없이 LLM_STREAM_TRUNCATED (중복 출력 방지)', async () => {
        // 출력 후 절단: 첫 read는 루 전달, 둘째 read는 에러
    let sent = false;
    const partialBody = new ReadableStream({
      pull(c) {
        if (!sent) {
          sent = true;
          c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"일부"}}]}\n\n'));
        } else {
          c.error(new Error('connection reset'));
        }
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(partialBody, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const seen: string[] = [];
    await expect(
      chatCompletion({ messages: [{ role: 'user', content: 'hi' }], onDelta: d => seen.push(d) })
    ).rejects.toMatchObject({ code: 'LLM_STREAM_TRUNCATED' });
    expect(seen).toEqual(['일부']); // partial은 이미 전달됨 — 폴백으로 이어 붙이면 안 된다
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('전원·비상 모두 실패 → 마지막 LlmError 전파 (호출자 템플릿 폴백 트리거)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'down' } }, 502))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'also down' } }, 503));
    await expect(chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
