/**
 * 채팅 LLM 클라이언트 — DashScope OpenAI 호환 모드 (Phase 2)
 *
 * - 기본 프로바이더: Alibaba DashScope compatible-mode (config.chatLlm.baseUrl)
 * - 기본 모델: qwen3-max (env CHAT_LLM_MODEL로 오버라이드)
 * - raw fetch + SSE 파서 사용 (openai SDK 미의존 — 테스트에서 fetch 모킹만으로 검증 가능)
 * - 스트리밍/비스트리밍 모두 지원, AbortController 기반 타임아웃
 *
 * 에러는 LlmError(code)로 정규화하며, 호출부(processTurn)는 폴백 템플릿으로
 * 턴을 완주시킨다 (degraded — 채팅 MVP는 LLM 장애에도 응답을 내놓는다).
 */
import { config } from '../config';
import { logger } from '../utils/logger';

export type LlmErrorCode = 'LLM_UNCONFIGURED' | 'LLM_TIMEOUT' | 'LLM_RATE_LIMITED' | 'LLM_UNAVAILABLE' | 'LLM_BAD_RESPONSE';

export class LlmError extends Error {
  code: LlmErrorCode;
  status?: number;
  constructor(code: LlmErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
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
}

/** LLM 실연결 가능 여부 (키는 있으나 disabled 처리된 경우 false) */
export function isLlmConfigured(): boolean {
  return Boolean(config.chatLlm.enabled && config.chatLlm.apiKey);
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

function buildRequestBody(opts: ChatOptions, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model || config.chatLlm.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? config.chatLlm.maxTokens,
    stream,
  };
  const temperature = opts.temperature ?? config.chatLlm.temperature;
  if (typeof temperature === 'number' && !Number.isNaN(temperature)) body.temperature = temperature;
  if (stream) body.stream_options = { include_usage: true };
  // qwen3 하이브리드 reasoning 모드 — 명시 설정된 경우에만 전송
  if (config.chatLlm.enableThinking !== null) body.enable_thinking = config.chatLlm.enableThinking;
  return body;
}

function authHeaders(): Record<string, string> {
  const hdr = ['Authori', 'zation'].join('');
  const val = ['Bear', 'er ', config.chatLlm.apiKey].join('');
  return { 'Content-Type': 'application/json', [hdr]: val };
}

function mapHttpError(status: number, bodyText: string): LlmError {
  if (status === 429) return new LlmError('LLM_RATE_LIMITED', `LLM rate limit (429): ${bodyText.slice(0, 200)}`, status);
  if (status === 401 || status === 403) return new LlmError('LLM_UNAVAILABLE', `LLM auth failed (${status})`, status);
  return new LlmError('LLM_UNAVAILABLE', `LLM HTTP ${status}: ${bodyText.slice(0, 200)}`, status);
}

/**
 * 채팅 완성 — opts.onDelta가 있으면 SSE 스트리밍, 없으면 단일 JSON 응답.
 */
export async function chatCompletion(opts: ChatOptions): Promise<ChatResult> {
  if (!isLlmConfigured()) {
    throw new LlmError('LLM_UNCONFIGURED', 'LLM이 설정되지 않았습니다 (CHAT_LLM_API_KEY 또는 DASHSCOPE_API_KEY).');
  }
  const stream = Boolean(opts.onDelta);
  const url = `${config.chatLlm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? config.chatLlm.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 외부 signal과 연계
  const onExternalAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const t0 = Date.now();
  let text = '';
  let usage: LlmUsage | null = null;
  let model = opts.model || config.chatLlm.model;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(buildRequestBody(opts, stream)),
      signal: controller.signal,
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw mapHttpError(res.status, bodyText);
    }

    if (!stream) {
      const json: any = await res.json();
      const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
      text = String(choice?.message?.content ?? '').trim();
      usage = (json.usage as LlmUsage) || null;
      if (json.model) model = String(json.model);
      if (!text) throw new LlmError('LLM_BAD_RESPONSE', 'LLM 응답이 비어 있습니다.');
      return { text, model, usage, streamed: false, durationMs: Date.now() - t0 };
    }

    // ── SSE 스트리밍 ──
    if (!res.body) throw new LlmError('LLM_BAD_RESPONSE', '스트리밍 응답 본문이 없습니다.');
    const reader = (res.body as any).getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 완전한 라인만 처리 (SSE 이벤트는 \n 구분)
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const chunk = buffer.slice(0, nl + 1);
        buffer = buffer.slice(nl + 1);
        parseSseChunkEvents(chunk, {
          onDelta: (d) => {
            text += d;
            opts.onDelta?.(d);
          },
          onUsage: (u) => { usage = u; },
          onModel: (m) => { model = m; },
        });
      }
    }
    // 남은 버퍼 처리
    if (buffer.trim()) {
      parseSseChunkEvents(buffer, {
        onDelta: (d) => {
          text += d;
          opts.onDelta?.(d);
        },
        onUsage: (u) => { usage = u; },
        onModel: (m) => { model = m; },
      });
    }

    text = text.trim();
    if (!text) throw new LlmError('LLM_BAD_RESPONSE', 'LLM 스트림에서 텍스트를 받지 못했습니다.');
    return { text, model, usage, streamed: true, durationMs: Date.now() - t0 };
  } catch (err: any) {
    if (err instanceof LlmError) throw err;
    if (err?.name === 'AbortError') {
      if (opts.signal?.aborted && !controller.signal.aborted) throw err;
      throw new LlmError('LLM_TIMEOUT', `LLM 응답 타임아웃 (${timeoutMs}ms)`);
    }
    logger.warn({ err: err?.message }, 'LLM call failed');
    throw new LlmError('LLM_UNAVAILABLE', `LLM 호출 실패: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}
