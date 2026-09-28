import { Locale, appendLanguageInstruction, pickQuip, QuipKey } from '../lib/locale';
/**
 * 뉴런 오케스트레이션 그래프 — neuron-architecture-spec §5
 * LangGraph StateGraph 구성 (공감 → Router → 답변/비주얼 → Compose).
 * LangGraph를 사용할 수 없는 환경(테스트/개발)에서는 동일 노드 함수를
 * 순차 파이프라인(simple engine)으로 실행한다.
 *
 * 노드는 상태 변환과 실시간 이벤트를 담당하며 답변 노드만 LLM을 호출한다.
 * processTurn은 사용자 메시지를 먼저 저장하고 응답 및 사용량을 영속화한다.
 */
import { classifyStructured, StructuredAnswer } from '../lib/structured';
import { randomUUID } from 'node:crypto';
import { withSessionLock } from '../lib/turnLock';
import { ApiError } from '../lib/errors';
import { chatCompletion, isLlmConfigured, LlmError, ChatMessage } from '../lib/llm';
import { GroundingResult, GroundingSummary, searchGrounding, buildGroundingPrompt, groundingAnswerText, groundingCardPayload, isPerplexityConfigured, toGroundingSummary, GROUNDING_NOTES } from '../lib/perplexity';
import { MessagesRow } from '../types/db';
import { config } from '../config';
import { DbClient } from '../lib/supabase';
import { linkAttachmentsToMessage } from '../lib/attachments';
import { photoEditCardForTurn, photoEditDirectivePending } from '../lib/photoEditCard';
import { PersonaConfig, DialogueType } from '../types/db';
import { NeuronRouter, classifyDialogueType } from './router';
import { classifyByLLM, CLASSIFY_ADOPT } from './llmClassify';
import { generateSuggestedQuestions, SuggestedQuestion } from '../lib/suggestedQuestions';
import { buildPersonaPrompt, PersonaGuard, classifyExpertise, DISCLAIMERS } from '../lib/persona';
import { activateNeuronInstance, getNeuronBySlug } from './registry';

export type NeuronStage = 'thinking' | 'organizing' | 'finalizing' | 'rendering';

export interface NeuronStatusEvent {
  neuron: string;
  status: 'processing' | 'idle' | 'degraded';
  stage: NeuronStage;
  quip: string;
}

export interface LlmRunInfo {
  used: boolean;
  model: string | null;
  fallback: boolean;
  /** 실제 답변을 만든 프로바이더 id (전원/비상전원 구분 — t_67eaf475). */
  provider?: string;
  reason?: string;
  usage?: unknown;
  durationMs?: number;
}

export interface NodeContext {
  signal?: AbortSignal;
  classificationCancelled?: boolean;
  emit(e: NeuronStatusEvent): void;
  onDelta?(d: string): void;
  llm: LlmRunInfo;
  /** 공감 확인음 노출 후 답변 LLM 시작 전 대기(ms) — t_344e047a ①. 0이면 즉시. */
  leadMs?: number;
  /** ③ 후속 질문 보강 컨텍스트(볼트 노트·선호) 조회용 — processTurn이 주입. */
  db?: DbClient;
}

type HistoryMessage = { role: string; content: string; source_neuron?: string | null };

/** 뉴런 이벤트 quip: 페르소나 말투(tone_config.quip_tone/formality) + 세션 로케일 조합. */
function quipText(state: NeuronState, key: QuipKey): string {
  return pickQuip(key, state.locale, state.persona?.tone);
}

export interface NeuronState {
  locale: Locale;
  // 식별
  sessionId: string;
  userId: string;
  agentId: string;
  persona: PersonaConfig | null;
  history: HistoryMessage[];
  llm: LlmRunInfo;
  // 입력
  userMessage: string;
  sttMetadata: Record<string, unknown> | null;
  // 라우팅
  dialogueType: DialogueType;
  /** 판별 단계 (1=패턴 확정 2=LLM 인용 3=규칙 폴백) — classifier_stage 계약 (t_56498848). */
  dialogueStage?: 1 | 2 | 3;
  dialogueConfidence?: number;
  activationPlan: string[];
  reason: string;
  hasActiveTask: boolean;
  pendingQueueLength: number;
  // 뉴런 출력
  empathyResponse: string | null;
  answerResponse: string | null;
  structured: StructuredAnswer;
  visualRequested: boolean;
  /** 전문가 그라운딩 (t_d54bc456) — 법률·회계 카테고리 판정과 검색 활성화 조건 */
  expertise: keyof typeof DISCLAIMERS;
  groundEnabled: boolean;
  grounding: GroundingResult | null;
  /** photo_edit 지시+이미지 첨부 동반 (t_78ffba4f) — routerNode가 answer 강제 활성에 사용. */
  photoEditPending?: boolean;
  /** 예/아니오 확인 발화 에코 억제 (t_135a19b5, 대표님 9/28 정정) — true면 empathy 뉴런 skip. */
  empathySuppressed?: boolean;
  // 컴포즈
  finalResponse: { empathy: string | null; answer: string | null; visualsRequested: boolean };
  events: NeuronStatusEvent[];
  // 디버그
  engine: 'langgraph' | 'simple';
}

