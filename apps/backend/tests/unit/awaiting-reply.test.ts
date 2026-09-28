/**
 * t_811e176c 답변 대기 — 판정 규칙 · 감지 영속/이벤트 · 발화 해소 · GET /pending · 011 래치.
 * (대표님 9/28 09:07: "사용자가 답변해야할걸 따로 지정해서 예/아니오 답변 혹은 주관식 답변으로")
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, afterAll } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, textTurnResponse, TurnEmitEvent } from '../../src/lib/chatTurn';
import {
  detectReplyRequest, replyPendingSnapshot, resolvePendingReplies,
  replyRequestColumns, isMissingReplyColumns,
  __setAwaitingReplyColumnMissing, __resetAwaitingReplyProbe,
} from '../../src/lib/awaitingReply';
import { DbClient, getStore } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';
import { authedApp, bearer, closeTestApp, createFullStack, signup } from '../helpers';

const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  __resetAwaitingReplyProbe();
  store = createStore();
  store.tables.sessions.push({ ...session });
  store.tables.personas.push({ id: 'persona', tone_config: {} });
  db = createDevClient(store) as DbClient;
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); __resetAwaitingReplyProbe(); });

/** DEV 봉인 환경에서 스트림 답변만 모크 (후속 질문/분류 LLM은 env에서 꺼짐 — 관례 동일). */
function streamFetch(answer: string) {
  return vi.fn(async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    if (body.stream) {
      return new Response(`data: {"model":"test-model","choices":[{"delta":{"content":${JSON.stringify(answer)}}}]}\n\ndata: [DONE]\n`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  });
}

describe('판정 규칙 (LLM 0회, 오탐 우선 차단)', () => {
  it('예/아니오 확정 요구 → yesno', () => {
    expect(detectReplyRequest('정리 끝났어. 바로 발송할까요?')).toMatchObject({ kind: 'yesno' });
    expect(detectReplyRequest('이대로 진행해도 괜찮을까요?')).toMatchObject({ kind: 'yesno' });
    expect(detectReplyRequest('Draft is ready. Should I send it now?')).toMatchObject({ kind: 'yesno' });
  });

  it('주관식 정보·선택 요구 → freeform', () => {
    expect(detectReplyRequest('먼저 몇 가지를 확인할게.\n마감일은 언제인가요?')).toMatchObject({ kind: 'freeform' });
    expect(detectReplyRequest('Which budget option do you prefer?')).toMatchObject({ kind: 'freeform' });
    // live LLM 답변에서 실제로 관측된 존칭 정보 요구 종결 — 스모크 프로브 회고(t_811e176c).
    expect(detectReplyRequest('혹시 특정 마감 기한이 있는 건가요?')).toMatchObject({ kind: 'freeform', excerpt: '혹시 특정 마감 기한이 있는 건가요?' });
  });

  it('둘 다 → both, 발췌는 결정 요구 문장', () => {
    const r = detectReplyRequest('개편 내용을 정리했어.\nA안과 B안 중 어느 쪽을 원해?\n바로 진행할까?');
    expect(r?.kind).toBe('both');
    expect(r?.excerpt).toContain('진행할까');
  });

  it('평서형 상투마감·수사는 미감지 (대표님 9/28 불만 — 무의미 노이즈 금지)', () => {
    expect(detectReplyRequest('네, 요청에 대해 정리해드렸어요.\n- 핵심 요약: 확인했습니다.\n- 필요한 정보: 구체적인 목표와 마감 일정을 알려주시면 더 정확하게 준비할게요.\n더 필요한 부분이 있으면 말씀해주세요!')).toBeNull();
    expect(detectReplyRequest('I have reviewed "reboot". Please share your specific goals and deadline so I can help further.')).toBeNull();
    expect(detectReplyRequest('안녕! 오늘도 좋은 하루 보내.')).toBeNull();
  });

  it('중간 문장만 의문형(과거 서술)이고 마지막이 평서면 미감지', () => {
    expect(detectReplyRequest('예전에 궁금했던 걸 정리했어.\n참고만 하면 돼.\n추가 설명은 여기까지고, 결과 표는 아래에 붙였어.\n오늘은 여기까지 정리할게요.')).toBeNull();
  });

  it('null/공백 입력 안전', () => {
    expect(detectReplyRequest('')).toBeNull();
  });
});

describe('감지 영속·이벤트·해소 (runTextTurn 공유 경로)', () => {
  it('질의 포함 답변 → awaiting_reply=true·reply_request 페이로드·스냅샷 이벤트(count 1)', async () => {
    vi.stubGlobal('fetch', streamFetch('서류 3부를 준비했어.\n우선 계약서부터 보낼까요?'));
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '계약 서류 준비해줘', { locale: 'ko', emit: e => events.push(e) });

    const answerRow = store.tables.messages.find(m => m.source_neuron === 'answer');
    expect(answerRow?.awaiting_reply).toBe(true);
    expect(answerRow?.reply_kind).toBe('yesno');
    expect((answerRow?.structured_payload as any).reply_request).toMatchObject({ kind: 'yesno' });
    // 제안(suggested_questions)과 회신 필요(reply_request)는 별개 필드 — 혼동 금지 계약.
    expect((textTurnResponse(result) as any).reply_request).toMatchObject({ kind: 'yesno', excerpt: expect.any(String) });
    const pending = events.filter(e => e.type === 'reply.pending.updated') as any[];
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ session_id: 'session', count: 1 });
    expect(pending[0].items[0]).toMatchObject({ message_id: answerRow?.id, reply_kind: 'yesno', turn_index: expect.any(Number), excerpt: expect.any(String) });
    // run.completed는 마지막 이벤트 유지 (기존 계약 보존 — 스냅샷은 그 직전).
    expect(events.at(-1)!.type).toBe('run.completed');
    const snap = await replyPendingSnapshot(db, 'session');
    expect(snap).toMatchObject({ count: 1 });
  });

  it('사용자 회신 발화 → 이전 대기 해소 + 스냅샷 count 0', async () => {
    vi.stubGlobal('fetch', streamFetch('우선 진행할까요?'));
    await runTextTurn(db, session, 'user', '준비해줘', { locale: 'ko', emit: () => undefined });
    expect(store.tables.messages.find(m => m.source_neuron === 'answer')?.awaiting_reply).toBe(true);

    // 회신 턴의 답변은 평서형이어야 해소 확인이 순수하다 (t_135a19b5 예/아니오 게이트:
    // 순수 확인 발화도 답변을 강제 생성 — 새 답변이 회신을 요구하면 대기가 재산된다).
    vi.stubGlobal('fetch', streamFetch('네, 진행했어요.'));
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session, 'user', '예', { locale: 'ko', emit: e => events.push(e) });
    expect(store.tables.messages.find(m => m.source_neuron === 'answer')?.awaiting_reply).toBe(false);
    const pending = events.filter(e => e.type === 'reply.pending.updated') as any[];
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ count: 0, items: [] });
    // 이번 턴 답변은 평서 폴백(미감지) → 대기 재산 없음. 발화 자체가 해소 신호.
    expect(await replyPendingSnapshot(db, 'session')).toMatchObject({ count: 0 });
  });

  it('전이가 없는 평범한 턴은 reply.pending.updated 노이즈 없음', async () => {
    vi.stubGlobal('fetch', streamFetch('단순 정보 답변이야. 도움 필요하면 또 불러!'));
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session, 'user', '안녕', { locale: 'ko', emit: e => events.push(e) });
    expect(events.filter(e => e.type === 'reply.pending.updated')).toHaveLength(0);
  });
});

