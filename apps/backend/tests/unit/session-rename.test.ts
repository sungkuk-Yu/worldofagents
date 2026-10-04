/**
 * 세션 제목 수동 수정 API 단위 테스트 (t_95c5498e — PATCH /api/sessions/:id/title).
 *
 * 계약 (카드 요구 §1-§2):
 *  - requireAuth + getOwnedSession: 타인 세션 → 404(존재 숨김), 미인증 → 401, 원본 행 불변.
 *  - body {title}: trim 후 1~120자(코드포인트) — 빈 제목/비문자열/초과 → 400 VALIDATION_ERROR,
 *    120자 정확히 → 통과, 앞뒤 공백 트리밍 저장. (80자 초안은 김비서 경주 지시로 120 상향)
 *  - sessions.title(006 캐논 컬럼) 기록, 응답은 ok(updated session).
 *  - last_activity_at 무변경 — 제목 수정은 활동이 아니다(목록 정렬 역전 방지).
 *  - metadata.title 미갱신 — 캐논 title 컬럼 우선 원칙 유지(폴백 역전 버그 방지).
 *  - 성공 후 GET /api/sessions 목록에 반영.
 *
 * devstore(mock DB) 전용 — 실DB 접속 0 (fetch 모의 차단 포함).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { app, build } from '../../src/index';
import { signup, createFullStack, bearer } from '../helpers';
import { getStore } from '../../src/lib/supabase';
import { SESSION_TITLE_EDIT_MAX } from '../../src/lib/sessionTitle';

let aToken: string;
let bToken: string;
let stackA: { agent: any; session: any };
let stackB: { agent: any; session: any };

beforeAll(async () => {
  await build();
  aToken = (await signup(app, 'alice-rename@test.io')).token;
  bToken = (await signup(app, 'bob-rename@test.io')).token;
  stackA = await createFullStack(app, aToken);
  stackB = await createFullStack(app, bToken);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // 외부 네트워크 원천 차단 (mock DB만으로 완결되는지 증명)
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('외부 네트워크 호출 금지'); });
});
afterEach(() => { vi.restoreAllMocks(); });

const patchTitle = (id: string, payload: unknown, token = aToken) =>
  app.inject({ method: 'PATCH', url: `/api/sessions/${id}/title`, headers: bearer(token), payload: payload as any });

const sessionRow = (id: string) => getStore().tables.sessions.find(r => r.id === id);

describe('PATCH /api/sessions/:id/title — 검증', () => {
  it('성공: trim된 제목 저장 + ok(updated session) 응답', async () => {
    const res = await patchTitle(stackA.session.id, { title: '  저녁 회고 정리  ' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(stackA.session.id);
    expect(body.data.title).toBe('저녁 회고 정리');
    expect(sessionRow(stackA.session.id).title).toBe('저녁 회고 정리');
  });

  it('경계: 120자 정확히 통과, 121자 → 400 VALIDATION_ERROR', async () => {
    const at = '가'.repeat(SESSION_TITLE_EDIT_MAX);
    const over = '가'.repeat(SESSION_TITLE_EDIT_MAX + 1);
    expect((await patchTitle(stackA.session.id, { title: at })).statusCode).toBe(200);
    const bad = await patchTitle(stackA.session.id, { title: over });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
    // 실패한 초과는 원본에 반영되지 않는다 (120자 값 유지)
    expect(sessionRow(stackA.session.id).title).toBe(at);
  });

  it('빈 제목: 공백만/빈 문자열/title 누락/비문자열 → 400', async () => {
    for (const payload of [{ title: '' }, { title: '   \n\t ' }, {}, { title: null }, { title: 42 }]) {
      const res = await patchTitle(stackA.session.id, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('미인증 → 401 (requireAuth)', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/sessions/${stackA.session.id}/title`, payload: { title: '몰래 개명' } });
    expect(res.statusCode).toBe(401);
    expect(sessionRow(stackA.session.id).title).not.toBe('몰래 개명');
  });
});

describe('PATCH /api/sessions/:id/title — 소유권·무결성', () => {
  it('타인 세션 → 404(존재 숨김), B 세션 행 불변', async () => {
    const before = sessionRow(stackB.session.id);
    const res = await patchTitle(stackB.session.id, { title: '남의 대화 개명' }, aToken); // A가 B의 세션 수정 시도
    expect(res.statusCode).toBe(404);
    expect(['NOT_FOUND', 'SESSION_NOT_FOUND']).toContain(res.json().error.code); // 존재 숨김
    expect(sessionRow(stackB.session.id).title).toBe(before.title);
  });

  it('존재하지 않는 세션 ID → 404', async () => {
    const res = await patchTitle('00000000-0000-4000-8000-000000000000', { title: '없음' });
    expect(res.statusCode).toBe(404);
  });

  it('last_activity_at 무변경 — 제목 수정은 활동이 아니다', async () => {
    const before = sessionRow(stackA.session.id).last_activity_at;
    const res = await patchTitle(stackA.session.id, { title: '활동 아닌 개명' });
    expect(res.statusCode).toBe(200);
    expect(sessionRow(stackA.session.id).last_activity_at).toBe(before);
    expect(res.json().data.last_activity_at).toBe(before);
  });

  it('metadata.title 미갱신 — 캐논 title 컬럼 우선 원칙 유지', async () => {
    // metadata에 옛 제목이 있는 상태(포크 승계 시나리오)에서 개명
    const target = stackA.session.id;
    Object.assign(sessionRow(target), { metadata: { title: '폴백 옛 제목' } });
    const res = await patchTitle(target, { title: '새 캐논 제목' });
    expect(res.statusCode).toBe(200);
    const row = sessionRow(target);
    expect(row.title).toBe('새 캐논 제목');
    expect(row.metadata.title).toBe('폴백 옛 제목'); // 의도적 불변 (세션 목록/상세는 컬럼 우선)
  });
});

describe('개명 → 세션 목록 API 반영', () => {
  it('GET /api/sessions 행의 title가 새 제목', async () => {
    const res = await patchTitle(stackA.session.id, { title: '목록 반영 확인' });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/sessions', headers: bearer(aToken) });
    expect(list.statusCode).toBe(200);
    const row = list.json().data.find((s: any) => s.id === stackA.session.id);
    expect(row.title).toBe('목록 반영 확인');
  });
});
