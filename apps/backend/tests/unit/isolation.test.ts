/**
 * 세션 소유권 격리 테스트 — 사용자 B가 A의 세션/메시지에 접근 불가 (REST).
 * 리뷰 치명#1의 REST 측 검증 (WS 측은 phase2-contract.test.ts + smoke_chat.mjs에서 검증).
 *
 * 주의: helpers.createTestApp은 모듈 싱글턴 app을 재사용하므로 build()는 1회만.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, signup, createFullStack, bearer, closeTestApp, TestApp } from '../helpers';

let app: TestApp;
let aToken: string;
let bToken: string;
let sessionA: { id: string };

beforeAll(async () => {
  app = await createTestApp();
  const a = await signup(app, 'alice-iso@test.io');
  aToken = a.token;
  const b = await signup(app, 'bob-iso@test.io');
  bToken = b.token;
  const stack = await createFullStack(app, aToken);
  sessionA = stack.session;
});

afterAll(async () => {
  await closeTestApp(app);
});

describe('세션 소유권 격리 (REST)', () => {
  it('B는 A 세션 상세 조회 불가 (404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionA.id}`,
      headers: bearer(bToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('SESSION_NOT_FOUND');
  });

  it('B는 A 세션에 메시지 전송 불가 (404)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionA.id}/messages`,
      headers: bearer(bToken),
      payload: { content: '훔쳐보기' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('B는 A 세션 히스토리 조회 불가 (404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionA.id}/messages`,
      headers: bearer(bToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('B 세션 목록에 A 세션 없음', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: bearer(bToken),
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data || []).map((s: { id: string }) => s.id);
    expect(ids).not.toContain(sessionA.id);
  });

  it('B는 A 세션 뉴런 인스턴스/이력 조회 불가 (404)', async () => {
    const r1 = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/neurons`, headers: bearer(bToken) });
    const r2 = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/neurons/history`, headers: bearer(bToken) });
    expect(r1.statusCode).toBe(404);
    expect(r2.statusCode).toBe(404);
  });

  it('B는 A 세션 컨텍스트/메모리 조회 불가 (404)', async () => {
    const r1 = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/context`, headers: bearer(bToken) });
    const r2 = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/memories`, headers: bearer(bToken) });
    const r3 = await app.inject({ method: 'GET', url: `/api/sessions/${sessionA.id}/transcripts`, headers: bearer(bToken) });
    expect(r1.statusCode).toBe(404);
    expect(r2.statusCode).toBe(404);
    expect(r3.statusCode).toBe(404);
  });

  it('B는 A 세션 아카이브/상태변경 불가 (404)', async () => {
    const r1 = await app.inject({ method: 'POST', url: `/api/sessions/${sessionA.id}/archive`, headers: bearer(bToken) });
    const r2 = await app.inject({ method: 'PATCH', url: `/api/sessions/${sessionA.id}`, headers: bearer(bToken), payload: { status: 'suspended' } });
    expect(r1.statusCode).toBe(404);
    expect(r2.statusCode).toBe(404);
  });

  it('A는 자기 세션 정상 접근 (통제군)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionA.id}`,
      headers: bearer(aToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(sessionA.id);
  });
});
