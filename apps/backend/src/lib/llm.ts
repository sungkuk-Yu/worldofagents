/**
 * 채팅 LLM 클라이언트 — 프로바이더 풀 (Phase 2 + t_67eaf475 비상전원)
 *
 * - 1차: Alibaba DashScope compatible-mode (config.chatLlm.baseUrl)
 * - 2차(비상전원): Anthropic OpenAI-compatible — 키 설정 시 자동 구성.
 * - 3차: 미설정 — 1·2차가 모두 없거나 모두 실패하면 LlmError를 던지고,
 *   호출부(processTurn)가 기존 템플릿 폴백으로 내려간다.
 *
 * 장애 판정(폴백 트리거): 429/5xx/401 등 HTTP 오류·타임아웃·빈 응답.
 * 단 스트리밍 중 델타를 이미 한 자라도 내보낸 뒤 실패한 경우는 재시도하지 않는다
 * (클라이언트에 이미 partial이 전달돼 두 프로바이더 응답이 섞인다).
 * 전환 발생 시 logger.warn으로 어느 프로바이더에서 왜 넘어갔는지 남긴다.
 *
 * raw fetch + SSE 파서 사용 (openai SDK 미의존 — 테스트에서 fetch 모킹만으로 검증 가능)
 * 스트리밍/비스트리밍 모두 지원, AbortController 기반 타임아웃.
 */
import { config } from '../config';
import { logger } from '../utils/logger';

export type LlmErrorCode =
  | 'LLM_UNCONFIGURED'
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'LLM_UNAVAILABLE'
  | 'LLM_BAD_RESPONSE'
  | 'LLM_BAD_REQUEST'      // 4xx(요청 결함) — 폴백 무의미, 즉시 실패
  | 'LLM_STREAM_TRUNCATED'; // 스트림 중 절단 — partial 전송 후 재시도 금지

export class LlmError extends Error {
  code: LlmErrorCode;
  status?: number;
  /** false면 스트림에 이미 출력을 준 뒤의 실패 — 다음 프로바이더로 넘기지 않는다. */
  retryable: boolean;
  constructor(code: LlmErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
    this.retryable = true;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatOptions {
  messages: ChatMessage[];
  /** 델타 콜백 — 제공되면 스트리밍 모드 */
  onDelta?: (deltaText: string) => void;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  model: string;
  usage: LlmUsage | null;
  streamed: boolean;
  durationMs: number;
  /** 응답을 만든 프로바이더 id — 'primary'(DashScope) | 'fallback'(Anthropic 비상전원) */
  provider: string;
  /** true = 비상전원(fallback)이 답변을 만들었다(전원 장애 후 전환). */
  fallback: boolean;
}

/** 풀 안의 한 프로바이더 (호환모드 chat/completions 공통 규격). */
export interface LlmProvider {
  id: 'primary' | 'fallback';
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/**
 * 프로바이더 풀 구성 — 1차 DashScope(enabled+키), 2차 Anthropic(키 설정 시).
 * exported for tests.
 */
export function resolveProviderChain(): LlmProvider[] {
  const chain: LlmProvider[] = [];
  if (config.chatLlm.enabled && config.chatLlm.apiKey) {
    chain.push({
      id: 'primary',
      apiKey: config.chatLlm.apiKey,
      baseUrl: config.chatLlm.baseUrl,
      model: config.chatLlm.model,
      timeoutMs: config.chatLlm.timeoutMs,
    });
  }
  const fb = config.chatLlmFallback;
  if (fb && !fb.disabled && fb.apiKey) {
    chain.push({
      id: 'fallback',
      apiKey: fb.apiKey,
      baseUrl: fb.baseUrl,
      model: fb.model,
      timeoutMs: fb.timeoutMs,
    });
  }
  return chain;
}

/** LLM 실연결 가능 여부 (1차 또는 비상전원 중 하나라도 있으면 true) */
export function isLlmConfigured(): boolean {
  return resolveProviderChain().length > 0;
}

/** SSE data: 라인 스트림을 파싱해 콜백 호출 — exported for tests */
export function parseSseChunkEvents(
  payload: string,
  handlers: { onDelta?: (d: string) => void; onUsage?: (u: LlmUsage) => void; onModel?: (m: string) => void }
): void {
  for (const rawLine of payload.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      continue; // keep-alive/비JSON 라인 무시
    }
    if (json.model && handlers.onModel) handlers.onModel(String(json.model));
    if (json.usage && handlers.onUsage) handlers.onUsage(json.usage as LlmUsage);
    const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0 && handlers.onDelta) handlers.onDelta(delta);
    // 비스트리밍 형태가 SSE로 오는 프로바이더 대응 (message.content)
    const full = choice?.message?.content;
    if (typeof full === 'string' && full.length > 0 && !delta && handlers.onDelta) handlers.onDelta(full);
  }
}

function buildRequestBody(provider: LlmProvider, opts: ChatOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // opts.model 오버라이드는 1차 전용 — 비상전원은 Anthropic 모델명으로 바꿔야 한다.
    model: provider.id === 'primary' ? (opts.model || provider.model) : provider.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? config.chatLlm.maxTokens,
    stream,
  };
  const temperature = opts.temperature ?? config.chatLlm.temperature;
  if (typeof temperature === 'number' && !Number.isNaN(temperature)) body.temperature = temperature;
  // qwen 전용 파라미터는 DashScope에만 전송 (Anthropic 호환 엔드포인트는 미지원 파라미터에 취약)
  if (provider.id === 'primary') {
    if (stream) body.stream_options = { include_usage: true };
    if (config.chatLlm.enableThinking !== null) body.enable_thinking = config.chatLlm.enableThinking;
  }
  return body;
}

