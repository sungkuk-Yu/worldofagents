import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok } from '../lib/errors';
import { meSkillRoutes } from './skills';

/**
 * /api/me — 내 프로필/리소스 (api-design.md §3.1, §3.7)
 * 프로필 자체는 auth 라우트의 /me와 중복되지 않게 여기서는 확장 리소스만.
 */
export async function meRoutes(app: FastifyInstance) {
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