export interface ProcessTurnOptions {
  locale?: Locale;
  thread?: { parentMessageId: string; rootMessageId: string };
  signal?: AbortSignal;
  emitEvent?: (event: NeuronStatusEvent) => void;
  history?: HistoryMessage[];
  /** 공유 실행기가 상태 이벤트와 같은 식별자를 사용하도록 전달한다. */
  turnId?: string;
  onAnswerDelta?(delta: string, index: number): void;
  onTurnStatus?(status: 'received' | 'processing' | 'completed' | 'failed', extra?: { stage?: NeuronStage; error?: { code: string; message: string } }): void;
  /** STT 메타데이터 (음성 입력인 경우) */
  sttMetadata?: Record<string, unknown> | null;
  /** 첨부 링크 (t_401c5bd1): 사용자 메시지 저장 후 messages_attachments에 링크할 ID 목록. */
  attachmentIds?: string[];
  /** 짧은 확인음 노출 후 답변 시작 전 대기(ms) — 대표님 9/28 ①. 생략 시 config.answerLeadMs. */
  answerLeadMs?: number;
}

export interface TurnResult {
  turnId: string;
  llm: LlmRunInfo;
  messages: { user: MessagesRow; empathy: MessagesRow | null; answer: MessagesRow | null };
  userMessageId: string;
  empathyMessageId: string | null;
  answerMessageId: string | null;
  empathyResponse: string | null;
  answerResponse: string | null;
  structured: StructuredAnswer;
  /** 후속 예상 질문 2~3개 (t_344e047a ③) — structured_payload.suggested_questions와 동일. 실패 시 []. */
  suggestedQuestions: SuggestedQuestion[];
  dialogueType: DialogueType;
  /** 판별 단계 (t_56498848) — 1=패턴 2=LLM 3=폴백/수동 */
  dialogueStage: 1 | 2 | 3;
  dialogueConfidence: number;
  /** 전문가 그라운딩 요약 (t_d54bc456) — 발동하지 않았으면 null */
  grounding: GroundingSummary | null;
  /** 뉴런 활성화 계획 — 설계 문서와 동일한 객체 형태 (activate/reason) */
  activationPlan: { activate: string[]; reason: string; dialogueType: DialogueType };
  events: NeuronStatusEvent[];
  guardPassed: boolean;
  engine: 'langgraph' | 'simple';
}

// ── 노드 함수 (실시간 이벤트 및 상태 변환) ─────────────────────────

/** 취소 전파 대기 — answer 리드 지연(t_344e047a ①)용 abortable sleep. */
function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0 || signal?.aborted) {
      if (signal?.aborted) reject(new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.'));
      else resolve();
      return;
    }
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function empathyNode(state: NeuronState, ctx: NodeContext): Partial<NeuronState> {
  // 예/아니오 게이트 (t_135a19b5, 대표님 9/28 정정): 직전 empathy 행 뒤의 짧은 확인 발화에는
  // 복창을 생성하지 않는다 — 중복 에코 루프 방지, 답변으로 직결.
  if (state.empathySuppressed) return {};
  const persona = state.persona;
  const prompt = persona ? buildPersonaPrompt(persona, 'empathy') : '';
  // t_135a19b5 정정: 복창 원문(에코 문장)을 그대로 노출한다. t_344e047a의 짧은 확인음
  // 대체는 오적용이었음 — 확인음(yes/no 분류)은 행의 structured_payload.empathy_ack에 보존.
  const response = buildEmpathyTemplate(state.userMessage, state.dialogueType, prompt, state.locale);
  ctx.emit({ neuron: 'empathy', status: 'idle', stage: 'thinking', quip: quipText(state, 'ack') });
  return {
    empathyResponse: response,
    events: [...state.events, { neuron: 'empathy', status: 'idle', stage: 'thinking', quip: quipText(state, 'ack') }],
  };
}

/** 짧은 확인 발화(3초 예/아니오 칩 tapped 산출물 포함) 판별 — 순수 확인만, 부분일치 금지. */
const CONFIRMATION_UTTERANCES = new Set([
  '예', '네', '요', 'ㅇ', 'ㄴ', '응', '어', '넵', '넹', 'ㅇㅋ', 'ㄴㄴ',
  '아니', '아니요', '아니오', 'yes', 'no', 'yeah', 'yep', 'nope', 'nah', 'y', 'n', 'ok', 'okay',
]);
export function isConfirmationUtterance(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!~〜？?。，,\s]+$/g, '');
  return t.length > 0 && t.length <= 8 && CONFIRMATION_UTTERANCES.has(t);
}

/** 직전 턴 컨텍스트에 empathy 행이 있었나 (history 최신 3행: [user, empathy, answer]) */
function hasTrailingEmpathyRow(history: HistoryMessage[]): boolean {
  return history.slice(-3).some(m => m.role === 'agent' && m.source_neuron === 'empathy');
}

/** 직전 발화(history의 최신 user 행)도 짧은 확인이었나 — 연속 예/아니오 체인 유지 (카드 #4). */
function previousTurnWasConfirmation(history: HistoryMessage[]): boolean {
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  return lastUser ? isConfirmationUtterance(String(lastUser.content ?? '')) : false;
}

