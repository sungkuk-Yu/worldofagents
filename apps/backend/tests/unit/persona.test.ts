import { describe, it, expect } from 'vitest';
import {
  rowToPersonaConfig,
  buildPersonaPrompt,
  PersonaGuard,
  buildConversationHistory,
} from '../../src/lib/persona';
import { PersonasRow } from '../../src/types/db';

const baseRow: PersonasRow = {
  id: 'p1',
  agent_id: 'a1',
  version: 1,
  name: '민지',
  voice_config: { voice_id: 'alloy', speed: 1.0 },
  tone_config: { formality: 'friendly', emoji_usage: 'rare', sentence_length: 'medium', honorific_level: 3 },
  style_guide: {
    personality_traits: ['꼼꼼함', '친근함'],
    preferred_expressions: ['~할게요'],
    forbidden_expressions: ['상관없어'],
    example_responses: [{ user_input: '안녕', agent_response: '안녕하세요!' }],
  },
  neuron_overrides: { empathy: { warmth_delta: 0.2, allowed_prefixes: ['아'] }, answer: { formality_delta: 0.1 } },
  relationship_type: 'colleague',
  is_active: true,
  created_at: '2026-09-25T00:00:00Z',
};

describe('페르소나 변환/프롬프트', () => {
  it('rowToPersonaConfig — 기본값 병합 + 관계 컨텍스트', () => {
    const cfg = rowToPersonaConfig(baseRow);
    expect(cfg.persona_id).toBe('p1');
    expect(cfg.name).toBe('민지');
    expect(cfg.tone.formality).toBe('friendly');
    expect(cfg.relationship_context.user_relationship).toBe('colleague');
    expect(cfg.style_guide.personality_traits).toContain('꼼꼼함');
  });

  it('rowToPersonaConfig — 빈 설정에서도 안전한 기본값', () => {
    const cfg = rowToPersonaConfig({ ...baseRow, style_guide: {}, tone_config: {}, neuron_overrides: {} });
    expect(cfg.tone.formality).toBe('friendly');
    expect(cfg.style_guide.personality_traits).toEqual([]);
    expect(cfg.style_guide.forbidden_expressions).toEqual([]);
  });

  it('buildPersonaPrompt — 이름/말투/금지 표현/뉴런 오버라이드 포함', () => {
    const prompt = buildPersonaPrompt(rowToPersonaConfig(baseRow), 'empathy');
    expect(prompt).toContain('민지');
    expect(prompt).toContain('[말투 규칙]');
    expect(prompt).toContain('friendly');
    expect(prompt).toContain('상관없어');
    expect(prompt).toContain('따뜻함: +0.2');
    expect(prompt).toContain('허용 시작 표현: 아');
    expect(prompt).toContain('다른 이름으로 자신을 소개하지 마세요');
  });
});

describe('PersonaGuard', () => {
  it('금지 표현을 교체하고 checks에 기록', async () => {
    const guard = new PersonaGuard(rowToPersonaConfig(baseRow));
    const result = await guard.validate('그건 상관없어요. 그래도 도와드릴게요.', 'answer');
    expect(result.passed).toBe(false);
    expect(result.response).not.toContain('상관없어');
    expect(result.checks.some((c) => !c.passed && c.reason.includes('상관없어'))).toBe(true);
  });

  it('잘못된 자기 참조 감지', async () => {
    const guard = new PersonaGuard(rowToPersonaConfig(baseRow));
    const result = await guard.validate('제 이름은 지훈입니다. 반갑습니다.', 'answer');
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.reason.includes('잘못된 자기 참조'))).toBe(true);
  });

  it('올바른 자기 참조 + 클린 텍스트는 통과', async () => {
    const guard = new PersonaGuard(rowToPersonaConfig(baseRow));
    const result = await guard.validate('민지가 도와드릴게요. 편하게 말씀하세요.', 'answer');
    expect(result.passed).toBe(true);
    expect(result.response).toBe('민지가 도와드릴게요. 편하게 말씀하세요.');
  });

  it('빈 금지 목록이면 추가 검사만 수행', async () => {
    const row = { ...baseRow, style_guide: { ...(baseRow.style_guide as object), forbidden_expressions: [] } };
    const guard = new PersonaGuard(rowToPersonaConfig(row as PersonasRow));
    const result = await guard.validate('안녕하세요!', 'answer');
    expect(result.passed).toBe(true);
  });
});

describe('대화 히스토리', () => {
  it('buildConversationHistory — 최근 N턴만 유지', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const sliced = buildConversationHistory(history, 10);
    expect(sliced.length).toBe(10);
    expect(sliced[0].content).toBe('m20');
  });
});