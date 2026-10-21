"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISCLAIMERS = exports.PersonaGuard = void 0;
exports.rowToPersonaConfig = rowToPersonaConfig;
exports.getActivePersona = getActivePersona;
exports.buildPersonaPrompt = buildPersonaPrompt;
exports.buildConversationHistory = buildConversationHistory;
exports.classifyExpertise = classifyExpertise;
const DEFAULT_TONE = { formality: 'friendly', emoji_usage: 'rare', sentence_length: 'medium', honorific_level: 3 };
function rowToPersonaConfig(row, overrides) {
    const style = (row.style_guide || {});
    const tone = { ...DEFAULT_TONE, ...(row.tone_config || {}) };
    return {
        system_prompt: typeof row.style_guide?.system_prompt === 'string' ? row.style_guide.system_prompt : undefined,
        tags: Array.isArray(row.style_guide?.tags) ? row.style_guide.tags : [],
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
    if (config.system_prompt)
        lines.push(config.system_prompt);
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
exports.DISCLAIMERS = {
    legal: { ko: '※ 본 응답은 AI가 생성한 정보이며 정식 법률 자문이 아닙니다.', en: '※ This response is AI-generated information and is not professional legal advice.' },
    accounting: { ko: '※ 본 응답은 AI가 생성한 정보이며 정식 세무·회계 자문이 아닙니다.', en: '※ This response is AI-generated information and is not professional tax or accounting advice.' },
    medical: { ko: '※ 본 응답은 AI가 생성한 정보이며 전문 의료진의 진단이나 진료를 대신하지 않습니다.', en: '※ This response is AI-generated information and does not replace professional medical diagnosis or care.' },
    // t_20746efa — 시사/뉴스 depth lane(대표님 10/10 2안): 최신 사실 확인이 필요한 카테고리.
    current: { ko: '※ 본 응답은 AI가 생성한 정보이며 최신 보도는 출처와 함께 확인이 필요합니다.', en: '※ This response is AI-generated information; please verify latest reports against their sources.' },
    general: { ko: '※ 본 응답은 AI가 생성한 정보입니다.', en: '※ This response is AI-generated information.' },
};
/** 스키마에 category가 없으면 config.category 및 페르소나 이름/프롬프트/태그로 판정한다. */
function classifyExpertise(...values) {
    const text = values.map(v => typeof v === 'string' ? v : JSON.stringify(v) || '').join(' ');
    if (/법률|변호|legal|lawyer/i.test(text))
        return 'legal';
    // t_a546fb54 — 세목 파생어 보강 (대표님 10/10 두배속 실측: '상속세 신고 기한이 언제야'
    // 가 (세무|회계|tax|account)에만 걸려 미판정 → 승격 누락). precision-first:
    // '○○세' 전용 세목 명사만 — 오탐 비용은 백스테이지 지연뿐, 단독 '세/세금'은 미포함.
    if (/세무|회계|tax|account|상속세|증여세|부가가치세|양도세|종합소득세|부가세|capital\s*gains|inheritance\s*tax|estate\s*tax/i.test(text))
        return 'accounting';
    if (/의료|의사|진료|medical|doctor/i.test(text))
        return 'medical';
    // t_20746efa: 시사(current affairs) — depth lane 판정용 발화 텍스트 분류.
    // 오탐 비용은 '검색 한 번 더'지만 precision-first: 뉴스/시사 고유 키워드만 잡는다.
    if (/시사|뉴스|정국|선거|국회|latest\s*news|current\s*affairs|breaking\s*news/i.test(text))
        return 'current';
    return 'general';
}
//# sourceMappingURL=persona.js.map