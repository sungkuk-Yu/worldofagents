import { serializeMessage, selectAllRows } from '../lib/helpers';
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ApiError, ERROR_CODES, ok } from '../lib/errors';
import { MessagesRow, SessionsRow } from '../types/db';

/** 세션 제목 — 006 캐논 sessions.title 컬럼 우선, 없으면 metadata.title 폴백 (sessions.ts와 동일 규칙). */
function sessionTitle(session: SessionsRow): string | null {
  if (typeof session.title === 'string' && session.title.trim()) return session.title.trim();
  const meta = session.metadata as Record<string, unknown> | null;
  const title = meta && typeof meta.title === 'string' ? meta.title.trim() : '';
  return title || null;
}

/**
 * GET /api/favorites — 내 즐겨찾기 메시지 목록 (마이그레이션 003).
 *
 * 소유권: service_role + 라우트 수준 필터 (002 확립 원칙) —
 *   ① 내 세션 ID 집합을 먼저 구하고 ② favorite=true AND session_id IN (내 세션)으로 조회한다.
 * 세션 정보 조인(session_id/title/agent 이름)은 devstore 호환을 위해 수동 조인으로 수행
 *   (PostgREST 임베드 `sessions(...)`는 인메모리 devstore에서 동작하지 않는다).
 * 정렬: created_at 내림차순(최신 즐겨찾기 먼저) + id 보조 키(동일 시각 결정성).
 * 페이지네이션: limit(기본 50, 최대 200)/offset — limit+1행 조회로 meta.has_more 산출.
 */
export async function favoriteRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, async (request) => {
    const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };
    const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const start = Math.max(parseInt(offset, 10) || 0, 0);

    const sessions = await selectAllRows(request.db, 'sessions', { user_id: request.userId }) as SessionsRow[];
    if (!sessions.length) return ok([], { limit: max, offset: start, has_more: false });
    const sessionIds = new Set(sessions.map(s => s.id));

    // limit+1행 조회 → has_more 판정 (devstore/PostgREST 공통: range(from,to)는 양끝 포함)
    const { data, error } = await request.db.from('messages').select('*')
      .eq('favorite', true)
      .in('session_id', [...sessionIds])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + max);
    if (error) throw new ApiError(ERROR_CODES.INTERNAL_ERROR, error.message);
    const rows = (data as MessagesRow[]) || [];
    const hasMore = rows.length > max;
    const page = hasMore ? rows.slice(0, max) : rows;

    // 세션·에이전트 수동 조인 (즐겨찾기 행의 세션만 대상으로 소규모 조회)
    const usedSessionIds = [...new Set(page.map(r => r.session_id))];
    const agentIds = [...new Set(sessions.filter(s => usedSessionIds.includes(s.id)).map(s => s.agent_id))];
    const agents = agentIds.length
      ? ((await request.db.from('agents').select('*').in('id', agentIds)).data as { id: string; name: string }[] | null) || []
      : [];
    const agentNameById = new Map(agents.map(a => [a.id, a.name]));
    const sessionById = new Map(sessions.map(s => [s.id, s]));

    return ok(page.map(row => {
      const session = sessionById.get(row.session_id);
      return {
        message: serializeMessage(row),
        session: {
          id: row.session_id,
          title: session ? sessionTitle(session) : null,
          agent_id: session?.agent_id ?? null,
          agent_name: session ? agentNameById.get(session.agent_id) ?? null : null,
          status: session?.status ?? null,
        },
      };
    }), { limit: max, offset: start, has_more: hasMore });
  });
}
