import { DbClient } from '../lib/supabase';
import { PersonaConfig, DialogueType } from '../types/db';
export type NeuronStage = 'thinking' | 'organizing' | 'finalizing' | 'rendering';
export interface NeuronStatusEvent {
    neuron: string;
    status: 'processing' | 'idle' | 'degraded';
    stage: NeuronStage;
    quip: string;
}
export interface NeuronState {
    sessionId: string;
    userId: string;
    agentId: string;
    persona: PersonaConfig | null;
    userMessage: string;
    sttMetadata: Record<string, unknown> | null;
    dialogueType: DialogueType;
    activationPlan: string[];
    reason: string;
    hasActiveTask: boolean;
    pendingQueueLength: number;
    empathyResponse: string | null;
    answerResponse: string | null;
    visualRequested: boolean;
    finalResponse: {
        empathy: string | null;
        answer: string | null;
        visualsRequested: boolean;
    };
    events: NeuronStatusEvent[];
    engine: 'langgraph' | 'simple';
}
export interface ProcessTurnOptions {
    emitEvent?: (event: NeuronStatusEvent) => void;
    history?: {
        role: string;
        content: string;
    }[];
    /** STT 메타데이터 (음성 입력인 경우) */
    sttMetadata?: Record<string, unknown> | null;
}
export interface TurnResult {
    userMessageId: string;
    empathyMessageId: string | null;
    answerMessageId: string | null;
    empathyResponse: string | null;
    answerResponse: string | null;
    dialogueType: DialogueType;
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
export declare function processTurn(db: DbClient, sessionId: string, userId: string, agentId: string, persona: PersonaConfig | null, userMessage: string, opts?: ProcessTurnOptions): Promise<TurnResult>;
//# sourceMappingURL=graph.d.ts.map