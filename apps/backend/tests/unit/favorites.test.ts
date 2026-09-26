/**
 * 즐겨찾기 영속화 테스트 (마이그레이션 003 — 카드 t_219c4d36).
 *
 * 검증 범위:
 * - PATCH /api/messages/:id/favorite: 본인 메시지 등록/해제, 소유권 없는 메시지 → 404, 잘못된 body → 400
 * - GET /api/favorites: 세션 정보 조인(title/agent_name), dialogue_type/structured_payload 포함,
 *   limit/offset 페이지네이션 + has_more, 사용자 격리(B는 A 즐겨찾기 미열람)
 * - cascade: 메시지 삭제·회원탈퇴 시 즐겨찾기 행도 소멸 (FK ON DELETE CASCADE 기존 정책 + devstore 시뮬레이션)
 *
 * 메시지 행은 devstore에 직접 insert (created_at 명시로 정렬·페이지네이션 결정성 확보).
 * 주의: helpers.createTestApp은 resetStore로 스토어 싱글턴을 교체하지만 supabaseAdmin은
 * import 시점 스토어를 계속 참조한다 — thread-fork.test.ts와 동일하게 build()만 호출해
 * getStore()와 라우트 DB의 정합성을 유지한다 (vitest 파일별 모듈 격리로 파일 간에는 분리됨).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { app, build } from '../../src/index';
import { signup, createFullStack, bearer } from '../helpers';
import { supabaseAdmin as db, getStore } from '../../src/lib/supabase';

let aToken: string;
let bToken: string;
let stackA: { agent: any; session: any };

beforeAll(async () => {
  await build();
  const a = await signup(app, 'alice-fav@test.io');
  aToken = a.token;
  const b = await signup(app, 'bob-fav@test.io');
  bToken = b.token;
  stackA = await createFullStack(app, aToken);
});

afterAll(async () => {
  await app.close();
});

/** A 소유 세션에 메시지 행을 직접 삽입 (favorite 기본 false). */
async function seedMessage(turnIndex: number, createdAt: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await db.from('messages').insert({
    session_id: stackA.session.id, turn_index: turnIndex, role: 'agent', message_type: 'card',
    content: `카드 ${turnIndex}`, dialogue_type: 'info_card',
    structured_payload: { title: `카드 ${turnIndex}`, summary: '요약', facts: [] },
    source_neuron: 'answer', attachments: [], persona_guard: {}, user_feedback: null,
    locale: 'ko', ai_generated: true, created_at: createdAt, ...extra,
  }).select().single();
  expect(error).toBeNull();
  return data as any;
}

async function patchFavorite(messageId: string, favorite: unknown, token = aToken) {
  return app.inject({ method: 'PATCH', url: `/api/messages/${messageId}/favorite`, headers: bearer(token), payload: { favorite } });
}

async function listFavorites(query = '', token = aToken) {
  const res = await app.inject({ method: 'GET', url: `/api/favorites${query}`, headers: bearer(token) });
  return res;
}

beforeEach(() => {
  // 이전 테스트의 메시지 행 정리 (세션/에이전트는 유지)
  const store = getStore();
  store.tables.messages = store.tables.messages.filter(m => m.session_id !== stackA.session.id);
});

