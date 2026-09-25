"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTurn = processTurn;
/**
 * 뉴런 오케스트레이션 그래프 — neuron-architecture-spec §5
 * LangGraph StateGraph 구성 (공감 → Router → 답변/비주얼 → Compose).
 * LangGraph를 사용할 수 없는 환경(테스트/개발)에서는 동일 노드 함수를
 * 순차 파이프라인(simple engine)으로 실행한다.
 *
 * 노드는 DB 쓰기를 하지 않는 순수 상태 변환으로 설계하고,
 * 영속화(messages/instances/사용량)는 processTurn 마지막에 일괄 수행한다.
 */
const config_1 = require("../config");
const router_1 = require("./router");
const persona_1 = require("../lib/persona");
const registry_1 = require("./registry");
// ── 노드 함수 (순수 상태 변환) ─────────────────────────
function empathyNode(state) {
    const persona = state.persona;
    const prompt = persona ? (0, persona_1.buildPersonaPrompt)(persona, 'empathy') : '';
    const response = buildEmpathyTemplate(state.userMessage, state.dialogueType, prompt);
    return {
        empathyResponse: response,
        events: [...state.events, { neuron: 'empathy', status: 'idle', stage: 'thinking', quip: '듣고 있어요' }],
    };
}
function routerNode(state) {
    const plan = router_1.NeuronRouter.plan(state.userMessage, {
        hasActiveTask: state.hasActiveTask,
        pendingQueueLength: state.pendingQueueLength,
    });
    return {
        dialogueType: plan.dialogueType,
        activationPlan: plan.activate,
        reason: plan.reason,
        events: [...state.events, { neuron: 'router', status: 'processing', stage: 'organizing', quip: '어떻게 처리할지 정리 중이에요' }],
    };
}
function answerNode(state) {
    if (!state.activationPlan.includes('answer'))
        return {};
    const persona = state.persona;
    const prompt = persona ? (0, persona_1.buildPersonaPrompt)(persona, 'answer') : '';
    return {
        answerResponse: buildAnswerTemplate(state.userMessage, state.dialogueType, prompt),
        events: [...state.events, { neuron: 'answer', status: 'processing', stage: 'thinking', quip: '자료를 찾고 있어요...' }],
    };
}
function visualNode(state) {
    const requested = state.activationPlan.includes('visual');
    if (!requested)
        return { visualRequested: false };
    return {
        visualRequested: true,
        events: [...state.events, { neuron: 'visual', status: 'processing', stage: 'rendering', quip: '표/차트를 만들고 있어요...' }],
    };
}
function composeNode(state) {
    return {
        finalResponse: {
            empathy: state.empathyResponse,
            answer: state.answerResponse,
            visualsRequested: state.visualRequested,
        },
    };
}
// ── 템플릿 응답 생성 (Phase 1 기본; OpenAI API 키가 있으면 LLM 사용) ──
function buildEmpathyTemplate(message, dialogueType, _prompt) {
    const prefix = message.trim().slice(0, 30);
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
function buildAnswerTemplate(message, _dialogueType, prompt) {
    // DEV: LLM 없이도 동작하는 상세 답변 템플릿
    return (`네, "${message.trim().slice(0, 50)}"에 대해 정리해드렸어요.\n\n` +
        `- 핵심 요약: 요청하신 내용을 확인했고, 지금 바로 진행할 수 있어요.\n` +
        `- 필요한 정보: 구체적인 목표와 마감 일정을 알려주시면 더 정확하게 준비할게요.\n\n` +
        `더 필요한 부분이 있으면 말씀해주세요!`);
}
// ── Simple 파이프라인 ─────────────────────────────────
function simplePipeline(initial) {
    let state = { ...initial, events: [...initial.events], finalResponse: { empathy: null, answer: null, visualsRequested: false } };
    state = { ...state, ...routerNode(state) };
    state = { ...state, ...empathyNode(state) };
    state = { ...state, ...answerNode(state) };
    state = { ...state, ...visualNode(state) };
    state = { ...state, ...composeNode(state) };
    state.events = state.events.filter((e, i, arr) => arr.findIndex((x) => x.neuron === e.neuron && x.status === e.status) === i);
    return state;
}
// ── LangGraph 래퍼 ────────────────────────────────────
let langGraphAvailable = null;
function checkLangGraph() {
    if (langGraphAvailable !== null)
        return langGraphAvailable;
    try {
        // ESM 패키지 — Node 22.12+의 require(esm)로 로드
        require('@langchain/langgraph');
        langGraphAvailable = true;
    }
    catch {
        langGraphAvailable = false;
    }
    return langGraphAvailable;
}
async function langGraphPipeline(initial) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { StateGraph, Annotation, START, END } = require('@langchain/langgraph');
    const StateAnnotation = Annotation.Root({
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
        visualRequested: Annotation,
        finalResponse: Annotation,
        events: Annotation,
        engine: Annotation,
    });
    const graph = new StateGraph(StateAnnotation)
        .addNode('router', routerNode)
        .addNode('empathy', empathyNode)
        .addNode('answer', answerNode)
        .addNode('visual', visualNode)
        .addNode('compose', composeNode)
        .addEdge(START, 'router')
        .addEdge('router', 'empathy')
        .addEdge('empathy', 'answer')
        .addEdge('answer', 'visual')
        .addEdge('visual', 'compose')
        .addEdge('compose', END)
        .compile();
    const result = await graph.invoke({ ...initial });
    return { ...initial, ...result, engine: 'langgraph' };
}
// ── 턴 처리 (영속화 포함) ─────────────────────────────
async function processTurn(db, sessionId, userId, agentId, persona, userMessage, opts = {}) {
    const events = [];
    const emit = (e) => {
        events.push(e);
        opts.emitEvent?.(e);
    };
    const dialogueType = (0, router_1.classifyDialogueType)(userMessage);
    // 활성 작업/큐 상태 컨텍스트 조회
    const { data: activeTasks } = await db.from('tasks').select('id').eq('session_id', sessionId).in('status', ['pending', 'in_progress']);
    const hasActiveTask = activeTasks?.length ? true : false;
    const prevQueue = await db.from('context_patches').select('*').eq('session_id', sessionId).eq('key', 'task.queue');
    const pendingQueueLength = prevQueue.data?.length ? 1 : 0;
    const initial = {
        sessionId,
        userId,
        agentId,
        persona,
        userMessage,
        sttMetadata: null,
        dialogueType,
        activationPlan: ['empathy'],
        reason: '',
        hasActiveTask,
        pendingQueueLength,
        empathyResponse: null,
        answerResponse: null,
        visualRequested: false,
        finalResponse: { empathy: null, answer: null, visualsRequested: false },
        events: [],
        engine: 'simple',
    };
    const engine = config_1.config.neuronEngine === 'langgraph' && checkLangGraph() ? 'langgraph' : 'simple';
    const final = engine === 'langgraph' ? await langGraphPipeline(initial) : simplePipeline(initial);
    for (const e of final.events)
        emit(e);
    // ── 영속화 ──
    // 다음 turn_index
    const { data: lastMsg } = await db
        .from('messages')
        .select('turn_index')
        .eq('session_id', sessionId)
        .order('turn_index', { ascending: false })
        .limit(1)
        .maybeSingle();
    const nextTurn = (lastMsg?.turn_index ?? -1) + 1;
    // 인스턴스 활성화는 저장 직전에 (empathy 항상 + plan)
    for (const neuron of ['empathy', 'answer', 'visual', 'queue']) {
        if (neuron === 'empathy' || final.activationPlan.includes(neuron)) {
            try {
                await (0, registry_1.activateNeuronInstance)(db, sessionId, neuron);
            }
            catch {
                // 뉴런 부재 시 무시
            }
        }
    }
    // 사용자 메시지 저장
    const { data: msgUser, error: errUser } = await db
        .from('messages')
        .insert({
        session_id: sessionId,
        turn_index: nextTurn,
        role: 'user',
        message_type: opts?.sttMetadata ? 'voice' : 'text',
        content: userMessage,
        stt_metadata: opts?.sttMetadata ? opts.sttMetadata : null,
        source_neuron: null,
        attachments: [],
        persona_guard: {},
        user_feedback: null,
    })
        .select()
        .single();
    if (errUser)
        throw errUser;
    // 에이전트 응답 저장 (공감 → 답변)
    let empathyMessageId = null;
    let answerMessageId = null;
    let guardPassed = true;
    if (final.empathyResponse) {
        const { data: m, error } = await db
            .from('messages')
            .insert({
            session_id: sessionId,
            turn_index: nextTurn + 1,
            role: 'agent',
            message_type: 'text',
            content: final.empathyResponse,
            stt_metadata: null,
            source_neuron: 'empathy',
            attachments: [],
            persona_guard: {},
            user_feedback: null,
        })
            .select()
            .single();
        if (!error && m)
            empathyMessageId = m.id;
    }
    if (final.answerResponse) {
        const guard = new persona_1.PersonaGuard(persona || {
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
        const { data: m, error } = await db
            .from('messages')
            .insert({
            session_id: sessionId,
            turn_index: nextTurn + (final.empathyResponse ? 2 : 1),
            role: 'agent',
            message_type: 'text',
            content: guardResult.response,
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
        if (!error && m)
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
    // 사용량 집계 (성공으로 기록)
    for (const slug of ['empathy', 'answer', 'visual', 'queue']) {
        if (slug === 'empathy' || final.activationPlan.includes(slug)) {
            const neuron = await (0, registry_1.getNeuronBySlug)(db, slug);
            if (neuron)
                void db.rpc('increment_neuron_usage', { p_neuron_id: neuron.id, p_success: true });
        }
    }
    return {
        userMessageId: msgUser.id,
        empathyMessageId,
        answerMessageId,
        empathyResponse: final.empathyResponse,
        answerResponse: final.answerResponse,
        dialogueType: final.dialogueType,
        activationPlan: {
            activate: final.activationPlan,
            reason: final.reason,
            dialogueType: final.dialogueType,
        },
        events,
        guardPassed,
        engine,
    };
}
//# sourceMappingURL=graph.js.map