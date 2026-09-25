/**
 * 테스트 공용 헬퍼 — DEV_MODE 인메모리 스토어 + Fastify 앱 부팅.
 *
 * vitest는 테스트 파일별로 독립 워커를 띄우므로 모듈 싱글턴(app, devstore)이
 * 파일 간 격리된다. 각 테스트 시작 시 resetStore()로 스토어를 초기화한다.
 */
import { resetStore } from '../src/lib/devstore';
import { build, app as fastifyApp } from '../src/index';
import type { FastifyInstance, InjectOptions } from 'fastify';

export type TestApp = FastifyInstance;

/** 새로 리셋된 스토어 + 부팅된 앱 생성 */
export async function createTestApp(): Promise<TestApp> {
  resetStore();
  await build();
  return fastifyApp;
}

/** 앱 종료 (열린 핸들/타이머 정리) */
export async function closeTestApp(app: TestApp): Promise<void> {
  try {
    await app.close();
  } catch {
    // 이미 닫힘
  }
}

export interface SignupResult {
  res: Awaited<ReturnType<TestApp['inject']>>;
  body: any;
  token: string;
  userId: string;
}

export async function signup(
  app: TestApp,
  email = 'user@test.io',
  password = 'password123',
  display_name?: string
): Promise<SignupResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email, password, display_name: display_name || email.split('@')[0] },
  });
  const body = res.json();
  return {
    res,
    body: body?.data,
    token: body?.data?.token,
    userId: body?.data?.user?.id,
  };
}

export interface AuthedTest {
  app: TestApp;
  token: string;
  userId: string;
  email: string;
}

/** 회원가입까지 끝낸 인증 상태 생성 */
export async function authedApp(email = 'user@test.io'): Promise<AuthedTest> {
  const app = await createTestApp();
  const { token, userId } = await signup(app, email);
  if (!token || !userId) throw new Error(`signup 실패: ${email}`);
  return { app, token, userId, email };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** JSON으로 응답을 강제하는 inject 래퍼 */
export async function inject(
  app: TestApp,
  opts: InjectOptions
): Promise<{ statusCode: number; json: () => any; body: string }> {
  const res = await app.inject(opts);
  return { statusCode: res.statusCode, json: () => res.json(), body: res.body };
}

/** 테스트용 (user, agent, session) 풀 세팅 */
export async function createFullStack(app: TestApp, token: string) {
  const agentRes = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: bearer(token),
    payload: { name: '테스트 에이전트', agent_type: 'shadow' },
  });
  const agent = agentRes.json().data;
  const sessionRes = await app.inject({
    method: 'POST',
    url: '/api/sessions/ensure',
    headers: bearer(token),
    payload: { agent_id: agent.id },
  });
  const session = sessionRes.json().data;
  return { agent, session, personaId: session.persona_id };
}