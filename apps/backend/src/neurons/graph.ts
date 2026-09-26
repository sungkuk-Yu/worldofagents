import { Locale, QUIPS, appendLanguageInstruction } from '../lib/locale';
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
import { PersonaConfig, DialogueType } from '../types/db';
import { NeuronRouter, classifyDialogueType } from './router';
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
}

type HistoryMessage = { role: string; content: string; source_neuron?: string | null };

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
  dialogueType: DialogueType;
  /** 전문가 그라운딩 요약 (t_d54bc456) — 발동하지 않았으면 null */
  grounding: GroundingSummary | null;
  /** 뉴런 활성화 계획 — 설계 문서와 동일한 객체 형태 (activate/reason) */
  activationPlan: { activate: string[]; reason: string; dialogueType: DialogueType };
  events: NeuronStatusEvent[];
  guardPassed: boolean;
  engine: 'langgraph' | 'simple';
}

// ── 노드 함수 (실시간 이벤트 및 상태 변환) ─────────────────────────

function empathyNode(state: NeuronState, ctx: NodeContext): Partial<NeuronState> {
  const persona = state.persona;
  const prompt = persona ? buildPersonaPrompt(persona, 'empathy') : '';
  const response = buildEmpathyTemplate(state.userMessage, state.dialogueType, prompt, state.locale);
  ctx.emit({ neuron: 'empathy', status: 'idle', stage: 'thinking', quip: QUIPS.thinking[state.locale] });
  return {
    empathyResponse: response,
    events: [...state.events, { neuron: 'empathy', status: 'idle', stage: 'thinking', quip: QUIPS.thinking[state.locale] }],
  };
}

function routerNode(state: NeuronState, ctx: NodeContext): Partial<NeuronState> {
  const plan = NeuronRouter.plan(state.userMessage, {
    hasActiveTask: state.hasActiveTask,
    pendingQueueLength: state.pendingQueueLength,
  });
  ctx.emit({ neuron: 'router', status: 'processing', stage: 'organizing', quip: QUIPS.organizing[state.locale] });
  return {
    dialogueType: plan.dialogueType,
    activationPlan: plan.activate,
    reason: plan.reason,
    events: [...state.events, { neuron: 'router', status: 'processing', stage: 'organizing', quip: QUIPS.organizing[state.locale] }],
  };
}

async function answerNode(state: NeuronState, ctx: NodeContext): Promise<Partial<NeuronState>> {
  if (!state.activationPlan.includes('answer')) return {};
  const prompt = state.persona ? buildPersonaPrompt(state.persona, 'answer') : '';
  const start: NeuronStatusEvent = { neuron: 'answer', status: 'processing', stage: 'thinking', quip: QUIPS.thinking[state.locale] };
  ctx.emit(start);
  let answerResponse: string;
  // ── 전문가 그라운딩 (t_d54bc456) — 법률·회계 등 전문가 카테고리는 Perplexity
  // 최신 웹 검색 근거 + 출처를 반드시 동반한다. 키 미설정 시 시도하지 않는다
  // (DEV/unit 테스트는 실 키 없이도 기존 동작 그대로). ──
  let grounding: GroundingResult | null = null;
  if (state.groundEnabled && isPerplexityConfigured() && !ctx.signal?.aborted) {
    ctx.emit({ neuron: 'grounding', status: 'processing', stage: 'thinking', quip: QUIPS.thinking[state.locale] });
    grounding = await searchGrounding(state.userMessage, state.locale, { signal: ctx.signal });
    ctx.emit({
      neuron: 'grounding',
      status: grounding.status === 'grounded' ? 'idle' : 'degraded',
      stage: 'organizing',
      quip: QUIPS.organizing[state.locale],
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
      ctx.llm = { used: true, model: result.model, fallback: false, usage: result.usage, durationMs: result.durationMs };
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
  // 답변 생성 이후 분류 단계에서 받은 취소는 규칙 카드로 완료한다.
  ctx.classificationCancelled = Boolean(ctx.signal?.aborted);
  const end: NeuronStatusEvent = { neuron: 'answer', status: 'idle', stage: 'finalizing', quip: QUIPS.finalizing[state.locale] };
  ctx.emit(end);
  return { answerResponse, structured, grounding, llm: ctx.llm, events: [...state.events, start, end] };
}

function visualNode(state: NeuronState, ctx: NodeContext): Partial<NeuronState> {
  const requested = state.activationPlan.includes('visual');
  if (!requested) return { visualRequested: false };
  ctx.emit({ neuron: 'visual', status: 'processing', stage: 'rendering', quip: QUIPS.rendering[state.locale] });
  return {
    visualRequested: true,
    events: [...state.events, { neuron: 'visual', status: 'processing', stage: 'rendering', quip: QUIPS.rendering[state.locale] }],
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
      }, onDelta: d => opts.onAnswerDelta?.(d, deltaIndex++), llm: { used: false, model: null, fallback: false } };
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
      const checkCancelled = () => {
        if (opts.signal?.aborted && !ctx.classificationCancelled) throw new ApiError('RUN_CANCELLED', '실행이 취소되었습니다.');
      };
      checkCancelled();
      processing = true;
      opts.onTurnStatus?.('processing', { stage: 'thinking' });
      const final = engine === 'langgraph' ? await langGraphPipeline(initial, ctx) : await simplePipeline(initial, ctx);
      classificationCancelled = Boolean(ctx.classificationCancelled);
      checkCancelled();
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

      checkCancelled();
      if (final.empathyResponse) {
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
            structured_payload: {},
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
        empathyResponse: final.empathyResponse,
        answerResponse: final.answerResponse,
        structured: final.structured,
        dialogueType: final.dialogueType,
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
