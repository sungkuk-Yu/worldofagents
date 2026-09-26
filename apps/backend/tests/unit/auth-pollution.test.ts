/**
 * P0 회귀(t_486cf23b): 로그인으로 인한 공유 supabaseAdmin 클라이언트 오염 방지 계약.
 *
 * 원인: login 라우트가 공유 service_role 클라이언트에서 signInWithPassword를 호출하면
 * supabase-js가 인스턴스에 사용자 세션을 저장(persistSession=false여도 메모리 세션)하고,
 * 이후 모든 PostgREST 요청이 service_role 키 대신 마지막 로그인 사용자의 JWT로 나가
 * RLS 쓰기 전체가 거부됐다(DEV_MODE=false에서만 재현).
 *
 * 이 테스트는 dev 모드에서 오염 자체는 재현할 수 없으므로
 * "공유 admin의 세션형 auth API를 절대 호출하지 않는다"는 코드 계약을 검증한다.
 *
 * 주의(favorites/vault 카드와 동일): resetStore()를 호출하면 supabaseAdmin이 모듈 로드 시
 * 캡처한 dev 스토어와 getStore()가 어긋나므로, 여기서는 고유 이메일로 격리한다.
 * vitest 파일별 워커 격리로 스토어는 최초 1회 생성된다.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { supabaseAdmin, createEphemeralAuthClient } from '../../src/lib/supabase';
import { signup } from '../helpers';

beforeAll(async () => { await build(); });
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await app.close(); });

describe('P0 오염 방지 — 로그인/로그아웃은 공유 admin auth를 건드리지 않는다', () => {
  it('POST /api/auth/login은 공유 supabaseAdmin.auth.signInWithPassword를 호출하지 않는다', async () => {
    const { body } = await signup(app, 'pollution-login@test.io', 'password123');
    expect(body.token).toBeTruthy();

    const sharedSignIn = vi.spyOn(supabaseAdmin.auth, 'signInWithPassword');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'pollution-login@test.io', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.token).toBeTruthy();
    expect(res.json().data.user.email).toBe('pollution-login@test.io');
    expect(sharedSignIn).not.toHaveBeenCalled();
  });

  it('POST /api/auth/logout은 공유 supabaseAdmin.auth.signOut을 호출하지 않는다', async () => {
    const sharedSignOut = vi.spyOn(supabaseAdmin.auth, 'signOut');
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.success).toBe(true);
    expect(sharedSignOut).not.toHaveBeenCalled();
  });

  it('잘못된 비밀번호 로그인 → 401 AUTH_INVALID (오염 여부와 무관한 인증 계약)', async () => {
    await signup(app, 'pollution-bad@test.io', 'password123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'pollution-bad@test.io', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_INVALID');
  });

  it('createEphemeralAuthClient는 호출마다 새 auth 객체를 반환하고 로그인에 동작한다', async () => {
    await signup(app, 'pollution-eph@test.io', 'password123');
    const a = createEphemeralAuthClient();
    const b = createEphemeralAuthClient();
    expect(a).not.toBe(b);
    expect(a).not.toBe(supabaseAdmin.auth);
    const res = await a.signInWithPassword({ email: 'pollution-eph@test.io', password: 'password123' });
    expect(res.error).toBeNull();
    expect(res.data.session.access_token).toBeTruthy();
  });

  it('login 이후에도 서버 쓰기(agent/session 생성)가 정상 동작한다 (오염 시뮬레이션 종단 계약)', async () => {
    const { body } = await signup(app, 'pollution-write@test.io', 'password123');
    expect(body.token).toBeTruthy();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'pollution-write@test.io', password: 'password123' },
    });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${login.json().data.token}` };

    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers,
      payload: { name: '오염 후 쓰기 테스트', agent_type: 'shadow' },
    });
    expect(agentRes.statusCode).toBe(201);
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions/ensure',
      headers,
      payload: { agent_id: agentRes.json().data.id },
    });
    expect(sessionRes.statusCode).toBe(201);
  });
});
