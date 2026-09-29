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
import { detectReplyRequest, replyRequestColumns, isMissingReplyColumns, markAwaitingReplyColumnsMissing, ReplyRequest } from '../lib/awaitingReply';
import { buildPersonaPrompt, PersonaGuard, classifyExpertise, DISCLAIMERS } from '../lib/persona';
import { isBridgeConfigured, isKimSecretaryAgent, sendTurnToSecretary, bridgeFallbackText, BridgeError } from '../lib/secretaryBridge';
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

type HistoryMessage = { role: string; content: string; source_neuron?: string | null; structured_payload?: Record<string, unknown> | null };

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
  /** 동일 발화 재전송 (t_c31e3f45, 김비서 case: 같은 소리 반복) — true면 empathy skip + no-repeat 강제. */
  repeatUtterance?: boolean;
  /** 공감 재질문 (t_44f8896c) — 직전 empathy 행의 template_id. 회전 시드(연속 재사용 금지). */
  empathyLastTemplateId?: string | null;
  /** 공감 재질문 (t_44f8896c) — 행 content는 재질문 문장, 복창 원문(에코)은 empathy_full로 보존. */
  empathyEcho?: string | null;
  empathyTemplateId?: string | null;
  /** 김비서 room 브리지 (t_620d5549) — true면 answerNode가 로컬 LLM 대신 Hermes kimsecretary를 호출. */
  secretaryBridge?: boolean;
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
  /** 답변 대기 (t_811e176c) — 회신 요구 감지 시 {kind, excerpt}. 없으면 null. */
  replyRequest: ReplyRequest | null;
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
  // 동일 발화 재전송 (t_c31e3f45, 김비서 라이브 진단): 직전 user 행과 같은 텍스트면 재질문
  // 회전을_stop — "뭘 말해도 같은 소리" 에코 루프의 직접 원인. 답변은 계속 직결(answer_always).
  if (state.empathySuppressed || state.repeatUtterance) return {};
  const persona = state.persona;
  const prompt = persona ? buildPersonaPrompt(persona, 'empathy') : '';
  // 복창 원문(에코 문장)은 empathy_full로 보존 (t_135a19b5), 화면 노출은 재질문으로 교체
  // (t_44f8896c, 대표님 9/28: "단순 복창이 아니고, 좀 다채롭게 이거 맞냐는 식으로 재 질문").
  const echo = buildEmpathyTemplate(state.userMessage, state.dialogueType, prompt, state.locale);
  const { text, templateId } = buildEmpathyRequestion(state.userMessage, state.empathyLastTemplateId, state.locale);
  ctx.emit({ neuron: 'empathy', status: 'idle', stage: 'thinking', quip: quipText(state, 'ack') });
  return {
    empathyResponse: text,
    empathyEcho: echo,
    empathyTemplateId: templateId,
    events: [...state.events, { neuron: 'empathy', status: 'idle', stage: 'thinking', quip: quipText(state, 'ack') }],
  };
}

// ── 에코 루프 차단 (t_c31e3f45, 김비서 라이브 진단 9/29) ──
// 발화 정규화: 공백/대소문자/말미 구두점 제거 — "같은 발화 재전송" 판정용.
export function normalizeUtterance(text: string): string {
  return text.trim().toLowerCase().replace(/[\s]+/g, ' ').replace(/[.!~〜？?。，,、]+$/g, '');
}

/** history(내림차순 아님 — 최신이 뒤)에서 직전 사용자 발화. 이번 발화와 동일하면 재전송. */
function lastUserUtterance(history: HistoryMessage[]): string | null {
  const last = [...history].reverse().find(m => m.role === 'user');
  return last ? normalizeUtterance(String(last.content ?? '')) : null;
}