async function routerNode(state: NeuronState, ctx: NodeContext): Promise<Partial<NeuronState>> {
  const plan = NeuronRouter.plan(state.userMessage, {
    hasActiveTask: state.hasActiveTask,
    pendingQueueLength: state.pendingQueueLength,
  });
  // photo_edit 강제 활성 (t_78ffba4f): 프론트 buildEditMessage 산출물은 "이 부분 잘라줘"처럼
  // 규칙상 information/command로 잡혀 answer 뉴런이 꺼지고 답변 메시지가 저장되지 않는다.
  // 지시 펜스+이미지 첨부가 같은 턴에 있으면 카드를 얹을 답변 행 자체가 필요하므로 answer를 강제한다.
  const photoEditForced = state.photoEditPending && !plan.activate.includes('answer');
  // Stage 2 (t_56498848): 패턴 미확정(Stage 3 폴백)인 발화만 LLM 의도 분류에 넘긴다 —
  // 고신뢰 패턴 확정 발화는 0ms 규칙으로 이미 끝난다(spec §2.3 "놓치는 것보다 오판이 위험").
  // LLM 미설정/실패/타임아웃 → null → 규칙 폴백 유지. 인용 임계(0.8) 미만도 각 단계 값 그대로 둔다.
  let dialogueType = plan.dialogueType;
  let dialogueStage: 1 | 2 | 3 = plan.dialogueStage;
  let confidence = plan.confidence;
  if (plan.dialogueStage === 3) {
    const history = (state.history || []).slice(-6).map(h => `${h.role}: ${String(h.content).slice(0, 200)}`);
    const llm = await classifyByLLM(state.userMessage, { history, signal: ctx.signal });
    if (llm && llm.confidence >= CLASSIFY_ADOPT) {
      dialogueType = llm.type;
      dialogueStage = 2;
      confidence = llm.confidence;
    }
  }
  ctx.emit({ neuron: 'router', status: 'processing', stage: 'organizing', quip: quipText(state, 'organizing') });
  // Stage 2 인용 시 계획 보정: 요청형이면 answer, data면 visual (plan과 동일 규칙).
  let activationPlan = plan.activate;
  let reason = plan.reason;
  if (dialogueStage === 2) {
    const set = new Set(plan.activate);
    if (dialogueType !== 'information') set.add('answer');
    if (dialogueType === 'data') set.add('visual');
    activationPlan = [...set];
    reason = `${plan.reason}, llm_stage2=${confidence.toFixed(2)}`;
  }
  if (photoEditForced) {
    activationPlan = [...new Set([...activationPlan, 'answer'])];
    reason = `${reason}, photo_edit=answer_forced`;
  }
  // 예/아니오 게이트 (t_135a19b5): 확인 발화는 복창 없이 답변으로 직결 — information처럼
  // plan이 answer 없이 끝나면 응답이 완전 침묵이 되므로 강제 활성한다.
  if (state.empathySuppressed && !activationPlan.includes('answer')) {
    activationPlan = [...activationPlan, 'answer'];
    reason = `${reason}, confirm_gate=answer_forced`;
  }
  return {
    dialogueType,
    dialogueStage,
    dialogueConfidence: confidence,
    activationPlan,
    reason,
    events: [...state.events, { neuron: 'router', status: 'processing', stage: 'organizing', quip: quipText(state, 'organizing') }],
  };
}

