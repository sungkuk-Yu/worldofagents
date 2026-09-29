/**
 * t_02f58030 답글/인용 (백로그④, 마이그레이션 012) — 수신 검증·요약 스냅샷·레치·프롬프트 삽입·
 * serialize 승격·큐 우회·롤백 파일 계약. DEV_MODE devstore (012 불필요 — 래치/컬럼 생략 경로).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../src/config';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import {
  stripMarkdown, replySnippet, REPLY_SNIPPET_MAX, resolveReplyContext, replyToColumn,
  classifyReplyInsertError, isMissingReplyToColumn, isReplyRefViolation,
  __setReplyToColumnMissing, __resetReplyToProbe, isReplyToKnownUnavailable,
} from '../../src/lib/replyTo';
import { serializeMessage } from '../../src/lib/helpers';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const session = { id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
const other = { id: 'session2', user_id: 'user', agent_id: 'agent', persona_id: 'persona', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  __resetReplyToProbe();
  store = createStore();
  store.tables.sessions.push({ ...session }, { ...other });
  store.tables.personas.push({ id: 'persona', tone_config: {} });
  store.tables.users.push({ id: 'user', display_name: '대표님', email: 'a@b.c' });
  store.tables.agents.push({ id: 'agent', name: '테스트 에이전트' });
  store.tables.messages.push(
    { id: 'm-user', session_id: 'session', role: 'user', content: '# 오늘 **계획** 잡아줄래?\n- 산책\n- 리뷰', turn_index: 0 },
    { id: 'm-agent', session_id: 'session', role: 'agent', content: '네, 아래처럼 진행합니다.\n```py\nprint(1)\n```', turn_index: 1 },
    { id: 'm-other', session_id: 'session2', role: 'user', content: '남세션 발화', turn_index: 0 },
  );
  db = createDevClient(store) as DbClient;
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); __resetReplyToProbe(); });

/** DEV 봉인 환경에서 스트림 답변만 모크 — 요청 body(system 프롬프트)를 캡처한다. (awaiting-reply 관례) */
function streamFetch(answer: string, capture?: (bodies: any[]) => void) {
  const bodies: any[] = [];
  return vi.fn(async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    capture?.(bodies);
    if (body.stream) {
      return new Response(`data: {"model":"test-model","choices":[{"delta":{"content":${JSON.stringify(answer)}}}]}\n\ndata: [DONE]\n`);
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  });
}

describe('stripMarkdown / replySnippet (순수 규칙)', () => {
  it('헤더·인라인 강조·목록 마커 제거, 문자만 남긴다', () => {
    expect(stripMarkdown('# 오늘 **계획** 잡아줄래?\n- 산책\n- 리뷰')).toBe('오늘 계획 잡아줄래? 산책 리뷰');
    expect(stripMarkdown('> 인용과 ~~취소~~ *기울임*')).toBe('인용과 취소 기울임');
  });
  it('링크는 [text](url)→text, 코드펜스 블록은 통째 제거', () => {
    expect(stripMarkdown('문서는 [여기](https://x.io) 참고')).toBe('문서는 여기 참고');
    expect(stripMarkdown('설명\n```py\nprint(1)\n```\n마무리')).toBe('설명 마무리');
  });
  it('요약 캡 = 80자 (카드 확정)', () => {
    expect(replySnippet('가'.repeat(200)).length).toBe(REPLY_SNIPPET_MAX);
    expect(REPLY_SNIPPET_MAX).toBe(80);
  });
});

