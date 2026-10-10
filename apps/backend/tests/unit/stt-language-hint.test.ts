/**
 * t_827dcbcc — STT 언어 힌트 전파 ('is' 오전사 픽스, 대표님 10/10 08:43 실측).
 *
 * 봉인 계약 (카드 수정계약 #1/#4/#5):
 *  [A] transcribeAudio(bundle, hint) → 사이드카 fetch URL에 ?language=<hint>.
 *      힌트 없음/'auto' → 쿼리 없음 (자동감지 유지 = 구거동 하위호환).
 *  [B] 우선순위: client audio.start config.language 명시 > 세션 locale(resolveLocale,
 *      기본=config.defaultLocale='ko'). 로컬(=프론트 개발) 담당과 무관한 서버측 결정 —
 *      프론트가 아무 language도 안 보내도 ko 힌트가 나간다.
 *  [C] draft 경로(audio.end{draft:true})는 힌트 전파 후에도 비영속 유지 (user 행 0·run 0).
 *  [D] audio.cancel 폐기 계약 무영향 (회귀).
 * vi.mock 없는 봉인 fetch 스파이: 사이드카 불요 — CI에서 실행. 실사이드카 A/B는
 * smoke_voice_stt.mjs (시나리오: ko 힌트 고정 / en 명시 힌트 우선)에서.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app, build } from '../../src/index';
import { config } from '../../src/config';
import { signup, createFullStack } from '../helpers';
import { websocketHandler } from '../../src/websocket/handler';
import { getStore } from '../../src/lib/devstore';
import { normalizeSttLanguageHint, MOCK_STT_PHRASE } from '../../src/lib/stt';

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

/** 0.3초 톤 PCM (hasVoiceActivity 통과) */
function toneBuffer(seconds = 0.3): Buffer {
  const samples = new Int16Array(Math.floor(16000 * seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = 12000;
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

/** 사이드카 URL만 위조 fetch 스파이 — 그 외 fetch(supabase 등)는 원본 위임. (로컬) */
function mockSidecar() {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const u = String(input);
    if (u.includes(':9899/transcribe')) {
      calls.push(u);
      return new Response(JSON.stringify({
        text: '힌트 테스트 발화', language: 'ko', confidence: 0.9, duration_ms: 300, service: 'local',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return orig(input, init);
  });
  return { calls, spy };
}

function withSidecarUrl(url: string, fn: () => Promise<void>) {
  const prev = config.sttSidecar.url;
  Object.defineProperty(config.sttSidecar, 'url', { value: url, configurable: true });
  return fn().finally(() => Object.defineProperty(config.sttSidecar, 'url', { value: prev, configurable: true }));
}

const userRows = () => getStore().tables.messages.filter((m: any) => m.role === 'user' && m.session_id === session.id);

describe('[A] normalizeSttLanguageHint — 순수 정규화 (카드계약 #1 방어)', () => {
  it('유효 코드 통과·캐이스/태그 정규화·auto/빈값/ Junk 은 undefined(자동감지 유지)', () => {
    expect(normalizeSttLanguageHint('ko')).toBe('ko');
    expect(normalizeSttLanguageHint('EN')).toBe('en');
    expect(normalizeSttLanguageHint('ko-KR')).toBe('ko');
    expect(normalizeSttLanguageHint(' auto ')).toBeUndefined();   // 500 원천 (실측 ValueError)
    expect(normalizeSttLanguageHint('')).toBeUndefined();
    expect(normalizeSttLanguageHint(null)).toBeUndefined();
    expect(normalizeSttLanguageHint(undefined)).toBeUndefined();
    expect(normalizeSttLanguageHint('klingon!')).toBeUndefined();
  });
});

describe('[B] WS 핸들러 → 사이드카 힌트 전파 (fetch 스파이, 사이드카 불요)', () => {
  it('B1 클라이언트 language 미지정(구 앱 형상) → 세션 locale 기본 ko 힌트가 ?language=ko로 나간다', async () => {
    const { calls, spy } = mockSidecar();
    try {
      await withSidecarUrl('http://127.0.0.1:9899', async () => {
        const { send, sendBinary } = await connect(session.id);
        await send({ type: 'subscribe', session_id: session.id });
        await send({ type: 'audio.start', session_id: session.id }); // language 없음 → 'auto'
        await sendBinary(toneBuffer());
        await send({ type: 'audio.end', session_id: session.id, draft: true });
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe('http://127.0.0.1:9899/transcribe?language=ko');
    } finally { spy.mockRestore(); }
  });

  it('B2 client config.language=en 명시 → locale(ko)보다 우선, ?language=en', async () => {
    const { calls, spy } = mockSidecar();
    try {
      await withSidecarUrl('http://127.0.0.1:9899', async () => {
        const { send, sendBinary } = await connect(session.id);
        await send({ type: 'subscribe', session_id: session.id });
        await send({ type: 'audio.start', session_id: session.id, config: { language: 'en' } });
        await sendBinary(toneBuffer());
        await send({ type: 'audio.end', session_id: session.id, draft: true });
      });
      expect(calls[0]).toBe('http://127.0.0.1:9899/transcribe?language=en');
    } finally { spy.mockRestore(); }
  });

  it('B3 subscribe locale=en 세션 + client 미지정 → en 힌트 (세션 locale 우선)', async () => {
    const { calls, spy } = mockSidecar();
    try {
      await withSidecarUrl('http://127.0.0.1:9899', async () => {
        const { send, sendBinary } = await connect(session.id);
        await send({ type: 'subscribe', session_id: session.id, locale: 'en' });
        await send({ type: 'audio.start', session_id: session.id });
        await sendBinary(toneBuffer());
        await send({ type: 'audio.end', session_id: session.id, draft: true });
      });
      expect(calls[0]).toBe('http://127.0.0.1:9899/transcribe?language=en');
    } finally { spy.mockRestore(); }
  });

  it('B4 client config.language=auto 명시 → locale 기본 ko 로 폴백 (auto=자동감지 요청이 아니라 미지정과 동일 취급)', async () => {
    const { calls, spy } = mockSidecar();
    try {
      await withSidecarUrl('http://127.0.0.1:9899', async () => {
        const { send, sendBinary } = await connect(session.id);
        await send({ type: 'subscribe', session_id: session.id });
        await send({ type: 'audio.start', session_id: session.id, config: { language: 'auto' } });
        await sendBinary(toneBuffer());
        await send({ type: 'audio.end', session_id: session.id, draft: true });
      });
      expect(calls[0]).toBe('http://127.0.0.1:9899/transcribe?language=ko');
    } finally { spy.mockRestore(); }
  });

  it('[C] 힌트 전파 후 draft 경로 비영속 회귀 — transcript.draft 1건·final/message.new/run.* 0·user 행 0', async () => {
    const { spy } = mockSidecar();
    const rowsBefore = userRows().length;
    try {
      let sock: any;
      await withSidecarUrl('http://127.0.0.1:9899', async () => {
        const c = await connect(session.id);
        sock = c;
        await c.send({ type: 'subscribe', session_id: session.id });
        await c.send({ type: 'audio.start', session_id: session.id });
        await c.sendBinary(toneBuffer());
        await c.send({ type: 'audio.end', session_id: session.id, draft: true });
      });
      const types = sock.socket.events.map((e: any) => e.type);
      const draft = sock.socket.events.find((e: any) => e.type === 'transcript.draft');
      expect(draft).toBeTruthy();
      expect(draft.text).toBe('힌트 테스트 발화');
      expect(draft.language).toBe('ko'); // 사이드카 응답 language 참고용 유지 (계약 #2)
      expect(types).not.toContain('transcript.final');
      expect(types).not.toContain('message.new');
      expect(types.filter((t: string) => t.startsWith('run.'))).toHaveLength(0);
      expect('seq' in draft).toBe(false);
      expect(userRows()).toHaveLength(rowsBefore);
    } finally { spy.mockRestore(); }
  });

  it('[D] audio.cancel 폐기 계약 무영향 — cancel 후 발화 전사 0·user 행 0·vad off 1', async () => {
    const { calls, spy } = mockSidecar();
    const rowsBefore = userRows().length;
    try {
      await withSidecarUrl('http://127.0.0.1:9899', async () => {
        const { socket, send, sendBinary } = await connect(session.id);
        await send({ type: 'subscribe', session_id: session.id });
        await send({ type: 'audio.start', session_id: session.id });
        await sendBinary(toneBuffer());
        await send({ type: 'audio.cancel', session_id: session.id });
        await new Promise(r => setTimeout(r, 200));
        expect(calls).toHaveLength(0); // 전사 미호출
        const types = socket.events.map((e: any) => e.type);
        expect(types).toContain('audio.vad'); // 폐기 통보(vad off)는 유지
        expect(types).not.toContain('transcript.draft');
        expect(types).not.toContain('transcript.final');
        expect(userRows()).toHaveLength(rowsBefore);
      });
    } finally { spy.mockRestore(); }
  });

  it('하위호환: transcribeAudio 2번째 인자 생략 = 쿼리 없음 (자동감지 구거동 보존)', async () => {
    const { transcribeAudio } = await import('../../src/lib/stt');
    const { calls, spy } = mockSidecar();
    try {
      await withSidecarUrl('http://127.0.0.1:9899', async () => {
        await transcribeAudio(toneBuffer());
        await transcribeAudio(toneBuffer(), 'auto');
        await transcribeAudio(toneBuffer(), 'en');
      });
      expect(calls[0]).toBe('http://127.0.0.1:9899/transcribe');
      expect(calls[1]).toBe('http://127.0.0.1:9899/transcribe');
      expect(calls[2]).toBe('http://127.0.0.1:9899/transcribe?language=en');
    } finally { spy.mockRestore(); }
  });
});
