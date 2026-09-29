/**
 * t_2133e4fc — 음성 전사 → user 발화 선(先)방송 계약 (대표님 #324).
 *  handleTr(audio.end/transcript)는 runTextTurn 실행 **이전**에 user 행을 영속하고
 *  transcript.final+message.new(user)를 확정 turn_index/message_id로 선방송한다.
 *  runTextTurn(persistedUser)은 같은 user message_id를 재사용 — 중복 영속·중복 message.new 금지.
 *  답변 실행 실패(run.failed)에도 발화 텍스트와 user message_id는 이미 화면에 확정되어 있다.
 *  (텍스트 REST/WS message.send 경로는 기존 순서 유지 — phase2-contract이 그 계약의 단일 소스.)
 */
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { build, app } from '../../src/index';
import { config } from '../../src/config';
import { signup, createFullStack, bearer } from '../helpers';
import { websocketHandler } from '../../src/websocket/handler';
import { supabaseAdmin } from '../../src/lib/supabase';
import { persistUserUtteranceEarly, runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { __resetIdempotencyProbe, __setIdempotencyColumnMissing, isIdempotencyKnownUnavailable } from '../../src/lib/idempotency';
import { createDevClient, getStore } from '../../src/lib/devstore';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow, MessagesRow } from '../../src/types/db';

let token: string;
let session: any;
const sockets: any[] = [];

beforeAll(async () => {
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(false);
  await build();
  ({ token } = await signup(app));
  ({ session } = await createFullStack(app, token));
});
afterAll(async () => {
  for (const socket of sockets) socket.handlers.close?.();
  vi.restoreAllMocks();
  await app.close();
});
afterEach(() => { vi.restoreAllMocks(); });

async function connect(id?: string) {
  const socket = {
    events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
    send(value: string) { this.events.push(JSON.parse(value)); },
    on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
    terminate: vi.fn(),
  };
  sockets.push(socket);
  const request: any = { query: { session_id: id }, server: app,
    jwtVerify: async () => { request.user = app.jwt.verify(token); } };
  await websocketHandler({ socket }, request);
  return {
    socket,
    send: async (message: unknown) => socket.handlers.message(JSON.stringify(message), false),
    sendBinary: async (buf: Buffer) => socket.handlers.message(buf, true),
  };
}