describe('resolveReplyContext — invalid 무시 + 발화 통과 계약', () => {
  it('같은 세션 user 원문 → ID + by=작성자 display_name + 스트리핑 발췌', async () => {
    const ctx = await resolveReplyContext(db, 'session', 'm-user', 'user', 'agent');
    expect(ctx.replyToId).toBe('m-user');
    expect(ctx.summary).toEqual({ message_id: 'm-user', by: '대표님', text: '오늘 계획 잡아줄래? 산책 리뷰' });
  });
  it('agent 원문 → by=에이전트 이름, 펜스 제거 발췌', async () => {
    const ctx = await resolveReplyContext(db, 'session', 'm-agent', 'user', 'agent');
    expect(ctx.summary?.by).toBe('테스트 에이전트');
    expect(ctx.summary?.text).toBe('네, 아래처럼 진행합니다.');
  });
  it('없는 ID / 다른 세션 / 비문자열 / 빈 문자열 → null 강등 (throw 없음)', async () => {
    expect((await resolveReplyContext(db, 'session', 'nope', 'user', 'agent')).replyToId).toBeNull();
    expect((await resolveReplyContext(db, 'session', 'm-other', 'user', 'agent')).replyToId).toBeNull();
    for (const junk of [undefined, null, 42, '', '   ', {} as any]) {
      const ctx = await resolveReplyContext(db, 'session', junk, 'user', 'agent');
      expect(ctx).toEqual({ replyToId: null, summary: null });
    }
  });
  it('display_name 없으면 폴백 사용자/에이전트', async () => {
    store.tables.users.length = 0;
    store.tables.agents.length = 0;
    const ctx = await resolveReplyContext(db, 'session', 'm-user', 'user', 'agent');
    expect(ctx.summary?.by).toBe('사용자');
    const agentCtx = await resolveReplyContext(db, 'session', 'm-agent', 'user', 'agent');
    expect(agentCtx.summary?.by).toBe('에이전트');
  });
});

describe('processTurn end-to-end (devstore)', () => {
  it('유효 reply_to → user 행 reply_to_id+요약, answer 행 payload 사본, message.new에 최상위 노출', async () => {
    vi.stubGlobal('fetch', streamFetch('좋아, 그렇게 하자.'));
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '이거 보류해줘', { locale: 'ko', replyToId: 'm-user', emit: e => events.push(e) });
    const userRow = store.tables.messages.find(m => m.id === result.userMessageId)!;
    expect(userRow.reply_to_id).toBe('m-user');
    expect((userRow.structured_payload as any).reply_to).toEqual({ message_id: 'm-user', by: '대표님', text: '오늘 계획 잡아줄래? 산책 리뷰' });
    const answerRow = store.tables.messages.find(m => m.id === result.answerMessageId)!;
    expect((answerRow.structured_payload as any).reply_to).toMatchObject({ message_id: 'm-user' });
    const userEvent = events.find(e => e.type === 'message.new' && (e as any).message.role === 'user') as any;
    expect(userEvent.message.reply_to_id).toBe('m-user');
    expect((userEvent.message.structured_payload as any).reply_to.by).toBe('대표님');
  });

  it('invalid reply_to(다른 세션) → 발화·답변 정상, reply 컬럼/요약 없음', async () => {
    vi.stubGlobal('fetch', streamFetch('무인용으로 이어간다.'));
    const events: TurnEmitEvent[] = [];
    const result = await runTextTurn(db, session, 'user', '계속', { locale: 'ko', replyToId: 'm-other', emit: e => events.push(e) });
    expect(result.answerMessageId).toBeTruthy();
    const userRow = store.tables.messages.find(m => m.id === result.userMessageId)!;
    expect(userRow.reply_to_id).toBeNull(); // devstore 기본 null(실DB DEFAULT NULL) — 인용 미기록
    expect((userRow.structured_payload as any).reply_to).toBeUndefined();
    // serializeMessage는 미적용/dev 행을 null로 정규화 (프론트 판정 안정)
    expect(serializeMessage(userRow as any).reply_to_id).toBeNull();
  });

  it('answerNode 프롬프트에 인용 지시문 삽입 (없으면 무삽입)', async () => {
    let bodies: any[] = [];
    vi.stubGlobal('fetch', streamFetch('인용 보고 답함.', b => { bodies = b; }));
    await runTextTurn(db, session, 'user', '보류', { locale: 'ko', replyToId: 'm-agent', emit: () => {} });
    const systems = bodies.map(b => (b.messages?.[0]?.content ?? '') as string);
    expect(systems.some(s => s.includes('사용자가 특정 발화에 답글을 달했습니다')
      && s.includes('[테스트 에이전트] "네, 아래처럼 진행합니다."')
      && s.includes('m-agent'))).toBe(true);
    // 무인용 턴은 기존 프롬프트와 동일 (회귀 방지)
    let plain: any[] = [];
    vi.stubGlobal('fetch', streamFetch('일반 답함.', b => { plain = b; }));
    await runTextTurn(db, session, 'user', '일반 발화', { locale: 'ko', emit: () => {} });
    expect(plain.every(b => !String(b.messages?.[0]?.content ?? '').includes('답글을 달했습니다'))).toBe(true);
  });

  it('원문 삭제 후에도 요약 스냅샷 살아있고 링크만 소멸 의미 (SET NULL 계약의 애플리케이션 반영)', async () => {
    vi.stubGlobal('fetch', streamFetch('답함.'));
    const result = await runTextTurn(db, session, 'user', '답글 발화', { locale: 'ko', replyToId: 'm-user', emit: () => {} });
    store.tables.messages = store.tables.messages.filter(m => m.id !== 'm-user'); // 원문 DELETE
    const userRow = store.tables.messages.find(m => m.id === result.userMessageId)!;
    expect((userRow.structured_payload as any).reply_to.text).toBe('오늘 계획 잡아줄래? 산책 리뷰');
  });
});