async function answerNode(state: NeuronState, ctx: NodeContext): Promise<Partial<NeuronState>> {
  if (!state.activationPlan.includes('answer')) return {};
  // ① 짧은 확인음(ack) 후 답변 스트리밍 전 체감 공백 (t_344e047a, 대표님 9/28 ①) —
  // config.answerLeadMs(기본 3000, 0=즉시). 이 3초는 quip이 도는 구간이다. 취소 전파됨.
  if (ctx.leadMs) await waitOrAbort(ctx.leadMs, ctx.signal);
  const prompt = state.persona ? buildPersonaPrompt(state.persona, 'answer') : '';
  const start: NeuronStatusEvent = { neuron: 'answer', status: 'processing', stage: 'thinking', quip: quipText(state, 'thinking') };
  ctx.emit(start);
  let answerResponse: string;
  // ── 전문가 그라운딩 (t_d54bc456) — 법률·회계 등 전문가 카테고리는 Perplexity
  // 최신 웹 검색 근거 + 출처를 반드시 동반한다. 키 미설정 시 시도하지 않는다
  // (DEV/unit 테스트는 실 키 없이도 기존 동작 그대로). ──
  let grounding: GroundingResult | null = null;
  if (state.groundEnabled && isPerplexityConfigured() && !ctx.signal?.aborted) {
    ctx.emit({ neuron: 'grounding', status: 'processing', stage: 'thinking', quip: quipText(state, 'thinking') });
    grounding = await searchGrounding(state.userMessage, state.locale, { signal: ctx.signal });
    ctx.emit({
      neuron: 'grounding',
      status: grounding.status === 'grounded' ? 'idle' : 'degraded',
      stage: 'organizing',
      quip: quipText(state, 'organizing'),
    });
  }
  const groundingBlock = grounding && grounding.status === 'grounded' ? `\n\n${buildGroundingPrompt(grounding, state.locale)}` : '';
  if (isLlmConfigured()) {
    const history: ChatMessage[] = (config.chatLlm.historyTurns > 0 ? state.history : [])
      .filter(m => m.role === 'user' || (m.role === 'agent' && m.source_neuron === 'answer'))
      .slice(-(Math.max(0, config.chatLlm.historyTurns) || Infinity))
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
    try {
      const result = await chatCompletion({
        messages: [{ role: 'system', content: appendLanguageInstruction(prompt + '\nAnswer naturally. Avoid excessive markdown.' + groundingBlock, state.locale) }, ...history, { role: 'user', content: state.userMessage }],
        onDelta: d => ctx.onDelta?.(d),
        signal: ctx.signal,
      });
      answerResponse = result.text;
      ctx.llm = { used: true, model: result.model, fallback: result.fallback, provider: result.provider, usage: result.usage, durationMs: result.durationMs };
    } catch (err) {
      if (ctx.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.');
      }
      if (!(err instanceof LlmError)) throw err;
      // 검색 근거가 확보됐다면 일반 템플릿 대신 그 자체를 답변으로 제시한다 (무근거 법률 답변 금지).
      if (grounding && grounding.status === 'grounded') {
        answerResponse = groundingAnswerText(grounding, state.locale);
        ctx.llm = { used: false, model: grounding.model, fallback: true, reason: err.code };
      } else {
        answerResponse = buildAnswerTemplate(state.userMessage, state.dialogueType, prompt, state.locale);
        ctx.llm = { used: false, model: null, fallback: true, reason: err.code };
      }
    }
  } else if (grounding && grounding.status === 'grounded') {
    answerResponse = groundingAnswerText(grounding, state.locale);
    ctx.llm = { used: false, model: null, fallback: false, reason: 'LLM_UNCONFIGURED' };
  } else {
    answerResponse = buildAnswerTemplate(state.userMessage, state.dialogueType, prompt, state.locale);
    ctx.llm = { used: false, model: null, fallback: false, reason: 'LLM_UNCONFIGURED' };
  }
  let structured = await classifyStructured(state.userMessage, state.dialogueType, answerResponse, ctx.signal);
  if (grounding) {
    structured = structured.dialogue_type === 'text' && grounding.status === 'grounded'
      ? { ...structured, dialogue_type: 'info_card', structured_payload: { title: state.userMessage.slice(0, 50), summary: answerResponse.slice(0, 200), facts: [], grounding: groundingCardPayload(grounding) } }
      : { ...structured, structured_payload: { ...structured.structured_payload, grounding: groundingCardPayload(grounding) } };
  }
  // ③ 후속 예상 질문 2~3개 (t_344e047a) — 세션 최근 발화·볼트 노트·사용자 preference를
  // 컨텍스트로 LLM 1회. 실패(미설정/타임아웃/파싱/조회 오류)는 조용히 생략, 체감 0. 절대 던지지 않는다.
  if (!ctx.signal?.aborted) {
    const contextLines = [...(state.history || []).slice(-6).map(h => `${h.role === 'user' ? 'user' : 'agent'}: ${String(h.content).slice(0, 200)}`),
      `user: ${state.userMessage.slice(0, 200)}`, `agent: ${answerResponse.slice(0, 400)}`];
    try {
      if (ctx.db) {
        const { data: notes } = await ctx.db.from('vault_notes').select('title')
          .eq('user_id', state.userId).order('updated_at', { ascending: false }).limit(5);
        const titles = ((notes as { title?: string }[] | null) || []).map(n => n.title).filter(Boolean);
        if (titles.length) contextLines.push(`user saved notes (topics): ${titles.join(' | ').slice(0, 300)}`);
        const { data: user } = await ctx.db.from('users').select('preferences,profile').eq('id', state.userId).maybeSingle();
        const u = (user as { preferences?: Record<string, unknown>; profile?: Record<string, unknown> } | null) || null;
        const prefs = JSON.stringify({ ...(u?.preferences || {}), ...(u?.profile || {}) }).slice(0, 300);
        if (prefs && prefs !== '{}') contextLines.push(`user preferences: ${prefs}`);
      }
    } catch { /* 보강 컨텍스트 조회 실패는 발화 이력만으로 계속 */ }
    const questions = await generateSuggestedQuestions(contextLines.join('\n'), state.locale, { signal: ctx.signal });
    if (questions?.length) {
      structured = { ...structured, structured_payload: { ...structured.structured_payload, suggested_questions: questions } };
    }
  }
  // 답변 생성 이후 분류 단계에서 받은 취소는 규칙 카드로 완료한다.
  ctx.classificationCancelled = Boolean(ctx.signal?.aborted);
  const end: NeuronStatusEvent = { neuron: 'answer', status: 'idle', stage: 'finalizing', quip: quipText(state, 'finalizing') };
  ctx.emit(end);
  return { answerResponse, structured, grounding, llm: ctx.llm, events: [...state.events, start, end] };
}

function visualNode(state: NeuronState, ctx: NodeContext): Partial<NeuronState> {
  const requested = state.activationPlan.includes('visual');
  if (!requested) return { visualRequested: false };
  ctx.emit({ neuron: 'visual', status: 'processing', stage: 'rendering', quip: quipText(state, 'rendering') });
  return {
    visualRequested: true,
    events: [...state.events, { neuron: 'visual', status: 'processing', stage: 'rendering', quip: quipText(state, 'rendering') }],
  };
}

function composeNode(state: NeuronState, _ctx: NodeContext): Partial<NeuronState> {
  return {
    finalResponse: {
      empathy: state.empathyResponse,
      answer: state.answerResponse,
      visualsRequested: state.visualRequested,
    },
  };
}

// ── 공감 및 LLM 장애 시 폴백 템플릿 ──

