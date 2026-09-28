/**
 * t_344e047a 3계약 (대표님 9/28, ①정정 코멘트 #187 반영):
 *  ① 공감 뉴런 생성 유지 + 화면 노출은 짧은 확인음(ack) + answer 첫 토큰 전 리드 지연(config)
 *  ② 질문 큐: message_queue 적재/체크포인트/드레인 순차 답변/상한/아카이브 마감
 *  ③ 시그니티드 질문: answer 후 LLM 1회 생성, structured_payload.suggested_questions, 실패 시 조용한 생략
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { drainSessionQueue, runTextTurn, textTurnResponse, TurnEmitEvent } from '../../src/lib/chatTurn';
import { QUIPS } from '../../src/lib/locale';
import {
  enqueueQuestion, listQueue, markQueueStatus, queueSnapshot, skipAllPending,
} from '../../src/lib/questionQueue';
import { parseSuggestedQuestions } from '../../src/lib/suggestedQuestions';
import { EMPATHY_REQUESTION_TEMPLATES } from '../../src/neurons/graph';
import { DbClient, getStore as getStoreRef } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  store.tables.sessions.push({ ...session });
  // runTextTurn/processTurn은 personas 로드 후 진행 — phase2.test와 동일한 최소 셋업.
  store.tables.personas.push({ id: 'persona', tone_config: {} });
  db = createDevClient(store) as DbClient;
  // 단위 테스트는 기본 봉인(LEAD=0/SUGGEST off) — 필요한 테스트만 getter 스파이로 켠다.
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 스트림(답변)과 비스트림(후속 질문)을 구분하는 fetch 모크. */
function llmFetch(suggestions?: string[]) {
  return vi.fn(async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    if (body.stream) {
      return new Response('data: {"model":"test-model","choices":[{"delta":{"content":"답변 본문"}}]}\n\ndata: [DONE]\n');
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: suggestions
        ? JSON.stringify({ questions: suggestions })
        : 'JSON 아님 — 파싱 실패' } }],
    }));
  });
}