describe('래치·강등 판정 (011 관례 대칭)', () => {
  it('PGRST204/42703 = 컬럼 미적용, 23503/FK·CROSS_SESSION = 참조 위반', () => {
    expect(isMissingReplyToColumn({ code: 'PGRST204' })).toBe(true);
    expect(isMissingReplyToColumn({ code: '42703' })).toBe(true);
    expect(isMissingReplyToColumn({ message: 'column messages.reply_to_id does not exist' })).toBe(true);
    expect(isMissingReplyToColumn({ code: '23503', message: 'foreign key' })).toBe(false);
    expect(isReplyRefViolation({ code: '23503' })).toBe(true);
    expect(isReplyRefViolation({ message: 'CROSS_SESSION_REPLY_TO denied: target belongs to another session' })).toBe(true);
  });
  it('classifyReplyInsertError — 무인용 발화(null)는 재시도 없음, column-drop 우선', () => {
    expect(classifyReplyInsertError({ code: 'PGRST204' }, false)).toBeNull();
    expect(classifyReplyInsertError({ code: 'PGRST204' }, true)).toBe('column-drop');
    expect(classifyReplyInsertError({ code: '23503', message: 'violates foreign key' }, true)).toBe('ref-drop');
    expect(classifyReplyInsertError({ code: '23505', message: 'duplicate' }, true)).toBeNull();
  });
  it('래치(on): 컬럼 생략 insert — 요약 payload는 유지, 대화 경로 무영향', async () => {
    __setReplyToColumnMissing(true);
    expect(replyToColumn('m-user')).toEqual({});
    expect(isReplyToKnownUnavailable()).toBe(true);
    vi.stubGlobal('fetch', streamFetch('래치 후 답함.'));
    const result = await runTextTurn(db, session, 'user', '래치 발화', { locale: 'ko', replyToId: 'm-user', emit: () => {} });
    const userRow = store.tables.messages.find(m => m.id === result.userMessageId)!;
    expect(userRow.reply_to_id).toBeNull(); // 컬럼 자체를 만지지 않는다 (래치 = 생략 insert)
    expect((userRow.structured_payload as any).reply_to).toMatchObject({ message_id: 'm-user' });
  });
  it('insert가 PGRST204로 첫 실패 → 래치_on + 컬럼 생략 재시도 성공', async () => {
    const failing = interceptUserInsert(db, { code: 'PGRST204', message: "column 'reply_to_id' not found" }, v => v.reply_to_id !== undefined);
    vi.stubGlobal('fetch', streamFetch('재시도 성공.'));
    const result = await runTextTurn(failing as DbClient, session, 'user', '재시도 발화', { locale: 'ko', replyToId: 'm-user', emit: () => {} });
    expect(result.answerMessageId).toBeTruthy();
    expect(isReplyToKnownUnavailable()).toBe(true); // 래치(on) — 이후 턴은 생략 insert
    const userRow = store.tables.messages.find(m => m.id === result.userMessageId)!;
    expect(userRow.reply_to_id).toBeNull(); // 재시도 insert는 컬럼 생략 → devstore 기본 null
    expect((userRow.structured_payload as any).reply_to).toMatchObject({ message_id: 'm-user' });
  });
  it('insert가 23503(경쟁 삭제) → 인용 전부 탈락 재시도, 발화 통과·래치 무영향', async () => {
    const failing = interceptUserInsert(db, { code: '23503', message: 'CROSS_SESSION_REPLY_TO denied' }, v => v.reply_to_id !== undefined);
    vi.stubGlobal('fetch', streamFetch('경쟁 후 답함.'));
    const result = await runTextTurn(failing as DbClient, session, 'user', '경쟁 발화', { locale: 'ko', replyToId: 'm-user', emit: () => {} });
    expect(result.answerMessageId).toBeTruthy();
    expect(isReplyToKnownUnavailable()).toBe(false); // 참조 위반은 래치와 무관
    const userRow = store.tables.messages.find(m => m.id === result.userMessageId)!;
    expect(userRow.reply_to_id).toBeNull(); // ref-drop 재시도는 빈 extra — 기본 null
    expect((userRow.structured_payload as any).reply_to).toBeUndefined(); // ref-drop은 인용 정보 전체 탈락
  });
});

