import { Locale } from '../lib/locale';
/**
 * 뉴런 오케스트레이션 그래프 — neuron-architecture-spec §5
 * LangGraph StateGraph 구성 (공감 → Router → 답변/비주얼 → Compose).
 * LangGraph를 사용할 수 없는 환경(테스트/개발)에서는 동일 노드 함수를
 * 순차 파이프라인(simple engine)으로 실행한다.
 *
 * 노드는 상태 변환과 실시간 이벤트를 담당하며 답변 노드만 LLM을 호출한다.
 * processTurn은 사용자 메시지를 먼저 저장하고 응답 및 사용량을 영속화한다.
 */
import { StructuredAnswer } from '../lib/structured';
import { GroundingResult, GroundingSummary } from '../lib/perplexity';
import { MessagesRow } from '../types/db';
import { DbClient } from '../lib/supabase';
import { PersonaConfig, DialogueType } from '../types/db';
import { LlmClassifyResult } from './llmClassify';
import { SuggestedQuestion } from '../lib/suggestedQuestions';
export { EMPATHY_REQUESTION_TEMPLATES, empathyKeywordSummary, buildEmpathyRequestion } from '../lib/empathyRule';
import { ReplyRequest } from '../lib/awaitingReply';
import { ReplyToSummary } from '../lib/replyTo';
import { DISCLAIMERS } from '../lib/persona';
import { type JournalRow } from '../lib/runCheckpoint';
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
    /**
     * t_baee5c42 (게이트1 ack→첫글자 ≤1.5s): Stage2 분류 선(先)발사 프라미스.
     * processTurn이 그래프 진입 전(user 저장·ack·empathy early와 오버랩되게) 발사하면
     * routerNode가 이를 재사용한다 — 분류 ~900ms의 직렬 소각 제거. 미설정/resume는
     * routerNode가 인라인 호출(현행 1:1). 소비 후 재사용 금지(1턴 1발사).
     */
    classifyPrefired?: Promise<LlmClassifyResult | null>;
}
type HistoryMessage = {
    role: string;
    content: string;
    source_neuron?: string | null;
    structured_payload?: Record<string, unknown> | null;
};
export interface NeuronState {
    locale: Locale;
    sessionId: string;
    userId: string;
    agentId: string;
    persona: PersonaConfig | null;
    history: HistoryMessage[];
    llm: LlmRunInfo;
    userMessage: string;
    sttMetadata: Record<string, unknown> | null;
    dialogueType: DialogueType;
    /** 판별 단계 (1=패턴 확정 2=LLM 인용 3=규칙 폴백) — classifier_stage 계약 (t_56498848). */
    dialogueStage?: 1 | 2 | 3;
    dialogueConfidence?: number;
    activationPlan: string[];
    reason: string;
    hasActiveTask: boolean;
    pendingQueueLength: number;
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
    finalResponse: {
        empathy: string | null;
        answer: string | null;
        visualsRequested: boolean;
    };
    events: NeuronStatusEvent[];
    engine: 'langgraph' | 'simple';
}
export interface ProcessTurnOptions {
    locale?: Locale;
    thread?: {
        parentMessageId: string;
        rootMessageId: string;
    };
    signal?: AbortSignal;
    emitEvent?: (event: NeuronStatusEvent) => void;
    history?: HistoryMessage[];
    /** 공유 실행기가 상태 이벤트와 같은 식별자를 사용하도록 전달한다. */
    turnId?: string;
    onAnswerDelta?(delta: string, index: number): void;
    onTurnStatus?(status: 'received' | 'processing' | 'completed' | 'failed', extra?: {
        stage?: NeuronStage;
        error?: {
            code: string;
            message: string;
        };
    }): void;
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
    messages: {
        user: MessagesRow;
        empathy: MessagesRow | null;
        answer: MessagesRow | null;
    };
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
    activationPlan: {
        activate: string[];
        reason: string;
        dialogueType: DialogueType;
    };
    events: NeuronStatusEvent[];
    guardPassed: boolean;
    engine: 'langgraph' | 'simple';
}
export declare function normalizeUtterance(text: string): string;
/**
 * LLM 컨텍스트용 히스토리 필터 (t_c31e3f45 A, 김비서 판정):
 * 공감 재질문/복창 행(source_neuron='empathy' 또는 payload.empathy_*)과 자기 발화 에코로
 * 쓰이는 모든 컨텍스트 주입 지점에서 공유한다. 답변(answer)과 사용자 발화만 남긴다.
 * 소스 뉴런이 없는 레거시 agent 행(음성 확정 등)은 content가 답변이었으므로 answer로 본다.
 */
export declare function answerableHistory(history: HistoryMessage[]): HistoryMessage[];
/** 문자 2-gram Dice 계수 (0~1) — 재귀 생성 판정용 (t_c31e3f45 B, 임계 0.8).
 *  t_51f9fd01: 구현은 lib/textSimilarity.ts로 이동(공감 복창 차단과 공유) — 하위호환 재수출 유지. */
export { textSimilarity } from '../lib/textSimilarity';
/**
 * 지시형 발화 판정 (t_c31e3f45 요구1): "정리해 주세요" 류 — 공백 제거 후 어미 검사.
 *Stage 3 '해줘' 패턴이 공백 변형("해 주","해주세요")에서 놓치는 것과 같은 뿌리 결함
 * 보충 (오탐 비용=골격 1줄 < 미탐 비용=상투어 반복).
 */
export declare function isDirectiveUtterance(text: string): boolean;
/**
 * '약속만 하고 산출물 없는' 답변 판정 (t_c31e3f45 요구1): 번호/글머리/표 등 구조화된
 * 산출물이 전혀 없고 ~해 드릴게요/도움이 되길/나열해 주시겠 류 미래 약속 어미만 있는 답변.
 * 실제 목록·표가 있으면 false(개입 없음). 지시형 발화에만 적용한다.
 */
export declare function looksLikeEmptyPromise(answer: string, locale: Locale): boolean;
export declare function isConfirmationUtterance(text: string): boolean;
export declare function buildAnswerTemplate(message: string, _dialogueType: DialogueType, prompt: string, locale: Locale): string;
export declare function processTurn(db: DbClient, sessionId: string, userId: string, agentId: string, persona: PersonaConfig | null, userMessage: string, opts?: ProcessTurnOptions): Promise<TurnResult>;
//# sourceMappingURL=graph.d.ts.map