describe('011 미적용 래치 (008 관례)', () => {
  it('PGRST204/42703 감지', () => {
    expect(isMissingReplyColumns({ code: 'PGRST204' })).toBe(true);
    expect(isMissingReplyColumns({ code: '42703' })).toBe(true);
    expect(isMissingReplyColumns({ message: 'column messages.awaiting_reply does not exist' })).toBe(true);
    expect(isMissingReplyColumns({ code: '23514', message: 'check constraint violation' })).toBe(false);
  });

  it('래치(on): 컬럼 생략·스냅샷 null·해소 no-op — 대화 경로 무영향', async () => {
    __setAwaitingReplyColumnMissing(true);
    expect(replyRequestColumns({ kind: 'yesno', excerpt: 'x' })).toEqual({});
    expect(await resolvePendingReplies(db, 'session')).toBe(0);
    expect(await replyPendingSnapshot(db, 'session')).toBeNull();

    vi.stubGlobal('fetch', streamFetch('진행할까요?'));
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '해줘', { locale: 'ko', emit: e => events.push(e) });
    expect(result.answerMessageId).toBeTruthy();
    // 래치(on) = 컬럼 생략 insert — devstore 기본값 false(실DB DEFAULT false와 동일)를 초과해
    // true가 되지 않는 것이 계약. 감지 문장('해줘'는 미감지)이라도 강등 확인은 충분하다.
    expect(store.tables.messages.find(m => m.source_neuron === 'answer')?.awaiting_reply).toBe(false);
    expect(events.filter(e => e.type === 'reply.pending.updated')).toHaveLength(0);
  });
});

describe('GET /api/sessions/:id/pending (REST 폴백)', () => {
  // helpers 앱은 모듈 싱글턴 — 파일당 1회 빌트인 (favorites.test 관례).
  let app: Awaited<ReturnType<typeof authedApp>>['app'];
  let token: string;
  beforeAll(async () => {
    const ctx = await authedApp(`pending-${Date.now()}@test.io`);
    app = ctx.app;
    token = ctx.token;
  });
  afterAll(async () => { await closeTestApp(app); });

  it('대기 1행 → {count, items} read-back', async () => {
    const { session: sess } = await createFullStack(app, token);
    // 대기 행을 직접 적재 (devstore는 insert 기본값 없음 → awaiting_reply 명시).
    storePush(sess.id);
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${sess.id}/pending`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ count: 1, items: [{ reply_kind: 'yesno', excerpt: expect.any(String) }] });
    expect(res.json().meta.total).toBe(1);
  });

  it('미인증 401 / 타인 세션 접근 거부', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/sessions/whatever/pending' });
    expect(anon.statusCode).toBe(401);
    // 같은 앱에서 두 번째 사용자.
    const other = await signup(app, `pending3-${Date.now()}@test.io`);
    const mine = await app.inject({ method: 'POST', url: '/api/agents', headers: bearer(other.token), payload: { name: 'a', agent_type: 'shadow' } });
    const foreign = await app.inject({ method: 'GET', url: `/api/sessions/${mine.json().data.id}/pending`, headers: bearer(token) });
    expect([403, 404]).toContain(foreign.statusCode);
  });
});

function storePush(sessionId: string) {
  // helpers.authedApp이 만든 앱과 같은 devstore 인스턴스 (resetStore 후 모듈 싱글턴).
  getStore().tables.messages.push({
    id: 'pending-msg-1', session_id: sessionId, turn_index: 3, role: 'agent', locale: 'ko',
    ai_generated: true, message_type: 'text', content: '정리했어. 이대로 발송할까요?',
    dialogue_type: 'text', structured_payload: {}, stt_metadata: null, source_neuron: 'answer',
    attachments: [], persona_guard: {}, user_feedback: null, favorite: false,
    awaiting_reply: true, reply_kind: 'yesno', created_at: new Date().toISOString(),
  });
}