/** 0.3초 톤 PCM (hasVoiceActivity 통과) — 단위 테스트 봉인(env)에서 mock STT가 MOCK_STT_PHRASE를 반환. */
function toneBuffer(seconds = 0.3): Buffer {
  const samples = new Int16Array(Math.floor(16000 * seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = 12000;
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

/** 선방송 불변식: message.new(user)·transcript.final이 run.started보다 앞서고,
 *  확정 message_id/turn_index를 실으며, run.completed의 user id와 동일하다. */
function assertEarlyBroadcast(events: any[]) {
  const types = events.map(e => e.type);
  const firstMessageNew = types.indexOf('message.new');
  const firstRunStarted = types.indexOf('run.started');
  expect(firstMessageNew).toBeGreaterThanOrEqual(0);
  expect(firstRunStarted).toBeGreaterThan(firstMessageNew);
  const userNew = events[firstMessageNew];
  expect(userNew.message.role).toBe('user');
  expect(userNew.message.content.length).toBeGreaterThan(0);
  const tf = events.find(e => e.type === 'transcript.final');
  expect(tf.message_id).toBe(userNew.message.id);
  expect(tf.turn_index).toBe(userNew.message.turn_index);
  const completed = events.find(e => e.type === 'run.completed');
  expect(completed).toBeTruthy();
  expect(completed.message_ids.user).toBe(userNew.message.id);
  // user message.new는 정확히 1회 (중복 발행 금지 — ingress contract).
  expect(events.filter(e => e.type === 'message.new' && e.message.role === 'user')).toHaveLength(1);
  // 같은 run_id로 직렬 연결 (선방송 message.new = 실행 런).
  expect(userNew.run_id).toBe(events.find(e => e.type === 'run.started').run_id);
}

it('WS transcript(final): user 발화가 run.started보다 먼저 확정 id로 선방송되고 중복 영속 없다', async () => {
  const { socket, send } = await connect(session.id);
  await send({ type: 'subscribe', session_id: session.id });
  await send({ type: 'transcript', session_id: session.id, text: '회의 일정 잡아줘', is_final: true });
  assertEarlyBroadcast(socket.events);
  // user 행 1개만 영속 (runTextTurn 재사용 — 중복 insert 없음).
  const rows = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages`, headers: bearer(token) });
  const users = rows.json().data.filter((m: any) => m.role === 'user' && m.content === '회의 일정 잡아줘');
  expect(users).toHaveLength(1);
  expect(users[0].id).toBe(socket.events.find(e => e.type === 'message.new').message.id);
});

it('WS audio.end(PTT): 전사 확정 → message.new(user) < run.started, transcript.final 확정 message_id', async () => {
  const { socket, send, sendBinary } = await connect(session.id);
  await send({ type: 'subscribe', session_id: session.id });
  await send({ type: 'audio.start', session_id: session.id, config: { mode: 'ptt' } });
  await sendBinary(toneBuffer());
  await send({ type: 'audio.end', session_id: session.id });
  assertEarlyBroadcast(socket.events);
  // 발화 텍스트가 user 행에 남고 message_type=voice + stt_metadata 영속 (구계약 유지).
  const userMsg = socket.events.find(e => e.type === 'message.new').message;
  expect(userMsg.message_type).toBe('voice');
  expect(userMsg.stt_metadata.service).toBe('mock');
  const rows = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages`, headers: bearer(token) });
  expect(rows.json().data.filter((m: any) => m.role === 'user' && m.message_type === 'voice')).toHaveLength(1);
});

it('답변 저장 실패(run.failed)에도 선방송된 user 발화는 유지되고 중복 영속 없다', async () => {
  const { socket, send } = await connect(session.id);
  await send({ type: 'subscribe', session_id: session.id });
  const original = supabaseAdmin.from.bind(supabaseAdmin);
  const spy = vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
    const q: any = original(table);
    if (table === 'messages') {
      const insert = q.insert.bind(q);
      q.insert = (row: any) => row.role === 'agent'
        ? { select: () => ({ single: async () => ({ data: null, error: { message: '저장 실패' } }) }) }
        : insert(row);
    }
    return q;
  });
  try {
    await send({ type: 'transcript', session_id: session.id, text: '오늘 할 일 정리해줘', is_final: true });
  } finally { spy.mockRestore(); }
  const types = socket.events.map(e => e.type);
  const firstMessageNew = types.indexOf('message.new');
  const firstRunStarted = types.indexOf('run.started');
  expect(firstMessageNew).toBeGreaterThanOrEqual(0);
  expect(firstRunStarted).toBeGreaterThan(firstMessageNew);
  expect(socket.events[firstMessageNew].message.role).toBe('user');
  expect(types).toContain('run.failed');
  expect(types.indexOf('run.failed')).toBeGreaterThan(firstRunStarted);
  // 실패 후에도 user 행은 정확히 1개 영속 (중복 없음) — 화면 발화와 동일 id.
  const store = getStore();
  const userRows = store.tables.messages.filter((m: any) => m.role === 'user' && m.session_id === session.id && m.content === '오늘 할 일 정리해줘');
  expect(userRows).toHaveLength(1);
  expect(userRows[0].id).toBe(socket.events[firstMessageNew].message.id);
});

it('선영속 실패(전체 insert 장애)는 구 흐름 폴백 — 013 실패 종료 계약(run.progress→run.failed), message.new 없음', async () => {
  const { socket, send } = await connect(session.id);
  await send({ type: 'subscribe', session_id: session.id });
  const original = supabaseAdmin.from.bind(supabaseAdmin);
  const spy = vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
    const q: any = original(table);
    if (table === 'messages') q.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { message: '저장 실패' } }) }) });
    return q;
  });
  try {
    await send({ type: 'transcript', session_id: session.id, text: '실패 폴백 점검', is_final: true });
  } finally { spy.mockRestore(); }
  // 재베이스 r2 시맨틱 갱신: main의 t_3486b1d7 ⑤가 실패 종개를 user 저장 성공 이후
  // run.started로 이동 — 선영속·본저장 모두 실패하면 run.started 없이 finally의
  // thinking 진행도+run.failed(구 흐름 폴백, phase2-contract 'WS 저장 실패'와 동일 계약).
  expect(socket.events.filter(e => e.type.startsWith('run.')).map(e => e.type)).toEqual(['run.progress', 'run.failed']);
  expect(socket.events.filter(e => e.type === 'message.new')).toHaveLength(0);
});