function buildEmpathyTemplate(message: string, dialogueType: DialogueType, _prompt: string, locale: Locale): string {
  const prefix = message.trim().slice(0, 30);
  if (locale === 'en') {
    const replies: Record<DialogueType, string> = {
      data: `I'll organize the data for "${prefix}".`, file: `I'll check the file task for "${prefix}".`,
      task: `I'll start working on "${prefix}" and keep you updated.`, question: `Let me explain "${prefix}".`,
      command: `I'll take care of "${prefix}".`, information: `I hear you: "${prefix}". Let me help.`,
      multi: `I'll help coordinate "${prefix}".`,
    };
    return replies[dialogueType];
  }
  switch (dialogueType) {
    case 'data':
      return `"${prefix}" 자료 정리하시는군요. 바로 준비해서 보여드릴게요.`;
    case 'file':
      return `"${prefix}" 파일 작업이 필요하시군요. 확인해볼게요.`;
    case 'task':
      return `"${prefix}" 작업 시작할게요. 진행 상황 계속 알려드릴게요.`;
    case 'question':
      return `"${prefix}"에 대해 알려드릴게요.`;
    case 'command':
      return `"${prefix}" 네, 바로 처리할게요.`;
    default:
      return `"${prefix}" 말씀하셨네요. 계속 이어서 도와드릴게요.`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildAnswerTemplate(message: string, _dialogueType: DialogueType, prompt: string, locale: Locale): string {
  if (locale === 'en') return `I have reviewed "${message.trim().slice(0, 50)}". Please share your specific goals and deadline so I can help further.`;
  // DEV: LLM 없이도 동작하는 상세 답변 템플릿
  return (
    `네, "${message.trim().slice(0, 50)}"에 대해 정리해드렸어요.\n\n` +
    `- 핵심 요약: 요청하신 내용을 확인했고, 지금 바로 진행할 수 있어요.\n` +
    `- 필요한 정보: 구체적인 목표와 마감 일정을 알려주시면 더 정확하게 준비할게요.\n\n` +
    `더 필요한 부분이 있으면 말씀해주세요!`
  );
}

// ── Simple 파이프라인 ─────────────────────────────────

async function simplePipeline(initial: NeuronState, ctx: NodeContext): Promise<NeuronState> {
  let state: NeuronState = { ...initial, events: [...initial.events], finalResponse: { empathy: null, answer: null, visualsRequested: false } };
  state = { ...state, ...await routerNode(state, ctx) };
  state = { ...state, ...await empathyNode(state, ctx) };
  state = { ...state, ...await answerNode(state, ctx) };
  state = { ...state, ...await visualNode(state, ctx) };
  state = { ...state, ...await composeNode(state, ctx) };
  state.events = state.events.filter((e, i, arr) => arr.findIndex((x) => x.neuron === e.neuron && x.status === e.status) === i);
  return state;
}

// ── LangGraph 래퍼 ────────────────────────────────────

let langGraphAvailable: boolean | null = null;
function checkLangGraph(): boolean {
  if (langGraphAvailable !== null) return langGraphAvailable;
  try {
    // ESM 패키지 — Node 22.12+의 require(esm)로 로드
    require('@langchain/langgraph');
    langGraphAvailable = true;
  } catch {
    langGraphAvailable = false;
  }
  return langGraphAvailable;
}

async function langGraphPipeline(initial: NeuronState, ctx: NodeContext): Promise<NeuronState> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { StateGraph, Annotation, START, END } = require('@langchain/langgraph');

  const StateAnnotation = Annotation.Root({
    locale: Annotation,
    history: Annotation,
    llm: Annotation,
    sessionId: Annotation,
    userId: Annotation,
    agentId: Annotation,
    persona: Annotation,
    userMessage: Annotation,
    sttMetadata: Annotation,
    dialogueType: Annotation,
    dialogueStage: Annotation,
    dialogueConfidence: Annotation,
    activationPlan: Annotation,
    reason: Annotation,
    hasActiveTask: Annotation,
    pendingQueueLength: Annotation,
    empathyResponse: Annotation,
    answerResponse: Annotation,
    structured: Annotation,
    visualRequested: Annotation,
    expertise: Annotation,
    groundEnabled: Annotation,
    grounding: Annotation,
    photoEditPending: Annotation,
    empathySuppressed: Annotation,
    finalResponse: Annotation,
    events: Annotation,
    engine: Annotation,
  });

  const wrap = (node: (state: NeuronState, ctx: NodeContext) => Partial<NeuronState> | Promise<Partial<NeuronState>>) =>
    (state: NeuronState, cfg?: { configurable?: { ctx?: NodeContext } }) =>
      node(state, cfg?.configurable?.ctx || { emit: () => undefined, llm: { used: false, model: null, fallback: false } });
  const graph = new StateGraph(StateAnnotation)
    .addNode('router', wrap(routerNode))
    .addNode('empathy', wrap(empathyNode))
    .addNode('answer', wrap(answerNode))
    .addNode('visual', wrap(visualNode))
    .addNode('compose', wrap(composeNode))
    .addEdge(START, 'router')
    .addEdge('router', 'empathy')
    .addEdge('empathy', 'answer')
    .addEdge('answer', 'visual')
    .addEdge('visual', 'compose')
    .addEdge('compose', END)
    .compile();

  const result = await graph.invoke({ ...initial }, { configurable: { ctx } });
  return { ...initial, ...result, engine: 'langgraph' };
}

// ── 턴 처리 (영속화 포함) ─────────────────────────────

export async function processTurn(
  db: DbClient,
  sessionId: string,
  userId: string,
  agentId: string,
  persona: PersonaConfig | null,
  userMessage: string,
  opts: ProcessTurnOptions = {}
): Promise<TurnResult> {
  const locale = opts.locale ?? config.defaultLocale;
  const turnId = opts.turnId || randomUUID();
  opts.onTurnStatus?.('received');
  return withSessionLock(sessionId, async () => {
    let processing = false;
    let classificationCancelled = false;
    try {
      const events: NeuronStatusEvent[] = [];
      const emit = (e: NeuronStatusEvent) => {
        events.push(e);
        opts.emitEvent?.(e);
      };

      let deltaIndex = 0;
      const ctx: NodeContext = { signal: opts.signal, emit: e => {
        emit(e);
        opts.onTurnStatus?.('processing', { stage: e.stage });
      }, onDelta: d => opts.onAnswerDelta?.(d, deltaIndex++), llm: { used: false, model: null, fallback: false },
      // ① 확인음 후 답변 시작 전 체감 공백 (t_344e047a). 0이면 즉시.
      leadMs: opts.answerLeadMs ?? config.answerLeadMs,
      // ③ 후속 질문 보강 컨텍스트 조회 (볼트 노트·선호) — t_344e047a.
      db };
      const dialogueType = classifyDialogueType(userMessage);

      // 전문가 카테고리 판정 (t_d54bc456) — 그라운딩 게이트와 저장 시 디스클레이머가 공유한다.
      const { data: agentRow, error: agentFetchError } = await db.from('agents').select('*').eq('id', agentId).maybeSingle();
      if (agentFetchError) throw new ApiError('INTERNAL_ERROR', agentFetchError.message);
      const expertise = classifyExpertise(agentRow?.category, agentRow?.config, persona?.name, persona?.system_prompt, persona?.tags);
      // 그라운딩 활성 조건: 에이전트/페르소나가 전문가 카테고리이거나 질문 자체가 법률·회계·의료 질문.
      // (종량제 — 일반 토크에는 호출하지 않는다. 대표님 지시: 법률 답변은 무조건 검색 근거와 함께.)
      const questionExpertise = classifyExpertise(userMessage);
      const groundEnabled = (expertise !== 'general' || questionExpertise !== 'general') && isPerplexityConfigured();

      // 활성 작업/큐 상태 컨텍스트 조회
      const { data: activeTasks } = await db.from('tasks').select('id').eq('session_id', sessionId).in('status', ['pending', 'in_progress']);
      const hasActiveTask = (activeTasks as any[] | null)?.length ? true : false;
      const prevQueue = await db.from('context_patches').select('*').eq('session_id', sessionId).eq('key', 'task.queue');
      const pendingQueueLength = (prevQueue.data as any[] | null)?.length ? 1 : 0;

      let history = opts.history;
      if (opts.thread) {
        const { data: root, error: rootError } = await db.from('messages').select('*')
          .eq('session_id', sessionId).eq('id', opts.thread.rootMessageId).maybeSingle();
        if (rootError || !root) throw new ApiError('NOT_FOUND', '스레드 루트를 찾을 수 없습니다.');
        const { data: replies, error } = await db.from('messages').select('*')
          .eq('session_id', sessionId).eq('root_message_id', root.id)
          .order('turn_index', { ascending: false }).limit(Math.max(0, config.chatLlm.historyTurns * 3));
        if (error) throw new ApiError('INTERNAL_ERROR', error.message);
        history = [root, ...(replies || []).reverse()];
      } else if (!history) {
        const { data, error } = await db.from('messages').select('role,content,source_neuron,turn_index').eq('session_id', sessionId)
          .order('turn_index', { ascending: false }).limit(Math.max(0, config.chatLlm.historyTurns * 3));
        if (error) throw new ApiError('INTERNAL_ERROR', error.message);
        history = (data || []).reverse();
      }

      // photo_edit 카드 emission (t_78ffba4f): user 지시 펜스 + 이미지 첨부가 같은 턴이면
      // 답변 structured를 photo_edit로 승격 — 프론트 registerCard('photo_edit')가 즉시 렌더.
      // pending은 초기 상태(routerNode의 answer 강제 활성)에서 필요해 link보다 먼저 판정한다
      // (지시 발화가 information으로 잡혀 답변 행 자체가 저장되지 않으면 카드가 나갈 자리가 없다).
      // 최종 payload는 link 결과(첨부 URL)로 아래에서 확정 — 판정 규칙은 photoEditCard.ts 단일 소스.
      const photoEditPending = photoEditDirectivePending(userMessage, opts.attachmentIds?.length ?? 0);

      // 예/아니오 게이트 (t_135a19b5, 대표님 9/28 정정): 프론트 3초 예/아니오 칩(또는 직접 입력)의
      // 짧은 확인 발화이자 직전 턴 컨텍스트에 empathy 행(또는 직전 발화도 확인 — 연속 체인)이면
      // 복창을 생성하지 않는다 — 중복 에코 루프 방지. 답변은 직결(침묵 금지, routerNode 강제 활성).
      const empathySuppressed = isConfirmationUtterance(userMessage)
        && (hasTrailingEmpathyRow(history || []) || previousTurnWasConfirmation(history || []));

      const initial: NeuronState = {
        locale,
        sessionId,
        userId,
        agentId,
        persona,
        userMessage,
        history: history || [],
        llm: ctx.llm,
        sttMetadata: opts.sttMetadata || null,
        dialogueType,
        dialogueStage: 3,
        dialogueConfidence: 0,
        activationPlan: ['empathy'],
        reason: '',
        hasActiveTask,
        pendingQueueLength,
        empathyResponse: null,
        answerResponse: null,
        structured: { dialogue_type: 'text', structured_payload: {}, classifier: 'rules' },
        visualRequested: false,
        expertise,
        groundEnabled,
        grounding: null,
        photoEditPending,
        empathySuppressed,
        finalResponse: { empathy: null, answer: null, visualsRequested: false },
        events: [],
        engine: 'simple',
      };

      const engine: 'langgraph' | 'simple' =
        config.neuronEngine === 'langgraph' && checkLangGraph() ? 'langgraph' : 'simple';

      // ── 영속화 ──

      // 다음 turn_index
      const getNextTurn = async () => {
        const { data: lastMsg, error } = await db
          .from('messages')
          .select('turn_index')
          .eq('session_id', sessionId)
          .order('turn_index', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', error.message);
        return ((lastMsg as { turn_index?: number } | null)?.turn_index ?? -1) + 1;
      };
      let nextTurn = await getNextTurn();

      // 사용자 메시지 저장
      const saveUser = () => db
        .from('messages')
        .insert({
          session_id: sessionId,
          parent_message_id: opts.thread?.parentMessageId ?? null,
          root_message_id: opts.thread?.rootMessageId ?? null,
          turn_index: nextTurn,
          role: 'user',
          locale,
          ai_generated: false,
          message_type: opts?.sttMetadata ? 'voice' : 'text',
          content: userMessage,
          dialogue_type: null,
          structured_payload: {},
          stt_metadata: opts?.sttMetadata ? opts.sttMetadata : null,
          source_neuron: null,
          attachments: [],
          persona_guard: {},
          user_feedback: null,
        })
        .select()
        .single();

      let { data: msgUser, error: errUser } = await saveUser();
      if (errUser && /duplicate|unique/i.test(errUser.message || '')) {
        nextTurn = await getNextTurn();
        ({ data: msgUser, error: errUser } = await saveUser());
      }
      if (errUser || !msgUser) throw new ApiError('INTERNAL_ERROR', errUser?.message || '사용자 메시지 저장 실패');
      // 첨부 링크 (t_401c5bd1): LLM 호출 전에 실패시켜 비용을 물리지 않는다. 소유권/이중링크 검증은 공유 lib.
      let linkedAttachments: { url: string; mime: string }[] = [];
      if (opts.attachmentIds?.length) {
        linkedAttachments = await linkAttachmentsToMessage(db, userId, sessionId, (msgUser as { id: string }).id, opts.attachmentIds);
      }
      const checkCancelled = () => {
        if (opts.signal?.aborted && !ctx.classificationCancelled) throw new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.');
      };
      checkCancelled();
      processing = true;
      opts.onTurnStatus?.('processing', { stage: 'thinking' });
      const final = engine === 'langgraph' ? await langGraphPipeline(initial, ctx) : await simplePipeline(initial, ctx);
      classificationCancelled = Boolean(ctx.classificationCancelled);
      checkCancelled();
      // photo_edit 카드 emission (t_78ffba4f): user 지시 펜스 + 이미지 첨부가 같은 턴에 있으면
      // 답변 structured를 photo_edit로 승격 — 프론트 registerCard('photo_edit')가 즉시 렌더.
      // 기존 file/text 분류보다 우선하되, 지시·이미지 둘 다 없으면 무영향(결정론 규칙, LLM 미경유).
      const photoEdit = photoEditCardForTurn(userMessage, linkedAttachments);
      if (photoEdit) final.structured = photoEdit;
      // 인스턴스 활성화는 저장 직전에 (empathy 항상 + plan)
      for (const neuron of ['empathy', 'answer', 'visual', 'queue'] as const) {
        if (neuron === 'empathy' || final.activationPlan.includes(neuron)) {
          try {
            await activateNeuronInstance(db, sessionId, neuron);
          } catch {
            // 뉴런 부재 시 무시
          }
        }
      }


      // 에이전트 응답 저장 (공감 → 답변)
      let empathyMessageId: string | null = null;
      let answerMessageId: string | null = null;
      let guardPassed = true;
      let empathyMessage: MessagesRow | null = null;
      let answerMessage: MessagesRow | null = null;
      // 화면 노출용 공감 텍스트(짧은 확인음) — TurnResult.empathyResponse의 계약값 (t_344e047a ①).
      let empathyVisible: string | null = null;

      checkCancelled();
      if (final.empathyResponse) {
        // t_135a19b5 정정 (대표님 9/28 08:40): 화면 노출은 복창 원문(에코 문장) 그대로 복원.
        // "예/아니오" 수준 짧은 확인음(yes/no 분류)은 대체가 아니라 structured_payload.empathy_ack에 보존.
        const empathyAck = pickQuip('ack', locale, persona?.tone);
        const { data: m, error } = await db
          .from('messages')
          .insert({
            session_id: sessionId,
            parent_message_id: opts.thread ? msgUser.id : null,
            root_message_id: opts.thread?.rootMessageId ?? null,
            turn_index: nextTurn + 1,
            role: 'agent',
            locale,
            ai_generated: true,
            message_type: 'text',
            content: final.empathyResponse,
            dialogue_type: null,
            structured_payload: { empathy_ack: empathyAck },
            stt_metadata: null,
            source_neuron: 'empathy',
            attachments: [],
            persona_guard: {},
            user_feedback: null,
          })
          .select()
          .single();
        if (error || !m) throw new ApiError('INTERNAL_ERROR', error?.message || '공감 메시지 저장 실패');
        empathyMessage = m;
        empathyMessageId = m.id;
        // 계약 필드 = 화면 노출 텍스트 = 복창 원문 (t_135a19b5).
        empathyVisible = final.empathyResponse;
      }

      if (final.answerResponse) {
        const guard = new PersonaGuard(persona || {
          persona_id: '',
          name: '에이전트',
          voice: {},
          tone: { formality: 'friendly', emoji_usage: 'rare', sentence_length: 'medium', honorific_level: 3 },
          style_guide: { personality_traits: [], preferred_expressions: [], forbidden_expressions: [], example_responses: [] },
          neuron_overrides: {},
          relationship_context: { user_relationship: 'assistant', conversation_history_summary: '', recent_mood: '' },
        });
        const guardResult = await guard.validate(final.answerResponse, 'answer');
        guardPassed = guardResult.passed;
        // 전문가 디스클레이머 + 그라운딩 정직 표기 (t_d54bc456)
        let suffix = expertise === 'general' ? '' : `\n\n${DISCLAIMERS[expertise][locale]}`;
        if (final.groundEnabled && final.grounding && final.grounding.status !== 'grounded' && final.grounding.reason !== 'CANCELLED') {
          // 검색 성공했는데 인용이 없는 것과 검색 자체가 실패한 것을 구분해 정직 표기한다.
          const key = final.grounding.reason === 'NO_CITATIONS' || final.grounding.reason === 'EMPTY_RESPONSE' ? 'NO_SOURCES' : 'UNAVAILABLE';
          suffix += `\n${GROUNDING_NOTES[key][locale]}`;
        }
        // 전문가 디스클레이머 + 그라운딩 정직 표기 (t_d54bc456) — 가드에서 정화된 응답은 항상 반영한다.
        final.answerResponse = guardResult.response + suffix;

        checkCancelled();
        const { data: m, error } = await db
          .from('messages')
          .insert({
            session_id: sessionId,
            parent_message_id: opts.thread ? msgUser.id : null,
            root_message_id: opts.thread?.rootMessageId ?? null,
            turn_index: nextTurn + (final.empathyResponse ? 2 : 1),
            role: 'agent',
            locale,
            ai_generated: true,
            message_type: 'text',
            content: final.answerResponse,
            dialogue_type: final.structured.dialogue_type,
            structured_payload: final.structured.structured_payload,
            stt_metadata: null,
            source_neuron: 'answer',
            attachments: [],
            persona_guard: {
              passed: guardResult.passed,
              checks: guardResult.checks,
            },
            user_feedback: null,
          })
          .select()
          .single();
        if (error || !m) throw new ApiError('INTERNAL_ERROR', error?.message || '답변 메시지 저장 실패');
        answerMessage = m;
        answerMessageId = m.id;
      }

      // 컨텍스트 패치 — conversation.recent 갱신
      await db.from('context_patches').insert({
        session_id: sessionId,
        key: 'conversation.recent',
        operation: 'append',
        delta: { value: { role: 'user', content: userMessage, turn_index: nextTurn } },
        source_neuron: 'router',
      });
      await db.from('context_patches').insert({
        session_id: sessionId,
        key: 'conversation.recent',
        operation: 'append',
        delta: { value: { role: 'agent', content: final.answerResponse || final.empathyResponse || '', turn_index: nextTurn + 1 } },
        source_neuron: 'answer',
      });

      // 사용량 집계 (LLM 장애 폴백은 답변 뉴런 실패로 기록)
      for (const slug of ['empathy', 'answer', 'visual', 'queue']) {
        if (slug === 'empathy' || final.activationPlan.includes(slug)) {
          const neuron = await getNeuronBySlug(db, slug);
          if (neuron) await db.rpc('increment_neuron_usage', { p_neuron_id: neuron.id, p_success: !(slug === 'answer' && ctx.llm.fallback) });
        }
      }

      opts.onTurnStatus?.('completed');
      return {
        turnId,
        llm: ctx.llm,
        messages: { user: msgUser, empathy: empathyMessage, answer: answerMessage },
        userMessageId: (msgUser as { id: string }).id,
        empathyMessageId,
        answerMessageId,
        empathyResponse: empathyVisible,
        answerResponse: final.answerResponse,
        structured: final.structured,
        // ③ (t_344e047a) — answerNode가 structured_payload에 병합한 후속 질문 (실패 시 []).
        suggestedQuestions: ((final.structured.structured_payload as Record<string, unknown>)?.suggested_questions as SuggestedQuestion[]) ?? [],
        dialogueType: final.dialogueType,
        dialogueStage: final.dialogueStage ?? 3,
        dialogueConfidence: final.dialogueConfidence ?? 0,
        grounding: final.grounding ? toGroundingSummary(final.grounding) : null,
        activationPlan: {
          activate: final.activationPlan,
          reason: final.reason,
          dialogueType: final.dialogueType,
        },
        events,
        guardPassed,
        engine,
      };
    } catch (err: any) {
      if ((opts.signal?.aborted && !classificationCancelled) || err?.name === 'AbortError' || err?.code === 'RUN_CANCELLED') {
        throw new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.');
      }
      if (!processing) opts.onTurnStatus?.('processing', { stage: 'thinking' });
      opts.onTurnStatus?.('failed', { error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || '턴 처리 실패' } });
      throw err;
    }
  });
}
