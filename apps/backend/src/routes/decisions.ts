import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ApiError, ERROR_CODES, badRequest, ok } from '../lib/errors';
import { updateDecisionStatus, listDecisions } from '../lib/decisionItems';
import { broadcastToSession } from '../websocket/handler';

/** decision_items 소유권 검증 및 조회 */
async function getOwnedDecision(db: any, userId: string, decisionId: string) {
  const { data, error } = await db
    .from('decision_items')
    .select('*, sessions!inner(user_id)')
    .eq('id', decisionId)
    .maybeSingle();
  
  if (error || !data) throw new ApiError('NOT_FOUND', '결정 항목을 찾을 수 없습니다.');
  
  // 소유권 검증: 세션의 user_id가 요청자와 일치해야 함
  if ((data as any).sessions?.user_id !== userId) {
    throw new ApiError('NOT_FOUND', '결정 항목을 찾을 수 없습니다.');
  }
  
  return data;
}

export async function decisionRoutes(app: FastifyInstance) {
  // POST /api/decisions/:id/answer — 인라인 답변 제출 (t_2de069f3 프론트 계약)
  // PATCH /:id와 동일 상태 전이지만 status='answered' 고정·answer 필수. UX 전용 얇은 래퍼.
  app.post('/:id/answer', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { answer?: unknown } | null;

    if (typeof body?.answer !== 'string' || body.answer.trim().length === 0) {
      throw badRequest('answer는 필수입니다.');
    }

    // 소유권 검증
    const decision = await getOwnedDecision(request.db, request.userId, id);

    // 상태 갱신 (answered 확정)
    const updated = await updateDecisionStatus(request.db, id, 'answered', body.answer);

    // WS decision.updated 브로드캐스트 (PATCH와 동일 패턴)
    const sessionId = (decision as any).session_id;
    const items = await listDecisions(request.db, sessionId);
    const pending_count = items.filter(i => i.status === 'pending').length;

    broadcastToSession(sessionId, {
      type: 'decision.updated',
      session_id: sessionId,
      decision_id: id,
      status: updated.status,
      pending_count,
    });

    return ok(updated);
  });

  // PATCH /api/decisions/:id — 결정 상태 전이 (t_6d208fb5)
  // 상태: pending → answered / deferred / dismissed
  // answered일 때 answer 필수
  app.patch('/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status?: unknown; answer?: unknown } | null;
    
    if (typeof body?.status !== 'string' || !['answered', 'deferred', 'dismissed'].includes(body.status)) {
      throw badRequest('status는 answered / deferred / dismissed 중 하나여야 합니다.');
    }
    
    const status = body.status as 'answered' | 'deferred' | 'dismissed';
    
    if (status === 'answered' && typeof body.answer !== 'string') {
      throw badRequest('answered 상태일 때 answer는 필수입니다.');
    }
    
    // 소유권 검증
    const decision = await getOwnedDecision(request.db, request.userId, id);
    
    // 상태 갱신
    const updated = await updateDecisionStatus(
      request.db,
      id,
      status,
      status === 'answered' && typeof body.answer === 'string' ? body.answer : undefined
    );
    
    // WS decision.updated 브로드캐스트 (queue.updated 패턴 재사용)
    const sessionId = (decision as any).session_id;
    const items = await listDecisions(request.db, sessionId);
    const pending_count = items.filter(i => i.status === 'pending').length;
    
    broadcastToSession(sessionId, {
      type: 'decision.updated',
      session_id: sessionId,
      decision_id: id,
      status: updated.status,
      pending_count,
    });
    
    return ok(updated);
  });
}
