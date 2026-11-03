// 그룹채팅 P1 — PM 라우터 (t_a5c340d0, 2032cbdc+b50b8ef5 재구현)
// @멘션 > 답글 target > 저가 모델 판단 우선순위를 코드 보장(명시 경로 모델호출 0회).
// 출력 고정 계약 {responders, mode(single|parallel|sequence), confidence[0,1]}.
// 실패 전 경로 fail-closed(responders=[] — 빈 responders는 D5 호출 금지 신호).
// audit·로그에 메시지 본문·시크릿 금지(문자수/개수만).
import { chatCompletion, LlmError, type ChatMessage, type ChatOptions, type LlmUsage } from './llm.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import type { RouteDecision, RouteDecider, RouteMode, RouterInput } from './groupChatContext.js';

export const MODES: RouteMode[] = ['single', 'parallel', 'sequence'];
export const MAX_RESPONDERS = 3; // mention 초과 truncated(승인) 모델 응답 truncation audit

export type PmRouteSource = 'mention' | 'reply' | 'model' | 'clarify' | 'degraded';
export type PmDegradedReason = 'model_unavailable' | 'invalid_output' | 'no_candidates' | null;

export interface PmCandidate {
  agent_id: string;
  name?: string;
  card: string; // role card = agents.description(대체 [역할카드 미설정])
}

export interface PmRouterRequest {
  roomId: string;
  ownerId: string;
  messageId: string;
  message: string;
  roleCards: PmCandidate[]; // 후보 풀=화이트리스트
  mentions: string[]; // @멘션 원시 배열(미보정)
  replyTo: { authorType: 'user' | 'agent'; authorId: string } | null;
  threadSummary?: string | null;
  signal?: AbortSignal;
}

export interface PmRouterAudit {
  dropped_mentions: string[]; // 화이트리스트 밖/중복 제거된 멘션
  dropped_invalid: string[]; // 모델 응답에서 제거된 unknown ID
  truncated: boolean; // >3 truncation 발생
  mode_normalized: boolean; // 응답 mode 정규화 발생
  raw_confidence: number | null; // clamp 전 원값 보존
  mention_reply_to: string | null; // 답글 타깃(P2 계약 강화 필드)
}

export interface PmRouterResult {
  decision: RouteDecision;
  route_source: PmRouteSource;
  clarify: boolean; // 저신뢰 되물음(사용자 질문 필요)
  clarify_utterance: string | null;
  degraded: PmDegradedReason;
  low_confidence: boolean;
  model: string | null;
  usage: LlmUsage | null;
  attempts: number;
  latency_ms: number;
  audit: PmRouterAudit;
  message_chars: number;
  candidate_count: number;
}

export interface PmRouterDeps {
  chat?: (opts: ChatOptions) => Promise<Awaited<ReturnType<typeof chatCompletion>>>;
}

function envNumber(name: string, def: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : def;
}

export function routerConfig() {
  // 음수 env clamp(b50b8ef5 머신리뷰 반영): 임계는 [0,1]로만 해석
  const threshold = Math.min(1, Math.max(0, envNumber('PM_ROUTER_LOW_CONF', 0.5)));
  const actionRaw = (process.env.PM_ROUTER_LOW_CONF_ACTION ?? 'clarify').trim().toLowerCase();
  const action = actionRaw === 'single_top' ? 'single_top' : 'clarify';
  const model = process.env.PM_ROUTER_MODEL || config.chatLlm.model || 'qwen3.8-flash';
  return { threshold, action, model };
}

function emptyAudit(replyTo: PmRouterRequest['replyTo']): PmRouterAudit {
  return {
    dropped_mentions: [], dropped_invalid: [], truncated: false,
    mode_normalized: false, raw_confidence: null, mention_reply_to: replyTo?.authorId ?? null,
  };
}

function finalize(req: PmRouterRequest, partial: Omit<PmRouterResult, 'message_chars' | 'candidate_count'>): PmRouterResult {
  const out: PmRouterResult = { ...partial, message_chars: req.message.length, candidate_count: req.roleCards.length };
  logger.info({
    evt: 'pm-router', room_id: out.decision ? req.roomId : undefined, message_id: req.messageId,
    route_source: out.route_source, decision: out.decision, clarify: out.clarify,
    degraded: out.degraded, low_confidence: out.low_confidence, model: out.model, usage: out.usage,
    attempts: out.attempts, latency_ms: out.latency_ms, audit: out.audit,
    message_chars: out.message_chars, candidate_count: out.candidate_count,
  }, 'pm_router_decision');
  return out;
}

