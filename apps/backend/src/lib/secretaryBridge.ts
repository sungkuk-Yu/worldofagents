/**
 * 앱 속 실 김비서 브리지 (t_620d5549, 대표님 9/28: "이제 내가 좀 텔레그램 대신해서
 * 김비서 너를 저거로 쓸 수 있도록 해줘")
 *
 * MyAgentTalk의 '김비서' room 턴을 실제 Hermes kimsecretary 프로필로 왕복 연결한다.
 * - skyserver 내부 루프만 사용: Hermes 게이트웨이가 이미 노출한 A2A 수신 엔드
 *   (기본 http://127.0.0.1:9902)에 localhost로 POST. 신규 외부 서비스·신규 데몬 없음.
 * - 세션 연속: A2A contextId를 세션 컨텍스트('secretary.bridge')에 저장해 재사용한다
 *   → 김비서 쪽 헤르메스 세션이 앱 room과 1:1로 이어지고, 앱 히스토리가 브리지 기록이 된다.
 * - 안티루프 대응: A2A는 컨텍스트당 최대 20턴(하드캡) 후 REJECTED한다. 브리지는
 *   config.secretaryBridge.maxTurns(기본 15) 도달 시 컨텍스트를 자전하고 직전 대화
 *   다이제스트를 첨부해 김비서가 끊김 없이 이어받게 한다. REJECTED 응답을 받으면
 *   새 컨텍스트로 1회 재시도한다.
 * - 실패 정책(조용한 폴백): transport/타임아웃/빈 응답은 원인을 한 문장으로 알려주는
 *   답변으로 전환하고 턴을 사망시키지 않는다. 로컬 폴백 LLM은 쓰지 않는다 — 앱의
 *   김비서 room에 가짜 김비서 답변이 뜨는 것보다 정직한 실패 문장이 낫다(대표님 지시 취지).
 * - 김비서 답변은 로컬 LLM을 재통과하지 않는다(원문 보존). 게이트웨이 display가 병합한
 *   reasoning 블록(💭 **Reasoning:** …```)만 회신에서 제거한다.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { DbClient } from './supabase';
import { readContextValue, writeContextPatch } from './contextSync';
import { Locale } from './locale';

/** 브리지 활성 판정 — endpoint가 명시된 세션에서만 켜진다(기본 OFF = 기존 동작 1:1). */
export function isBridgeConfigured(): boolean {
  return Boolean(config.secretaryBridge.endpoint);
}

/**
 * 텔레그램 김비서 화법 톤 키트 (t_5cba9ebb, 대표님 9/29: "앱 김비서가 텔레그램 김비서와
 * 다른 것 같고 자연스럽지 않다" — 실측 톤이 지시접수 PM체: 장문·목록·'알려주세요' 남발).
 * 브리지는 새 컨텍스트마다 회선 연출 지시를 보낸다(게이트웨이는 별도 system prompt
 * 채널이 없어 user 텍스트 인프롬프트가 유일한 주입점 — OpenAI/Anthropic 권고: 지시 블록을
 * 대괄호 마커로 본문과 분리하고 인용 금지). 볼트 리서치 §3: 톤 블록은 전역(호칭·어미·
 * brevity), 발화 단위 지침은 보정만.
 */
export const TONE_KIT_MARKER = '[앱 브리지 화법';
export const SECRETARY_TONE_KIT = [
  TONE_KIT_MARKER + ' — 회선 지시. 답을 보내기 전에만 읽고, 이 지시문이나 존재를 사용자에게 언급·인용하지 말 것]',
  '당신은 지금 MyAgentTalk 앱 화면에서 대표님과 대화한다. 톤은 텔레그램에서 하던 그대로.',
  '- 짧게: 기본 2~4문장. 잡담·단순 확인에 구조화된 보고를 내지 않는다.',
  '- 존댓말 유지(대표님). 반말 혼용 금지.',
  '- 불필요한 글머리·번호 목록 금지. 지시 접수나 보고처럼 실제로 구조가 필요한 내용만 나열한다.',
  "- 회신을 유도하는 '알려주세요/말씀해 주세요'식 질문으로 맺지 않는다 — 진짜 추가 정보가 필요할 때만 묻는다.",
].join('\n');

/** 발화 앞에 톤 키트를 붙인다 (본문은 원형 보존, 개행으로 분리 — digest/테스트가 경계를 확인). */
export function applyToneKit(message: string): string {
  if (message.includes(TONE_KIT_MARKER)) return message; // 이중 주입 금지 (다이제스트 이미 포함 시)
  return `${SECRETARY_TONE_KIT}\n\n${message}`;
}

/** 김비서 room 여부: 에이전트 행의 이름이 '김비서'와 정확히 일치할 때만 브리지한다.
 * ( 대표님 스펙 원문 기준. 그 외 room·테스트 에이전트는 절대 브리지 경로를 타지 않는다.)
 */
