/**
 * 뉴런 활성화 판단 로직 (Router) — neuron-architecture-spec §3.3
 * 규칙 기반 판별 + 키워드 분류 + 커스텀 뉴런 트리거 스캔.
 * Stage 1/3 판별은 프론트와 공유하는 단일 패턴 표(dialogPatterns.json)로 수행한다 (t_56498848).
 * Stage 2(LLM)는 graph.ts routerNode가 async로 보강 — 여기는 동기 경로만.
 */
import { DialogueType } from '../types/db';
export interface ActivationPlan {
    activate: string[];
    dialogueType: DialogueType;
    reason: string;
    /** 판별 단계 (1=패턴 확정, 3=규칙 폴백) — Stage2 인용 시 graph가 2로 갱신해 전달. */
    dialogueStage: 1 | 2 | 3;
    confidence: number;
}
/** 대화 유형 분류 — 공유 패턴 표 Stage 1 + 의문/명령 폴백 (호환 유지용 동기 API) */
export declare function classifyDialogueType(text: string): DialogueType;
export interface RouterContext {
    hasActiveTask: boolean;
    pendingQueueLength: number;
}
/**
 * 뉴런 라우터 — 사용자 입력을 분석해 필요한 뉴런 조합 결정.
 * 규칙:
 *  - 공감: 항상 활성 (상시)
 *  - 답변: 질문/요청 감지 시
 *  - 비주얼: 시각 산출물 필요 시 (data 유형 등)
 *  - 큐: 진행 중 작업 + 끼어들기 감지 시
 */
export declare class NeuronRouter {
    static plan(text: string, ctx: RouterContext, installedCustomSlugs?: string[]): ActivationPlan;
}
/** 세션 대화 유형 분류 (기존 preserve API 이름 — websocket 및 테스트 호환) */
export declare const classifyDialogue: typeof classifyDialogueType;
//# sourceMappingURL=router.d.ts.map