/**
 * Perplexity Sonar 검색 그라운딩 클라이언트 (t_d54bc456)
 *
 * 대표님 지시: "법률 답변과 조사는 퍼플렉시티로" — 법률·회계·의료 등 전문가
 * 카테고리 답변은 LLM 기억만으로 생성하면 안 되며, 최신 웹 검색 근거와
 * 출처(citations)를 반드시 동반한다.
 *
 * - OpenAI 호환 /chat/completions (model: sonar-pro) — raw fetch, SDK 미의존 (llm.ts와 동일 패턴)
 * - 응답의 citations(URL[]) + search_results(title/snippet)를 소스 목록으로 정규화
 * - 예외를 던지지 않고 GroundingResult.status 로 실패를 전달한다
 *   (호출부는 실패 시에도 턴을 완성하되 "검색 기반 아님"을 정직하게 표기한다).
 * - 종량제(pay-per-request) — 전문가 카테고리에서만 호출해 비용을 제어한다.
 */
import { config } from '../config';
import { Locale } from './locale';
import { logger } from '../utils/logger';

export type GroundingStatus = 'grounded' | 'failed' | 'skipped';

export interface GroundingSource {
  url: string;
  title: string | null;
  snippet: string | null;
  date: string | null;
}

export interface GroundingResult {
  status: GroundingStatus;
  /** Sonar가 검색 기반으로 생성한 답변문 (메인 LLM 프롬프트에 주입) */
  findings: string | null;
  /** citations URL 목록 (전체) */
  citations: string[];
  /** 검색 근거 카드용 소스 (search_results 병합, 최대 maxSources) */
  sources: GroundingSource[];
  model: string | null;
  durationMs: number;
  /** 실패/생략 사유 코드 */
  reason?: string;
  usage?: unknown;
}

export interface GroundingOptions {
  signal?: AbortSignal;
  /** 출처 상한 (기본 config.perplexity.maxSources) */
  maxSources?: number;
}

const SYSTEM_PROMPT = `You are a research grounding engine for expert (legal/tax/medical) answers.
Answer the user's question strictly from your live web search results, with inline numeric citations like [1][2].
Prefer primary/official sources (statutes, court data, government publications). State uncertainty honestly.
Do not add disclaimers of your own — the caller appends them.`;

function langHint(locale: Locale): string {
  return locale === 'ko' ? 'Answer in 한국어.' : 'Answer in English.';
}

