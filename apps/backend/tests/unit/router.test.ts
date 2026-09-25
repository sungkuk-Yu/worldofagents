import { describe, it, expect } from 'vitest';
import { classifyDialogueType, NeuronRouter } from '../../src/neurons/router';

describe('classifyDialogueType', () => {
  it('데이터/시각화 요청 분류', () => {
    expect(classifyDialogueType('Q3 매출 표로 정리해줘')).toBe('data');
    expect(classifyDialogueType('차트 만들어줘')).toBe('data');
    expect(classifyDialogueType('데이터 분석해줘')).toBe('data');
  });

  it('파일 작업 분류', () => {
    expect(classifyDialogueType('PDF 파일 정리해줘')).toBe('file');
    expect(classifyDialogueType('문서 업로드할게')).toBe('file');
  });

  it('작업/실행 요청 분류', () => {
    expect(classifyDialogueType('보고서 작성해줘')).toBe('task');
    expect(classifyDialogueType('알림 설정해줘')).toBe('task');
  });

  it('질문/명령/정보성 분류', () => {
    expect(classifyDialogueType('이거 어떻게 해?')).toBe('question');
    expect(classifyDialogueType('바로 해줘')).toBe('command');
    expect(classifyDialogueType('오늘 날씨 괜찮네')).toBe('information');
  });
});

describe('NeuronRouter.plan', () => {
  const emptyCtx = { hasActiveTask: false, pendingQueueLength: 0 };

  it('공감 뉴런은 항상 활성', () => {
    const plan = NeuronRouter.plan('안녕', emptyCtx);
    expect(plan.activate).toContain('empathy');
    expect(plan.reason).toContain('empathy=always');
  });

  it('질문 감지 시 answer 활성', () => {
    const plan = NeuronRouter.plan('이거 어떻게 해?', emptyCtx);
    expect(plan.activate).toContain('answer');
  });

  it('시각 산출물 필요 시 visual 활성', () => {
    const plan = NeuronRouter.plan('차트로 정리해줘', emptyCtx);
    expect(plan.activate).toContain('visual');
  });

  it('진행 중 작업 + 끼어들기 시 queue 활성', () => {
    const plan = NeuronRouter.plan('잠깐, 다른 거 해줘', { hasActiveTask: true, pendingQueueLength: 0 });
    expect(plan.activate).toContain('queue');
    expect(plan.reason).toContain('queue=interruption_detected');
  });

  it('큐 대기 중이면 queue 활성', () => {
    const plan = NeuronRouter.plan('그냥 물어볼게', { hasActiveTask: false, pendingQueueLength: 1 });
    expect(plan.activate).toContain('queue');
  });

  it('설치된 커스텀 뉴런 트리거 스캔', () => {
    const plan = NeuronRouter.plan('이거 영어로 번역해줘', emptyCtx, ['translation']);
    expect(plan.activate).toContain('translation');
    expect(plan.reason).toContain('translation=custom_trigger');
  });

  it('커스텀 뉴런 미설치 시 트리거 무시', () => {
    const plan = NeuronRouter.plan('이거 영어로 번역해줘', emptyCtx, []);
    expect(plan.activate).not.toContain('translation');
  });
});