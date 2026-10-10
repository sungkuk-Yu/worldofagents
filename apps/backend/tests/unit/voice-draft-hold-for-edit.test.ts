/**
 * t_8bac5645 — 음성 hold-for-edit 브리지 (대표님 10/4 '수정(녹음 완료하나 전송 전 텍스트 편집)' 요구).
 *
 * 봉인 계약 (카드 verbatim):
 *  [1] audio.end{draft:true} → transcript.draft{session_id,text,confidence,language,duration_ms} 회신.
 *      user 행 영속 0건·run.* 발행 0건·transcript.final 0건·멱등(client_req_id) 저장 0.
 *      seq 미채번 — last_seq diff 리플레이 버퍼에 없음 (eventlog 선행례 favorite.updated).
 *      draft 생략(false)은 기존 전송 경로 1:1 (하위호환) — 같은 소켓 회귀.
 *  [2] transcript.final/persistUserUtteranceEarly/runTextTurn 미호출 정적 프루브 (readFileSync 관례).
 *  [3] audio.cancel 폐기 계약 무영향 회귀.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';

// 게이트 verbatim 'mock 스파이 0' — chatTurn 래퍼 카운터(실동작 통과, 호출 횟수만 센다).
// vi.mock은 파일 홀스트: 전부 통과 라우팅이라 기존 테스트 동작과 무관.
const turnCalls = vi.hoisted(() => ({ persist: 0, run: 0 }));
vi.mock('../../src/lib/chatTurn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/chatTurn')>();
  return {
    ...actual,
    persistUserUtteranceEarly: (...args: any[]) => { turnCalls.persist++; return (actual as any).persistUserUtteranceEarly(...args); },
    runTextTurn: (...args: any[]) => { turnCalls.run++; return (actual as any).runTextTurn(...args); },
  };
});

import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { signup, createFullStack } from '../helpers';
import { websocketHandler } from '../../src/websocket/handler';
import { currentSeq, replaySince } from '../../src/websocket/eventlog';
import { getStore } from '../../src/lib/devstore';
import { MOCK_STT_PHRASE } from '../../src/lib/stt';

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

/** 0.3초 톤 PCM (hasVoiceActivity 통과) — 봉인 env에서 mock STT가 MOCK_STT_PHRASE를 반환. */
function toneBuffer(seconds = 0.3): Buffer {
  const samples = new Int16Array(Math.floor(16000 * seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = 12000;
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

function silenceBuffer(seconds = 0.3): Buffer {
  return Buffer.alloc(Math.floor(16000 * seconds) * 2);
}

const userRows = () => getStore().tables.messages.filter((m: any) => m.role === 'user' && m.session_id === session.id);

describe('audio.end{draft:true} hold-for-edit 브리지 (t_8bac5645)', () => {
  it('[1] 전사 회신만: transcript.draft 필드 5종, final·message.new·run.* 0건, user 행 0', async () => {
    const { socket, send, sendBinary } = await connect(session.id);
    await send({ type: 'subscribe', session_id: session.id });
    const rowsBefore = userRows().length;
    const seqBefore = currentSeq(session.id);
    const callsBefore = { ...turnCalls };
    await send({ type: 'audio.start', session_id: session.id });
    await sendBinary(toneBuffer());
    await send({ type: 'audio.end', session_id: session.id, draft: true });

    // 게이트 verbatim: draft=true 시 persistUserUtteranceEarly/runTextTurn 미호출 (스파이 0).
    expect(turnCalls.persist).toBe(callsBefore.persist);
    expect(turnCalls.run).toBe(callsBefore.run);
    const types = socket.events.map(e => e.type);
    const draft = socket.events.find(e => e.type === 'transcript.draft');
    expect(draft).toBeTruthy();
    // wire 형상 고정 (카드 verbatim): {type, session_id, text, confidence, language, duration_ms}
    expect(draft).toMatchObject({ session_id: session.id, text: MOCK_STT_PHRASE, confidence: expect.any(Number), language: expect.any(String), duration_ms: expect.any(Number) });
    expect(draft.duration_ms).toBeGreaterThan(0);
    expect(types).not.toContain('transcript.final');
    expect(types).not.toContain('message.new');
    expect(types.filter(t => t.startsWith('run.'))).toHaveLength(0);
    expect(types.filter(t => t.startsWith('queue.'))).toHaveLength(0);
    // 발화 소켓 회신 전용 — 허브 브로드캐스트 아님: 다른 소켓(없으므로 broadcastToSession 경유 여부로 간접 검증) 대신 eventlog 무채번.
    expect('seq' in draft).toBe(false);
    expect(currentSeq(session.id)).toBe(seqBefore);
    expect(replaySince(session.id, seqBefore).some(e => e.type === 'transcript.draft')).toBe(false);
    // user 행 영속 0건
    expect(userRows()).toHaveLength(rowsBefore);
  });

  it('[1b] 같은 세션 draft 생략(audio.end) 전송 경로 1:1 회귀 — 선방송 계약 그대로, draft 이후에도 유효', async () => {
    const { socket, send, sendBinary } = await connect(session.id);
    await send({ type: 'subscribe', session_id: session.id });
    // 먼저 draft 한 번 (버전 혼재 시뮬: 같은 소켓에서 draft → 일반 릴리스 순환)
    await send({ type: 'audio.start', session_id: session.id });
    await sendBinary(toneBuffer());
    await send({ type: 'audio.end', session_id: session.id, draft: true });
    const draftOnly = socket.events.filter(e => e.type === 'transcript.draft').length;
    expect(draftOnly).toBe(1);
    const rowsBefore = userRows().length;
    const callsBefore = { ...turnCalls };

    await send({ type: 'audio.start', session_id: session.id });
    await sendBinary(toneBuffer());
    await send({ type: 'audio.end', session_id: session.id }); // draft absent = 전송

    // 카운터 래퍼가 핸들러의 chatTurn import에 실제로 결선되어 있어야 의미 있는 0증가 검증.
    expect(turnCalls.run).toBeGreaterThan(callsBefore.run);
    expect(turnCalls.persist).toBeGreaterThan(callsBefore.persist);

    const types = socket.events.map(e => e.type);
    const firstMessageNew = types.indexOf('message.new');
    const firstRunStarted = types.indexOf('run.started');
    expect(firstMessageNew).toBeGreaterThanOrEqual(0);
    expect(firstRunStarted).toBeGreaterThan(firstMessageNew);
    const tf = socket.events.find(e => e.type === 'transcript.final');
    expect(tf.message_id).toBe(socket.events[firstMessageNew].message.id);
    expect(tf.turn_index).toBe(socket.events[firstMessageNew].message.turn_index);
    expect(userRows()).toHaveLength(rowsBefore + 1);
    // 전송 경로에 transcript.draft 유입 없음 (draft 회신 1건 유지)
    expect(socket.events.filter(e => e.type === 'transcript.draft')).toHaveLength(draftOnly);
  });

  it('[1c] 무음 릴리스 draft는 text:\'\' no-op 회신 — final 무음 경로와 대칭, 영속 0', async () => {
    const { socket, send, sendBinary } = await connect(session.id);
    await send({ type: 'subscribe', session_id: session.id });
    const rowsBefore = userRows().length;
    await send({ type: 'audio.start', session_id: session.id });
    await sendBinary(silenceBuffer());
    await send({ type: 'audio.end', session_id: session.id, draft: true });
    const draft = socket.events.find(e => e.type === 'transcript.draft');
    expect(draft).toMatchObject({ text: '', confidence: 0 });
    expect(socket.events.map(e => e.type)).not.toContain('transcript.final');
    expect(userRows()).toHaveLength(rowsBefore);
  });

  it('[1d] draft는 멱등 저장 0 — 같은 client_req_id 후속 실전송은 dedup 없이 정상 실행', async () => {
    const { socket, send, sendBinary } = await connect(session.id);
    await send({ type: 'subscribe', session_id: session.id });
    const key = `draft-idem-${Date.now()}`;
    await send({ type: 'audio.start', session_id: session.id });
    await sendBinary(toneBuffer());
    await send({ type: 'audio.end', session_id: session.id, draft: true, client_req_id: key });
    const rowsAfterDraft = userRows().length;
    expect(socket.events.filter(e => e.type === 'message.new')).toHaveLength(0);

    await send({ type: 'audio.start', session_id: session.id });
    await sendBinary(toneBuffer());
    await send({ type: 'audio.end', session_id: session.id, client_req_id: key });
    const userNew = socket.events.find(e => e.type === 'message.new' && e.message?.role === 'user');
    expect(userNew).toBeTruthy();
    expect(userNew.deduped).toBeUndefined(); // 신규 영속 — draft가 키를 태워 실전송을 삼키지 않는다
    expect(userRows()).toHaveLength(rowsAfterDraft + 1);
  });

  it('[3] audio.cancel 폐기 계약 무영향 — 취소 시 draft도 final도 없음, 후속 start 정상', async () => {
    const { socket, send, sendBinary } = await connect(session.id);
    await send({ type: 'subscribe', session_id: session.id });
    const rowsBefore = userRows().length;
    await send({ type: 'audio.start', session_id: session.id });
    await sendBinary(toneBuffer());
    await send({ type: 'audio.cancel', session_id: session.id });
    const types = socket.events.map(e => e.type);
    expect(types.filter(t => t === 'transcript.draft' || t === 'transcript.final')).toHaveLength(0);
    expect(socket.events.find(e => e.type === 'audio.vad' && e.active === false)).toBeTruthy();
    expect(userRows()).toHaveLength(rowsBefore);
    // cancel 후 draft 릴리스 = 스트림 없음 → 기존 VALIDATION_ERROR 계약 그대로
    await send({ type: 'audio.end', session_id: session.id, draft: true });
    const err = socket.events.find(e => e.type === 'error' && e.code === 'VALIDATION_ERROR');
    expect(err.message).toContain('활성 오디오 스트림');
    expect(socket.events.filter(e => e.type === 'transcript.draft')).toHaveLength(0);
  });
});

describe('[2] 정적 프루브 — readFileSync 관례 (ack-queue-suggest/attachments 동계)', () => {
  const handler = fs.readFileSync('src/websocket/handler.ts', 'utf8');
  const proto = fs.readFileSync('src/websocket/protocol.ts', 'utf8');
  const evlog = fs.readFileSync('src/websocket/eventlog.ts', 'utf8');

  it('handleAudioEnd의 draft 분기는 handleTr(transcript.final/persistUserUtteranceEarly/runTextTurn) 호출보다 먼저 return한다', () => {
    // protocol.ts: draft 플래그 wire + 이벤트 타입 공존
    expect(proto).toMatch(/audio\.end';\s*session_id:\s*string;\s*client_req_id\?:\s*string;\s*draft\?:\s*true/);
    expect(proto).toContain("type: 'transcript.draft'");
    // handler.ts: handleTr 호출은 handleAudioEnd 하단 단일 지점 — draft return이 그보다 위
    const fn = handler.slice(handler.indexOf('async function handleAudioEnd'), handler.indexOf('// ── 최종 트랜스크립트'));
    const draftReturnIdx = fn.indexOf("type: 'transcript.draft'");
    const handleTrIdx = fn.indexOf('await handleTr(');
    expect(draftReturnIdx).toBeGreaterThanOrEqual(0);
    expect(handleTrIdx).toBeGreaterThan(draftReturnIdx);
    // draft 경로 안에 transcript.final 브로드캐스트·transcript() 캐리어 직수신 회신 없음 (무음 draft 분기도 sendJson 회신 전용)
    const draftBlock = fn.slice(draftReturnIdx, handleTrIdx);
    expect(draftBlock).toContain("'transcript.draft'");
  });

  it('transcript.draft는 eventlog recordedTypes 밖 — seq 미채번·diff 리플레이 무폭주', () => {
    expect(evlog).not.toContain("'transcript.draft'");
    // 발화 소켓 회신 전용: handler의 draft 회신은 전부 sendJson(socket,...) — broadcastToSession 없음
    const fn = handler.slice(handler.indexOf('async function handleAudioEnd'), handler.indexOf('// ── 최종 트랜스크립트'));
    const draftLines = fn.split('\n').filter(l => l.includes("'transcript.draft'"));
    expect(draftLines.length).toBeGreaterThan(0);
    for (const l of draftLines) expect(l).toContain('sendJson(socket');
  });
});
