"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyDialogue = exports.NeuronRouter = void 0;
exports.classifyDialogueType = classifyDialogueType;
/** 대화 유형 분류 — 기존 classifyDialogueType 확장 (MVP 패턴 매칭) */
function classifyDialogueType(text) {
    const patterns = [
        { type: 'data', keywords: ['스프레드시트', '표로', '표를', '데이터', '차트', '그래프', '계산', '분석해', '정리해줘'] },
        { type: 'file', keywords: ['파일', 'pdf', '이미지', '문서', '다운로드', '업로드', '첨부'] },
        { type: 'task', keywords: ['작업', '실행', '예약', '알림', '설정', '삭제', '추가', '보고서', '작성해', '보내줘', '만들어줘'] },
        { type: 'multi', keywords: ['여러', '함께', '협업', '다른 에이전트', '비교'] },
    ];
    for (const p of patterns) {
        if (p.keywords.some((kw) => text.includes(kw)))
            return p.type;
    }
    if (/[?？]|어떻게|뭐|왜|언제|누구|무엇|인지|알려줘|알려주/.test(text))
        return 'question';
    if (/해줘|해주|~해라|시켜|요청|부탁/.test(text))
        return 'command';
    return 'information';
}
/**
 * 뉴런 라우터 — 사용자 입력을 분석해 필요한 뉴런 조합 결정.
 * 규칙:
 *  - 공감: 항상 활성 (상시)
 *  - 답변: 질문/요청 감지 시
 *  - 비주얼: 시각 산출물 필요 시 (data 유형 등)
 *  - 큐: 진행 중 작업 + 끼어들기 감지 시
 */
class NeuronRouter {
    static plan(text, ctx, installedCustomSlugs = []) {
        const dialogueType = classifyDialogueType(text);
        const activate = new Set(['empathy']);
        const reasons = ['empathy=always'];
        const hasRequest = dialogueType === 'question' || dialogueType === 'command' || dialogueType === 'data' || dialogueType === 'file' || dialogueType === 'task';
        if (hasRequest) {
            activate.add('answer');
            reasons.push('answer=request_detected');
        }
        if (dialogueType === 'data' || /차트|그래프|표로|시각화|인포그래픽/.test(text)) {
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
        const triggerMap = {
            translation: ['번역', 'translate', '영어로', '영작', '해석해'],
        };
        for (const slug of installedCustomSlugs) {
            const triggers = triggerMap[slug] || [];
            if (triggers.some((t) => text.toLowerCase().includes(t))) {
                activate.add(slug);
                reasons.push(`${slug}=custom_trigger`);
            }
        }
        return { activate: [...activate], dialogueType, reason: reasons.join(', ') };
    }
}
exports.NeuronRouter = NeuronRouter;
/** 세션 대화 유형 분류 (기존 preserve API 이름 — websocket 및 테스트 호환) */
exports.classifyDialogue = classifyDialogueType;
//# sourceMappingURL=router.js.map