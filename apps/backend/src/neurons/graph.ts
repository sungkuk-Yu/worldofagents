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
import { generateEmpathyRequest } from '../lib/empathyRequest';
import { chipProceedMs, typingLeadMs } from '../lib/typingPacer';
// t_a654c9ac: 규칙 풀은 lib/empathyRule.ts로 분리(단일 소스). 재질문은 LLM 재해석 우선,
// 규칙은 최후 폴백. 테스트 하위호환: graph.ts가 아래 export-from로 같은 경로를 유지한다.
import { buildEmpathyRequestion } from '../lib/empathyRule';
import { textSimilarity } from '../lib/textSimilarity';
export { EMPATHY_REQUESTION_TEMPLATES, empathyKeywordSummary, buildEmpathyRequestion } from '../lib/empathyRule';
import { detectReplyRequest, replyRequestColumns, isMissingReplyColumns, markAwaitingReplyColumnsMissing, ReplyRequest } from '../lib/awaitingReply';
import { clientReqColumns, isClientReqConflict, isMissingClientReqColumn, markIdempotencyColumnMissing } from '../lib/idempotency';
import { nextTurnFromLast } from '../lib/helpers';
import { ReplyToSummary, resolveReplyContext, replyToColumn, classifyReplyInsertError, markReplyToColumnMissing } from '../lib/replyTo';
import { buildPersonaPrompt, PersonaGuard, classifyExpertise, DISCLAIMERS } from '../lib/persona';
import { orthographyRules, applyNaraSpeller, SpellerSuggestion, mergeProtectedTerms, normalizeProtectedTerms } from '../lib/koreanOrthography';
import { isBridgeConfigured, isKimSecretaryAgent, sendTurnToSecretary, bridgeFallbackText, BridgeError } from '../lib/secretaryBridge';
import { activateNeuronInstance, getNeuronBySlug } from './registry';
import { createSaver, checkpointEnabled, JournalState, journalStamp, openRun, runScopedId, type JournalRow } from '../lib/runCheckpoint';

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
  /** 공감 선(先)영속 경로가 이미 empathy thinking 이벤트를 발행했다면 true (t_f46d1d7a) —
   *  empathyNode은 동일 thinking 이벤트 재발행을 억제한다 (neuron.status 중복 0). */
  empathyPreEmitted?: boolean;
  /** t_a654c9ac: 음성/echoMode off 턴 (리드 지연 0 계약 소유 — 타이핑 리드로 덮어쓰지 않는다). */
  voiceOrEchoOff?: boolean;
  /** t_a654c9ac: 재질문 카드 message.new 노출 시각(Date.now) — 자동 예 진행 ≤2.6s 측정 앵커. */
  empathyExposureMs?: number;
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
  /**
   * t_20746efa two-speed (대표님 10/10 확정 계약) — '깊이 필요' 판정 lane.
   * true면 back stage: 고모델(chatLlm.deepModel) 승격 + (키 설정 시) Perplexity 근거.
   * false면 front desk: 기본 flash 무검색 즉시 답변. 평상 턴은 전부 false가 목표.
   */
  deepLane: boolean;
  groundEnabled: boolean;
  grounding: GroundingResult | null;
  /** photo_edit 지시+이미지 첨부 동반 (t_78ffba4f) — routerNode가 answer 강제 활성에 사용. */
  photoEditPending?: boolean;
  /** 예/아니오 확인 발화 에코 억제 (t_135a19b5, 대표님 9/28 정정) — true면 empathy 뉴런 skip. */
  empathySuppressed?: boolean;
  /** 공감(에코) 모드 선호 off (t_95ac521b, 대표님 9/29) — true면 empathy 행·확인음·리드 지연 없이 answer 직진. */
  echoModeOff?: boolean;
  /** 고유명사 보호 사전 (t_f5a9b570) — users.preferences.protectedTerms + 페르소나명. 어문 게이트 스킵 + 프롬프트 고지. */
  orthoProtectedTerms?: string[];
  /** 동일 발화 재전송 (t_c31e3f45, 김비서 case: 같은 소리 반복) — true면 empathy skip + no-repeat 강제. */
  repeatUtterance?: boolean;
  /** 공감 재질문 (t_44f8896c) — 직전 empathy 행의 template_id. 회전 시드(연속 재사용 금지). */
  empathyLastTemplateId?: string | null;
  /** 공감 재질문 (t_a654c9ac) — processTurn이 early 경로에서 확정해 주입한 LLM 재해석 문구.
   *  있으면 empathyNode는 재생성하지 않고 그대로 쓴다 (1턴 1재질문 — 발화점 단일화). */
  empathyPreText?: string | null;
  /** 공감 재질문 (t_44f8896c) — 행 content는 재질문 문장, 복창 원문(에코)은 empathy_full로 보존. */
  empathyEcho?: string | null;
  empathyTemplateId?: string | null;
  /** 김비서 room 브리지 (t_620d5549) — true면 answerNode가 로컬 LLM 대신 Hermes kimsecretary를 호출. */
  secretaryBridge?: boolean;
  /** 답글 인용 스냅샷 (t_02f58030) — 검증 통과 시 processTurn이 주입. answerNode 지시문·user 행 요약. */
  replyTo?: ReplyToSummary | null;
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
  /** random_id 멱등 (t_3486b1d7 ①, migration 013): user 행에 stamp. 013 미적용/플래그 off 시 컬럼 미접촉. */
  clientReqId?: string | null;
  /** 답글 인용 원문 ID (t_02f58030, 마이그레이션 012): 존재+같은 세션 검증 후 user 행 reply_to_id·
   *  structured_payload.reply_to 요약으로 영속. invalid는 무시(발화 통과) — resolveReplyContext 계약. */
  replyToId?: unknown;
  /** 짧은 확인음 노출 후 답변 시작 전 대기(ms) — 대표님 9/28 ①. 생략 시 config.answerLeadMs. */
  answerLeadMs?: number;
  /** ⑤ user 카드 사전 emit (t_3486b1d7, 김비서 9/29 A2A): 저장 직후 콜백 → chatTurn이 run.started보다 먼저 message.new user를 브로드캐스트. */
  onUserCreated?(userRow: MessagesRow): void;
  /** ⑤ run.started emit 타이밍 (t_3486b1d7): user 카드 emit 직후 콜백. chatTurn이 여기서 run.started를 발행해 이벤트 순서 계약 충족. */
  onRunReady?(): void;
  /**
   * 내구성 실행 resume (t_7182aa8f, 014) — 부팅 스캐너가 미완 run의 저널 행을 넘긴다.
   * 저장 지점별 재시작 가드: user/empathy/answer 행이 이미 stamped면 재생성하지 않고
   * 로드만, tail_persisted면 컨텍스트 패치·집계를 건너뛴다. 체크포인터가 있으면
   * 그래프는 invoke(null)로 크래시 직전 슈퍼스텝부터 재개(완료 노드 스킵).
   */
  resume?: JournalRow;
  /** 선(先)영속 user 행 (t_2133e4fc): 음성 전사 확정 시 handleTr가 runTextTurn 실행 전에 저장·선방송한
   *  행. processTurn은 insert를 건너뛰고 이 id를 재사용(중복 영속 금지), history에서 자기 행을
   *  배제(재전송 오탐·LLM 컨텍스트 복제 방지), 에이전트 번호는 최신 turn_index 뒤에서 받는다. */
  persistedUser?: MessagesRow;
  /** 공감 재질문 선(先)영속 발행 (t_f46d1d7a): user 카드·run.started 직후, 파이프라인(LLM)
   *  실행 **이전에** empathy 행이 저장되면 콜백 — chatTurn이 message.new(empathy)를 즉시
   *  브로드캐스트해 프론트 예/아니오 칩 창(발화 후 2.5s)이 답변 지연과 무관하게 열린다.
   *  미호출(off/스킵/resume)이면 기존 런 종료 후 발행 경로 그대로. */
  onEmpathyEarly?(empathyRow: MessagesRow): void;
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