it('persistUserUtteranceEarly+runTextTurn 단위: 같은 message_id 재사용·번호 인접·user message.new 미발행', async () => {
  const store = getStore();
  const db = createDevClient(store) as unknown as DbClient;
  store.tables.sessions.push({
    id: 'early-unit', user_id: 'early-user', agent_id: 'early-agent', persona_id: null,
    status: 'active', title: '선영속 단위 점검',
  });
  const row = store.tables.sessions.find(s => s.id === 'early-unit') as SessionsRow;
  const events: TurnEmitEvent[] = [];
  const userRow = (await persistUserUtteranceEarly(db, row, row.user_id, '번호 인접 점검', { locale: 'ko' })).row;
  expect(userRow.turn_index).toBe(0);
  const result = await runTextTurn(db, row, row.user_id, '번호 인접 점검', {
    sttMetadata: { service: 'mock' }, turnId: 'fixed-run', persistedUser: userRow,
    emit: e => events.push(e),
  });
  // 같은 user message_id 재사용 — 중복 영속 없음.
  expect(result.userMessageId).toBe(userRow.id);
  expect(store.tables.messages.filter(m => m.role === 'user' && m.session_id === 'early-unit')).toHaveLength(1);
  // runTextTurn은 user message.new를 재발행하지 않는다 (handleTr 선방송 분담).
  expect(events.filter(e => e.type === 'message.new' && (e as any).message?.role === 'user')).toHaveLength(0);
  // 선저장 user(T=0) 뒤 에이전트 번호 인접: 음성 턴은 empathy 생략 → answer = T+1.
  const answer = store.tables.messages.find(m => m.session_id === 'early-unit' && m.source_neuron === 'answer');
  expect(answer!.turn_index).toBe(1);
  // 선방송 run_id와 이후 이벤트 run_id가 일치 (동일 런 연결).
  expect((events.find(e => e.type === 'run.started') as any).run_id).toBe('fixed-run');
});

it('선영속 행은 history에서 배제 — 직전 발화 없음(첫 발화)이면 자기 발화와 repeatUtterance 오탐하지 않는다', async () => {
  const store = getStore();
  const db = createDevClient(store) as unknown as DbClient;
  store.tables.sessions.push({
    id: 'early-unit-2', user_id: 'early-user', agent_id: 'early-agent', persona_id: null,
    status: 'active', title: '배제 점검',
  });
  const row = store.tables.sessions.find(s => s.id === 'early-unit-2') as SessionsRow;
  // 텍스트 턴(음성 아님): 선영속 user 행이 history에 남는다면 이번 발화가 "직전 user 행과 동일"
  // → repeatUtterance 오탐 → empathy 억제. 배제 계약으로 empathy 재질문이 정상 발행된다.
  const userRow = (await persistUserUtteranceEarly(db, row, row.user_id, '처음 말하는 문장', { locale: 'ko' })).row;
  const result = await runTextTurn(db, row, row.user_id, '처음 말하는 문장', {
    persistedUser: userRow, emit: () => undefined,
  });
  expect(result.empathyMessageId).toBeTruthy();
  expect(result.activationPlan.activate).toContain('empathy');
});

// ── 재베이스 r2 봉인 (kimsecretary 리뷰 요구 ②③): 013 멱등 연결 + 롤백 게이트 상호환 ──

/** 헬퍼 — 격리 세션(devstore 전역 스토어). */
function seedSession(id: string, title = '멱등 점검') {
  const store = getStore();
  store.tables.sessions.push({
    id, user_id: 'early-user', agent_id: 'early-agent', persona_id: null,
    status: 'active', title,
  });
  return store.tables.sessions.find(s => s.id === id) as SessionsRow;
}

