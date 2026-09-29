/**
 * 볼트 도서관 검색 버스 (t_d469fac3, 대표님 9/30 "Spotify 도서관" 지시)
 *
 * GET /api/vault/library?q=&k= — 로컬 볼트 사이드카(scripts/vault_sidecar.py,
 * BM25+임베딩 하이브리드)를 게이트하는 관리자 토큰 엔드.
 * - 볼트는 에이전트 공용 업무 인프라(사용자 데이터 아님) — 앱 JWT 대신 VAULT_ADMIN_TOKEN
 *   헤더(x-vault-key)로만 열린다. 타이밍 세이프 비교.
 * - 토큰·URL 미설정(기본) 시 404 — classify endpointEnabled 컨벤션 동일. 실서비스는
 *   deploy.env에 설정. 사용자 vault_notes의 /api/vault/search와 완전 별개 레인.
 * - 응답: 상위 k개 청크 {rank,score,path,title,heading,date,snippet} — 에이전트는
 *   '통째 read' 대신 이 결과만 컨텍스트에 올린다 (토큰 10~20배 절감의 제공면).
 */
import { timingSafeEqual } from 'node:crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { ok, ApiError, badRequest } from '../lib/errors';

/** 관리자 토큰 게이트 — 미설정 시 엔드 자체가 존재하지 않는 것(404), 설정 후 불일치는 403.
 *  async 필수: Fastify 4에서 동기 preHandler는 콜백 스타일(next 미호출 시 행아웃)로 처리돼 정지한다. */
export async function requireVaultAdmin(request: FastifyRequest): Promise<void> {
  const expected = config.vaultLibrary.adminToken;
  if (!expected || !config.vaultLibrary.url) {
    throw new ApiError('NOT_FOUND', '볼트 도서관 엔드가 비활성화되었습니다.');
  }
  const token = request.headers['x-vault-key'];
  if (typeof token !== 'string' || !token) {
    throw new ApiError('FORBIDDEN', '볼트 도서관 접근 권한이 없습니다.');
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError('FORBIDDEN', '볼트 도서관 접근 권한이 없습니다.');
  }
}

interface LibrarySearchResponse {
  ok: boolean;
  query: string;
  mode: string;
  k: number;
  took_ms: number;
  results: unknown[];
}

/**
 * 사이드카 호출은 주입 가능하게 분리 — 단위 테스트가 fetch 스텁으로 교체하는 지점
 * (stt.ts transcribeViaSidecar 컨벤션: 비2xx/네트워크 실패는 호출부로 옮긴다).
 */
export async function searchVaultLibrary(q: string, k: number): Promise<LibrarySearchResponse> {
  const url = config.vaultLibrary.url;
  const res = await fetch(`${url}/search?q=${encodeURIComponent(q)}&k=${k}`, {
    signal: AbortSignal.timeout(config.vaultLibrary.timeoutMs),
  });
  if (!res.ok) {
    // 503 INDEX_NOT_READY 등 — 인덱스/사이드카 준비 문제. 조용한 빈 결과 폴백 금지.
    throw Object.assign(new Error(`vault library HTTP ${res.status}`), { code: 'VAULT_LIBRARY_UNAVAILABLE' });
  }
  return (await res.json()) as LibrarySearchResponse;
}

export async function vaultLibraryRoutes(app: FastifyInstance) {
  // GET /api/vault/library?q=&k= — 관리자 토큰 required. k 기본 3 (1~10).
  app.get('/library', { preHandler: requireVaultAdmin }, async (request) => {
    const { q, k: kRaw } = request.query as { q?: string; k?: string };
    if (!q || !q.trim()) throw badRequest('검색어(q)는 필수입니다.');
    const k = Math.min(Math.max(parseInt(kRaw || '3', 10) || 3, 1), 10);
    try {
      const body = await searchVaultLibrary(q.trim(), k);
      return ok({
        query: body.query,
        mode: body.mode,
        took_ms: body.took_ms,
        results: (body.results || []).map((r) => {
          const item = r as Record<string, unknown>;
          // 사이드카 청크 본문 전체는 넘기지 않는다 — 스니펫만 (토큰 절감 계약).
          return {
            rank: item.rank, score: item.score, path: item.path, title: item.title,
            heading: item.heading, date: item.date, snippet: String(item.snippet || '').slice(0, 400),
            kind: item.kind || 'vault',
          };
        }),
      }, { source: 'vault-library' });
    } catch (err: any) {
      if (err?.code === 'VAULT_LIBRARY_UNAVAILABLE') {
        throw new ApiError('VAULT_LIBRARY_UNAVAILABLE', '볼트 도서관 인덱스를 사용할 수 없습니다.', { detail: err.message });
      }
      throw new ApiError('VAULT_LIBRARY_UNAVAILABLE', '볼트 도서관 검색에 실패했습니다.', { detail: String(err?.message || err) });
    }
  });
}