/** Perplexity 응답 JSON → GroundingResult 정규화 (exported for tests) */
export function normalizeGroundingResponse(
  json: any,
  opts: { startedAt: number; maxSources: number; status?: GroundingStatus; reason?: string }
): GroundingResult {
  const content = String(json?.choices?.[0]?.message?.content ?? '').trim();
  const citations: string[] = Array.isArray(json?.citations)
    ? json.citations.filter((c: unknown) => typeof c === 'string' && /^https?:\/\//.test(c))
    : [];
  const searchResults: any[] = Array.isArray(json?.search_results) ? json.search_results : [];
  const byUrl = new Map<string, GroundingSource>();
  for (const sr of searchResults) {
    const url = typeof sr?.url === 'string' ? sr.url : null;
    if (!url || !/^https?:\/\//.test(url)) continue;
    byUrl.set(url, {
      url,
      title: typeof sr?.title === 'string' ? sr.title : null,
      snippet: typeof sr?.snippet === 'string' ? sr.snippet : null,
      date: typeof sr?.date === 'string' ? sr.date : (typeof sr?.last_updated === 'string' ? sr.last_updated : null),
    });
  }
  // citations 우선 (모델이 실제로 인용한 출처), 그다음 search_results 보충
  const ordered: GroundingSource[] = [];
  for (const url of citations) {
    ordered.push(byUrl.get(url) ?? { url, title: null, snippet: null, date: null });
    byUrl.delete(url);
  }
  for (const src of byUrl.values()) ordered.push(src);

  const hasGrounding = Boolean(content) && ordered.length > 0;
  const status: GroundingStatus = opts.status ?? (hasGrounding ? 'grounded' : 'failed');
  return {
    status,
    findings: hasGrounding ? content : null,
    citations,
    sources: status === 'grounded' ? ordered.slice(0, opts.maxSources) : [],
    model: typeof json?.model === 'string' ? json.model : null,
    durationMs: Date.now() - opts.startedAt,
    reason: opts.reason ?? (status === 'failed' ? (content ? 'NO_CITATIONS' : 'EMPTY_RESPONSE') : undefined),
    usage: json?.usage ?? undefined,
  };
}

export function isPerplexityConfigured(): boolean {
  return Boolean(config.perplexity.enabled && config.perplexity.apiKey);
}

/**
 * 전문가 질문 검색 그라운딩 — 절대 throw 하지 않는다.
 * 취소(signal)는 status:'failed', reason:'CANCELLED'로 전달된다.
 */
export async function searchGrounding(query: string, locale: Locale, opts: GroundingOptions = {}): Promise<GroundingResult> {
  const startedAt = Date.now();
  const maxSources = opts.maxSources ?? config.perplexity.maxSources;
  if (!isPerplexityConfigured()) {
    return { status: 'skipped', findings: null, citations: [], sources: [], model: null, durationMs: 0, reason: 'NOT_CONFIGURED' };
  }
  if (opts.signal?.aborted) {
    return { status: 'skipped', findings: null, citations: [], sources: [], model: null, durationMs: 0, reason: 'CANCELLED' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.perplexity.timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (opts.signal) {
    opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const res = await fetch(`${config.perplexity.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.perplexity.apiKey}`,
      },
      body: JSON.stringify({
        model: config.perplexity.model,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n${langHint(locale)}` },
          { role: 'user', content: query },
        ],
        temperature: 0.2,
        search_context_size: config.perplexity.searchContextSize,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const reason = res.status === 429 ? 'RATE_LIMITED' : res.status === 401 || res.status === 403 ? 'AUTH_FAILED' : `HTTP_${res.status}`;
      logger.warn({ status: res.status, body: bodyText.slice(0, 200) }, 'Perplexity grounding failed');
      return { status: 'failed', findings: null, citations: [], sources: [], model: null, durationMs: Date.now() - startedAt, reason };
    }
    const json: any = await res.json();
    return normalizeGroundingResponse(json, { startedAt, maxSources });
  } catch (err: any) {
    const cancelled = controller.signal.aborted;
    const reason = err?.name === 'AbortError' ? (cancelled && opts.signal?.aborted ? 'CANCELLED' : 'TIMEOUT') : 'UNAVAILABLE';
    logger.warn({ err: err?.message }, 'Perplexity grounding error');
    return { status: 'failed', findings: null, citations: [], sources: [], model: null, durationMs: Date.now() - startedAt, reason };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }
}

export interface GroundingSummary {
  status: GroundingStatus;
  engine: 'perplexity-sonar';
  model: string | null;
  sources: GroundingSource[];
  citations_total: number;
  reason?: string;
  duration_ms: number;
}

/** REST/WS에 그대로 실어 보낼 요약 (내부 GroundingResult → 직렬화 형태) */
export function toGroundingSummary(r: GroundingResult): GroundingSummary {
  return {
    status: r.status,
    engine: 'perplexity-sonar',
    model: r.model,
    sources: r.sources,
    citations_total: r.citations.length,
    ...(r.reason ? { reason: r.reason } : {}),
    duration_ms: r.durationMs,
  };
}

/** structured_payload.grounding — 프론트 인용 카드(Perplexity식 citation badge) 렌더용 */
export function groundingCardPayload(r: GroundingResult): Record<string, unknown> {
  return {
    engine: 'perplexity-sonar',
    status: r.status,
    model: r.model,
    retrieved_at: new Date().toISOString(),
    sources: r.sources,
    citations_total: r.citations.length,
  };
}

/** 메인 LLM 없이 그라운딩만 성공했을 때의 답변문 (Sonar 답변 + 출처 목록) */
export function groundingAnswerText(r: GroundingResult, locale: Locale): string {
  const header = locale === 'ko' ? '— Perplexity 최신 웹 검색 기반 답변 —' : '— Answer grounded in live Perplexity web search —';
  const sources = r.sources.map((s, i) => `[${i + 1}] ${s.url}${s.title ? ` (${s.title})` : ''}`).join('\n');
  return `${r.findings}\n\n${header}\n${sources}`;
}

/** 메인 LLM 시스템 프롬프트에 삽입할 그라운딩 컨텍스트 블록 */
export function buildGroundingPrompt(result: GroundingResult, locale: Locale): string {
  const header = locale === 'ko'
    ? '[실시간 검색 근거 — Perplexity 최신 웹 검색]\n아래 검색 결과는 법률·전문 조사 에이전트가 방금 확보한 최신 근거입니다. 답변은 반드시 이 근거에 기반으로 작성하고, 해당 사실을 쓸 때 [1][2]처럼 번호로 인용하세요. 근거에 없는 내용은 단정하지 말고 추가 확인이 필요하다고 밝히세요.'
    : '[Live web-search grounding — Perplexity]\nThe search findings below are fresh expert-grade sources retrieved just now. Answer strictly grounded in them and cite inline as [1][2]. Do not assert anything not covered by the findings — say verification is needed instead.';
  const lines = result.sources.map((s, i) => `[${i + 1}] ${s.url}${s.title ? ` — ${s.title}` : ''}${s.date ? ` (dated ${s.date})` : ''}`);
  return `${header}\n\n--- Search findings ---\n${result.findings}\n--- Sources ---\n${lines.join('\n')}`;
}

/** 검색 실패/미実施 시 정직 표기 (대표님 지시: "검색 실패 시에도 '검색 기반 아님' 정직 표기") */
export const GROUNDING_NOTES: Record<'UNAVAILABLE' | 'NO_SOURCES', Record<Locale, string>> = {
  UNAVAILABLE: {
    ko: '※ 실시간 검색을 수행하지 못해 본 답변은 검색 기반이 아닙니다. 최신 법령·판단 변경 여부를 반드시 확인하세요.',
    en: '※ Live search was unavailable, so this answer is not search-grounded. Please verify current statutes and rulings.',
  },
  NO_SOURCES: {
    ko: '※ 본 답변은 실시간 검색 근거를 확보하지 못해 검색 기반이 아닙니다. 최신 법령·판단 변경 여부를 반드시 확인하세요.',
    en: '※ No live-search sources were retrieved, so this answer is not search-grounded. Please verify current statutes and rulings.',
  },
};