/**
 * LLM 컨텍스트용 히스토리 필터 (t_c31e3f45 A, 김비서 판정):
 * 공감 재질문/복창 행(source_neuron='empathy' 또는 payload.empathy_*)과 자기 발화 에코로
 * 쓰이는 모든 컨텍스트 주입 지점에서 공유한다. 답변(answer)과 사용자 발화만 남긴다.
 * 소스 뉴런이 없는 레거시 agent 행(음성 확정 등)은 content가 답변이었으므로 answer로 본다.
 */
export function answerableHistory(history: HistoryMessage[]): HistoryMessage[] {
  return (history || []).filter(m =>
    m.role === 'user' ||
    (m.role === 'agent' && !(
      m.source_neuron === 'empathy' ||
      (m.structured_payload && (m.structured_payload.empathy_full || m.structured_payload.empathy_question))
    ))
  );
}

/** 문자 2-gram Dice 계수 (0~1) — 재귀 생성 판정용 (t_c31e3f45 B, 임계 0.8). */
export function textSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(norm(a));
  const gb = grams(norm(b));
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}

/** 직전 답변 행 content (answerNode 재생성 판정·히스토리 차단 문구용). */
function lastAnswerContent(history: HistoryMessage[]): string | null {
  const last = answerableHistory(history).slice().reverse().find(m => m.role === 'agent');
  const c = last ? String(last.content ?? '') : '';
  return c.length > 20 ? c : null;
}

/** no-repeat 지시문 (t_c31e3f45 B) — 시스템 프롬프트에 append. */
const NO_REPEAT_INSTRUCTION: Record<Locale, string> = {
  ko: '절대로 직전 답변이나 사용자 발화를 그대로 복사용하지 말고, 같은 요청이라도 새 관점·새 구성으로 앞서 나아가는 내용을 말하라.',
  en: "Never copy your previous answer or the user's wording verbatim; even for a repeated request, advance with a fresh angle and structure.",
};

/**
 * 지시형 발화 판정 (t_c31e3f45 요구1): "정리해 주세요" 류 — 공백 제거 후 어미 검사.
 *Stage 3 '해줘' 패턴이 공백 변형("해 주","해주세요")에서 놓치는 것과 같은 뿌리 결함
 * 보충 (오탐 비용=골격 1줄 < 미탐 비용=상투어 반복).
 */
export function isDirectiveUtterance(text: string): boolean {
  const t = text.replace(/\s+/g, '').toLowerCase();
  return /(해주세요|해주시|해드릴|해줘|해다오|정리해|정리할|요약해|보여줘|알려줘|알려드릴|만들어줘|만들어줄|작성해|보내줘|시작해|확인해|준비해|schedule|organize|summarize|prepare|createit)/.test(t)
    || /\b(please|could you|can you|set up|sort ?out|list ?out)\b/.test(text.toLowerCase());
}

/**
 * '약속만 하고 산출물 없는' 답변 판정 (t_c31e3f45 요구1): 번호/글머리/표 등 구조화된
 * 산출물이 전혀 없고 ~해 드릴게요/도움이 되길/나열해 주시겠 류 미래 약속 어미만 있는 답변.
 * 실제 목록·표가 있으면 false(개입 없음). 지시형 발화에만 적용한다.
 */
