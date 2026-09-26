// 대화 유형 판별기 (Dialog Type Classifier)
// 설계서: dialogue-functionality-spec.md §2
// 3단계 하이브리드 판별: 패턴 매칭 → LLM 분류 → 사용자 확인
import { DialogType } from '../types';

// Stage 1: 키워드/패턴 매칭 (즉각 판별, 0ms)
const PATTERN_RULES: { patterns: string[]; type: DialogType }[] = [
  {
    patterns: ['표', '차트', '엑셀', '데이터 분석', '스프레드시트', '계산', '수식'],
    type: 'data',
  },
  {
    patterns: ['파일', '문서', 'PDF', '첨부', '계약서', '보고서'],
    type: 'file',
  },
  {
    patterns: ['예약', '일정', '알림', '스케줄', '캘린더'],
    type: 'task',
  },
  {
    patterns: ['에이전트 초대', '여러 명', '협업', '팀'],
    type: 'multi-agent',
  },
];

export interface ClassificationResult {
  type: DialogType;
  confidence: number;
  stage: 1 | 2 | 3;
}

// Stage 1: 패턴 매칭
export function classifyByPattern(input: string): ClassificationResult | null {
  const normalized = input.toLowerCase();

  for (const rule of PATTERN_RULES) {
    for (const pattern of rule.patterns) {
      if (normalized.includes(pattern.toLowerCase())) {
        return {
          type: rule.type,
          confidence: 0.85,
          stage: 1,
        };
      }
    }
  }

  return null;
}

// Stage 2: LLM 분류 (비동기, 백그라운드)
// TODO: 실제 LLM API 연동
export async function classifyByLLM(input: string): Promise<ClassificationResult | null> {
  // Placeholder — 실제 구현 시 LLM API 호출
  console.log('[Classifier] LLM classification requested for:', input.substring(0, 50));

  // 시뮬레이션: 기본값은 정보 응답형
  return {
    type: 'information',
    confidence: 0.6,
    stage: 2,
  };
}

// 통합 판별 함수 (3단계 하이브리드)
export async function classifyDialogType(input: string): Promise<ClassificationResult> {
  // Stage 1: 패턴 매칭 (즉각)
  const patternResult = classifyByPattern(input);
  if (patternResult && patternResult.confidence >= 0.8) {
    return patternResult;
  }

  // Stage 2: LLM 분류 (비동기)
  const llmResult = await classifyByLLM(input);
  if (llmResult && llmResult.confidence >= 0.8) {
    return llmResult;
  }

  // Stage 3: 폴백 — 정보 응답형 기본값 + 사용자 확인 필요
  return {
    type: llmResult?.type ?? 'information',
    confidence: llmResult?.confidence ?? 0.5,
    stage: 3,
  };
}