function failClosed(req: PmRouterRequest, degraded: PmDegradedReason, opts: {
  attempts?: number; latencyMs?: number; model?: string | null; usage?: LlmUsage | null; audit?: PmRouterAudit; confidence?: number; source?: PmRouteSource;
} = {}): PmRouterResult {
  return finalize(req, {
    decision: { responders: [], mode: 'single', confidence: opts.confidence ?? 0 },
    route_source: opts.source ?? 'degraded', clarify: false, clarify_utterance: null,
    degraded, low_confidence: false, model: opts.model ?? null, usage: opts.usage ?? null,
    attempts: opts.attempts ?? 0, latency_ms: opts.latencyMs ?? 0,
    audit: opts.audit ?? emptyAudit(req.replyTo),
  });
}

const CLARIFY_UTTERANCE = '누구의 답변이 필요하신 건지 조금 더 알려주시겠어요? (@멘션이나 답글로 지정해 주시면 바로 연결할게요.)';

/** 멘션 정규화: @ 접두 제거·trim·중복 제거 → {ids, dropped, truncated} */
export function normalizeMentions(mentions: string[], allowlist: Set<string>): { ids: string[]; dropped: string[]; truncated: boolean } {
  const dropped: string[] = [];
  const ids: string[] = [];
  for (const raw of mentions) {
    const id = String(raw).replace(/^@+/, '').trim();
    if (!id || !allowlist.has(id) || ids.includes(id)) { dropped.push(id || String(raw)); continue; }
    ids.push(id);
  }
  let truncated = false;
  let out = ids;
  if (out.length > MAX_RESPONDERS) { out = out.slice(0, MAX_RESPONDERS); truncated = true; }
  return { ids: out, dropped, truncated };
}

function modelPrompt(req: PmRouterRequest): ChatMessage[] {
  const cards = req.roleCards.map((c) => ({ agent_id: c.agent_id, name: c.name ?? c.agent_id, card: c.card }));
  const summary = req.threadSummary ? `\n최근 스레드 요약: ${req.threadSummary}` : '';
  return [
    { role: 'system', content: [
      '당신은 그룹채팅 PM 라우터입니다. 사용자 메시지를 보고 응답할 에이전트를 결정합니다.',
      '반드시 아래 JSON 오브젝트만 출력합니다(설명·마크다운 금지):',
      '{"responders":["<agent_id>"],"mode":"single|parallel|sequence","confidence":0.0}',
      '- responders: 역할카드 agent_id 중 사용자 질문에 답할 에이전트 1~3명. 없으면 빈 배열.',
      '- mode: 1명=single, 독립 병렬=parallel, 순서 의존=sequence.',
      '- confidence: 0~1 실수. 불확실하면 낮게.',
    ].join('\n') },
    { role: 'user', content: `역할카드: ${JSON.stringify(cards)}${summary}\n\n사용자 메시지:\n${req.message}` },
  ];
}

interface ParsedOutput { responders: string[]; mode: RouteMode; confidence: number; }

function parseModelJson(text: string): ParsedOutput | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: any;
  try { obj = JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.responders)
    || typeof obj.confidence !== 'number' || !Number.isFinite(obj.confidence)) return null;
  const mode: RouteMode = MODES.includes(obj.mode) ? obj.mode : 'single';
  return { responders: obj.responders.filter((r: unknown) => typeof r === 'string'), mode, confidence: obj.confidence };
}

async function callModel(req: PmRouterRequest, deps: PmRouterDeps) {
  const { model } = routerConfig();
  const chat = deps.chat ?? chatCompletion;
  const messages = modelPrompt(req);
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const res = await chat({ messages, model, temperature: 0, maxTokens: 256, signal: req.signal, enableThinking: false });
      return { ok: true as const, res, attempts: attempt };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false as const, reason: 'model_unavailable' as const, attempts: attempt, aborted: true };
      }
      const retryable = err instanceof LlmError && err.retryable;
      if (retryable && attempt < 2) continue; // transport만 재시도 1회
      return { ok: false as const, reason: 'model_unavailable' as const, attempts: attempt };
    }
  }
}

/**
 * 고정 계약 라우터. 우선순위: @멘션 > 답글 target > 모델.
 * 명시 경로(멘션/답글)에서는 모델을 호출하지 않는다.
 */