export function looksLikeEmptyPromise(answer: string, locale: Locale): boolean {
  const hasArtifact = /(^|\n)\s*(\d+[.)、]|[-•*]\s|\|)|```/.test(answer) || answer.length > 600;
  if (hasArtifact) return false;
  const promise = locale === 'en'
    ? /(i will|i'?ll|let me|i can|i'd be happy|would you like|please (tell|provide|share))/i
    : /(드릴게요|드릴게|드리길|되길|나열해|정리해 드|알려드릴|보여드릴|시작할|준비할|확인할|말씀해 주|알려주|보내주|추가해|적어)/;
  return promise.test(answer);
}

/** 짧은 확인 발화(3초 예/아니오 칩 tapped 산출물 포함) 판별 — 순수 확인만, 부분일치 금지. */
const CONFIRMATION_UTTERANCES = new Set([
  '예', '네', '요', 'ㅇ', 'ㄴ', '응', '어', '넵', '넹', 'ㅇㅋ', 'ㄴㄴ',
  '아니', '아니요', '아니오', 'yes', 'no', 'yeah', 'yep', 'nope', 'nah', 'y', 'n', 'ok', 'okay',
  // t_5e407a8a: '맞아요/아니에오' 계열(그렇다/아니다 변형) — 프론트 50/50 버튼 라벨(t_c62a2eb7) 대비.
  // 정확 일치 원칙 유지: 부분일치 없이 위 목록만 통과 ('요' 단독은 이미 전체-일치 집합이라 안전).
  '맞아요', '맞습니다', '맞음', '맞아', '아니에오', '아니에요', '아닙니다',
  '틀렸어', '틀렸어요', '틀림',
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

/** 공감 재질문 회전 시드 (t_44f8896c): history에서 최신 empathy 행의 template_id. */
function lastEmpathyTemplateId(history: HistoryMessage[]): string | null {
  const last = [...history].reverse().find(m => m.role === 'agent' && m.source_neuron === 'empathy');
  const id = last?.structured_payload?.template_id;
  return typeof id === 'string' ? id : null;
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
    // A (t_c31e3f45): Stage2 컨텍스트에도 공감 재질문 행을 주입하지 않는다 —
    // 자기 발화 에코가 분류기를 오염시켜 같은 소리를 재생산한다.
    const history = answerableHistory(state.history || []).slice(-6).map(h => `${h.role}: ${String(h.content).slice(0, 200)}`);
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
    reason = `${reason}, ${state.repeatUtterance ? 'repeat_gate' : 'confirm_gate'}=answer_forced`;
  }
  // C (t_c31e3f45, 김비서 case 1 "답변 없이 공감행만"): 공감 행이 plan을 만들어도
  // 답변은 매 발화 존재해야 한다 — "empathy alone" 구조 원천 금지.
  // 실행 골격(buildAnswerTemplate)은 LLM 장애 시에도 답변 행을 내보낸다.
  if (!activationPlan.includes('answer')) {
    activationPlan = [...activationPlan, 'answer'];
    reason = `${reason}, answer_always=empathy_never_alone`;
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
  // ── 앱 속 실 김비서 브리지 (t_620d5549) — '김비서' room 턴은 로컬 LLM이 아니라
  // Hermes kimsecretary(A2A localhost)로 보낸다. 실패·타임아웃은 원인 문장 폴백으로
  // 전환(턴 사망 금지). 성패와 무관하게 이후 structured/저장 경로는 기존과 동일. ──
  if (state.secretaryBridge && ctx.db) {
    ctx.emit({ neuron: 'bridge', status: 'processing', stage: 'thinking', quip: quipText(state, 'thinking') });
    let bridgeResult: { text: string; state: string } | null = null;
    let bridgeFailReason = '';
    try {
      // A (t_c31e3f45): 브리지 자전 다이제스트도 answerable만 — 공감 재질문 행이
      // 김비서 컨텍스트에 섞이면 같은 소리 재생산의 공급원이 된다.
      bridgeResult = await sendTurnToSecretary(ctx.db, state.sessionId, state.userMessage, answerableHistory(state.history || []));
    } catch (err) {
      bridgeFailReason = (err as BridgeError)?.kind || 'transport';
      if (ctx.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) bridgeFailReason = 'transport';
    }
    if (bridgeResult) {
      answerResponse = bridgeResult.text;
      ctx.llm = { used: false, model: 'hermes:kimsecretary', fallback: false, provider: 'secretary-bridge' };
      ctx.emit({ neuron: 'bridge', status: 'idle', stage: 'organizing', quip: quipText(state, 'organizing') });
    } else {
      answerResponse = bridgeFallbackText(state.locale, bridgeFailReason);
      ctx.llm = { used: false, model: null, fallback: true, reason: `BRIDGE_${bridgeFailReason.toUpperCase()}` };
      ctx.emit({ neuron: 'bridge', status: 'degraded', stage: 'organizing', quip: quipText(state, 'organizing') });
    }
    // 브리지 답변은 로컬 structured 분류·후속 질문 LLM만 추가 경유 (원문 재작성 금지).
    let bridgeStructured = await classifyStructured(state.userMessage, state.dialogueType, answerResponse, ctx.signal);
    const bridgeReply = detectReplyRequest(answerResponse);
    if (bridgeReply) bridgeStructured = { ...bridgeStructured, structured_payload: { ...bridgeStructured.structured_payload, reply_request: bridgeReply } };
    if (!ctx.signal?.aborted) {
      const contextLines = [...answerableHistory(state.history || []).slice(-6).map(h => `${h.role === 'user' ? 'user' : 'agent'}: ${String(h.content).slice(0, 200)}`),
        `user: ${state.userMessage.slice(0, 200)}`, `agent: ${answerResponse.slice(0, 400)}`];
      const questions = await generateSuggestedQuestions(contextLines.join('\n'), state.locale, { signal: ctx.signal });
      if (questions?.length) bridgeStructured = { ...bridgeStructured, structured_payload: { ...bridgeStructured.structured_payload, suggested_questions: questions } };
    }
    ctx.classificationCancelled = Boolean(ctx.signal?.aborted);
    const bridgeEnd: NeuronStatusEvent = { neuron: 'answer', status: 'idle', stage: 'finalizing', quip: quipText(state, 'finalizing') };
    ctx.emit(bridgeEnd);
    return { answerResponse, structured: bridgeStructured, grounding: null, llm: ctx.llm, events: [...state.events, start, bridgeEnd] };
  }
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
    // A (t_c31e3f45, 김비서 판정): LLM 컨텍스트에서 공감 재질문·복창 행을 완전 배제.
    // source_neuron='empathy' 뿐 아니라 payload.empathy_* 보유 행(음성 확정 등 레거시)도 필터 —
    // 'agent: 이거 맞죠? …'가assistant 발화로 주입되면 모델이 자기 직전 발화를 복창/혼합한다.
    const prevAnswer = lastAnswerContent(state.history || []);
    // B (t_c31e3f45): 직전 답변 복창 방지 — no-repeat 지시문 append.
    const noRepeat = state.repeatUtterance || prevAnswer ? `\n${NO_REPEAT_INSTRUCTION[state.locale]}` : '';
    const history: ChatMessage[] = (config.chatLlm.historyTurns > 0 ? answerableHistory(state.history || []) : [])
      .filter(m => m.role === 'user' || (m.role === 'agent' && m.source_neuron !== 'empathy' && !(m.structured_payload && (m.structured_payload.empathy_question || m.structured_payload.empathy_full))))
      .slice(-(Math.max(0, config.chatLlm.historyTurns) || Infinity))
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
    const systemPrompt = appendLanguageInstruction(prompt + '\nAnswer naturally. Avoid excessive markdown.' + noRepeat + groundingBlock, state.locale);
    try {
      const result = await chatCompletion({
        messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: state.userMessage }],
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
    // B (t_c31e3f45, 김비서 case 4 "이전 답변이 그대로 반복"): 직전 답변과 80%+ 유사하면
    // 복창으로 판정해 재생성 1회. 스트리밍 델타가 이미 나갔을 수 있어 재생성 응답은
    // answer.done 확정 텍스트로 교체된다 (프론트 reduceStreams: done.text가 최종본).
    if (prevAnswer && ctx.llm.used && textSimilarity(answerResponse, prevAnswer) >= 0.8) {
      ctx.emit({ neuron: 'answer', status: 'processing', stage: 'organizing', quip: quipText(state, 'organizing') });
      try {
        const regen = await chatCompletion({
          messages: [
            { role: 'system', content: systemPrompt + `\n\n[ANTI-ECHO] ${state.locale === 'en' ? 'Your previous answer was: ' : '네 직전 답변: '}${prevAnswer.slice(0, 600)}\n${NO_REPEAT_INSTRUCTION[state.locale]}` },
            ...history,
            { role: 'user', content: state.userMessage },
          ],
          // 재생성도 스트림 — 델타는 이어 붙지만 프론트는 answer.done 확정 텍스트로 교체한다
          // (reduceStreams: done.text가 최종본). 미스트림이면 확정 텍스트와 화면이 어긋난다.
          onDelta: d => ctx.onDelta?.(d),
          signal: ctx.signal,
        });
        if (regen.text && textSimilarity(regen.text, prevAnswer) < 0.8) {
          answerResponse = regen.text;
          ctx.llm = { used: true, model: regen.model, fallback: regen.fallback, provider: regen.provider, usage: regen.usage, durationMs: regen.durationMs };
        } else {
          // 재생성도 복창이면 골격으로 마감 — 발화 내용 기반이라 최소 실행 골격 응답을 보장한다 (C).
          answerResponse = buildAnswerTemplate(state.userMessage, state.dialogueType, prompt, state.locale);
        }
      } catch { /* 재생성 실패는 1차 응답 유지 (턴 사망 금지) */ }
    }
  } else if (grounding && grounding.status === 'grounded') {
    answerResponse = groundingAnswerText(grounding, state.locale);
    ctx.llm = { used: false, model: null, fallback: false, reason: 'LLM_UNCONFIGURED' };
  } else {
    answerResponse = buildAnswerTemplate(state.userMessage, state.dialogueType, prompt, state.locale);
    ctx.llm = { used: false, model: null, fallback: false, reason: 'LLM_UNCONFIGURED' };
  }
  // 요구1 (t_c31e3f45, 대표님 9/29 카드): 지시형 발화인데 LLM 답변이 '약속'으로만 끝나면
  // (정리해 드릴게요/보여드릴게요류 — 실제 산출물 없음) 즉시 실행 가능한 번호 목록
  // 골격+빈 슬롯 형태로 승격한다. 판단 근거는 답변 원문(접미 ~만 사용) — 오탐 시에도
  // 골격은 발화 내용을 담고 있어 무해. 그라운딩/브리지 경유 답변은 이미 실체 있어 제외.
  if (isDirectiveUtterance(state.userMessage) && !grounding && answerResponse && looksLikeEmptyPromise(answerResponse, state.locale)) {
    answerResponse = `${answerResponse.trimEnd()}\n\n${buildAnswerTemplate(state.userMessage, state.dialogueType, prompt, state.locale)}`;
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
    const contextLines = [...answerableHistory(state.history || []).slice(-6).map(h => `${h.role === 'user' ? 'user' : 'agent'}: ${String(h.content).slice(0, 200)}`),
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
  // 답변 대기 (t_811e176c) — 회신 요구 문장 규칙 판정(LLM 0회). 결정은 저장 직전 answer
  // insert가 아니라 여기서 structured_payload에 얹는다: photo_edit 승격처럼 structured를
  // 통째 교체하는 경로가 드물기 때문에 여기서 넣는 편이 안전하고, REST/WS payload 계약이
  // 자동 통과한다. 행 컬럼(awaiting_reply/reply_kind)의 진짜 값은 graph의 insert에서 쓴다.
  const replyRequest = detectReplyRequest(answerResponse);
  if (replyRequest) {
    structured = { ...structured, structured_payload: { ...structured.structured_payload, reply_request: replyRequest } };
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

// ── 공감 재질문 템플릿 풀 (t_44f8896c, 대표님 9/28) ──
// "단순 복창이 아니고, 좀 다채롭게 이거 맞냐는 식으로 재 질문" — 복창 원문은
// structured_payload.empathy_full로 보존되고, 화면 노출(content)과 empathy_response는
// 아래 재질문 문장이 된다. 규칙 기반(LLL 0회), {요약}에 발화 키워드 압축을 주입한다.

type EmpathyTemplate = { id: string; ko: string; en: string };

/** pool 인덱스 = 회전 순서. template_id는 프론트 버튼 문구 결정 키로도 쓰인다. */
export const EMPATHY_REQUESTION_TEMPLATES: EmpathyTemplate[] = [
  { id: 'eq_confirm', ko: '이거 맞죠? {요약}', en: 'Quick check — "{요약}", right?' },
  { id: 'eq_proceed', ko: '{요약} — 맞으면 계속 진행할게요', en: '"{요약}" — if that\'s right, I\'ll keep going' },
  { id: 'eq_understand', ko: '제 이해가 맞다면 {요약}', en: 'If I read you right, it\'s about "{요약}"' },
  { id: 'eq_align', ko: '맞나요? {요약} 쪽으로 받아들이면 돼요', en: 'Sound good? I\'ll take it as "{요약}"' },
];

/** 발화 → {요약} 키워드 압축 (규칙 기반, LLM 0회): 문두 불요 소거 + 구두점 제거 + 24자 절단. */
export function empathyKeywordSummary(message: string): string {
  const cleaned = message
    .replace(/^(안녕하세요|반갑습니다|그럼|그래서|근데|그런데|있잖아|있죠|저희|우리)\s*[,!?]?\s*/i, '')
    .replace(/[。．.，,、!！?？~〜'"\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const head = cleaned || message.trim();
  return head.length > 24 ? head.slice(0, 24).trimEnd() + '…' : head;
}

/**
 * 재질문 생성 — 시드(lastTemplateId)로 회전: 같은 세션에서 직전 template_id 연속 재사용 금지.
 * 시드 미지원(pool 밖 id/동일 id)은 pool 인덱스 해시로 폴백(결정적, 세션 일관).
 */
export function buildEmpathyRequestion(
  message: string,
  lastTemplateId: string | null | undefined,
  locale: Locale,
): { text: string; templateId: string } {
  const pool = EMPATHY_REQUESTION_TEMPLATES;
  const summary = empathyKeywordSummary(message);
  const prev = lastTemplateId ? pool.findIndex(t => t.id === lastTemplateId) : -1;
  let idx: number;
  if (prev >= 0) {
    idx = (prev + 1) % pool.length; // 연속 재사용 금지 확정 회전
  } else {
    // 시드 없음: 발화 해시로 골랐더라도 prev와 겹치면 다음으로 민다.
    let h = 0;
    for (const ch of message) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    idx = h % pool.length;
    if (idx === prev) idx = (idx + 1) % pool.length;
  }
  const t = pool[idx];
  const raw = locale === 'en' ? t.en : t.ko;
  return { text: raw.split('{요약}').join(summary), templateId: t.id };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildAnswerTemplate(message: string, _dialogueType: DialogueType, prompt: string, locale: Locale): string {
  // C+요구1 (t_c31e3f45, 대표님 9/29 card + 김비서 case 1): LLM 장애/타임아웃·복창再生성
  // 실패 시에도 "정리해 드릴게요"류 약속만 남기지 않는다 — 지시형 발화에는 즉시 실행
  // 가능한 형태(번호 목록 골격+빈 슬롯)로 답한다. 발화 내용을 1번 항목에 반영해
  // 직전 답변과 겹치지 않는다 (에코 게이트 t_135a19b5 방식 차용).
  const key = message.trim().slice(0, 50);
  if (locale === 'en') {
    return (
      `Here is the working frame for "${key}":\n\n` +
      `1. Goal: ${key} — done when:\n2. Next action: ___ (who / by when)\n3. Needs from me: ___\n\n` +
      `Fill in what you can and I will take it from there.`
    );
  }
  return (
    `\"${key}\" 바로 정리해 드릴게요. 먼저 이 골격으로 시작해요.\n\n` +
    `1. 목표: ${key} — 완료 기준: ___\n` +
    `2. 다음 할 일: ___ (누가 / 언제까지)\n` +
    `3. 저에게 필요한 것: ___\n\n` +
    `비어 있는 칸만 채워 주시면 제가 이어서 정리할게요.`
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
    repeatUtterance: Annotation,
    empathyLastTemplateId: Annotation,
    empathyEcho: Annotation,
    empathyTemplateId: Annotation,
    secretaryBridge: Annotation,
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
        const { data, error } = await db.from('messages').select('role,content,source_neuron,structured_payload,turn_index').eq('session_id', sessionId)
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
      // 동일 발화 재전송 (t_c31e3f45, 김비서 case "뭘 말해도 같은 소리"): 직전 user 행과
      // 정규화 동일 텍스트면 공감 재질문 회전을 정지한다 — 에코가 아니라 진행으로 답한다.
      const lastUser = lastUserUtterance(history || []);
      const repeatUtterance = !empathySuppressed && !!lastUser && normalizeUtterance(userMessage) === lastUser;

      // 앱 속 실 김비서 브리지 (t_620d5549): 엔드포인트 설정 + 에이전트 이름 '김비서' 정합 시
      // answerNode가 로컬 LLM 대신 Hermes kimsecretary를 부른다. 그 외 room은 false — 기존 동작 1:1.
      const secretaryBridge = isBridgeConfigured() && isKimSecretaryAgent((agentRow as { name?: string } | null)?.name);

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
        repeatUtterance,
        empathyLastTemplateId: lastEmpathyTemplateId(history || []),
        empathyEcho: null,
        empathyTemplateId: null,
        secretaryBridge,
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
        // t_135a19b5 정정 (대표님 9/28 08:40): 짧은 확인음(yes/no 분류)은 structured_payload.empathy_ack에 보존.
        // t_44f8896c (대표님 9/28): content=재질문 문장으로 교체, 복창 원문(에코 문장)은 empathy_full로 보존.
        // 프론트는 empathy_question/template_id로 버튼 문구를 재질문에 맞게 결정할 수 있다.
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
            structured_payload: {
              empathy_ack: empathyAck,
              empathy_full: final.empathyEcho ?? null,
              empathy_question: final.empathyResponse,
              template_id: final.empathyTemplateId ?? null,
            },
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
        // 계약 필드 = 화면 노출 텍스트 = 재질문 문장 (t_44f8896c; 복창 원문은 empathy_full에 보존).
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
        // 답변 대기 컬럼 (t_811e176c) — answerNode의 reply_request와 같은 판정 결과를
        // 행에 적층(불일치 방지). 011 미적용 실DB는 PGRST204/42703 → 래치 후 컬럼 없이
        // 1회 재시도 (008 queue 폴백 관례).
        const replyReq = (final.structured.structured_payload as Record<string, unknown> | undefined)?.reply_request as ReplyRequest | undefined;
        const replyCols = replyRequestColumns(replyReq ?? null);
        const answerRowValues = (extra: Record<string, unknown>) => ({
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
          ...extra,
        });
        let { data: m, error } = await db
          .from('messages')
          .insert(answerRowValues(replyCols))
          .select()
          .single();
        if (error && replyCols.awaiting_reply !== undefined && isMissingReplyColumns(error)) {
          markAwaitingReplyColumnsMissing();
          ({ data: m, error } = await db
            .from('messages')
            .insert(answerRowValues({}))
            .select()
            .single());
        }
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
        // 답변 대기 (t_811e176c) — answerNode의 판정 (미감지 시 null).
        replyRequest: ((final.structured.structured_payload as Record<string, unknown>)?.reply_request as ReplyRequest) ?? null,
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
