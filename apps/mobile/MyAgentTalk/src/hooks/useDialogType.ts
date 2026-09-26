// useDialogType — 대화 유형 자동 판별 훅
// 설계서: dialogue-functionality-spec.md §2 (3단계 하이브리드 판별)
import { useState, useCallback } from 'react';
import { DialogType } from '../types';
import { classifyDialogType, ClassificationResult } from '../neurons/DialogTypeClassifier';

export interface UseDialogTypeReturn {
  currentType: DialogType;
  confidence: number;
  stage: 1 | 2 | 3;
  isClassifying: boolean;
  classify: (input: string) => Promise<void>;
  overrideType: (type: DialogType) => void;
}

export function useDialogType(initialType: DialogType = 'information'): UseDialogTypeReturn {
  const [currentType, setCurrentType] = useState<DialogType>(initialType);
  const [confidence, setConfidence] = useState(1.0);
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [isClassifying, setIsClassifying] = useState(false);

  const classify = useCallback(async (input: string) => {
    setIsClassifying(true);
    try {
      const result: ClassificationResult = await classifyDialogType(input);
      setCurrentType(result.type);
      setConfidence(result.confidence);
      setStage(result.stage);
    } catch (error) {
      console.error('[useDialogType] Classification error:', error);
    } finally {
      setIsClassifying(false);
    }
  }, []);

  const overrideType = useCallback((type: DialogType) => {
    setCurrentType(type);
    setConfidence(1.0);
    setStage(3); // 수동 전환 = Stage 3
  }, []);

  return {
    currentType,
    confidence,
    stage,
    isClassifying,
    classify,
    overrideType,
  };
}
