/**
 * POST /api/classify — 대화 유형 판별 엔드 (t_56498848, dialogue-functionality-spec.md §2)
 *
 * 프론트 DialogTypeClassifier가 Stage 2(서버 위임)로 호출하는 공용 판별 API.
 * 판별 로직(패턴 표·LLM 프롬프트·임계값) 전체가 서버 단일 구현(dialogClassifier + llmClassify)에 있고,
 * 프론트는 같은 표의 미러로 Stage 1 즉시 판별만 수행한다. 실패/미설정 경로에서도 항상 Stage 1/3 규칙 결과를
 * 내려준다(LLM은 보강일뿐 의존 금지). 상태 없음 — 채팅 턴을 발생시키지 않는다.
 *
 * 계약: requireAuth · body { content: string(≤2000), history?: string[] }
 *   → 200 { type: DialogueType, confidence: 0~1, stage: 1|2|3 }
 *   → 400 VALIDATION_ERROR(content 누락/과장) · 404 NOT_FOUND(CLASSIFY_ENDPOINT_DISABLED=true)
 */
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok, badRequest, ApiError } from '../lib/errors';
import { config } from '../config';
import { detectDialogPattern, ruleFallbackType, CONFIDENCE_ADOPT, DIALOG_CONFIDENCE } from '../neurons/dialogClassifier';
import { classifyByLLM } from '../neurons/llmClassify';

export async function classifyRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: requireAuth }, async (request) => {
    if (!config.classification.endpointEnabled) {
      throw new ApiError('NOT_FOUND', '분류 엔드가 비활성화되었습니다.');
    }
    const body = (request.body || {}) as { content?: unknown; history?: unknown };
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) throw badRequest('content는 필수 문자열입니다.');
    if (content.length > 2000) throw badRequest('content는 2000자를 초과할 수 없습니다.');
    let history: string[] = [];
    if (body.history !== undefined) {
      if (!Array.isArray(body.history) || body.history.some(h => typeof h !== 'string')) {
        throw badRequest('history는 문자열 배열이어야 합니다.');
      }
      history = (body.history as string[]).slice(-6);
    }

    // Stage 1: 공유 패턴 표 — 고신뢰 확정
    const hit = detectDialogPattern(content);
    if (hit && hit.confidence >= CONFIDENCE_ADOPT) {
      return ok({ type: hit.type, confidence: hit.confidence, stage: 1 as const });
    }

    // Stage 2: LLM 의도 분류 (미설정/실패/타임아웃/미채택 → 규칙 폴백)
    const llm = await classifyByLLM(content, { history });
    if (llm && llm.confidence >= CONFIDENCE_ADOPT) {
      return ok({ type: llm.type, confidence: llm.confidence, stage: 2 as const });
    }

    // Stage 3: 규칙 폴백 (의문/명령/정보) — 저신뢰 값으로 "사용자 확인" 신호를 보낸다.
    // LLM 저채택 값은 타입 근거가 아니므로 그대로 노출하지 않고 규칙 폴백 타입+fallback 신뢰도를 반환한다.
    return ok({
      type: ruleFallbackType(content),
      confidence: DIALOG_CONFIDENCE.fallback,
      stage: 3 as const,
    });
  });
}