async function empathyNode(state: NeuronState, ctx: NodeContext): Promise<Partial<NeuronState>> {
  // 예/아니오 게이트 (t_135a19b5, 대표님 9/28 정정): 직전 empathy 행 뒤의 짧은 확인 발화에는
  // 복창을 생성하지 않는다 — 중복 에코 루프 방지, 답변으로 직결.
  // 동일 발화 재전송 (t_c31e3f45, 김비서 라이브 진단): 직전 user 행과 같은 텍스트면 재질문
  // 회전을_stop — "뭘 말해도 같은 소리" 에코 루프의 직접 원인. 답변은 계속 직결(answer_always).
  // 공감 off 선호 (t_95ac521b, 대표님 9/29): preferences.echoMode==='off'면 텍스트 턴에서도
  // empathy 미생성 — 공감 행·예/아니오 칩·확인음 리드 지연이 통째로 빠지고 answer 직진.
  if (state.empathySuppressed || state.repeatUtterance || state.echoModeOff) return {};
  const persona = state.persona;
  const prompt = persona ? buildPersonaPrompt(persona, 'empathy') : '';
  // 복창 원문(에코 문장)은 empathy_full로 보존 (t_135a19b5), 화면 노출은 재질문으로 교체
  // (t_44f8896c, 대표님 9/28: "단순 복창이 아니고, 좀 다채롭게 이거 맞냐는 식으로 재 질문").
  // t_a654c9ac (대표님 10/4 추가 판정): 재질문 문구는 LLM 재해석 우선 — early 경로가 확정해
  // 주입한 empathyPreText를 그대로 쓴다 (1턴 1재질문, LLM 재호출 금지). 비-early 경로
  // (EMPATHY_EARLY=false 롤백)에서만 여기서 자체 호출하고, 실패/타임아웃은 규칙 폴백 —
  // 결정성 계약은 '문구 고정'이 아니라 '항상 재질문이 존재'.
  const echo = buildEmpathyTemplate(state.userMessage, state.dialogueType, prompt, state.locale);
  const rule = buildEmpathyRequestion(state.userMessage, state.empathyLastTemplateId, state.locale);
  let text = state.empathyPreText || rule.text;
  if (!state.empathyPreText && !ctx.empathyPreEmitted && config.empathyRequestLlm.enabled) {
    const llmText = await generateEmpathyRequest(state.userMessage, rule.templateId, state.locale, { signal: ctx.signal });
    if (ctx.signal?.aborted && !ctx.classificationCancelled) throw new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.');
    text = llmText || rule.text;
  }
  const templateId = rule.templateId; // 회전·연속금지 계약은 template_id가 소유 (t_44f8896c 불변)
  // 선영속 경로(t_f46d1d7a)는 같은 thinking 이벤트를 이미 발행 — 중복 neuron.status 억제.
  // events push는 state 기록용으로 유지 (simplePipeline의 (neuron,status) dedupe 존재).
  if (!ctx.empathyPreEmitted) ctx.emit({ neuron: 'empathy', status: 'idle', stage: 'thinking', quip: quipText(state, 'ack') });
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

/** 문자 2-gram Dice 계수 (0~1) — 재귀 생성 판정용 (t_c31e3f45 B, 임계 0.8).
 *  t_51f9fd01: 구현은 lib/textSimilarity.ts로 이동(공감 복창 차단과 공유) — 하위호환 재수출 유지. */
export { textSimilarity } from '../lib/textSimilarity';

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
  let deepFromLlm = false;
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
    // t_20746efa two-speed: depth 판정은 type 인용과 독립 채취 — 법률/시사 발화가
    // information 저신뢰로 type 미채택이어도 '깊이 필요' 신호는 살린다 (오탐 비용은
    // 백스테이지 지연뿐, precision-first 프롬프트). LLM 실패/미응답 → false (front desk).
    deepFromLlm = llm ? llm.deep === true : false;
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
    // t_20746efa two-speed: 깊이 판정 = processTurn 규칙 씨앗 OR Stage 2 LLM deep 보강.
    events: [...state.events, { neuron: 'router', status: 'processing', stage: 'organizing', quip: quipText(state, 'organizing') }],
    ...(deepFromLlm ? { deepLane: true, reason: `${reason}, depth_llm` } : {}),
  };
}

/** 답글 인용 지시문 (t_02f58030, 백로그④) — answerNode 프롬프트 삽입용. 인용 원문 요약+ID를
 *  LLM이 "무엇에 대한 답글인가"로 정렬한다. 발췌는 발행 시점 스냅샷(원문 삭제 후에도 유효). */
function replyInstruction(state: NeuronState): string {
  const r = state.replyTo;
  if (!r) return '';
  return state.locale === 'en'
    ? `\n\nThe user replied to an earlier message — answer as a reply to it. Quoted message (id ${r.message_id}) from ${r.by}: "${r.text}"`
    : `\n\n사용자가 특정 발화에 답글을 달했습니다: [${r.by}] "${r.text}" (원문 id: ${r.message_id}). 인용된 발화에 대한 답글로 답변하세요.`;
}

