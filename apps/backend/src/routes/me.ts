import { selectAllRows } from '../lib/helpers';
import { withSessionLock } from '../lib/turnLock';
import { cancelSessionRuns, clearSessionEvents } from '../websocket/eventlog';
import { closeSessionConnections } from '../websocket/handler';
import { supabaseAdmin } from '../lib/supabase';
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok, ApiError, ERROR_CODES } from '../lib/errors';
import { meSkillRoutes } from './skills';

/**
 * /api/me — 내 프로필/리소스 (api-design.md §3.1, §3.7)
 * 프로필 자체는 auth 라우트의 /me와 중복되지 않게 여기서는 확장 리소스만.
 */
export async function meRoutes(app: FastifyInstance) {
  // SDK 기본값은 완전 삭제이며 DEV 클라이언트도 동일한 cascade 계약을 구현한다.
  app.delete('/', { preHandler: requireAuth }, async (request) => {
    try {
      const sessions = await selectAllRows(supabaseAdmin, 'sessions', { user_id: request.userId });
      for (const session of sessions) cancelSessionRuns(session.id);
      // 실행 중인 턴이 마무리된 뒤 삭제하여 늦게 도착한 응답도 함께 파기한다.
      await Promise.all(sessions.map(session => withSessionLock(session.id, async () => undefined)));
      if (!supabaseAdmin.auth.admin.deleteUser) throw new Error('관리자 삭제 API 없음');
      const { error } = await supabaseAdmin.auth.admin.deleteUser(request.userId);
      if (error) throw error;
      for (const session of sessions) {
        clearSessionEvents(session.id);
        closeSessionConnections(session.id);
      }
    } catch {
      throw new ApiError('INTERNAL_ERROR', '회원탈퇴 처리에 실패했습니다.');
    }
    return ok({ deleted: true });
  });

  // 내 프로필 (api-design.md §3.1 — GET /me)
  app.get('/', { preHandler: requireAuth }, async (request) => {
    const { data, error } = await request.db.from('users').select('*').eq('id', request.userId).maybeSingle();
    if (error || !data) throw new ApiError(ERROR_CODES.AUTH_REQUIRED, '프로필을 찾을 수 없습니다.');
    return ok(data);
  });

  // PATCH /me — 프로필 수정
  app.patch('/', { preHandler: requireAuth }, async (request) => {
    const body = request.body as { display_name?: string; avatar_url?: string; phone?: string; timezone?: string; language?: string; preferences?: Record<string, unknown>; profile?: Record<string, unknown> };
    const patch: Record<string, unknown> = {};
    for (const key of ['display_name', 'avatar_url', 'phone', 'timezone', 'language', 'preferences', 'profile'] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (!Object.keys(patch).length) {
      const { data } = await request.db.from('users').select('*').eq('id', request.userId).maybeSingle();
      return ok(data);
    }
    const { data, error } = await request.db.from('users').update(patch).eq('id', request.userId).select().single();
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, '프로필 수정에 실패했습니다.', { detail: error.message });
    return ok(data);
  });

  // 내 에이전트 목록 (빠른 접근용)
  app.get('/agents', { preHandler: requireAuth }, async (request) => {
    const { data } = await request.db.from('agents').select('*').eq('owner_id', request.userId).eq('is_active', true).order('created_at', { ascending: false });
    return ok(data || []);
  });

  // 내 세션 목록
  app.get('/sessions', { preHandler: requireAuth }, async (request) => {
    const { data } = await request.db.from('sessions').select('*').eq('user_id', request.userId).eq('status', 'active').order('last_activity_at', { ascending: false }).limit(50);
    return ok(data || []);
  });

  // 스킬 (설치/등록) — meSkillRoutes와 통합
  await meSkillRoutes(app);
}