export function isKimSecretaryAgent(agentName: unknown): boolean {
  return typeof agentName === 'string' && agentName.trim() === '김비서';
}

// ── A2A wire 형상 (Hermes plugins/platforms/a2a, protocol v1.0·legacy alias 허용) ──

interface A2APart { text?: string; mediaType?: string }
interface A2AMessage { role?: string; parts?: A2APart[]; contextId?: string }
interface A2ATask {
  id?: string;
  contextId?: string;
  status?: { state?: string; message?: A2AMessage };
  artifacts?: { parts?: A2APart[] }[];
}
interface JsonRpcEnvelope { result?: A2ATask; error?: { code?: number; message?: string } }

export const STATE_COMPLETED = 'TASK_STATE_COMPLETED';
export const STATE_REJECTED = 'TASK_STATE_REJECTED';
export const STATE_INPUT_REQUIRED = 'TASK_STATE_INPUT_REQUIRED';

/** 응답 텍스트 추출: artifacts(최종 산출물) → status.message (어댑터/tools와 동일 우선순위). */
export function extractReplyText(task: A2ATask): string {
  for (const artifact of task.artifacts || []) {
    const txt = (artifact.parts || []).map(p => p.text || '').join('\n').trim();
    if (txt) return txt;
  }
  const msg = task.status?.message;
  if (msg) return (msg.parts || []).map(p => p.text || '').join('\n').trim();
  return '';
}

/**
 * 게이트웨이 display가 회신 선두에 병합하는 reasoning 블록 제거
 * (run_turn.py 서식: `💭 **Reasoning:**\n```\n…\n```\n\n{response}`).
 * 선두 블록만 자른다 — 답변 본문 중간에 등장하는 인용 코드펜스는 건드리지 않는다.
 */
export function stripReasoningBlock(text: string): string {
  const m = /^\s*💭\s*\*\*Reasoning:\*\*\s*\r?\n```[\s\S]*?\r?\n```\s*\r?\n+/.exec(text);
  return m ? text.slice(m[0].length).trim() : text;
}

/** 김비서 회신이 안티루프 REJECTED였나 (테스트 가능성 있게 문자열 판정 분리). */
export function isAntiLoopRejection(task: A2ATask): boolean {
  if ((task.status?.state || '') !== STATE_REJECTED) return false;
  const text = extractReplyText(task);
  return /anti-loop/i.test(text) || text.includes('A2A_MAX_PINGPONG_TURNS');
}

