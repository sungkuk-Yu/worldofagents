/**
 * t_dd43affd (t_baee5c42 후속 — 유실분 대체, t_64069bb8 계승) — 답변 영속·맥락 배선 회귀 봉인.
 * 백엔드 코드 무변경(테스트만). 대표님 계약 판정 중 ①②의 리포지토리 회귀망:
 *  ① 후속질문 맥락 배선 (단위 모크): 2턴 — '친구 이름 성국~생일 축하 추천' → '근데 내 친구
 *    이름이 뭐였지?' → 두 번째 답변 LLM 요청 messages가 [system, user(T1), assistant(T1답변),
 *    user(T2)] 형식으로 T1 발화(성국)를 history 주입해야 한다 (answerableHistory의 empathy
 *    배제 포함 봉인). 라이브 실측 미러는 tests/live_ctx_wiring_1010.mjs.
 *  ② run 도중 끼어든 발화 유실 금지 (WS 실배선 unit): 실행 중 두 번째 message.send →
 *    queue.updated(pending) 적재(messages 무중복) → T1 answer.done/message.new 영속 →
 *    드레인이 T2 순차 답변 → REST read-back user·answer 각 2행 → 재접속 subscribe
 *    last_seq=0 리플레이에 양 턴의 answer.done/message.new가 원래 seq 순으로 복원.
 *    (t_74792ee1·t_4c12323c의 live_* 하네스는 운영 창 전용 — 이 unit이 CI 회귀망.)
 *  ③ thinking 파라미터 계약은 two-speed.test.ts ⑤ 3건 봉인 — 본 파일은 참조만, 중복 금지 (카드 3항).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';
import { websocketHandler } from '../../src/websocket/handler';
import { replaySince } from '../../src/websocket/eventlog';
import { bearer, closeTestApp, createFullStack, createTestApp, signup, type TestApp } from '../helpers';

const sessionRow = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
const T1 = '내 친구 이름이 성국이는데 오늘 생일이야. 뭐라고 축하 메시지 보낼지 추천해줘';
const T2 = '근데 내 친구 이름이 뭐였지?';

beforeEach(() => {
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('① 후속질문 맥락 배선 — 2턴 LLM 요청 history 주입 봉인 (t_dd43affd①)', () => {
  it('T2 답변 요청 messages에 T1 발화(성국)가 user 히스토리로, T1 답변이 assistant로 주입된다', async () => {
    const store = createStore();
    store.tables.sessions.push({ ...sessionRow });
    store.tables.personas.push({ id: 'persona', tone_config: {} });
    store.tables.agents.push({ id: 'agent', name: '맥락비서', owner_id: 'user', category: 'general', config: {} });
    const db = createDevClient(store) as DbClient;
    // 답변 스트림/비스트림을 구분하는 fetch 모크 — 요청 messages 전체 수집.
    // 턴마다 다른 답변 텍스트: anti-echo 재생성(80%+ 유사)이 끼면 마지막 호출이 재생성이
    // 되어 관측 지점이 흔들린다 — 짧고 서로 다른 문장으로 결정화 (prevAnswer ≤20자 요건도 겸함).
    const calls: Array<{ stream: boolean; messages: Array<{ role: string; content: string }> }> = [];
    let answerSeq = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ stream: Boolean(body.stream), messages: body.messages });
      if (body.stream) {
        return new Response(`data: {"choices":[{"delta":{"content":"답변-${++answerSeq}입니다"}}]}\n\ndata: [DONE]\n`);
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'JSON 아님' } }] }));
    }));

    await runTextTurn(db, sessionRow, 'user', T1, { emit: () => undefined });
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, sessionRow, 'user', T2, { emit: e => events.push(e) });

    const t2Answer = calls.filter(c => c.stream).at(-1)!;
    expect(t2Answer).toBeTruthy();
    // 형식 봉인: [system, user(T1), assistant(T1 답변), user(T2)] — 공감 재질문 행은
    // answerableHistory가 배제(t_c31e3f45 A)하므로 4행 정확히.
    expect(t2Answer.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(t2Answer.messages[1].content).toContain('성국'); // T1 발화 = 라이브 프로브 must-assert('성국' 참조)의 근거
    expect(t2Answer.messages[2].content).toContain('답변-1'); // T1 답변이 assistant 히스토리로 이어진다
    expect(t2Answer.messages[3].content).toBe(T2);
    // 유실 금지의 단위 앵커: 턴 자체가 answer.done 발행 + answer 행 영속.
    expect(events.some(e => e.type === 'answer.done')).toBe(true);
    expect(store.tables.messages.some(m => m.role === 'agent' && m.source_neuron === 'answer')).toBe(true);
  });
});

describe('② run 도중 끼어든 발화 유실 금지 — WS 큐 적재·영속·재접속 리플레이 (t_dd43affd②)', () => {
  let app: TestApp;
  let token: string;
  let session: any;
  const sockets: any[] = [];

  beforeEach(async () => {
    app = await createTestApp(); // resetStore + build (helpers 관례)
    ({ token } = await signup(app, 'ctxpers@test.io'));
    ({ session } = await createFullStack(app, token));
  });
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.handlers.close?.();
    await closeTestApp(app);
  });

  /** ws-contract 관례: 실 소켓 없이 plain object로 websocketHandler 구동. */
  async function connect(headerToken?: string) {
    const socket = {
      events: [] as any[], handlers: {} as Record<string, (...args: any[]) => any>,
      send(value: string) { this.events.push(JSON.parse(value)); },
      on(event: string, fn: (...args: any[]) => any) { this.handlers[event] = fn; },
      terminate: vi.fn(),
    };
    sockets.push(socket);
    const request: any = { query: {}, server: app, jwtVerify: async () => {
      if (!headerToken) throw new Error('헤더 없음');
      request.user = app.jwt.verify(headerToken);
    } };
    await websocketHandler({ socket }, request);
    return { socket, send: (message: unknown) => socket.handlers.message(JSON.stringify(message), false) };
  }

  /** 답변 스트림을 수동 제어 — T1 실행 '도중' 끼어듦을 결정적으로 재현한다 (ws-contract 취소 테스트 관례). */
  function heldStreams() {
    const streams: Array<{ push: (t: string) => void; end: () => void }> = [];
    vi.stubGlobal('fetch', vi.fn(() => {
      const enc = new TextEncoder();
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          streams.push({
            push: t => controller.enqueue(enc.encode(`data: {"choices":[{"delta":{"content":"${t}"}}]}\n\n`)),
            end: () => { controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close(); },
          });
        },
      })));
    }));
    return streams;
  }

  it('실행 중 message.send → queue.updated(pending) → T1 영속 → 드레인 T2 → 재접속 리플레이', async () => {
    const streams = heldStreams();
    const c1 = await connect(token);
    const p1 = c1.send({ type: 'message.send', session_id: session.id, content: T1 });
    await vi.waitFor(() => expect(c1.socket.events.some(e => e.type === 'run.started')).toBe(true));

    // ── run 도중 두 번째 발화 (다른 탭 = 새 소켓 관례, SLA 프로브와 동일 세션 허브) ──
    const c2 = await connect(token);
    await c2.send({ type: 'message.send', session_id: session.id, content: T2 });
    const snap = c1.socket.events.filter(e => e.type === 'queue.updated').at(-1) as any;
    expect(snap).toBeTruthy();
    expect(snap).toMatchObject({ pending_count: 1, items: [{ content: T2, status: 'pending' }] });
    // 유실 금지 1차: 큐에 적재됐고(messages에는 아직 T2 user 행이 없다 — 중복 실행 없음).
    const mid = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages`, headers: bearer(token) });
    expect(mid.json().data.filter((m: any) => m.role === 'user' && m.content === T2)).toHaveLength(0);

    // ── T1 마감: answer.done/message.new 영속 후 완료 체인이 드레인으로 T2를 이어 답변 ──
    streams[0].push('성국아 생일 축하해!'); streams[0].end();
    await p1;
    const done1 = c1.socket.events.find(e => e.type === 'answer.done') as any;
    expect(done1).toMatchObject({ session_id: session.id, message_id: expect.any(String) });
    expect(done1.text).toContain('성국');
    expect(c1.socket.events.some(e => e.type === 'message.new' && e.message?.source_neuron === 'answer')).toBe(true);

    await vi.waitFor(() => expect(streams.length).toBe(2)); // 드레인 워커 T2 실행 착수
    streams[1].push('성국이었지'); streams[1].end();
    await vi.waitFor(() => {
      const last = c1.socket.events.filter(e => e.type === 'queue.updated').at(-1) as any;
      expect(last.pending_count).toBe(0);
      expect(last.items.map((i: any) => i.status)).toEqual(['answered']);
    });

    // 유실 금지 2차: REST read-back — user [T1,T2] 순서 + answer 2행.
    const hist = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages`, headers: bearer(token) });
    const rows = hist.json().data;
    expect(rows.filter((m: any) => m.role === 'user').map((m: any) => m.content)).toEqual([T1, T2]);
    expect(rows.filter((m: any) => m.source_neuron === 'answer')).toHaveLength(2);

    // ── 재접속 리플레이: last_seq=0 diff-sync가 양 턴의 answer.done/message.new를 원래 seq 순 복원 ──
    const c3 = await connect(token);
    await c3.send({ type: 'subscribe', session_id: session.id, last_seq: 0 });
    const replayed = replaySince(session.id, 0);
    expect(replayed.filter(e => e.type === 'answer.done')).toHaveLength(2);
    expect(replayed.filter(e => e.type === 'message.new' && (e as any).message?.source_neuron === 'answer')).toHaveLength(2);
    const seqs = replayed.map(e => e.seq as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    // 리플레이는 버퍼 사본 — 재접속이 기존 턴을 재실행하지 않는다 (멱등·유실 금지의 음(陰)측).
    const after = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/messages`, headers: bearer(token) });
    expect(after.json().data.filter((m: any) => m.role === 'user')).toHaveLength(2);
  });
});
