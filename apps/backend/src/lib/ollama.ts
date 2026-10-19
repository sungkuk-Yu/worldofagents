/**
 * 로컬 Ollama 클라이언트 (t_82cc0d99)
 *
 * front desk empathy/ack 앞단 처리를 로컬 ollama(qwen2.5:3b)로 우선 수행,
 * 실패 시 cloud LLM으로 폴백하는 구조의 로컬 레인.
 */
import { config } from '../config';
import { logger } from '../utils/logger';

export interface OllamaError extends Error {
  code: 'TIMEOUT' | 'NETWORK' | 'BAD_RESPONSE' | 'DISABLED';
  retryable: boolean;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaOptions {
  messages: OllamaMessage[];
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface OllamaResult {
  text: string;
  durationMs: number;
}

function createOllamaError(code: OllamaError['code'], message: string): OllamaError {
  const err = new Error(message) as OllamaError;
  err.name = 'OllamaError';
  err.code = code;
  err.retryable = code !== 'DISABLED';
  return err;
}

/**
 * Ollama chat API 호출 — /api/chat 엔드포인트, 비스트리밍 모드.
 * 실패는 OllamaError를 던진다 (호출부가 cloud로 폴백).
 */
export async function ollamaChat(opts: OllamaOptions): Promise<OllamaResult> {
  const lfd = config.localFrontDesk;
  if (!lfd.enabled) {
    throw createOllamaError('DISABLED', 'LOCAL_FRONT_DESK_ENABLED=false');
  }

  const model = opts.model || lfd.model;
  const startMs = Date.now();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), lfd.timeoutMs);
  const onOuterAbort = () => abort.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const url = `${lfd.baseUrl}/api/chat`;
    const body = {
      model,
      messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.9,
        num_predict: 64,
      },
    };

    logger.debug?.({ url, model, messages: opts.messages.length }, 'ollama 호출 시작');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort.signal,
    });

    if (!res.ok) {
      throw createOllamaError('NETWORK', `ollama HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json() as any;
    const text = String(json?.message?.content ?? '').trim();
    if (!text) {
      throw createOllamaError('BAD_RESPONSE', 'ollama 빈 응답');
    }

    const durationMs = Date.now() - startMs;
    logger.debug?.({ text: text.slice(0, 60), durationMs }, 'ollama 성공');
    return { text, durationMs };

  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
      logger.debug?.({ timeoutMs: lfd.timeoutMs, durationMs }, 'ollama 타임아웃 → cloud 폴백');
      throw createOllamaError('TIMEOUT', `ollama timeout after ${durationMs}ms`);
    }
    if ((err as OllamaError).code) {
      throw err; // 이미 OllamaError
    }
    logger.debug?.({ err: String(err.message || err), durationMs }, 'ollama 장애 → cloud 폴백');
    throw createOllamaError('NETWORK', `ollama fetch: ${String(err.message || err)}`);

  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