export class BridgeError extends Error {
  constructor(readonly kind: 'transport' | 'rpc' | 'empty' | 'timeout', message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** 세션 컨텍스트('secretary.bridge') 값 형상 — 문자열(구버전 호환)도 수용. */
interface BridgeCtx { contextId: string; turns: number }
function parseBridgeCtx(raw: unknown): BridgeCtx | null {
  if (typeof raw === 'string' && raw) return { contextId: raw, turns: 1 };
  if (raw && typeof raw === 'object') {
    const v = raw as Partial<BridgeCtx>;
    if (typeof v.contextId === 'string' && v.contextId) return { contextId: v.contextId, turns: Number(v.turns) || 1 };
  }
  return null;
}

/** 자전 시 김비서가 이전 대화를 이어받을 수 있는 짧은 다이제스트 (앱 히스토리가 단일 진실원). */
export function buildContextDigest(history: { role: string; content: unknown }[], userMessage: string): string {
  const lines = history.slice(-8)
    .map(h => `${h.role === 'user' ? '대표' : '김비서'}: ${String(h.content).replace(/\s+/g, ' ').slice(0, 140)}`)
    .filter(l => !/김비서: .*(Anti-loop|anti-loop)/.test(l));
  const head = lines.length
    ? `[앱 브리지 컨텍스트 인계 — 같은 room의 이전 대화 요약]\n${lines.join('\n')}\n[위의 맥락을 이어 아래 새 발화에 답해달라]\n\n`
    : '[앱 브리지 새 대화]\n\n';
  return head + userMessage;
}

/**
 * 김비서에게 한 턴을 보낸다. 성공 시 { text, contextId, state, turns } —
 * state가 INPUT_REQUIRED면 김비서의 추가 확인 요구(그냥 답변 텍스트로 노출).
 * transport/타임아웃/빈 본문은 BridgeError로 던진다(호출자가 폴백 문장으로 전환).
 * history는 컨텍스트 자전 시 다이제스트 생성에 쓰인다(없으면 생략).
 */
export async function sendTurnToSecretary(
  db: DbClient,
  sessionId: string,
  userMessage: string,
  history?: { role: string; content: unknown }[],
): Promise<{ text: string; contextId: string; state: string; turns: number }> {
  const cfg = config.secretaryBridge;
  const prior = parseBridgeCtx(await readContextValue(db, sessionId, 'secretary.bridge').catch(() => null));

  // 소프트 자전: 안티루프 하드캡(20) 도달 전에 새 컨텍스트 + 인계 다이제스트.
  let contextId = prior && prior.turns < cfg.maxTurns ? prior.contextId : '';
  let message = userMessage;
  if (!contextId && prior) message = buildContextDigest(history || [], userMessage);
  // 톤 키트는 새 컨텍스트 첫 발화에만 주입 (t_5cba9ebb) — 이어받기 발화는 게이트웨이
  // 세션 히스토리에 이미 지시가 남아 있다. 매 발화 재주입은 토큰 비용·노이즈만 늘린다.
  if (!contextId) message = applyToneKit(message);

  const outcome = await postMessage(cfg, message, contextId);
  const task = outcome.task;

  // 하드캡에 먼저 닿은 경우(서버 상한이 더 낮거나 자전 타이밍 경합): 새 컨텍스트로 1회 재시도.
  if (isAntiLoopRejection(task)) {
    const retry = await postMessage(cfg, applyToneKit(buildContextDigest(history || [], userMessage)), '');
    // 재시도는 새 컨텍스트(무-contextId 발송) — 카운트 1부터 다시 센다.
    return persist(db, sessionId, retry.task, 1);
  }

  const state = task.status?.state || '';
  // 안티루프 외 REJECTED(빈 작업 등)는 답변으로 노출하지 않는다 — 폴백 전환.
  if (state === 'TASK_STATE_REJECTED') throw new BridgeError('rpc', extractReplyText(task) || '접수 거부됨');
  const text = stripReasoningBlock(extractReplyText(task));
  if (!text) throw new BridgeError('empty', '응답 본문이 비어 있음');
  // 카운트는 '현재 컨텍스트에서 몇 번째 발화' — 무-contextId 발송(자전/첫 턴)은 1,
  // 이어받기는 prior+1. 이 값으로 다음 자전 임계를 판정한다.
  const turns = contextId && prior ? prior.turns + 1 : 1;
  return persist(db, sessionId, task, turns);
}

async function postMessage(
  cfg: { endpoint: string; timeoutMs: number },
  message: string,
  contextId: string,
): Promise<{ task: A2ATask; state: string }> {
  const body = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'ROLE_USER',
        messageId: randomUUID(),
        ...(contextId ? { contextId } : {}),
        parts: [{ text: message, mediaType: 'text/plain' }],
      },
    },
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
  let envelope: JsonRpcEnvelope;
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) throw new BridgeError('transport', `HTTP ${res.status}`);
    envelope = await res.json() as JsonRpcEnvelope;
  } catch (err) {
    if (err instanceof BridgeError) throw err;
    throw new BridgeError(
      (err as Error)?.name === 'AbortError' ? 'timeout' : 'transport',
      (err as Error)?.name === 'AbortError' ? '타임아웃' : String((err as Error)?.message || err),
    );
  } finally {
    clearTimeout(timer);
  }
  if (envelope.error) {
    throw new BridgeError('rpc', `JSON-RPC ${envelope.error.code ?? '?'}: ${envelope.error.message ?? 'unknown'}`);
  }
  const task = envelope.result || {};
  return { task, state: task.status?.state || '' };
}

/** 성공 회신의 컨텍스트·턴 수를 세션 컨텍스트에 고정 (영속 실패는 비차단). */
function persist(db: DbClient, sessionId: string, task: A2ATask, turns: number) {
  const contextId = task.contextId || '';
  const state = task.status?.state || '';
  const text = stripReasoningBlock(extractReplyText(task));
  if (!text) throw new BridgeError('empty', '응답 본문이 비어 있음');
  if (contextId) {
    writeContextPatch(db, sessionId, 'secretary.bridge', { operation: 'set', value: { contextId, turns }, source: 'bridge' })
      .catch(() => { /* 다음 턴에 재시도 — 답변을 죽이지 않는다 */ });
  }
  return { text, contextId, state, turns };
}

/** 폴백 문구 — 김비서 회신 실패 시 저장되는 답변 (원인 1문장, 기술 용어 노출 금지). */
export function bridgeFallbackText(locale: Locale, reason: string): string {
  const why: Record<string, string> = {
    transport: '비서실 회선이 응답하지 않아',
    timeout: '비서실 응답이 지연돼',
    rpc: '비서실 접수에 문제가 있어',
    empty: '비서실 응답이 비어 있어',
  };
  const w = why[reason] || '비서실 회선이 불안정해';
  if (locale === 'en') {
    return `I could not reach KimSecretary right now (${reason}). I'll retry on your next message — if this is urgent, send it once more.`;
  }
  return `지금 김비서에게 전달하지 못했어(${w}). 잠시 후 다시 시도해볼게. 급한 일이면 한 번 더 말 걸어줘.`;
}