export async function routePmTurn(req: PmRouterRequest, deps: PmRouterDeps = {}): Promise<PmRouterResult> {
  const allowlist = new Set(req.roleCards.map((c) => c.agent_id));
  const audit = emptyAudit(req.replyTo);

  // 1) @멘션
  if (req.mentions.length > 0) {
    const { ids, dropped, truncated } = normalizeMentions(req.mentions, allowlist);
    audit.dropped_mentions = dropped;
    audit.truncated = truncated;
    if (ids.length === 0) {
      // 전원 미보정 → fail-closed (되물음 아님: dropped审计)
      return failClosed(req, 'invalid_output', { audit, source: 'mention' });
    }
    return finalize(req, {
      decision: { responders: ids, mode: ids.length === 1 ? 'single' : 'parallel', confidence: 1 },
      route_source: 'mention', clarify: false, clarify_utterance: null, degraded: null,
      low_confidence: false, model: null, usage: null, attempts: 0, latency_ms: 0, audit,
    });
  }

  // 2) 답글 target
  if (req.replyTo && req.replyTo.authorType === 'agent' && allowlist.has(req.replyTo.authorId)) {
    return finalize(req, {
      decision: { responders: [req.replyTo.authorId], mode: 'single', confidence: 1 },
      route_source: 'reply', clarify: false, clarify_utterance: null, degraded: null,
      low_confidence: false, model: null, usage: null, attempts: 0, latency_ms: 0, audit,
    });
  }

  // 3) 모델 — 후보 풀 없음은 호출 무의미 → fail-closed(no_candidates), 0시도
  if (req.roleCards.length === 0) return failClosed(req, 'no_candidates', { audit });

  const t0 = Date.now();
  const call = await callModel(req, deps);
  const latency = Date.now() - t0;
  if (!call.ok) {
    return failClosed(req, call.reason, { attempts: call.attempts, latencyMs: latency, audit });
  }
  const parsed = parseModelJson(call.res.text);
  if (!parsed) {
    return failClosed(req, 'invalid_output', { attempts: call.attempts, latencyMs: latency, model: call.res.model, usage: call.res.usage, audit });
  }
  const valid = parsed.responders.filter((r) => allowlist.has(r));
  audit.dropped_invalid = parsed.responders.filter((r) => !allowlist.has(r));

  let confidence = parsed.confidence;
  if (confidence < 0 || confidence > 1) {
    audit.raw_confidence = confidence;
    confidence = Math.min(1, Math.max(0, confidence)); // 음수/env clamp, 원값 보존
  }
  const { threshold, action } = routerConfig();

  if (valid.length === 0) {
    // 스펙 우선순위: 저신뢰 되물음이 fail-closed보다 앞. 빈/전원 미등록이라도
    // confidence < threshold면 추측 아닌 되물음(clarify). 고신뢰 전원이 미등록이면
    // 화이트리스트 위반 데이터 문제로 보고 fail-closed — 어쨌든 D5 호출 금지 유지.
    if (confidence < threshold) {
      return finalize(req, {
        decision: { responders: [], mode: parsed.mode, confidence },
        route_source: 'clarify', clarify: true, clarify_utterance: CLARIFY_UTTERANCE, degraded: null,
        low_confidence: true, model: call.res.model, usage: call.res.usage,
        attempts: call.attempts, latency_ms: latency, audit,
      });
    }
    return failClosed(req, 'invalid_output', { attempts: call.attempts, latencyMs: latency, model: call.res.model, usage: call.res.usage, audit, confidence: 0 });
  }
  let mode = parsed.mode;
  let responders = valid;
  if (mode === 'single' && valid.length > 1) { mode = 'parallel'; audit.mode_normalized = true; }
  if (responders.length > MAX_RESPONDERS) { responders = responders.slice(0, MAX_RESPONDERS); audit.truncated = true; }

  if (confidence < threshold) {
    if (action === 'single_top') {
      return finalize(req, {
        decision: { responders: [responders[0]], mode: 'single', confidence },
        route_source: 'model', clarify: false, clarify_utterance: null, degraded: null,
        low_confidence: true, model: call.res.model, usage: call.res.usage,
        attempts: call.attempts, latency_ms: latency, audit,
      });
    }
    // 기본: 저신뢰 → 되물음(확정 상대 질문), responders=[] (D5 준수)
    return finalize(req, {
      decision: { responders: [], mode, confidence },
      route_source: 'clarify', clarify: true, clarify_utterance: CLARIFY_UTTERANCE, degraded: null,
      low_confidence: true, model: call.res.model, usage: call.res.usage,
      attempts: call.attempts, latency_ms: latency, audit,
    });
  }

  return finalize(req, {
    decision: { responders, mode, confidence },
    route_source: 'model', clarify: false, clarify_utterance: null, degraded: null,
    low_confidence: false, model: call.res.model, usage: call.res.usage,
    attempts: call.attempts, latency_ms: latency, audit,
  });
}

/** t_ea0b1f95 결합점 어댑터: 고정 RouteDecider 인터페이스로 노출. */
export function makePmRouteDecider(deps: PmRouterDeps = {}): RouteDecider {
  return async (input: RouterInput) => {
    const result = await routePmTurn({
      roomId: input.roomId, ownerId: input.ownerId, messageId: input.messageId,
      message: input.userText, roleCards: input.roleCards, mentions: [], replyTo: null,
      threadSummary: input.threadSummary,
    }, deps);
    return result.decision;
  };
}