/** messages.user insert를 조건 충족 시 times회 실패시키되, 이후 insert는 실제 체인으로 통과시킨다. */
function interceptUserInsert(dev: any, error: any, when: (values: any) => boolean, times = 1) {
  const from = dev.from.bind(dev);
  let remaining = times;
  return {
    ...dev,
    from: (table: string) => {
      const qb = from(table);
      if (table !== 'messages') return qb;
      const realInsert = qb.insert.bind(qb);
      qb.insert = (values: any) => {
        if (remaining > 0 && when(values)) {
          remaining--;
          return { select: () => ({ single: async () => ({ data: null, error }) }) };
        }
        return realInsert(values);
      };
      return qb;
    },
  };
}

describe('012/롤백·수신 배선 계약 (정적 프루브 — attachments.test 관례)', () => {
  it('마이그레이션 012: FK SET NULL + CROSS_SESSION 트리거 + 롤백 012_down 동반', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync('supabase/migrations/012_reply_to.sql', 'utf8');
    expect(sql).toContain('REFERENCES messages(id) ON DELETE SET NULL');
    expect(sql).toContain('CROSS_SESSION_REPLY_TO');
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF reply_to_id');
    expect(sql).toContain("ERRCODE = '23503'");
    const down = fs.readFileSync('supabase/rollback/012_reply_to_down.sql', 'utf8');
    expect(down).toContain('DROP COLUMN IF EXISTS reply_to_id');
    expect(down).toContain('DROP TRIGGER IF EXISTS trg_messages_reply_to_same_session');
  });
  it('WS protocol/message.send·REST 양쪽 reply_to_id 수신 배선 + 인용 발화 큐 우회', async () => {
    const fs = await import('node:fs');
    const proto = fs.readFileSync('src/websocket/protocol.ts', 'utf8');
    expect(proto).toContain('reply_to_id?: string');
    const handler = fs.readFileSync('src/websocket/handler.ts', 'utf8');
    expect(handler).toContain('replyToId: message.reply_to_id');
    expect(handler).toContain('!hasQuote && hasActiveRun');
    const routes = fs.readFileSync('src/routes/sessions.ts', 'utf8');
    expect(routes).toContain('replyToId: body.reply_to_id');
    expect(routes).toContain('!hasQuote && hasActiveRun');
    const replies = fs.readFileSync('src/routes/messages.ts', 'utf8');
    expect(replies).toContain('replyToId: body.reply_to_id');
  });
});