async function answerNode(state: NeuronState, ctx: NodeContext): Promise<Partial<NeuronState>> {
  if (!state.activationPlan.includes('answer')) return {};
  // ① 짧은 확인음(ack) 후 답변 스트리밍 전 체감 공백 (t_344e047a, 대표님 9/28 ①) —
  // config.answerLeadMs(기본 3000, 0=즉시). 이 3초는 quip이 도는 구간이다. 취소 전파됨.
  // t_a654c9ac (대표님 10/4) 사람 타이핑 감각 — HUMAN_TYPING ON이면 리드 계약을 교체한다:
  //  · 재질문 카드가 뜬 턴: 칩 창 소진 후 자동 예 진행 — [2.5s, 2.6s] (게이트 ≤2.6s).
  //    선(先)노출된 순간부터의 경과를 차감해 라우터 LLM 지연이 칩 창을 먹지 않게 한다.
  //  · 재질문 없는 텍스트 턴(확인 발화 직결 등): 발화 길이 비례 사람 리드타임 0.8~2.0s.
  //  · 음성/echoMode off 턴: leadMs=0 계약 불변 (t_5cba9ebb ≤3.5s SLA가 우선).
  // OFF(HUMAN_TYPING=false)면 아래 분기가 전부 스킵 — 기존 리드 지연과 1:1.
  let leadMs = ctx.leadMs;
  if (config.humanTyping.enabled && !ctx.voiceOrEchoOff) {
    if (state.empathyResponse) {
      const target = chipProceedMs();
      leadMs = ctx.empathyExposureMs
        ? Math.max(0, target - (Date.now() - ctx.empathyExposureMs))
        : target;
    } else {
      leadMs = typingLeadMs(state.userMessage.length);
    }
  }
  // t_20746efa 게이트 3 (front desk SLA: ack→첫 글자 ≤frontDeskFirstTokenMs): 연출 리드는
  // '체감'이지 SLA가 아니다(ack·quip가 대기를 채운다) — 리드 상한 = SLA − TTFT 예산(실측
  // flash 548ms+지터 700ms). empathy 리드(칩 창 2.5s 읽기 계약)·깊이 lane(백스테이지 =
  // '한 답의 지연')·voice/off(lead0)는 대상 아님. cap≤0이면 리드 전면 생략.
  if (leadMs && !state.empathyResponse && !state.deepLane) {
    const cap = config.protocol.frontDeskFirstTokenMs - config.protocol.frontDeskTtftBudgetMs;
    if (cap < leadMs) leadMs = Math.max(0, cap);
  }
  if (leadMs) await waitOrAbort(leadMs, ctx.signal);
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
  // ── 전문가 그라운딩 (t_d54bc456) — two-speed(t_20746efa)에서 검색은 **깊이 lane 전용**.
  // 발동 조건 = state.deepLane(규칙 씨앗 OR router Stage2 LLM 보강) + Perplexity 설정(opt-in).
  // 매 턴 선행검색 영구 폐기(대표님 10/10): 평상 턴은 이 gate를 통과하지 않는다.
  // 키 미설정 시 시도하지 않는다 (DEV/unit 테스트는 실 키 없이도 기존 동작 그대로). ──
  let grounding: GroundingResult | null = null;
  if (state.deepLane && isPerplexityConfigured() && !ctx.signal?.aborted) {
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
    // 어문 규칙(t_45256c7a)은 appendLanguageInstruction *이전* 본문에 붙인다 —
    // 'Respond in ….' 꼬리 계약(run-e) 보존. ko일 때만 주입(en 답변에 한국어 맞춤법 무의미).
    // t_f5a9b570: 보호 사전(사용자 prefs+페르소나명)을 규칙에 고지 — '김비서'를 스스로 쪼기지 않게.
    const systemPrompt = appendLanguageInstruction(prompt + '\nAnswer naturally. Avoid excessive markdown.' + noRepeat + orthographyRules(state.locale, mergeProtectedTerms(state.orthoProtectedTerms || [])) + groundingBlock + replyInstruction(state), state.locale);
    // t_20746efa two-speed: 깊이 lane은 백스테이지 고모델 승격(설정 시). 미설정이면
    // front 모델 유지 — 승격 실패 폴백이 아니라 '고모델 미배포' 상태라도 턴이 살아간다.
    const answerModel = state.deepLane && config.chatLlm.deepModel ? config.chatLlm.deepModel : undefined;
    try {
      const result = await chatCompletion({
        model: answerModel,
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
          // t_20746efa: 복창 재생성도 같은 lane 모델 유지 (front/deep 혼선 방지).
          model: answerModel,
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
  // ── PNU 맞춤법 후처리 게이트 (t_45256c7a, 대표님 9/30 "이해오" 재발 방지) ──
  // 프롬프트 어문규칙에도 LLM이 조사를 깨서 쓴다(9/30 실측) — 최종 답변 텍스트를 나라
  // 맞춤법 검사기로 확정 교정한다. 스트림 델타는 이미 나갔지만 프론트 reduceStreams는
  // answer.done/확정 행 text로 카드 본문을 교체하므로 화면 불일치가 없다. 브리지는
  // early-return이라 자동 면제(원문 재작성 금지), 디스클레이머 suffix는 이 뒤(processTurn)에
  // 붙으므로 오프셋 오염 없음. 미구성/실패/취소는 원문 그대로(턴 사망 금지).
  let orthoApplied: SpellerSuggestion[] | null = null;
  let orthoSkipped = 0;
  if (state.locale === 'ko' && answerResponse && !ctx.signal?.aborted) {
    const spell = await applyNaraSpeller(answerResponse, { signal: ctx.signal, protectedTerms: state.orthoProtectedTerms || [] });
    if (spell) {
      answerResponse = spell.text;
      orthoApplied = spell.suggestions;
      orthoSkipped = spell.skippedProtected;
    }
  }
  let structured = await classifyStructured(state.userMessage, state.dialogueType, answerResponse, ctx.signal);
  if (orthoApplied) {
    // 교정 근거를 페이로드에 남긴다 — 감사/회고 가능(무언 교정 금지).
    // t_f5a9b570: items는 채택분만, skipped_protected는 고유명사 보호로 차단된 건수(오디트).
    structured = { ...structured, structured_payload: { ...structured.structured_payload, orthography: { corrected: true, count: orthoApplied.length, skipped_protected: orthoSkipped, items: orthoApplied.map(s => ({ from: s.text, to: s.candidates[0] })) } } };
  }
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
// 아래 재질문 문장이 된다. t_a654c9ac(대표님 10/4): 규칙 풀은 lib/empathyRule.ts로
// 분리되고 기본은 LLM 재해석(lib/empathyRequest.ts), 실패 시에만 이 규칙 폴백.
// (재수출은 파일 상단의 export-from 1곳 — 중복 export 금지)

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

// compile 옵션 타입 — checkpointer는 Supabase transport 위의 커스텀 saver (t_7182aa8f).
type ExecOptions = { checkpointer?: import('../lib/runCheckpoint').SupabaseCheckpointSaver | null; threadId?: string; resume?: boolean };

async function langGraphPipeline(
  initial: NeuronState, ctx: NodeContext,
  exec?: ExecOptions
): Promise<NeuronState> {
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
    deepLane: Annotation,
    groundEnabled: Annotation,
    grounding: Annotation,
    photoEditPending: Annotation,
    empathySuppressed: Annotation,
    echoModeOff: Annotation,
    orthoProtectedTerms: Annotation,
    repeatUtterance: Annotation,
    empathyLastTemplateId: Annotation,
    empathyPreText: Annotation,
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
    .compile(exec?.checkpointer ? { checkpointer: exec.checkpointer } : {});

  // 내구성 실행 (t_7182aa8f, flag LANGGRAPH_CHECKPOINT=true):
  // thread_id=run_id 로 슈퍼스텝마다 체크포인트가 저장된다. resume 실행은 invoke(null) —
  // Pregel이 최신 체크포인트에서 이어 붙이고(완료 노드 스킵, probe 실측: a 재실행 없음),
  // 체크포인트가 없으면(크래시가 그래프 시작 전) 초기 상태로 fresh 실행한다.
  // flag off = 기존 호출형과 1:1 (configurable {ctx} 만 전달, checkpointer/스레드 없음).
  const configurable: Record<string, unknown> = exec?.threadId
    ? { ctx, thread_id: exec.threadId }
    : { ctx };
  let input: NeuronState | null = { ...initial };
  if (exec?.resume && exec.checkpointer && exec.threadId) {
    const tuple = await exec.checkpointer.getTuple({ configurable: { thread_id: exec.threadId } });
    if (tuple) input = null;
  }
  const result = input === null
    ? await graph.invoke(null, { configurable })
    : await graph.invoke(input, { configurable });
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
    // ── 내구성 실행 (t_7182aa8f, flag LANGGRAPH_CHECKPOINT=true / 마이그레이션 014) ──
    // 저널 open: 부팅 resume이면 기존 행을 재사용(중복 생성 금지)하고, 새 run이면
    // graph_runs에 레시피를 박는다. journalTableMissing 래치(008 관례)가 켜지면
    // 체크포인터·저널이 통째로 꺼지고 현행 무영속 경로와 1:1 동일하게 돈다.
    // journal은 try 밖에 선언 — catch에서 failed/abandoned 스탬프(부팅 스캐너가
    // 영구 재resume하지 않게)가 필요하다.
    const resuming = Boolean(opts.resume);
    const ckptActive = checkpointEnabled();
    const journal = new JournalState(db, turnId, opts.resume ?? null);
    try {
      const events: NeuronStatusEvent[] = [];
      const emit = (e: NeuronStatusEvent) => {
        events.push(e);
        opts.emitEvent?.(e);
      };

      if (!resuming && ckptActive) {
        await openRun(db, {
          runId: turnId, sessionId, userId,
          content: userMessage, locale,
          sttMetadata: opts.sttMetadata ?? null,
          thread: opts.thread ?? null,
          attachmentIds: opts.attachmentIds ?? null,
          replyToId: typeof opts.replyToId === 'string' ? opts.replyToId : null,
        });
      }

      let deltaIndex = 0;
      // 공감(에코) 모드 선호 (t_95ac521b, 대표님 9/29): users.preferences.echoMode==='off' →
      // empathy 미생성 — 공감 행·예/아니오 칩·확인음 리드 지연 없이 answer 직진. 미설정/그 외
      // 값은 'on'(현행 1:1 계약), 조회 오류도 'on' 강등 — 선호 하나로 턴을 죽이지 않는다.
      // 턴당 SELECT 1회(PATCH /me·auth/me 딥 머지 경로 재사용, 마이그레이션 불필요 JSONB 키).
      const { data: echoPrefRow } = await db.from('users').select('preferences').eq('id', userId).maybeSingle();
      const userPrefs = (echoPrefRow as { preferences?: { echoMode?: unknown; protectedTerms?: unknown } } | null)?.preferences || {};
      const echoModeOff = userPrefs.echoMode === 'off';
      // 고유명사 보호 사전 (t_f5a9b570, 김비서 #454 실측): preferences.protectedTerms(문자열 배열)
      // + 페르소나명. 배열이 아니거나 모양이 엉성하면 무시(턴 사망 금지 관례 동일).
      const orthoProtectedTerms = normalizeProtectedTerms([
        ...(Array.isArray(userPrefs.protectedTerms) ? userPrefs.protectedTerms.map(String) : []),
        persona?.name || '',
      ]);
      const ctx: NodeContext = { signal: opts.signal, emit: e => {
        emit(e);
        opts.onTurnStatus?.('processing', { stage: e.stage });
      }, onDelta: d => opts.onAnswerDelta?.(d, deltaIndex++), llm: { used: false, model: null, fallback: false },
      // ① 확인음 후 답변 시작 전 체감 공백 (t_344e047a). 0이면 즉시.
      // 음성 턴은 지연 0 (t_5cba9ebb 9/29 #325 보강 2항): 공감 스테이지가 없어 지연할
      // 확인음이 존재하지 않는다 — answer.delta가 전사 직후 시작되는 것이 목표(≤3.5s).
      // 공감 off 선호도 동일 — 지연할 확인음(empathy)이 없다 (t_95ac521b, 같은 선례).
      leadMs: (opts.sttMetadata || echoModeOff) ? 0 : (opts.answerLeadMs ?? config.answerLeadMs),
      // t_a654c9ac: 음성/off 턴 표시 — 타이핑 리드가 leadMs=0 SLA(t_5cba9ebb ≤3.5s)를 덮지 않게.
      voiceOrEchoOff: Boolean(opts.sttMetadata || echoModeOff),
      // ③ 후속 질문 보강 컨텍스트 조회 (볼트 노트·선호) — t_344e047a.
      db };
      const dialogueType = classifyDialogueType(userMessage);

      // 전문가 카테고리 판정 (t_d54bc456) — 그라운딩 게이트와 저장 시 디스클레이머가 공유한다.
      const { data: agentRow, error: agentFetchError } = await db.from('agents').select('*').eq('id', agentId).maybeSingle();
      if (agentFetchError) throw new ApiError('INTERNAL_ERROR', agentFetchError.message);
      const expertise = classifyExpertise(agentRow?.category, agentRow?.config, persona?.name, persona?.system_prompt, persona?.tags);
      // 그라운딩 활성 조건: 에이전트/페르소나가 전문가 카테고리이거나 질문 자체가 법률·회계·의료 질문.
      // (종량제 — 일반 토크에는 호출하지 않는다. 대표님 지시: 법률 답변은 무조건 검색 근거와 함께.)
      // t_20746efa: Perplexity 기본 OFF(opt-in) — 위 조건이 참이어도 플래그·키가 없으면 미발동.
      const questionExpertise = classifyExpertise(userMessage);
      // two-speed (대표님 10/10 확정): '깊이 lane' 씨앗 = 전문가 규칙 판정(에이전트 카테고리
      // 또는 발화 자체가 법률/세무/의료/시사). 검색 발동은 오직 이 lane에서만 — 매 턴 선행검색
      // 영구 폐기. routerNode Stage 2 LLM deep 판정이 규칙 미잡은 깊이 발화를 OR로 보강한다.
      // (평상 발화 = front desk: 기본 flash 무검색 즉시 답변. deepModel/검색 미설정 시
      //  깊이 lane도 flash 경로로 돌아간다 — 승격은 운영 opt-in.)
      const deepLane = expertise !== 'general' || questionExpertise !== 'general';
      const groundEnabled = deepLane && isPerplexityConfigured();

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
        const { data, error } = await db.from('messages').select('id,role,content,source_neuron,structured_payload,turn_index').eq('session_id', sessionId)
          .order('turn_index', { ascending: false }).limit(Math.max(0, config.chatLlm.historyTurns * 3));
        if (error) throw new ApiError('INTERNAL_ERROR', error.message);
        // 선(先)영속 행 배제 (t_2133e4fc): 이번 발화가 history의 "직전 user 행"으로 자기 자신과
        // 만나면 repeatUtterance 오탐 + LLM 컨텍스트 복제가 된다. 배제는 load-only —
        // lastUserUtterance 등 history 판정자 전부에 일관 적용(호출 지점 추가 수정 불필요).
        history = (data || []).reverse().filter((m: any) => !opts.persistedUser || m.id !== opts.persistedUser.id);
      } else if (opts.persistedUser) {
        history = history.filter((m: any) => m.id !== (opts.persistedUser as { id?: string }).id);
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
      // 음성 경로 공감 스테이지 생략 (t_5cba9ebb, 대표님 9/29 #325 확정 1항): audio.end→전사→
      // 즉시 답변(복명복창 폐기 — "사실상 복명복창은 안하고 지금의 텔레그램처럼"). empathy 재질문은
      // 텍스트 입력 전용. 전사문 자체는 user 카드로 표시(#325 2항 — 저장 경로는 그대로).
      const isVoiceTurn = Boolean(opts.sttMetadata);
      const empathySuppressed = isVoiceTurn
        || (isConfirmationUtterance(userMessage)
          && (hasTrailingEmpathyRow(history || []) || previousTurnWasConfirmation(history || [])));
      // 동일 발화 재전송 (t_c31e3f45, 김비서 case "뭘 말해도 같은 소리"): 직전 user 행과
      // 정규화 동일 텍스트면 공감 재질문 회전을 정지한다 — 에코가 아니라 진행으로 답한다.
      const lastUser = lastUserUtterance(history || []);
      const repeatUtterance = !empathySuppressed && !!lastUser && normalizeUtterance(userMessage) === lastUser;

      // 앱 속 실 김비서 브리지 (t_620d5549): 엔드포인트 설정 + 에이전트 이름 '김비서' 정합 시
      // answerNode가 로컬 LLM 대신 Hermes kimsecretary를 부른다. 그 외 room은 false — 기존 동작 1:1.
      const secretaryBridge = isBridgeConfigured() && isKimSecretaryAgent((agentRow as { name?: string } | null)?.name);

      // 답글 인용 (t_02f58030, 마이그레이션 012): 수신 검증은 invalid-무시 계약 — 없는 ID/
      // 다른 세션이면 null 강등 후 발화 통과. 요약 스냅샷은 user 행 structured_payload.reply_to에
      // 박아 원문 삭제(SET NULL) 후에도 인용바가 렌더된다 (텔레그램 관습).
      const replyCtx = opts.replyToId !== undefined ? await resolveReplyContext(db, sessionId, opts.replyToId, userId, agentId) : { replyToId: null, summary: null };

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
        deepLane,
        groundEnabled,
        grounding: null,
        photoEditPending,
        empathySuppressed,
        echoModeOff,
        orthoProtectedTerms,
        repeatUtterance,
        empathyLastTemplateId: lastEmpathyTemplateId(history || []),
        empathyEcho: null,
        empathyTemplateId: null,
        secretaryBridge,
        replyTo: replyCtx.summary,
        finalResponse: { empathy: null, answer: null, visualsRequested: false },
        events: [],
        engine: 'simple',
      };

      // engine: resume 시에는 크래시 전과 같은 엔진으로 재실행한다 (저널 engine 스탬프).
      // 미스탬프(그래프 진입 전 크래시)면 현재 설정으로 재판정 — simple 폴백은 무checkpoint라
      // 저널 스탬프 가드(user/empathy/answer/tail)만으로 구간 재시작한다.
      const engine: 'langgraph' | 'simple' =
        (resuming && opts.resume?.engine) || (config.neuronEngine === 'langgraph' && checkLangGraph() ? 'langgraph' : 'simple');
      if (ckptActive) await journalStamp.engine(db, turnId, engine);

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
        return nextTurnFromLast((lastMsg as { turn_index?: number } | null)?.turn_index);
      };
      let nextTurn = await getNextTurn();

      // 사용자 메시지 저장 — 013 멱등 컬럼 + 012 인용 컬럼/payload 강등 사다리 공용.
      // userCols(처음 포착): 진입 시 스탬프 시도 여부 — 래치 판정 가드용.
      // insert 안에서는 매 시도 재계산: 래치 on 후 재시도에서 컬럼이 실제 제외되게.
      const userCols = clientReqColumns(opts.clientReqId ?? null);

      // 선(先)영속 user 행 재사용 (t_2133e4fc): handleTr가 run 전에 저장·선방송한 행.
      // insert 건너뛰기 = 같은 user message_id 유지(중복 영속 금지, ingress contract).
      // 013 멱등 사다리(사전 조회·강등·CONFLICT)는 persistUserUtteranceEarly가 선처리 —
      // 선영속 경로가 멱등을 우회하는 구멍이 되지 않는다.
      // user 행은 이미 존재하므로 this turn의 에이전트 번호는 락 획득 시점의 최신 최대+1로
      // 재계산 — 선저장 이후 락 밖에서 끼어든 동시 턴과 UNIQUE(session_id,turn_index) 충돌 방지.
      let msgUserEarly: MessagesRow | null = null;
      if (opts.persistedUser) {
        msgUserEarly = opts.persistedUser;
        // user 행은 이미 존재 → nextTurn을 "직전 max"로 맞춘다 (max+1 - 1).
        // 낙관 경로: user=T면 empathy=T+1, answer=T+2 (정상 경로와 동일 인접 번호).
        // 락 밖 동시 턴이 T 뒤에 행을 심었으면 max가 그 뒤로 밀려 UNIQUE 충돌이 없다.
        nextTurn = (await getNextTurn()) - 1;
      }

      // 답글 인용 컬럼/요약 (t_02f58030): replyCols는 래치(on)면 빈 객체. 강등 2종 —
      //  · column-drop: 012 미적용(PGRST204/42703) → 래치 후 컬럼 생략 재시도 (011 관례, 요약 payload 유지)
      //  · ref-drop: 23503/FK·CROSS_SESSION 트리거(검증 후 원문 삭제 경쟁 등) → 인용 정보 탈락 재시도 (발화 통과)
      const replyPayload = replyCtx.summary ? { structured_payload: { reply_to: replyCtx.summary } } : {};
      const replyCols = replyToColumn(replyCtx.replyToId);
      // saveUser에 forcedId를 받으면 insert→upsert로 바뀐다 (t_7182aa8f②): resume 실행은
      // run_id 결정적 UUID로 저장하므로 크래시-스탬프 공백(행은 쓰였지만 journalStamp 미도달)으로
      // 같은 지점을 다시 지나도 행 복제가 아니라 같은 PK 수렴(upsert)이다. flag off 경로는
      // forcedId=undefined → 기존 insert와 동일 동작.
      // forcedId(t_7182aa8f②): ckptActive 경로는 run_id 결정적 UUID를 PK로 박아 upsert로
      // 저장한다 — 크래시가 insert 직후(journalStamp 미도달)로 일어나도 재실행이 같은 PK에
      // 수렴해 user/empathy/answer 행 복제가 구조적으로 없다. flag off는 기존 insert 그대로.
      const saveUser = (extra: Record<string, unknown>, forcedId?: string) => {
        const row = {
          ...(forcedId ? { id: forcedId } : {}),
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
          ...clientReqColumns(opts.clientReqId ?? null),
          ...extra,
        };
        const query = forcedId
          ? db.from('messages').upsert(row, { onConflict: 'id' })
          : db.from('messages').insert(row);
        return query.select().single();
      };

      // resume 구간 재시작 가드 (t_7182aa8f②): 스탬프된 user 행 id 또는 결정적 forcedId
      // 행이 이미 DB에 있으면 재생성하지 않고 로드한다 (turn_index 보존 — nextTurn pinning).
      // forcedId 히트는 스탬프 공백 크래시(쓰기 직후 사망)의 자기복구 경로 — 로드 후 스탬프.
      // 선영속 재사용 시 insert 전 구간 스킵 (t_2133e4fc) — 같은 user message_id 유지.
      // 013 멱등 사다리(사전 조회→컬럼 강등→CONFLICT)는 persistUserUtteranceEarly가 선처리했다.
      const userForcedId = ckptActive ? runScopedId(turnId, 'user') : undefined;
      let msgUser: MessagesRow | null = msgUserEarly;
      let errUser: { message?: string } | null = null;
      if (msgUser && ckptActive && !journal.userMessageId) await journal.stampUser(msgUser.id);
      if (!msgUser && resuming) {
        const preExisting = journal.userMessageId || userForcedId || null;
        const { data: existing, error } = await db.from('messages').select('*')
          .eq('id', preExisting).eq('session_id', sessionId).maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', error.message || 'resume: user 행 조회 실패');
        if (existing) {
          msgUser = existing as MessagesRow;
          // resume는 원 크래시 실행의 turn 계획에 못 박는다 — empathy/answer의
          // turn_index(nextTurn+1/+2)가 크래시 전과 동일하게 재계산되도록 pinning.
          nextTurn = (existing.turn_index as number);
          if (!journal.userMessageId) await journal.stampUser(existing.id);
        }
      }
      if (!msgUser) {
        ({ data: msgUser, error: errUser } = await saveUser({ ...replyCols, ...replyPayload }, userForcedId));
        // client_req 유니크 충돌(t_3486b1d7 ①) = 사전 조회를 뚫고 들어온 재전송 레이스 —
        // turn_index 충돌 리트라이로 삼키면 중복 user 행이 영속된다. 즉시 CONFLICT로 마감.
        if (errUser && isClientReqConflict(errUser)) {
          throw new ApiError('CONFLICT', '중복 전송이 이미 접수되었습니다.');
        }
        // 013 미적용 실DB 직격(PGRST204/42703, 사전 조회를 거치지 않은 processTurn 직접 호출) —
        // 래치 후 컬럼 없이 1회 재시도 (008/011 관례). insert 내 clientReqColumns가 재계산되어 제외.
        if (errUser && userCols.client_req_id !== undefined && isMissingClientReqColumn(errUser)) {
          markIdempotencyColumnMissing();
          ({ data: msgUser, error: errUser } = await saveUser({ ...replyCols, ...replyPayload }, userForcedId));
        }
        if (errUser && /duplicate|unique/i.test(errUser.message || '')) {
          nextTurn = await getNextTurn();
          ({ data: msgUser, error: errUser } = await saveUser({ ...replyCols, ...replyPayload }, userForcedId));
        }
        if (errUser) {
          const replyRetry = classifyReplyInsertError(errUser, Object.keys(replyCols).length > 0);
          if (replyRetry === 'column-drop') {
            markReplyToColumnMissing();
            ({ data: msgUser, error: errUser } = await saveUser(replyPayload, userForcedId));
          } else if (replyRetry === 'ref-drop') {
            ({ data: msgUser, error: errUser } = await saveUser({}, userForcedId));
          }
        }
        if (errUser || !msgUser) throw new ApiError('INTERNAL_ERROR', errUser?.message || '사용자 메시지 저장 실패');
        await journal.stampUser(msgUser.id);
      }
      // ⑤ user 카드 사전 emit (t_3486b1d7, 김비서 9/29 A2A): chatTurn이 run.started보다 먼저 message.new user를 브로드캐스트한다.
      opts.onUserCreated?.(msgUser as MessagesRow);
      // ⑤ run.started emit 타이밍: user 카드 직후 콜백. chatTurn이 여기서 run.started를 발행.
      opts.onRunReady?.();
      // 첨부 링크 (t_401c5bd1): LLM 호출 전에 실패시켜 비용을 물리지 않는다. 소유권/이중링크 검증은 공유 lib.
      // resume는 링크가 이미 걸려 있을 수 있다(크래시가 링크 후) — CONFLICT 재생성 오보를
      // 막고 기존 링크를 read-back한다(t_7182aa8f②).
      let linkedAttachments: { url: string; mime: string }[] = [];
      if (opts.attachmentIds?.length) {
        if (resuming) {
          const { data: already } = await db.from('messages_attachments').select('url,mime')
            .in('id', Array.from(new Set(opts.attachmentIds))).eq('message_id', (msgUser as { id: string }).id);
          linkedAttachments = (already as { url: string; mime: string }[]) || [];
          if (linkedAttachments.length !== new Set(opts.attachmentIds).size) {
            linkedAttachments = await linkAttachmentsToMessage(db, userId, sessionId, (msgUser as { id: string }).id, opts.attachmentIds);
          }
        } else {
          linkedAttachments = await linkAttachmentsToMessage(db, userId, sessionId, (msgUser as { id: string }).id, opts.attachmentIds);
        }
      }
      const checkCancelled = () => {
        if (opts.signal?.aborted && !ctx.classificationCancelled) throw new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.');
      };
      checkCancelled();
      processing = true;

      // ── 공감 재질문 선(先)영속·선노출 (t_f46d1d7a, 김비서 9/29 flake 판정) ──
      // empathy 생성은 이미 규칙 기반 결정적(buildEmpathyRequestion, LLM 0회)이지만,
      // 행 저장·message.new 발행이 런 종료 후 answer와 같은 초에 일어나는 것이 flake의
      // 실질 원인이다 (라이브 DB read-back: 발화→empathy 행 착지 15s~186s = 답변 LLM/
      // 브리지 지연 전량). 프론트 예/아니오 칩 창(발화 직후 2.5s)이 그 지연에 좌우돼
      // B/C/F 구간이 갈린다. → user 카드·run.started 발행 직후, 파이프라인(LLM) 실행
      // **이전에** empathy 판정(기존 suppression 게이트 전부 동일 적용)·저장·선발행.
      // 결정적 규칙만 사전 실행 — 답변 내용은 어떤 경로로도 앞당겨지지 않는다.
      // off(EMPATHY_EARLY=false)/resume/선영속 재전송 경로는 아래 late 저장 경로로 복귀.
      let empathyEarly: MessagesRow | null = null;
      const empathyEarlyEnabled = config.protocol.empathyEarly && !resuming && Boolean(opts.onEmpathyEarly);
      if (empathyEarlyEnabled && !initial.empathySuppressed && !initial.repeatUtterance && !initial.echoModeOff) {
        // t_a654c9ac (대표님 10/4 추가 판정): 재질문 문구는 LLM 재해석 우선 — 회전·연속금지
        // 계약은 template_id가 소유하므로 풀 선택은 규칙(buildEmpathyRequestion)이 확정하고,
        // LLM에는 그 템플릿 말투 계열 힌트만 준다. 실패/타임아웃/형식 위반은 규칙 문장 폴백 —
        // 결정성 계약은 '문구 고정'이 아니라 '항상 재질문이 존재'. 확정 문구는 initial.empathyPreText로
        // 파이프라인에 주입해 early 행과 empathyNode가 같은 문장을 쓴다 (1턴 1재질문, 재호출 금지).
        const ruleEarly = buildEmpathyRequestion(userMessage, initial.empathyLastTemplateId, locale);
        // 취소는 폴백으로 삼키지 않고 기존 런 취소 경로(RUN_CANCELLED)로 전파한다.
        const llmEarly = opts.signal?.aborted ? null : await generateEmpathyRequest(userMessage, ruleEarly.templateId, locale, { signal: opts.signal });
        if (opts.signal?.aborted) throw new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.');
        const earlyText = llmEarly ?? ruleEarly.text;
        initial.empathyPreText = earlyText;
        const earlyTemplateId = ruleEarly.templateId;
        const earlyEcho = buildEmpathyTemplate(userMessage, dialogueType, persona ? buildPersonaPrompt(persona, 'empathy') : '', locale);
        const empathyAck = pickQuip('ack', locale, persona?.tone);
        // 체크포인터 ON이면 결정적 id/upsert (t_7182aa8f② 계약) — resume 시 재로드 대상.
        const earlyForcedId = ckptActive ? runScopedId(turnId, 'empathy') : undefined;
        const earlyRow = {
          ...(earlyForcedId ? { id: earlyForcedId } : {}),
          session_id: sessionId,
          parent_message_id: opts.thread ? (msgUser as MessagesRow).id : null,
          root_message_id: opts.thread?.rootMessageId ?? null,
          turn_index: nextTurn + 1,
          role: 'agent',
          locale,
          ai_generated: true,
          message_type: 'text',
          content: earlyText,
          dialogue_type: null,
          structured_payload: {
            empathy_ack: empathyAck,
            empathy_full: earlyEcho,
            empathy_question: earlyText,
            template_id: earlyTemplateId,
          },
          stt_metadata: null,
          source_neuron: 'empathy',
          attachments: [],
          persona_guard: {},
          user_feedback: null,
        };
        const { data: em, error: emErr } = await (earlyForcedId
          ? db.from('messages').upsert(earlyRow, { onConflict: 'id' })
          : db.from('messages').insert(earlyRow))
          .select().single();
        if (emErr) {
          // UNIQUE(session_id,turn_index) 레이스(락 밖 동시 턴)는 번호 재읽기 1회 (saveUser 관례).
          if (/duplicate|unique/i.test(String(emErr.message || ''))) {
            const { data: retry, error: retryErr } = await db.from('messages')
              .insert({ ...earlyRow, turn_index: (await getNextTurn()) + 1 }).select().single();
            if (retryErr || !retry) throw new ApiError('INTERNAL_ERROR', retryErr?.message || '공감 선영속 실패');
            empathyEarly = retry as MessagesRow;
          } else {
            throw new ApiError('INTERNAL_ERROR', emErr.message || '공감 선영속 실패');
          }
        } else if (em) {
          empathyEarly = em as MessagesRow;
        }
        if (empathyEarly) {
          await journal.stampEmpathy(empathyEarly.id);
          // empathy 노드의 thinking 이벤트와 동일 payload — 프론트 quip/릴레이 dedupe 유지.
          ctx.empathyPreEmitted = true;
          ctx.emit({ neuron: 'empathy', status: 'idle', stage: 'thinking', quip: empathyAck });
          // 선(先) 발행 (t_f46d1d7a): user 카드·run.started 발행 직후 empathy 카드를 내보낸다 —
          // 프론트 예/아니오 칩 창(발화 후 2.5s)이 답변 LLM/브리지 지연(15~186s 실측)과 무관하게
          // 열린다. chatTurn이 message.new(empathy) 브로드캐스트 후 post-loop 재발행을 생략한다.
          opts.onEmpathyEarly?.(empathyEarly);
          // t_a654c9ac: 칩 창 개시 시각(서버 노출 각인) — answerNode 자동 예 진행 리드는
          // 이 순간부터 [2.5s,2.6s]로 측정된다 (라우터/재질문 LLM 지연이 칩 창을 못 먹게).
          ctx.empathyExposureMs = Date.now();
        }
      }

      opts.onTurnStatus?.('processing', { stage: 'thinking' });
      // 체크포인터 실행 (t_7182aa8f): saver는 run 전용 인스턴스, thread_id=run_id.
      // resume 실행은 thread에 히스토리가 있으면 invoke(null)로 크래시 직전부터,
      // 없으면(그래프 진입 전 크래시) 초기 상태로 fresh 실행 — langGraphPipeline이 판정.
      // ckptActive=false 이면 exec 생략 = flag off와 1:1 (무영속, 기존 호출형).
      const saver = ckptActive ? createSaver(db) : null;
      const final = engine === 'langgraph'
        ? await langGraphPipeline(initial, ctx, saver ? { checkpointer: saver, threadId: turnId, resume: resuming } : undefined)
        : await simplePipeline(initial, ctx);
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
        // 선영속 재사용 (t_f46d1d7a): user 카드 직후 미리 저장·발행한 행이 있으면 재생성하지
        // 않고 그 id/ 내용을 그대로 쓴다 — 메시지 1행 1message.new 계약(t_2133e4fc user 선영속과 동일 관례).
        if (empathyEarly) {
          empathyMessage = empathyEarly;
          empathyMessageId = empathyEarly.id;
          empathyVisible = empathyEarly.content;
        } else {
        // resume 가드 (t_7182aa8f②): empathy 행이 이미 스탬프됐거나 결정적 forcedId 행이
        // DB에 있으면(스탬프 공백) 재생성하지 않고 로드한다.
        const empathyForcedId = ckptActive ? runScopedId(turnId, 'empathy') : undefined;
        const empathyPre = resuming ? journal.empathyMessageId || empathyForcedId || null : null;
        let empathySaved = false;
        if (empathyPre) {
          const { data: ex, error } = await db.from('messages').select('*').eq('id', empathyPre)
            .eq('session_id', sessionId).maybeSingle();
          if (error) throw new ApiError('INTERNAL_ERROR', error.message || 'resume: empathy 조회 실패');
          if (ex) {
            empathyMessage = ex as MessagesRow;
            empathyMessageId = (ex as MessagesRow).id;
            empathyVisible = (ex as MessagesRow).content;
            empathySaved = true;
            if (!journal.empathyMessageId) await journal.stampEmpathy((ex as MessagesRow).id);
          }
        }
        if (!empathySaved) {
        // t_135a19b5 정정 (대표님 9/28 08:40): 짧은 확인음(yes/no 분류)은 structured_payload.empathy_ack에 보존.
        // t_44f8896c (대표님 9/28): content=재질문 문장으로 교체, 복창 원문(에코 문장)은 empathy_full로 보존.
        // 프론트는 empathy_question/template_id로 버튼 문구를 재질문에 맞게 결정할 수 있다.
        const empathyAck = pickQuip('ack', locale, persona?.tone);
        const empathyRow = {
          ...(empathyForcedId ? { id: empathyForcedId } : {}),
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
        };
        const { data: m, error } = await (empathyForcedId
          ? db.from('messages').upsert(empathyRow, { onConflict: 'id' })
          : db.from('messages').insert(empathyRow))
          .select()
          .single();
        if (error || !m) throw new ApiError('INTERNAL_ERROR', error?.message || '공감 메시지 저장 실패');
        empathyMessage = m;
        empathyMessageId = m.id;
        await journal.stampEmpathy(m.id);
        // 계약 필드 = 화면 노출 텍스트 = 재질문 문장 (t_44f8896c; 복창 원문은 empathy_full에 보존).
        empathyVisible = final.empathyResponse;
        }
        }
      }

      if (final.answerResponse) {
        // resume 가드 (t_7182aa8f②): answer 행이 이미 스탬프/결정적 id로 DB에 있으면 로드만.
        const answerForcedId = ckptActive ? runScopedId(turnId, 'answer') : undefined;
        const answerPre = resuming ? journal.answerMessageId || answerForcedId || null : null;
        let answerSaved = false;
        if (answerPre) {
          const { data: ex, error } = await db.from('messages').select('*').eq('id', answerPre)
            .eq('session_id', sessionId).maybeSingle();
          if (error) throw new ApiError('INTERNAL_ERROR', error.message || 'resume: answer 조회 실패');
          if (ex) {
            answerMessage = ex as MessagesRow;
            answerMessageId = (ex as MessagesRow).id;
            answerSaved = true;
            if (!journal.answerMessageId) await journal.stampAnswer((ex as MessagesRow).id);
          }
        }
        if (!answerSaved) {
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
        if ((final.groundEnabled || final.deepLane) && final.grounding && final.grounding.status !== 'grounded' && final.grounding.reason !== 'CANCELLED') {
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
          // 답글 인용 사본 (t_02f58030 ③): 카드는 "message.new/answer payload에 reply_to 요약 포함"이
          // 리터럴 계약 — 답변 행에도 같은 스냅샷을 병합해 어떤 수신자(유저 버블/답변 버블)든 인용
          // 컨텍스트를 갖는다. 프론트(t_62897e88)는 user 행 reply_to를 인용바 1차 소스로 권장.
          structured_payload: replyCtx.summary
            ? { ...final.structured.structured_payload, reply_to: replyCtx.summary }
            : final.structured.structured_payload,
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
        const answerRowWith = (extra: Record<string, unknown>) => ({
          ...(answerForcedId ? { id: answerForcedId } : {}),
          ...answerRowValues(extra),
        });
        let { data: m, error } = await (answerForcedId
          ? db.from('messages').upsert(answerRowWith(replyCols), { onConflict: 'id' })
          : db.from('messages').insert(answerRowValues(replyCols)))
          .select()
          .single();
        if (error && replyCols.awaiting_reply !== undefined && isMissingReplyColumns(error)) {
          markAwaitingReplyColumnsMissing();
          ({ data: m, error } = await (answerForcedId
            ? db.from('messages').upsert(answerRowWith({}), { onConflict: 'id' })
            : db.from('messages').insert(answerRowValues({})))
            .select()
            .single());
        }
        if (error || !m) throw new ApiError('INTERNAL_ERROR', error?.message || '답변 메시지 저장 실패');
        answerMessage = m;
        answerMessageId = m.id;
        await journal.stampAnswer(m.id);
        }
      }

      // tail 가드 (t_7182aa8f②): 컨텍스트 패치·사용량 집계는 저널에 기록된 뒤 재실행하면
      // conversation.recent 복제가 된다. resume에서 이미 tail_persisted면 건너뛴다.
      if (!journal.tailPersisted) {
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
      await journal.markTail();
      }
      await journal.finish('completed');

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
      // 저널 마감: 취소는 abandoned(재resume 금지, 사용자가 다시 보낸 게 새 run),
      // 그 외 실패는 failed. 둘 다 status가 running을 벗어나야 부팅 스캐너가 다시 주우지 않는다.
      if (ckptActive) {
        if ((opts.signal?.aborted && !classificationCancelled) || err?.name === 'AbortError' || err?.code === 'RUN_CANCELLED') {
          await journal.finish('abandoned', 'RUN_CANCELLED');
        } else {
          await journal.finish('failed', err?.code || 'INTERNAL_ERROR');
        }
      }
      if ((opts.signal?.aborted && !classificationCancelled) || err?.name === 'AbortError' || err?.code === 'RUN_CANCELLED') {
        throw new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.');
      }
      if (!processing) opts.onTurnStatus?.('processing', { stage: 'thinking' });
      opts.onTurnStatus?.('failed', { error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || '턴 처리 실패' } });
      throw err;
    }
  });
}