it('② 선영속 client_req_id 사전 조회: 재전송은 같은 user message_id 재사용(deduped) — insert 0건·중복 영속 없음', async () => {
  const store = getStore();
  const db = createDevClient(store) as unknown as DbClient;
  const row = seedSession('idem-early-1');
  const key = 'early-retry-1';
  const first = await persistUserUtteranceEarly(db, row, row.user_id, '멱등 재전송 점검', { locale: 'ko', clientReqId: key });
  expect(first.deduped).toBe(false);
  const before = store.tables.messages.filter(m => m.session_id === 'idem-early-1' && m.role === 'user').length;
  const again = await persistUserUtteranceEarly(db, row, row.user_id, '멱등 재전송 점검', { locale: 'ko', clientReqId: key });
  expect(again.deduped).toBe(true);
  expect(again.row.id).toBe(first.row.id); // 같은 user message_id — 선방송 id 유지
  expect(store.tables.messages.filter(m => m.session_id === 'idem-early-1' && m.role === 'user')).toHaveLength(before);
  // 013 컬럼 스탬프 확인 (devstore는 013 형상을 기본 null로 제공 — insert 시 값이 실린다).
  expect((again.row as any).client_req_id).toBe(key);
});

it('② 선영속 재전송 레이스(유니크 충돌)는 CONFLICT로 마감 — turn_index 리트라이로 삼키지 않는다', async () => {
  const store = getStore();
  const row = seedSession('idem-early-2');
  const original = supabaseAdmin.from.bind(supabaseAdmin);
  const spy = vi.spyOn(supabaseAdmin, 'from').mockImplementation((table: string) => {
    const q: any = original(table);
    if (table === 'messages') {
      q.insert = () => ({ select: () => ({ single: async () => ({ data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_messages_client_req"' } }) }) });
    }
    return q;
  });
  try {
    await expect(persistUserUtteranceEarly(supabaseAdmin, row, row.user_id, '레이스 점검', { clientReqId: 'race-1' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  } finally { spy.mockRestore(); }
});

it('② MESSAGE_IDEMPOTENCY_DISABLED=true: 선영속은 client_req_id 컬럼을 건드리지 않고 영속 계속(멱등만 off)', async () => {
  const store = getStore();
  const db = createDevClient(store) as unknown as DbClient;
  const row = seedSession('idem-early-3');
  vi.spyOn(config.protocol, 'idempotency', 'get').mockReturnValue(false);
  const first = await persistUserUtteranceEarly(db, row, row.user_id, '플래그 off 발화', { locale: 'ko', clientReqId: 'ignored-1' });
  expect(first.deduped).toBe(false); // 사전 조회 없이 항상 실행 경로 (구동작)
  // 재전송도 dedup 없이 새 행 — 플래그 off는 멱등 기능 전체 무효화 계약 (t_3486b1d7와 동일).
  const again = await persistUserUtteranceEarly(db, row, row.user_id, '플래그 off 발화', { locale: 'ko', clientReqId: 'ignored-1' });
  expect(again.deduped).toBe(false);
  const rows = store.tables.messages.filter(m => m.session_id === 'idem-early-3' && m.role === 'user');
  expect(rows).toHaveLength(2);
  expect((rows[0] as any).client_req_id ?? null).toBeNull(); // 컬럼 미접촉
});

it('② 013 미적용 래치(013 없는 실DB 흉내): 선영속 insert는 컬럼 없이 강등 성공 — 발화 경로 보존', async () => {
  const store = getStore();
  const db = createDevClient(store) as unknown as DbClient;
  const row = seedSession('idem-early-4');
  __setIdempotencyColumnMissing(true);
  try {
    const r = await persistUserUtteranceEarly(db, row, row.user_id, '래치 강등 발화', { locale: 'ko', clientReqId: 'latched-1' });
    expect(r.deduped).toBe(false);
    expect(r.row.content).toBe('래치 강등 발화');
    // 사전 조회도 래치로 null — 재전송이 멱등 없이 동작(기능 only-off, 대화 경로 계속 = t_3486b1d7 관례).
    const again = await persistUserUtteranceEarly(db, row, row.user_id, '래치 강등 발화', { locale: 'ko', clientReqId: 'latched-1' });
    expect(again.deduped).toBe(false);
  } finally {
    __resetIdempotencyProbe();
    expect(isIdempotencyKnownUnavailable()).toBe(false);
  }
});

it('③ USER_CARD_FIRST=false 롤백 게이트에서도 음성 선방송 순서 불변식 유지 (handleTr 선방송 + runTextTurn 재발행 금지)', async () => {
  const store = getStore();
  const db = createDevClient(store) as unknown as DbClient;
  const row = seedSession('gate-cardoff');
  vi.spyOn(config.protocol, 'userCardFirst', 'get').mockReturnValue(false);
  const userRow = (await persistUserUtteranceEarly(db, row, row.user_id, '카드오프 발화', { locale: 'ko' })).row;
  const events: TurnEmitEvent[] = [];
  await runTextTurn(db, row, row.user_id, '카드오프 발화', {
    turnId: 'gate-run', persistedUser: userRow, emit: e => events.push(e),
  });
  // 게이트 off = run.started가 최우선(베이스 1:1)이지만, persistedUser가 있으므로
  // user message.new는 post-loop에서 재발행되지 않는다 — 선방송(handleTr)이 유일한 user 카드.
  expect(events[0].type).toBe('run.started');
  expect(events.filter(e => e.type === 'message.new' && (e as any).message?.role === 'user')).toHaveLength(0);
  // answer/empathy 카드는 정상 발행 + source_message_id 생략(베이스 페이로드 1:1 계약).
  const agentCards = events.filter(e => e.type === 'message.new' && (e as any).message?.role !== 'user');
  expect(agentCards.length).toBeGreaterThan(0);
  for (const c of agentCards) {
    expect((c as any).source_message_id).toBeUndefined();
    expect((c as any).user_message_id).toBeUndefined();
  }
});

it('③ USER_CARD_FIRST=true(기본)에서도 persistedUser 경로는 user 카드를 이중 발행하지 않는다 (onUserCreated 스킵)', async () => {
  const store = getStore();
  const db = createDevClient(store) as unknown as DbClient;
  const row = seedSession('gate-cardon');
  const userRow = (await persistUserUtteranceEarly(db, row, row.user_id, '카드온 발화', { locale: 'ko' })).row;
  const events: TurnEmitEvent[] = [];
  await runTextTurn(db, row, row.user_id, '카드온 발화', {
    turnId: 'gate-run-2', persistedUser: userRow, emit: e => events.push(e),
  });
  // cardFirst ON: onUserCreated 콜백이 id 캡처만 하고 emit을 스킵 → user message.new 0건.
  expect(events.filter(e => e.type === 'message.new' && (e as any).message?.role === 'user')).toHaveLength(0);
  // run.started는 user 저장 후(onRunReady) — handleTr 선방송이 이미 앞에 나갔으므로 순서 계약 성립.
  expect(events.findIndex(e => e.type === 'run.started')).toBeGreaterThanOrEqual(0);
  // empathy/answer 카드는 user_message_id로 이번 선영속 행을 가리킨다 (dedupe 태우기 유지).
  const answerCard = events.find(e => e.type === 'message.new' && (e as any).message?.role !== 'user') as any;
  if (answerCard) expect(answerCard.source_message_id).toBe(userRow.id);
});

it('② WS transcript + client_req_id: 재전송 프레임은 턴을 재실행하지 않고 deduped message.new 1건만', async () => {
  const key = `ws-early-${Date.now()}`;
  const { socket, send } = await connect(session.id);
  await send({ type: 'subscribe', session_id: session.id });
  await send({ type: 'transcript', session_id: session.id, text: 'ws 멱등 재전송', is_final: true, client_req_id: key });
  assertEarlyBroadcast(socket.events);
  const userCardId = socket.events.find(e => e.type === 'message.new').message.id;
  socket.events.length = 0;
  // 재전송: 선영속 사전 조회가 같은 행을 찾음 → 선방송 skip, runTextTurn deduped 경로(이벤트 1건).
  await send({ type: 'transcript', session_id: session.id, text: 'ws 멱등 재전송', is_final: true, client_req_id: key });
  const dedupes = socket.events.filter(e => e.type === 'message.new' && e.deduped);
  expect(dedupes).toHaveLength(1);
  expect(dedupes[0].message.id).toBe(userCardId);
  expect(socket.events.filter(e => e.type.startsWith('run.'))).toHaveLength(0);
  expect(socket.events.filter(e => e.type === 'transcript.final')).toHaveLength(0);
  const rows = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages`, headers: bearer(token) });
  expect(rows.json().data.filter((m: any) => m.role === 'user' && m.content === 'ws 멱등 재전송')).toHaveLength(1);
});
