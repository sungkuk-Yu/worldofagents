"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersonaGuard = void 0;
exports.rowToPersonaConfig = rowToPersonaConfig;
exports.getActivePersona = getActivePersona;
exports.buildPersonaPrompt = buildPersonaPrompt;
exports.buildConversationHistory = buildConversationHistory;
const DEFAULT_TONE = { formality: 'friendly', emoji_usage: 'rare', sentence_length: 'medium', honorific_level: 3 };
function rowToPersonaConfig(row, overrides) {
    const style = (row.style_guide || {});
    const tone = { ...DEFAULT_TONE, ...(row.tone_config || {}) };
    return {
        persona_id: row.id,
        name: row.name,
        voice: (row.voice_config || {}),
        tone,
        style_guide: {
            personality_traits: Array.isArray(style.personality_traits) ? style.personality_traits : [],
            preferred_expressions: Array.isArray(style.preferred_expressions) ? style.preferred_expressions : [],
            forbidden_expressions: Array.isArray(style.forbidden_expressions) ? style.forbidden_expressions : [],
            example_responses: Array.isArray(style.example_responses) ? style.example_responses : [],
        },
        neuron_overrides: (row.neuron_overrides || {}),
        relationship_context: {
            user_relationship: row.relationship_type || 'assistant',
            conversation_history_summary: '',
            recent_mood: '',
        },
        ...overrides,
    };
}
/** 에이전트의 현재 활성 페르소나 로드 */
async function getActivePersona(db, agentId) {
    const { data, error } = await db
        .from('personas')
        .select('*')
        .eq('agent_id', agentId)
        .eq('is_active', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error || !data)
        return null;
    return rowToPersonaConfig(data);
}
/**
 * 뉴런 유형별 페르소나 시스템 프롬프트 생성.
 * 모든 뉴런이 동일한 페르소나 베이스를 받고, 뉴런별 오버라이드(정도 조절)만 다르다.
 */
function buildPersonaPrompt(config, neuronType) {
    const override = config.neuron_overrides[neuronType];
    const lines = [];
    lines.push(`당신은 "${config.name}"입니다. 사용자와 대화하는 하나의 일관된 인격입니다.`);
    lines.push('');
    lines.push('[말투 규칙]');
    lines.push(`- 격식: ${config.tone.formality}`);
    lines.push(`- 이모지: ${config.tone.emoji_usage}`);
    lines.push(`- 문장 길이: ${config.tone.sentence_length}`);
    lines.push(`- 존댓말 수준: ${config.tone.honorific_level}`);
    if (config.relationship_context.user_relationship) {
        lines.push(`- 사용자와의 관계: ${config.relationship_context.user_relationship}`);
    }
    if (config.relationship_context.conversation_history_summary) {
        lines.push(`- 최근 대화 요약: ${config.relationship_context.conversation_history_summary}`);
    }
    lines.push('');
    lines.push('[성격]');
    if (config.style_guide.personality_traits.length) {
        for (const t of config.style_guide.personality_traits)
            lines.push(`- ${t}`);
    }
    else {
        lines.push('- (설정된 성격 특성이 없습니다)');
    }
    lines.push('');
    lines.push('[사용하면 좋은 표현]');
    if (config.style_guide.preferred_expressions.length) {
        for (const e of config.style_guide.preferred_expressions)
            lines.push(`- ${e}`);
    }
    lines.push('');
    lines.push('[사용 금지 표현]');
    if (config.style_guide.forbidden_expressions.length) {
        for (const e of config.style_guide.forbidden_expressions)
            lines.push(`- ${e}`);
    }
    if (override) {
        lines.push('');
        lines.push('[현재 역할 조정]');
        if (typeof override.warmth_delta === 'number')
            lines.push(`- 따뜻함: ${override.warmth_delta >= 0 ? '+' : ''}${override.warmth_delta}`);
        if (typeof override.formality_delta === 'number')
            lines.push(`- 격식 조정: ${override.formality_delta >= 0 ? '+' : ''}${override.formality_delta}`);
        if (override.allowed_prefixes?.length)
            lines.push(`- 허용 시작 표현: ${override.allowed_prefixes.join(', ')}`);
    }
    if (config.style_guide.example_responses.length) {
        lines.push('');
        lines.push('[예시]');
        for (const ex of config.style_guide.example_responses.slice(0, 3)) {
            lines.push(`사용자: ${ex.user_input}`);
            lines.push(`${config.name}: ${ex.agent_response}`);
        }
    }
    lines.push('');
    lines.push('답변은 반드시 위 페르소나와 말투를 유지하세요. 다른 이름으로 자신을 소개하지 마세요.');
    return lines.join('\n');
}
/**
 * Persona Guard — 뉴런이 생성한 응답이 통합 페르소나를 따르는지 사후 검증.
 * 1단계(Phase 1): 규칙 기반 검사 (금지 표현, 잘못된 자기 참조)
 * 2단계(Phase 3 계획): LLM 기반 톤 일관성 검사 — 인터페이스에 시그니처만 준비
 */
class PersonaGuard {
    config;
    constructor(config) {
        this.config = config;
    }
    async validate(response, _neuronType = 'answer', _recentResponses = []) {
        const checks = [];
        let fixed = response;
        // 1. 금지 표현 검사 (규칙 기반, 빠름)
        for (const forbidden of this.config.style_guide.forbidden_expressions) {
            if (!forbidden)
                continue;
            if (fixed.includes(forbidden)) {
                checks.push({ passed: false, reason: `금지 표현 감지: '${forbidden}'`, fix: 'replace' });
                fixed = fixed.split(forbidden).join('…');
            }
        }
        // 2. 잘못된 자기 참조 검사 — 정확한 이름인지 확인
        const nameMentions = fixed.match(/제 이름은?\s*([^\s,。.!?]+)/g) || [];
        for (const mention of nameMentions) {
            const claimed = mention.replace(/제 이름은?\s*/, '');
            if (claimed !== this.config.name) {
                checks.push({ passed: false, reason: `잘못된 자기 참조: '${claimed}'`, fix: 'replace' });
            }
        }
        // 3. 톤 일관성 검사 (LLM 기반 — Phase 3 계획, 현재는 시그니처만)
        // TODO(Phase 3): 최근 N개 응답과 코사인 유사도/LLM 판정으로 톤 일관성 점수 산출
        const failed = checks.filter((c) => !c.passed);
        const passed = failed.length === 0;
        return { passed, response: fixed, checks };
    }
}
exports.PersonaGuard = PersonaGuard;
/** 시스템 프롬프트에 주입할 대화 히스토리 구성 */
function buildConversationHistory(history, maxTurns = 20) {
    return history.slice(-maxTurns);
}
//# sourceMappingURL=persona.js.map