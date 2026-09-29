/**
 * 볼트 도서관 검색 버스 단위 테스트 (t_d469fac3, 대표님 9/30 "Spotify 도서관" 지시)
 *
 * 검증 범위:
 * - 설정 게이트: url/token 미설정(기본 DEV/테스트) → 404 (classify endpointEnabled 컨벤션)
 * - 관리자 토큰: 헤더 누락/불일치 → 403, 일치 → 통과 (타이밍 세이프 비교)
 * - 검색 마핑: 사이드카 응답의 스니펫 400자 컷 + rank/score/path 보존, k 클램프
 * - 사이드카 장애: 503 VAULT_LIBRARY_UNAVAILABLE (조용한 빈 결과 폴백 금지)
 * - 격리 회귀: 사용자 볼트 GET /api/vault/search(JWT)는 라이브러리 설정과 무관하게 동작
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { app, build } from '../../src/index';
import { signup, bearer } from '../helpers';
import { config } from '../../src/config';
import { requireVaultAdmin } from '../../src/lib/vaultLibrary';

let token: string;

beforeAll(async () => {
  await build();
  const a = await signup(app, 'library-vault@test.io');
  token = a.token;
});

afterAll(async () => {
  await app.close();
});

/** config.vaultLibrary 스파이 (secretary-bridge.test 컨벤션: get 스파이) */
function withLibrary(url: string, adminToken: string) {
  vi.spyOn(config.vaultLibrary, 'url', 'get').mockReturnValue(url);
  vi.spyOn(config.vaultLibrary, 'adminToken', 'get').mockReturnValue(adminToken);
}

const SIDECAR_FIXTURE = {
  ok: true,
  query: '자비스',
  mode: 'hybrid',
  k: 3,
  took_ms: 12.3,
  results: [
    { rank: 1, score: 0.91, path: '2026-09-25-자비스-소개.md', title: '자비스 소개', heading: '나는 누구인가', date: '2026-09-25', snippet: '스'.repeat(500), kind: 'vault' },
    { rank: 2, score: 0.44, path: 'javis-records/memory/x.md', title: 'x', heading: 'h', date: '2026-09-11', snippet: 'short', kind: 'vault' },
  ],
};

describe('/api/vault/library — 설정·토큰 게이트', () => {
  it('preHandler는 async여야 한다 — 동기 함수는 Fastify4 콜백(next) 스타일로 해석돼 요청이 행아웃된다 (t_d469fac3 실측 사고)', async () => {
    expect(requireVaultAdmin.constructor.name).toBe('AsyncFunction');
  });

  it('미설정(기본) → 404 NOT_FOUND — DEV/테스트 동작 불변', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vault/library?q=자비스' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('설정 후 키 없음/틀린 키 → 403 FORBIDDEN (토큰 존재 여부 노출 금지)', async () => {
    withLibrary('http://127.0.0.1:9834', 'sekret-token');
    const noKey = await app.inject({ method: 'GET', url: '/api/vault/library?q=자비스' });
    expect(noKey.statusCode).toBe(403);
    const badKey = await app.inject({ method: 'GET', url: '/api/vault/library?q=자비스', headers: { 'x-vault-key': 'nope' } });
    expect(badKey.statusCode).toBe(403);
    expect(badKey.json().error.code).toBe('FORBIDDEN');
    // 앱 JWT로는 열리지 않는다 — 레인 분리 확인
    const jwt = await app.inject({ method: 'GET', url: '/api/vault/library?q=자비스', headers: bearer(token) });
    expect(jwt.statusCode).toBe(403);
    vi.restoreAllMocks();
  });

  it('q 누락 → 400 VALIDATION_ERROR (게이트 통과 후)', async () => {
    withLibrary('http://127.0.0.1:9834', 'sekret-token');
    const res = await app.inject({ method: 'GET', url: '/api/vault/library', headers: { 'x-vault-key': 'sekret-token' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    vi.restoreAllMocks();
  });
});

describe('/api/vault/library — 검색 마핑', () => {
  beforeEach(() => withLibrary('http://127.0.0.1:9834', 'sekret-token'));
  afterEach(() => vi.restoreAllMocks());

  it('사이드카 200 → ok 래퍼로 승격, snippet ≤400', async () => {
    let calledUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u: any) => {
      calledUrl = String(u);
      return new Response(JSON.stringify(SIDECAR_FIXTURE), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const res = await app.inject({ method: 'GET', url: '/api/vault/library?q=%EC%9E%90%EB%B9%84%EC%8A%A4&k=15', headers: { 'x-vault-key': 'sekret-token' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.meta.source).toBe('vault-library');
    expect(calledUrl).toContain('k=10'); // 상한 클램프
    const items = body.data.results;
    expect(items).toHaveLength(2);
    expect(items[0].path).toBe('2026-09-25-자비스-소개.md');
    expect(items[0].snippet.length).toBeLessThanOrEqual(400);
    expect(items[1].snippet).toBe('short');
  });

  it('사이드카 503 → VAULT_LIBRARY_UNAVAILABLE (빈 결과 폴백 금지)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"INDEX_NOT_READY"}', { status: 503 }));
    const res = await app.inject({ method: 'GET', url: '/api/vault/library?q=test', headers: { 'x-vault-key': 'sekret-token' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('VAULT_LIBRARY_UNAVAILABLE');
  });

  it('사이드카 연결 실패(타임아웃/다운) → 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('connect refused'), { name: 'TimeoutError' }));
    const res = await app.inject({ method: 'GET', url: '/api/vault/library?q=test', headers: { 'x-vault-key': 'sekret-token' } });
    expect(res.statusCode).toBe(503);
  });
});

describe('격리 회귀 — 사용자 볼트 레인 불변', () => {
  it('라이브러리 설정 켜짐 상태에서도 GET /api/vault/search는 JWT 소유 노트만 본다', async () => {
    withLibrary('http://127.0.0.1:9834', 'sekret-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(SIDECAR_FIXTURE), { status: 200 }));
    await app.inject({
      method: 'POST', url: '/api/vault/notes', headers: bearer(token),
      payload: { title: '라이브러리 격리 테스트', content: '이 노트만 검색되어야 한다' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/vault/search?q=격리', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].title).toBe('라이브러리 격리 테스트');
    vi.restoreAllMocks();
  });
});