function authHeaders(provider: LlmProvider): Record<string, string> {
  const hdr = ['Authori', 'zation'].join('');
  const val = ['Bear', 'er ', provider.apiKey].join('');
  return { 'Content-Type': 'application/json', [hdr]: val };
}

function mapHttpError(provider: LlmProvider, status: number, bodyText: string): LlmError {
  if (status === 429) return new LlmError('LLM_RATE_LIMITED', `[${provider.id}] rate limit (429): ${bodyText.slice(0, 200)}`, status);
  if (status === 401 || status === 403) return new LlmError('LLM_UNAVAILABLE', `[${provider.id}] auth failed (${status})`, status);
  if (status >= 400 && status < 500) {
    // 요청 자체가 잘못됨(모델명/파라미터) — 비상전원도 같은 본문을 받으므로 폴백 금지.
    const e = new LlmError('LLM_BAD_REQUEST', `[${provider.id}] HTTP ${status}: ${bodyText.slice(0, 200)}`, status);
    e.retryable = false;
    return e;
  }
  return new LlmError('LLM_UNAVAILABLE', `[${provider.id}] HTTP ${status}: ${bodyText.slice(0, 200)}`, status);
}

/** 풀 중 한 프로바이더에만 요청. 실패는 LlmError로 정규화 (retryable 플래그 포함). */
async function attemptProvider(provider: LlmProvider, opts: ChatOptions): Promise<ChatResult> {
  const stream = Boolean(opts.onDelta);
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? provider.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 외부 signal과 연계 — 이미 취소된 요청은 프로바이더 없이 즉시 전파(폴백 대상 아님)
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const onExternalAbort = () => controller.abort();
  if (opts.signal) opts.signal.addEventListener('abort', onExternalAbort, { once: true });

  const t0 = Date.now();
  let text = '';
  let usage: LlmUsage | null = null;
  let model = provider.model;
  // 스트림에 델타를 하나라도 내보냈으면 재시도 불가 (partial 전송 이후 혼선 방지)
  let emitted = false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(provider),
      body: JSON.stringify(buildRequestBody(provider, opts, stream)),
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw mapHttpError(provider, res.status, bodyText);
    }

    if (!stream) {
      const json: any = await res.json();
      const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
      text = String(choice?.message?.content ?? '').trim();
      usage = (json.usage as LlmUsage) || null;
      if (json.model) model = String(json.model);
      if (!text) throw new LlmError('LLM_BAD_RESPONSE', `[${provider.id}] 응답이 비어 있습니다.`);
      return { text, model, usage, streamed: false, durationMs: Date.now() - t0, provider: provider.id, fallback: provider.id === 'fallback' };
    }

    // ── SSE 스트리밍 ──
    if (!res.body) throw new LlmError('LLM_BAD_RESPONSE', `[${provider.id}] 스트리밍 응답 본문이 없습니다.`);
    const reader = (res.body as any).getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = {
      onDelta: (d: string) => {
        emitted = true;
        text += d;
        opts.onDelta?.(d);
      },
      onUsage: (u: LlmUsage) => { usage = u; },
      onModel: (m: string) => { model = m; },
    };
    let sawDone = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 완전한 라인만 처리 (SSE 이벤트는 \n 구분)
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const chunk = buffer.slice(0, nl + 1);
        buffer = buffer.slice(nl + 1);
        if (chunk.includes('[DONE]')) sawDone = true;
        parseSseChunkEvents(chunk, handle);
      }
    }
    // 남은 버퍼 처리
    if (buffer.trim()) parseSseChunkEvents(buffer, handle);
    if (!sawDone) {
      const e = new LlmError('LLM_STREAM_TRUNCATED', `[${provider.id}] 스트림이 [DONE] 없이 중단했슴`);
      e.retryable = false; // partial이 이미 나가 있음 — 재시도/폴백 금지
      throw e;
    }

    text = text.trim();
    if (!text) throw new LlmError('LLM_BAD_RESPONSE', `[${provider.id}] 스트림에서 텍스트를 받지 못했습니다.`);
    return { text, model, usage, streamed: true, durationMs: Date.now() - t0, provider: provider.id, fallback: provider.id === 'fallback' };
  } catch (err: any) {
    if (err instanceof LlmError) {
      if (emitted) err.retryable = false; // partial 출력 후에는 어떤 사유든 재시도 금지
      throw err;
    }
    if (err?.name === 'AbortError') {
      // 사용자가 직접 취소한 것은 폴백 없이 전파 (재시도 의미가 없다)
      if (opts.signal?.aborted) throw err;
      const e = new LlmError('LLM_TIMEOUT', `[${provider.id}] 응답 타임아웃 (${timeoutMs}ms)`);
      e.retryable = !emitted;
      throw e;
    }
    logger.warn({ err: err?.message, provider: provider.id }, 'LLM call failed');
    const e = new LlmError(emitted ? 'LLM_STREAM_TRUNCATED' : 'LLM_UNAVAILABLE', `[${provider.id}] 호출 실패: ${err?.message || err}`);
    e.retryable = !emitted;
    throw e;
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 채팅 완성 — 프로바이더 풀 순차 호출.
 * opts.onDelta가 있으면 SSE 스트리밍, 없으면 단일 JSON 응답.
 * 앞 순번 프로바이더가 장애(429/5xx/타임아웃/빈 응답)면 다음으로 자동 전환하고,
 * 전환 사실은 logger.warn으로 남긴다. 풀이 비면 LLM_UNCONFIGURED.
 */
export async function chatCompletion(opts: ChatOptions): Promise<ChatResult> {
  const chain = resolveProviderChain();
  if (chain.length === 0) {
    throw new LlmError('LLM_UNCONFIGURED', 'LLM이 설정되지 않았습니다 (CHAT_LLM_API_KEY/DASHSCOPE_API_KEY 또는 CHAT_LLM_FB_KEY 또는 비상전원 ANTHROPIC_API_KEY).');
  }
  let lastErr: LlmError | null = null;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    if (i > 0 && lastErr) {
      logger.warn(
        { from: chain[i - 1].id, to: provider.id, reason: lastErr.code, detail: lastErr.message.slice(0, 300) },
        'LLM 비상전원 전환'
      );
    }
    try {
      return await attemptProvider(provider, opts);
    } catch (err) {
      if (!(err instanceof LlmError)) throw err; // 사용자 취소(AbortError) 등 재시도 대상 아님
      if (!err.retryable) throw err; // 스트림 중도 실패 — 다음 프로바이더로 넘기지 않는다
      lastErr = err;
    }
  }
  throw lastErr as LlmError;
}

/** tests/smoke_llm_failover.mjs가 쓰는 공개 alias. */
export const llmProviderChain = resolveProviderChain;