describe('PATCH /api/messages/:id/favorite', () => {
  it('본인 메시지 즐겨찾기 등록 → 200 + favorite 행 반환', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    expect(msg.favorite).toBe(false); // devstore insert 기본값 = SQL DEFAULT false
    const res = await patchFavorite(msg.id, true);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ id: msg.id, favorite: true, dialogue_type: 'info_card' });
    // 직렬화 계약: locale/ai_generated/structured_payload 정규화 포함
    expect(body.data.locale).toBe('ko');
    expect(body.data.ai_generated).toBe(true);
    expect(body.data.structured_payload).toEqual(msg.structured_payload);
  });

  it('즐겨찾기 해제(true→false) → 행 favorite=false 반환', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    expect((await patchFavorite(msg.id, true)).statusCode).toBe(200);
    const res = await patchFavorite(msg.id, false);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.favorite).toBe(false);
  });

  it('소유권 없는 메시지(타 사용자 세션) → 404 (존재 숨김)', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    const res = await patchFavorite(msg.id, true, bToken);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    // 원본 행은 변경되지 않았다
    const row = getStore().tables.messages.find(m => m.id === msg.id);
    expect(row?.favorite).toBe(false);
  });

  it('존재하지 않는 메시지 ID → 404', async () => {
    const res = await patchFavorite('00000000-0000-4000-8000-000000000000', true);
    expect(res.statusCode).toBe(404);
  });

  it('favorite가 boolean이 아니면 → 400 VALIDATION_ERROR', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    for (const bad of ['true', 1, null, undefined]) {
      const res = await app.inject({ method: 'PATCH', url: `/api/messages/${msg.id}/favorite`, headers: bearer(aToken), payload: { favorite: bad } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    // body 자체가 없어도 400
    const noBody = await app.inject({ method: 'PATCH', url: `/api/messages/${msg.id}/favorite`, headers: bearer(aToken), payload: {} });
    expect(noBody.statusCode).toBe(400);
  });

  it('인증 없으면 → 401', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    const res = await app.inject({ method: 'PATCH', url: `/api/messages/${msg.id}/favorite`, payload: { favorite: true } });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/favorites', () => {
  it('즐겨찾기 행 + 세션 정보 조인(title/agent_name) 반환, 미등록 행 제외', async () => {
    // 세션 제목은 포크/메타 데이터 경로로 기록되는 metadata.title
    const { error } = await db.from('sessions').update({ metadata: { title: '법률 상담 세션' } }).eq('id', stackA.session.id);
    expect(error).toBeNull();
    const fav1 = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    const fav2 = await seedMessage(1, '2026-09-26T02:00:00.000Z');
    await seedMessage(2, '2026-09-26T03:00:00.000Z'); // 즐겨찾기 안 함
    await patchFavorite(fav1.id, true);
    await patchFavorite(fav2.id, true);

    const res = await listFavorites();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(2);
    // 정렬: created_at 내림차순 (최신 먼저)
    expect(body.data.map((row: any) => row.message.id)).toEqual([fav2.id, fav1.id]);
    const first = body.data[0];
    expect(first.message).toMatchObject({ id: fav2.id, favorite: true, dialogue_type: 'info_card' });
    expect(first.message.structured_payload).toMatchObject({ title: '카드 1' });
    expect(first.message.created_at).toBe('2026-09-26T02:00:00.000Z');
    expect(first.session).toMatchObject({
      id: stackA.session.id, title: '법률 상담 세션',
      agent_id: stackA.agent.id, agent_name: stackA.agent.name,
    });
    expect(body.meta).toMatchObject({ has_more: false, limit: 50, offset: 0 });
  });

  it('limit/offset 페이지네이션 + has_more', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const msg = await seedMessage(i, `2026-09-26T0${i + 1}:00:00.000Z`);
      await patchFavorite(msg.id, true);
      ids.push(msg.id);
    }
    // 최신 먼저: ids[4], ids[3], ids[2], ids[1], ids[0]
    const page1 = (await listFavorites('?limit=2')).json();
    expect(page1.data.map((r: any) => r.message.id)).toEqual([ids[4], ids[3]]);
    expect(page1.meta).toMatchObject({ has_more: true, limit: 2, offset: 0 });

    const page2 = (await listFavorites('?limit=2&offset=2')).json();
    expect(page2.data.map((r: any) => r.message.id)).toEqual([ids[2], ids[1]]);
    expect(page2.meta).toMatchObject({ has_more: true, limit: 2, offset: 2 });

    const page3 = (await listFavorites('?limit=2&offset=4')).json();
    expect(page3.data.map((r: any) => r.message.id)).toEqual([ids[0]]);
    expect(page3.meta).toMatchObject({ has_more: false, limit: 2, offset: 4 });

    // offset이 전체를 벗어나면 빈 배열
    const empty = (await listFavorites('?limit=2&offset=10')).json();
    expect(empty.data).toEqual([]);
    expect(empty.meta.has_more).toBe(false);
  });

  it('limit 상한(200)·음수/비숫자 입력 방어', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    await patchFavorite(msg.id, true);
    const capped = (await listFavorites('?limit=9999')).json();
    expect(capped.meta.limit).toBe(200);
    const bad = (await listFavorites('?limit=abc&offset=-5')).json();
    expect(bad.meta).toMatchObject({ limit: 50, offset: 0 });
    expect(bad.data).toHaveLength(1);
  });

  it('즐겨찾기 해제하면 목록에서 사라진다 (왕복)', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    await patchFavorite(msg.id, true);
    expect((await listFavorites()).json().data).toHaveLength(1);
    await patchFavorite(msg.id, false);
    expect((await listFavorites()).json().data).toHaveLength(0);
  });

  it('사용자 격리 — B는 A의 즐겨찾기를 볼 수 없다', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    await patchFavorite(msg.id, true);
    const resB = await listFavorites('', bToken);
    expect(resB.statusCode).toBe(200);
    expect(resB.json().data).toEqual([]);
  });

  it('세션이 다르면 각 행의 session 조인 정보가 달라진다', async () => {
    // A의 두 번째 (agent, session) 스택
    const stack2 = await createFullStack(app, aToken);
    const m1 = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    const { data: m2 } = await db.from('messages').insert({
      session_id: stack2.session.id, turn_index: 0, role: 'agent', message_type: 'text',
      content: '다른 세션 카드', source_neuron: 'answer', attachments: [], persona_guard: {},
      user_feedback: null, locale: 'ko', ai_generated: true, created_at: '2026-09-26T02:00:00.000Z',
    }).select().single();
    await patchFavorite(m1.id, true);
    await patchFavorite((m2 as any).id, true);
    const rows = (await listFavorites()).json().data;
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r: any) => [r.message.id, r]));
    expect(byId.get(m1.id).session).toMatchObject({ id: stackA.session.id, agent_name: stackA.agent.name });
    expect(byId.get((m2 as any).id).session).toMatchObject({ id: stack2.session.id, agent_name: stack2.agent.name });
    // 정리: 두 번째 스택 메시지 제거 (beforeEach는 stackA 세션만 청소)
    getStore().tables.messages = getStore().tables.messages.filter(m => m.session_id !== stack2.session.id);
  });

  it('cascade — 메시지 행 삭제 시 즐겨찾기도 소멸 (FK ON DELETE CASCADE = 001 기존 정책)', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    await patchFavorite(msg.id, true);
    expect((await listFavorites()).json().data).toHaveLength(1);
    // messages.session_id → sessions(id) ON DELETE CASCADE (001 §8) — 세션 삭제로 재현
    const { error } = await db.from('messages').delete().eq('id', msg.id);
    expect(error).toBeNull();
    expect((await listFavorites()).json().data).toHaveLength(0);
  });

  it('cascade — 회원탈퇴(DELETE /api/me) 시 즐겨찾기 행 전량 파기 (개인정보보호법 §21)', async () => {
    const leaving = await signup(app, `leaver-${Date.now()}@test.io`);
    const stack = await createFullStack(app, leaving.token);
    const { data: msg } = await db.from('messages').insert({
      session_id: stack.session.id, turn_index: 0, role: 'agent', message_type: 'text',
      content: '탈퇴자 카드', source_neuron: 'answer', attachments: [], persona_guard: {},
      user_feedback: null, favorite: true, locale: 'ko', ai_generated: true, created_at: '2026-09-26T01:00:00.000Z',
    }).select().single();
    const store = getStore();
    expect(store.tables.messages.some(m => m.id === (msg as any).id && m.favorite)).toBe(true);
    const res = await app.inject({ method: 'DELETE', url: '/api/me', headers: bearer(leaving.token) });
    expect(res.statusCode).toBe(200);
    // devstore cascade(deleteDevUser)로 메시지·세션 전량 파기 확인 — 실DB는 FK CASCADE
    expect(store.tables.messages.some(m => m.session_id === stack.session.id)).toBe(false);
    expect(store.tables.sessions.some(s => s.id === stack.session.id)).toBe(false);
    // 다른 사용자(A)의 데이터는 영향 없음
    expect(store.tables.sessions.some(s => s.id === stackA.session.id)).toBe(true);
  });
});

describe('메시지 행 직렬화에 favorite 포함 (히스토리 재표시 경로)', () => {
  it('GET /api/sessions/:id/messages 행에 favorite 기본값 포함', async () => {
    await seedMessage(0, '2026-09-26T01:00:00.000Z');
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${stackA.session.id}/messages`, headers: bearer(aToken) });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((m: any) => m.favorite === false)).toBe(true);
  });

  it('PATCH 후 히스토리 행 favorite=true 반영', async () => {
    const msg = await seedMessage(0, '2026-09-26T01:00:00.000Z');
    await patchFavorite(msg.id, true);
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${stackA.session.id}/messages`, headers: bearer(aToken) });
    const row = (res.json().data as any[]).find(m => m.id === msg.id);
    expect(row.favorite).toBe(true);
  });
});
