/**
 * 뉴런 활성화 판단 로직 (Router) — neuron-architecture-spec §3.3
 * 규칙 기반 판별 + 키워드 분류 + 커스텀 뉴런 트리거 스캔.
 * Stage 1/3 판별은 프론트와 공유하는 단일 패턴 표(dialogPatterns.json)로 수행한다 (t_56498848).
 * Stage 2(LLM)는 graph.ts routerNode가 async로 보강 — 여기는 동기 경로만.
 */
import { DialogueType } from '../types/db';
import { classifyByRulesSync } from './dialogClassifier';

export interface ActivationPlan {
  activate: string[];
  dialogueType: DialogueType;
  reason: string;
  /** 판별 단계 (1=패턴 확정, 3=규칙 폴백) — Stage2 인용 시 graph가 2로 갱신해 전달. */
  dialogueStage: 1 | 2 | 3;
  confidence: number;
}

/** 대화 유형 분류 — 공유 패턴 표 Stage 1 + 의문/명령 폴백 (호환 유지용 동기 API) */
export function classifyDialogueType(text: string): DialogueType {
  // 주의: 표 배열 순서 = 우선순위. 구체적인 명사 키워드(file)를 일반 동사 키워드(data)보다 먼저 검사한다.
  // 예) 'PDF 파일 정리해줘' → file (data의 '정리해줘'에 먼저 걸리면 안 됨)
  return classifyByRulesSync(text).type;
}

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
export class NeuronRouter {
  static plan(text: string, ctx: RouterContext, installedCustomSlugs: string[] = []): ActivationPlan {
    const rules = classifyByRulesSync(text);
    const dialogueType = rules.type;
    const activate = new Set<string>(['empathy']);
    const reasons: string[] = ['empathy=always'];

    const hasRequest = dialogueType === 'question' || dialogueType === 'command' || dialogueType === 'data' || dialogueType === 'file' || dialogueType === 'task' || dialogueType === 'multi';
    if (hasRequest) {
      activate.add('answer');
      reasons.push('answer=request_detected');
    }
    if (dialogueType === 'data' || /차트|그래프|표로|시각화|인포그래픽|\bchart|graph|visuali[sz]e\b/i.test(text)) {
      activate.add('visual');
      reasons.push('visual=visual_output_needed');
    }
    if (ctx.hasActiveTask && (dialogueType === 'command' || dialogueType === 'task')) {
      activate.add('queue');
      reasons.push('queue=interruption_detected');
    }
    if (ctx.pendingQueueLength > 0) {
      activate.add('queue');
      reasons.push('queue=has_pending');
    }

    // 커스텀 뉴런 트리거 스캔 (설치된 스킬 중 trigger_conditions 매칭)
    const triggerMap: Record<string, string[]> = {
      translation: ['번역', 'translate', '영어로', '영작', '해석해'],
    };
    for (const slug of installedCustomSlugs) {
      const triggers = triggerMap[slug] || [];
      if (triggers.some((t) => text.toLowerCase().includes(t))) {
        activate.add(slug);
        reasons.push(`${slug}=custom_trigger`);
      }
    }

    return { activate: [...activate], dialogueType, reason: reasons.join(', '), dialogueStage: rules.stage, confidence: rules.confidence };
  }
}

/** 세션 대화 유형 분류 (기존 preserve API 이름 — websocket 및 테스트 호환) */
export const classifyDialogue = classifyDialogueType;