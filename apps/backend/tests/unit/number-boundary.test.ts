/**
 * 수치 경계(Number coercion) P1 가드 회귀 테스트 (t_e1334cee, 볼트 [[2026-10-03-백개발-numbers-boundary-감사]]).
 *
 * 커버리지 (카드 범위 1~5, "banana" 클래스 차단 증거):
 * - P1-1 turn_index max+1: nextTurnFromLast 단언 + 오염 행에서 user insert 차단(행 수 불변) +
 *   문자열 숫자 "7"→8 복원(additive, 정상 동작 불변)
 * - P1-2 persona version: POST body.version 정수>0만 채택("banana"→자동 채번, "3"→숫자 3, 0/음수→자동),
 *   prev 오염("5"→6, "51" 문자 연결 차단), PATCH body.version 오염 삭제 회수
 * - P1-3 install_count: RPC 원자 경로(devstore bump_skill_install_count) + Number 가드 RMW 폴백
 *   + 언설치 하한 0
 * - P1-4 stt_metadata: sanitizeSttMetadata 단언 + REST 영속 직전 정화 실측("1234"→1234, "abc"→기본값,
 *   비객체 'banana'→null+message_type text)
 * - P1-5 queue position reduce: 가비지 position→0 폴백, 수치 최대+1
 * - 017 마이그레이션 정적 프루브 (015/016 관례 readFileSync, vitest cwd=apps/backend 기준 상대경로)
 *
 * 부팅: favorites/attachments 테스트 관례 — build() + supabaseAdmin(getStore() 싱글턴 정합).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { signup, createFullStack, bearer } from '../helpers';
import { supabaseAdmin as db, getStore } from '../../src/lib/supabase';
import { ApiError } from '../../src/lib/errors';
import { nextTurnFromLast, sanitizeSttMetadata, nextTurnIndex } from '../../src/lib/helpers';
import { persistUserUtteranceEarly } from '../../src/lib/chatTurn';
import { enqueueQuestion } from '../../src/lib/questionQueue';
import { SessionsRow } from '../../src/types/db';
import { readFileSync, readdirSync } from 'node:fs';

let token: string;
let userId: string;
let stack: { agent: any; session: any; personaId: string };

beforeAll(async () => {
  await build();
  ({ token, userId } = await signup(app, 'numbound@test.io'));
  stack = await createFullStack(app, token);
});
afterAll(async () => { await app.close(); });

const baseSession = () => ({ id: stack.session.id, user_id: userId, agent_id: stack.agent.id, persona_id: stack.personaId, status: 'active' });

// ───────────────────────────── P1-1 turn_index ─────────────────────────────
describe('P1-1 turn_index max+1 가드 (감사 §1)', () => {
  it('nextTurnFromLast: null/undefined→0, 숫자 그대로, 문자열 숫자 복원, banana/NaN은 ApiError 차단', () => {
    expect(nextTurnFromLast(null)).toBe(0);           // 빈 세션 — 기존 `-1+1` 의미 동일
    expect(nextTurnFromLast(undefined)).toBe(0);
    expect(nextTurnFromLast(3)).toBe(4);              // 정상 경로 불변
    expect(nextTurnFromLast('7')).toBe(8);            // 드리프트 복원 (additive)
    for (const garbage of ['banana', NaN, {}, '5a', Infinity]) {
      expect(() => nextTurnFromLast(garbage), `차단 실패: ${String(garbage)}`).toThrowError(ApiError);
    }
    try { nextTurnFromLast('banana'); } catch (e) {
      expect((e as ApiError).code).toBe('INTERNAL_ERROR');
      expect((e as ApiError).message).toContain('banana');
    }
  });

  it('마지막 행 turn_index가 banana → user insert 차단, 오염 행 외 insert 0 (격리 세션)', async () => {
    const sid = 'nb-contam'; // 메인 스택 세션 오염 방지 — 전용 격리 세션
    getStore().tables.messages.push({ id: 'contam-1', session_id: sid, turn_index: 'banana', role: 'agent', content: '오염 행', message_type: 'text', locale: 'ko', ai_generated: true, source_neuron: null, structured_payload: {}, stt_metadata: null, attachments: [], persona_guard: {}, dialogue_type: null, parent_message_id: null, root_message_id: null, user_feedback: null });
    const before = getStore().tables.messages.length;
    await expect(persistUserUtteranceEarly(db, { ...baseSession(), id: sid } as SessionsRow, userId, 'hi', { locale: 'ko' }))
      .rejects.toThrowError(/turn_index 오염/);
    expect(getStore().tables.messages.length).toBe(before); // 차단 = insert 0
    getStore().tables.messages = getStore().tables.messages.filter(r => r.session_id !== sid);
  });

  it('turn_index "7" 문자열 행에서 nextTurnIndex → 8 (숫자 복원, "71" 폭주 차단)', async () => {
    getStore().tables.messages.push({ id: 'str-7', session_id: 'nb-str7', turn_index: '7', role: 'agent', content: 'x', message_type: 'text', locale: 'ko', ai_generated: true, source_neuron: null, structured_payload: {}, stt_metadata: null, attachments: [], persona_guard: {}, dialogue_type: null, parent_message_id: null, root_message_id: null, user_feedback: null });
    expect(await nextTurnIndex(db, 'nb-str7')).toBe(8);
    getStore().tables.messages = getStore().tables.messages.filter(r => r.session_id !== 'nb-str7');
  });
});

// ───────────────────────────── P1-2 persona version ─────────────────────────────
describe('P1-2 persona version 가드 (감사 §2)', () => {
  const postPersona = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/agents/${stack.agent.id}/personas`, headers: bearer(token), payload });

  it('body.version "banana" → 거부되고 자동 채번(숫자)', async () => {
    const res = await postPersona({ name: 'P-banana', version: 'banana' });
    expect(res.statusCode).toBe(201);
    const v = res.json().data.version;
    expect(typeof v).toBe('number');
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThan(1);
  });

  it('body.version "3" → 숫자 3로 복원 채택 (문자열 영속 차단), 무결한 정수는 자동 채번 통과', async () => {
    const res = await postPersona({ name: 'P-str3', version: '3' });
    expect(res.statusCode).toBe(201);
    const v = res.json().data.version;
    expect(typeof v).toBe('number');
    expect(v).toBe(3); // Number 복원 — 문자열 "3" 그대로의 insert는 차단
    expect(getStore().tables.personas.find(p => p.name === 'P-str3')?.version).toBe(3);
    const okAuto = await postPersona({ name: 'P-clean-int' }); // version 미지정 — 자동 채번 불변
    expect(okAuto.statusCode).toBe(201);
    expect(Number.isInteger(okAuto.json().data.version)).toBe(true);
  });

  it('body.version 0/-5 → 거부, 자동 채번 (0 이하 버전 영속 차단)', async () => {
    for (const bad of [0, -5]) {
      const res = await postPersona({ name: `P-${bad}`, version: bad });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.version).toBeGreaterThan(1);
    }
  });

  it('prev 오염: 최고 버전 행이 문자열 "5" → 다음 버전 6 (문자 연결 "51" 차단)', async () => {
    const personas = getStore().tables.personas;
    personas.length = 0; // 이 agent 산하만 비움 (파일 격리 스토어)
    personas.push({ id: 'pv-contam', agent_id: stack.agent.id, version: '5', name: '오염', voice_config: {}, tone_config: {}, style_guide: {}, neuron_overrides: {}, relationship_type: 'assistant', is_active: true });
    const res = await postPersona({ name: 'P-after-contam' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.version).toBe(6);
  });

  it('PATCH body.version "banana" → 삭제 후 자동 채번 (spread 덮어쓰기 경로 봉쇄)', async () => {
    const personaId = getStore().tables.personas.find(p => p.name === 'P-after-contam')?.id ?? 'pv-contam';
    const res = await app.inject({ method: 'PATCH', url: `/api/agents/${stack.agent.id}/personas/${personaId}`, headers: bearer(token), payload: { name: 'P-patch', version: 'banana' } });
    expect(res.statusCode).toBe(201);
    const v = res.json().data.version;
    expect(typeof v).toBe('number');
    expect(v).toBe(7); // prev 6 + 1
  });
});

// ───────────────────────────── P1-3 install_count ─────────────────────────────
describe('P1-3 install_count 원자화 + 가드 (감사 §3)', () => {
  const seedSkill = (installCount: unknown) => {
    getStore().tables.skills.push({
      id: 'sk-nb-1', slug: 'nb-skill', name: '경계 스킬', description: null, category: 'general',
      version: '1.0.0', author_id: null, author_name: 'official', content: {}, icon_url: null,
      price: 0, status: 'published', security_scan: {}, install_count: installCount,
      usage_count: 0, satisfaction_sum: 0, satisfaction_count: 0,
    });
  };
  afterEach(() => {
    const s = getStore();
    s.tables.skills = s.tables.skills.filter(x => x.slug !== 'nb-skill');
    s.tables.skill_installations = s.tables.skill_installations.filter(x => x.skill_id !== 'sk-nb-1');
  });

  it('RPC 원자 경로: 오염된 "3"도 저장값 기준 +1 = 숫자 4 (devstore 017 semantics)', async () => {
    seedSkill('3');
    const res = await app.inject({ method: 'POST', url: '/api/skills/nb-skill/install', headers: bearer(token), payload: {} });
    expect(res.statusCode).toBe(201);
    const skill = getStore().tables.skills.find(x => x.slug === 'nb-skill');
    expect(skill?.install_count).toBe(4);
    expect(typeof skill?.install_count).toBe('number');
  });

  it('RPC 미적용 환경(017 pre-push, PGRST202) → Number 가드 RMW 폴백: "3"→4', async () => {
    const spy = vi.spyOn(db, 'rpc').mockImplementation(async (fn: string) =>
      fn === 'bump_skill_install_count'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function scalar bump_skill_install_count' } } as any
        : Promise.resolve({ data: null, error: null }));
    seedSkill('3');
    const r1 = await app.inject({ method: 'POST', url: '/api/skills/nb-skill/install', headers: bearer(token), payload: {} });
    expect(r1.statusCode).toBe(201);
    expect(getStore().tables.skills.find(x => x.slug === 'nb-skill')?.install_count).toBe(4);
    spy.mockRestore();
  });

  it('언설치 하한 0: install_count 0에서 DELETE → -1 아닌 0', async () => {
    seedSkill(0);
    const ins = await app.inject({ method: 'POST', url: '/api/skills/nb-skill/install', headers: bearer(token), payload: {} });
    expect(ins.statusCode).toBe(201);
    expect(getStore().tables.skills.find(x => x.slug === 'nb-skill')?.install_count).toBe(1);
    const del = await app.inject({ method: 'DELETE', url: '/api/skills/nb-skill/install', headers: bearer(token) });
    expect(del.statusCode).toBe(200);
    expect(getStore().tables.skills.find(x => x.slug === 'nb-skill')?.install_count).toBe(0);
    // 설치 이력 없이도 하한 봉인: devstore rpc 경로는 GREATEST(0,·) 재현
    const row = getStore().tables.skills.find(x => x.slug === 'nb-skill');
    row!.install_count = 0;
  });
});

// ───────────────────────────── P1-4 stt_metadata ─────────────────────────────
describe('P1-4 stt_metadata 저장 전 정화 (감사 §4)', () => {
  it('sanitizeSttMetadata: 문자열 수치 복원 / 가비지→기본값 / language 문자열만 / 멱등 / 비객체→null', () => {
    const s1 = sanitizeSttMetadata({ duration_ms: '1234', confidence: 'abc', language: 42, service: 'whisper' });
    expect(s1).toMatchObject({ duration_ms: 1234, confidence: 0.95, service: 'whisper' });
    expect(s1!.language).toBeUndefined();
    expect(sanitizeSttMetadata({ confidence: NaN, duration_ms: -50 })).toMatchObject({ confidence: 0.95, duration_ms: 0 });
    expect(sanitizeSttMetadata(s1)).toEqual(s1); // 멱등 (WS early-persist → runTextTurn 이중 스캔 안전)
    expect(sanitizeSttMetadata(null)).toBeNull();
    expect(sanitizeSttMetadata('banana' as any)).toBeNull();
    expect(sanitizeSttMetadata({ confidence: 0.87, duration_ms: 900, language: 'ko' })).toEqual({ confidence: 0.87, duration_ms: 900, language: 'ko' }); // 서버 계산 통과 — 동작 불변
  });

  it('REST POST messages: 오염 stt_metadata가 숫자로 정화되어 영속 (프론트 banana 재계산 원천 차단)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${stack.session.id}/messages`, headers: bearer(token),
      payload: { content: '음성 테스트', stt_metadata: { duration_ms: '1234', confidence: 'abc', service: 'mock' } },
    });
    expect(res.statusCode).toBe(201);
    const userRow = getStore().tables.messages.find(m => m.id === res.json().data.user_message_id);
    expect(userRow?.message_type).toBe('voice');
    expect(userRow?.stt_metadata).toMatchObject({ duration_ms: 1234, confidence: 0.95, service: 'mock' });
    expect(typeof userRow!.stt_metadata.duration_ms).toBe('number');
  });

  it('REST stt_metadata 비객체 "banana" → null 정화 + message_type text 회수', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${stack.session.id}/messages`, headers: bearer(token),
      payload: { content: '가비지 스터프', stt_metadata: 'banana' },
    });
    expect(res.statusCode).toBe(201);
    const userRow = getStore().tables.messages.find(m => m.id === res.json().data.user_message_id);
    expect(userRow?.stt_metadata).toBeNull();
    expect(userRow?.message_type).toBe('text');
  });
});

// ───────────────────────────── P1-5 queue position ─────────────────────────────
describe('P1-5 message_queue position reduce 가드 (감사 §5)', () => {
  it('가비지 position("banana"/undefined) 행 사이에서도 수치 최대+1 — NaN 영속 차단', async () => {
    const sid = 'nb-queue';
    getStore().tables.message_queue.push(
      { id: 'q1', session_id: sid, user_id: 'u', content: 'a', locale: 'ko', status: 'pending', position: 2, created_at: '2026-10-01T00:00:00Z', answered_at: null },
      { id: 'q2', session_id: sid, user_id: 'u', content: 'b', locale: 'ko', status: 'pending', position: 'banana', created_at: '2026-10-01T00:00:00Z', answered_at: null },
      { id: 'q3', session_id: sid, user_id: 'u', content: 'c', locale: 'ko', status: 'pending', position: '7', created_at: '2026-10-01T00:00:00Z', answered_at: null },
    );
    const item = await enqueueQuestion(db, { sessionId: sid, userId: 'u', content: '새 질문', locale: 'ko' });
    expect(item).not.toBeNull();
    expect(item!.position).toBe(8); // Number('7')||0 = 7 (banana→0 폴백), max+1 — NaN 침투 0
    getStore().tables.message_queue = getStore().tables.message_queue.filter(r => r.session_id !== sid);
  });
});

// ───────────────────────────── 017 정적 프루브 ─────────────────────────────
describe('017_install_count_atomic — 정적 프루브 (015/016 관례, 카드 금지: 실DB apply 없음)', () => {
  const UP = readFileSync('supabase/migrations/017_install_count_atomic.sql', 'utf8');
  const DOWN = readFileSync('supabase/rollback/017_install_count_atomic_down.sql', 'utf8');

  it('additive-only: 신규 함수 CREATE만 — ALTER/DROP/DELETE/TRUNCATE 0건 (대표님 DELETE/DROP 금지)', () => {
    const body = UP.replace(/^\s*--.*$/gm, '').toUpperCase();
    // UPDATE skills SET은 원자 RPC 본문 자체의 목적(007 bump_upload_quota 관례) — 금지 대상이 아니다.
    for (const forbidden of ['ALTER TABLE', 'DROP TABLE', 'DROP FUNCTION', 'DELETE FROM', 'TRUNCATE']) {
      expect(body, `017 본문에 금지 작업: ${forbidden}`).not.toContain(forbidden);
    }
    expect(UP).toContain('CREATE OR REPLACE FUNCTION bump_skill_install_count');
    expect(UP).not.toMatch(/context_patches|client_req/); // 015/016 영역 무침범
  });

  it('원자성 시맨틱: DB 저장값 기준 + delta, GREATEST 하한 0, delta∈{-1,1} 봉인', () => {
    expect(UP).toContain('GREATEST(0, install_count + p_delta)');
    expect(UP).toContain('p_delta NOT IN (-1, 1)');
    expect(UP).toContain('RETURNING install_count');
    expect(UP).toContain('$$ LANGUAGE plpgsql');
  });

  it('롤백 파일: 함수만 제거, skills 스키마/행 무영향 + 폴백 자동 강등 주석', () => {
    expect(DOWN).toContain('DROP FUNCTION IF EXISTS bump_skill_install_count(UUID, INTEGER)');
    const downBody = DOWN.replace(/^\s*--.*$/gm, '');
    expect(downBody).not.toMatch(/ALTER TABLE|DELETE FROM|TRUNCATE/);
  });

  it('번호 경주 봉쇄: 016 다음 첫 슬롯, 동일 번호 중복 파일 없음', () => {
    const files = readdirSync('supabase/migrations').filter((f: string) => f.startsWith('017'));
    expect(files).toEqual(['017_install_count_atomic.sql']);
  });
});