describe('① 공감 재질문 + 답변 리드 지연 (t_44f8896c: 복창→재질문, t_135a19b5 게이트 유지)', () => {
  it('공감 행 content = 재질문 문장, 복창 원문은 empathy_full·재질문은 empathy_question·template_id 저장', async () => {
    vi.stubGlobal('fetch', llmFetch());
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '왜 그런가요?', { locale: 'ko', emit: e => events.push(e) });

    const empathyRow = store.tables.messages.find(m => m.source_neuron === 'empathy');
    // t_44f8896c (대표님 9/28): 화면 노출(content)은 복창이 아닌 '이거 맞냐' 재질문.
    const payload = empathyRow?.structured_payload as any;
    expect(EMPATHY_REQUESTION_TEMPLATES.some(t => t.ko.includes('{요약}'))).toBe(true);
    expect(payload.template_id).toBeTruthy();
    expect(payload.empathy_question).toBe(empathyRow?.content);
    // 복창 원문(에코 문장)은 empathy_full로 보존 — 폐기 아니다.
    expect(payload.empathy_full).toContain('왜 그런가요?');
    expect(empathyRow?.content).not.toBe(payload.empathy_full);
    expect(empathyRow?.content).toContain('왜 그런가요'); // {요약}에 발화 키워드 주입
    expect(empathyRow?.content).not.toBe(QUIPS.ack.warm.ko);
    // 분류(yes/no 수준 짧은 확인음)는 structured_payload.empathy_ack에 유지.
    expect(payload.empathy_ack).toBe(QUIPS.ack.warm.ko);
    // 호환: empathy message_id는 계속 발행된다.
    expect(result.empathyMessageId).toBeTruthy();
    expect(result.empathyResponse).toBe(empathyRow?.content); // 계약 필드 = 화면 노출값(재질문)
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', message_ids: { empathy: result.empathyMessageId } });
    // 메시지 이벤트의 공감 content도 재질문과 동일.
    const empathyMsg = events.find(e => e.type === 'message.new' && (e as any).message.source_neuron === 'empathy') as any;
    expect(empathyMsg.message.content).toBe(empathyRow?.content);
  });

  it('회전 시드: 같은 세션 연속 턴에서 template_id 재사용 금지 (t_44f8896c)', async () => {
    vi.stubGlobal('fetch', llmFetch());
    const r1 = await runTextTurn(db, session, 'user', '매출 리포트 정리해줘', { emit: () => undefined });
    const r2 = await runTextTurn(db, session, 'user', '거듭제곱 계산 알려줘', { emit: () => undefined });
    const rows = store.tables.messages.filter(m => m.source_neuron === 'empathy');
    expect(rows.length).toBe(2);
    const [p1, p2] = rows.map(m => (m.structured_payload as any).template_id);
    expect(p1).not.toBe(p2); // 직전 템플릿 연속 재사용 금지
    expect(EMPATHY_REQUESTION_TEMPLATES.map(t => t.id)).toContain(p2);
    // 재질문 문장도 서로 달라야 한다 (다채롭게).
    expect(r1.empathyResponse).not.toBe(r2.empathyResponse);
  });

  it('예/아니오 게이트: 직전 empathy 행 뒤 짧은 확인 발화에는 공감 행을 만들지 않는다 (중복 에코 방지)', async () => {
    vi.stubGlobal('fetch', llmFetch());
    await runTextTurn(db, session, 'user', '왜 그런가요?', { emit: () => undefined });
    const before = store.tables.messages.filter(m => m.source_neuron === 'empathy').length;
    expect(before).toBe(1);
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '예', { emit: e => events.push(e) });
    // 공감 행 미생성 + empathy message_id는 null, 답변은 직결(침묵 금지).
    expect(store.tables.messages.filter(m => m.source_neuron === 'empathy').length).toBe(before);
    expect(result.empathyMessageId).toBeNull();
    expect(result.empathyResponse).toBeNull();
    expect(result.answerMessageId).toBeTruthy();
    expect(result.activationPlan.reason).toContain('confirm_gate=answer_forced');
    expect(events.at(-1)).toMatchObject({ type: 'run.completed', message_ids: { empathy: null } });
    // '아니요' 변형도 동일 게이트.
    const r2 = await runTextTurn(db, session, 'user', '아니요', { emit: () => undefined });
    expect(r2.empathyMessageId).toBeNull();
    expect(r2.answerMessageId).toBeTruthy();
  });

  it('게이트 비적용: 확인 발화라도 직전 턴에 empathy 행이 없으면 복창 정상 생성', async () => {
    vi.stubGlobal('fetch', llmFetch());
    const result = await runTextTurn(db, session, 'user', '네', { emit: () => undefined });
    expect(result.empathyMessageId).toBeTruthy();
    expect(result.empathyResponse).toContain('네');
  });

  it('접수 직후 run.progress 확인음(ack)이 나간다 (stage는 계약 코드 thinking)', async () => {
    vi.stubGlobal('fetch', llmFetch());
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session, 'user', '왜 그런가요?', { locale: 'ko', emit: e => events.push(e) });
    const progress = events.filter(e => e.type === 'run.progress') as any[];
    expect(progress[0].stage).toBe('thinking');
    expect(progress[0].quip).toBe(QUIPS.ack.warm.ko);
  });

  it('answer 첫 토큰 전 answerLeadMs만큼 대기한다 (config.answerLeadMs)', async () => {
    vi.stubGlobal('fetch', llmFetch());
    vi.spyOn(config, 'answerLeadMs', 'get').mockReturnValue(120);
    const t0 = Date.now();
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session, 'user', '왜 그런가요?', { emit: e => events.push(e) });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    // 지연 구간에도 run.started는 이미 나가 있었다 — quip이 도는 체감 공백.
    expect(events[0].type).toBe('run.started');
  });

  it('answerLeadMs=0이면 지연 없이 바로 답변 (테스트 기본 봉인 상태)', async () => {
    expect(config.answerLeadMs).toBe(0); // vitest env ANSWER_LEAD_MS=0
    vi.stubGlobal('fetch', llmFetch());
    const t0 = Date.now();
    await runTextTurn(db, session, 'user', '왜 그런가요?', { emit: () => undefined });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('② 질문 큐', () => {
  it('적재: position 승순·pending, 스냅샷은 language중립 status 코드', async () => {
    const a = await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: '첫 질문', locale: 'ko' });
    const b = await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: '둘째 질문', locale: 'ko' });
    expect(a).toMatchObject({ position: 0, status: 'pending' });
    expect(b).toMatchObject({ position: 1, status: 'pending' });
    const snap = queueSnapshot(await listQueue(db, 'session'));
    expect(snap).toMatchObject({ pending_count: 2, items: [{ position: 0 }, { position: 1 }] });
    expect(snap.items[0]).not.toHaveProperty('answered_message_id');
  });

  it('대기 상한 초과 시 null (호출부 RATE_LIMIT_EXCEEDED 신호)', async () => {
    vi.spyOn(config.questionQueue, 'maxPending', 'get').mockReturnValue(2);
    expect(await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: 'q1', locale: 'ko' })).toBeTruthy();
    expect(await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: 'q2', locale: 'ko' })).toBeTruthy();
    expect(await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: 'q3', locale: 'ko' })).toBeNull();
  });

  it('드레인 워커: pending을 position 순서로 순차 답변하고 answered + queue.updated 발행', async () => {
    vi.stubGlobal('fetch', llmFetch());
    await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: '첫 질문', locale: 'ko' });
    await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: '둘째 질문', locale: 'ko' });
    const events: TurnEmitEvent[] = [];
    await drainSessionQueue(db, 'session', 'user', e => events.push(e));

    const rows = await listQueue(db, 'session');
    expect(rows.map(r => r.status)).toEqual(['answered', 'answered']);
    // 답변 메시지 2세트(user+empathy+answer ×2)가 큐가 아닌 messages에 남는다 — 유실 없음.
    expect(store.tables.messages.filter(m => m.role === 'user')).toHaveLength(2);
    const updates = events.filter(e => e.type === 'queue.updated') as any[];
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.at(-1).items.map((i: any) => i.status)).toEqual(['answered', 'answered']);
    expect(updates.at(-1).pending_count).toBe(0);
  });

  it('드레인 실패는 skipped 체크포인트 — 대답 안 한 것이 보인다 (유실과 구분)', async () => {
    vi.stubGlobal('fetch', llmFetch());
    await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: '실패 질문', locale: 'ko' });
    // 사용자 메시지 저장을 폭파해 턴을 실패시킨다 (phase2.test 스파이 관례).
    const original = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((table: string) => {
      const q = original(table);
      if (table === 'messages') {
        const insert = q.insert.bind(q);
        q.insert = (row: any) => row.role === 'user'
          ? { select: () => ({ single: async () => ({ data: null, error: { message: '저장 실패' } }) }) }
          : insert(row);
      }
      return q;
    });
    const events: TurnEmitEvent[] = [];
    await drainSessionQueue(db, 'session', 'user', e => events.push(e));
    expect((await listQueue(db, 'session'))[0].status).toBe('skipped');
    expect((events.at(-1) as any).items[0].status).toBe('skipped');
  });

  it('skipAllPending: 미처리 pending을 skipped로 마감 (아카이브/유실 정리)', async () => {
    const q1 = await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: '남은 질문', locale: 'ko' });
    await markQueueStatus(db, (await enqueueQuestion(db, { sessionId: 'session', userId: 'user', content: '답한 질문', locale: 'ko' }))!.id, 'answered');
    await skipAllPending(db, 'session');
    const rows = await listQueue(db, 'session');
    expect(rows.find(r => r.id === q1!.id)!.status).toBe('skipped');
    expect(rows.filter(r => r.status === 'answered')).toHaveLength(1);
  });

  it('WS/REST 배선 정적 프루브 — 실행 중 끼어들기 판별·체크포인트 라우트 존재', async () => {
    const fs = await import('node:fs');
    const ws = fs.readFileSync('src/websocket/handler.ts', 'utf8');
    expect(ws).toContain('hasActiveRun(session!.id)');
    expect(ws).toContain("type: 'queue.updated'");
    const rest = fs.readFileSync('src/routes/sessions.ts', 'utf8');
    expect(rest).toContain("app.get('/:id/queue'");
    expect(rest).toContain('hasActiveRun(session.id)');
    const proto = fs.readFileSync('src/websocket/protocol.ts', 'utf8');
    expect(proto).toContain('queue.updated');
    const evlog = fs.readFileSync('src/websocket/eventlog.ts', 'utf8');
    expect(evlog).toContain("'queue.updated'"); // 재접속 last_seq 재생 대상
  });

  it('GET /api/sessions/:id/queue — data는 행 배열(프론트 normalizeQueueItems), 없는 세션 404', async () => {
    const { createTestApp, closeTestApp, signup, bearer, createFullStack } = await import('../helpers');
    const app = await createTestApp(); // resetStore로 앱·getStore 동일 싱글턴
    const { token, userId } = await signup(app, 'qa@test.io');
    const { session } = await createFullStack(app, token);
    const appDb = createDevClient(getStoreRef()) as unknown as DbClient;
    await enqueueQuestion(appDb, { sessionId: session.id, userId, content: '체크', locale: 'ko' });
    const r = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/queue`, headers: bearer(token) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]).toMatchObject({ content: '체크', status: 'pending', position: 0 });
    expect(body.meta.total).toBe(1);
    const rb = await app.inject({ method: 'GET', url: '/api/sessions/no-such/queue', headers: bearer(token) });
    expect(rb.statusCode).toBe(404);
    await closeTestApp(app);
  });
});

describe('③ 시그니티드 질문', () => {
  it('생성 성공: structured_payload.suggested_questions 저장 + run.completed/REST 응답 첨부', async () => {
    vi.spyOn(config.suggestedQuestions, 'enabled', 'get').mockReturnValue(true);
    const questions = ['연봉 차이는 얼마인가요?', '계약서 양식이 있나요?', '실업 급여는?'];
    vi.stubGlobal('fetch', llmFetch(questions));
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '왜 그런가요?', { locale: 'ko', emit: e => events.push(e) });

    expect(result.suggestedQuestions).toHaveLength(3);
    expect(result.suggestedQuestions.every(q => q.id && q.text && q.locale === 'ko')).toBe(true);
    // answer 행에 영속화 (프론트 재조회 계약).
    const answerRow = store.tables.messages.find(m => m.source_neuron === 'answer');
    expect((answerRow?.structured_payload as any).suggested_questions).toHaveLength(3);
    expect((events.at(-1) as any).structured.structured_payload.suggested_questions).toHaveLength(3);
    expect((textTurnResponse(result) as any).suggested_questions).toHaveLength(3);
    // LLM 호출 2회: 답변 스트림 + 질문 생성 1회.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('실패(파싱 불가)는 조용히 생략 — 사용자 체감 0, 턴은 성공', async () => {
    vi.spyOn(config.suggestedQuestions, 'enabled', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', llmFetch()); // 비스트림 응답이 garbage
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '왜 그런가요?', { locale: 'ko', emit: e => events.push(e) });
    expect(result.suggestedQuestions).toEqual([]);
    expect((events.at(-1) as any).type).toBe('run.completed');
    expect((events.at(-1) as any).structured.structured_payload.suggested_questions).toBeUndefined();
  });

  it('볼트 노트·선호가 컨텍스트로 주입된다 (생성 프롬프트에 노트 제목 포함)', async () => {
    vi.spyOn(config.suggestedQuestions, 'enabled', 'get').mockReturnValue(true);
    store.tables.vault_notes.push({ id: 'n1', user_id: 'user', title: '해지 위약금 정리', content: 'x', folder: '/', tags: [], updated_at: new Date().toISOString() });
    store.tables.users.push({ id: 'user', preferences: { interests: ['노동법'] } });
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      if (body.stream) return new Response('data: {"model":"m","choices":[{"delta":{"content":"답변"}}]}\n\ndata: [DONE]\n');
      seen.push(body.messages[body.messages.length - 1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"questions":["위약금은?","소송은?"]}' } }] }));
    }));
    const result = await runTextTurn(db, session, 'user', '왜 그런가요?', { emit: () => undefined });
    expect(result.suggestedQuestions).toHaveLength(2);
    expect(seen[0]).toContain('해지 위약금 정리');
    expect(seen[0]).toContain('노동법');
  });

  it('parseSuggestedQuestions 방어: 2개 미만 null, 4개면 3개 캡, fenced/배열 형태 허용', () => {
    expect(parseSuggestedQuestions('{"questions":["첫 질문?","둘 질문?"]}', 'ko')).toHaveLength(2);
    expect(parseSuggestedQuestions('```json\n{"questions":["a1?","b2?","c3?","d4?"]}\n```', 'ko')).toHaveLength(3);
    expect(parseSuggestedQuestions('["a1?","b2?"]', 'en')).toHaveLength(2);
    expect(parseSuggestedQuestions('{"questions":["a1?"]}', 'ko')).toBeNull();
    expect(parseSuggestedQuestions('garbage', 'ko')).toBeNull();
    expect(parseSuggestedQuestions('{"questions":["", "  ", "b"]}', 'ko')).toBeNull();
  });
});
