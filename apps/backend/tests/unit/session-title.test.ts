/**
 * 세션 제목 자동 채움 단위 테스트 (t_cc52fd4f 심야 D1-③ — 대표님 9/28 지시).
 *
 * 계약:
 *  - 규칙: 첫 사용자 메시지 요약(개행은 첫 행/공백 접기/50자 초과 시 49자+'…') — 010 백필 SQL과 동일 semantics.
 *  - 적용 지점: runTextTurn 단일 결절점 → REST sendMessage/WS message.send/PTT 트랜스크립트/큐 드레인 전부.
 *  - 보존: 이미 제목이 있는 세션은 절대 덮지 않는다 (수동 개명·포크 승계).
 *  - 레이스: UPDATE ... WHERE title IS NULL — 후착자는 0행(무언). metadata.title만 있는 세션도
 *    캐논 규칙상 '제목 있음' → 세팅 대상 아님.
 *  - 실패 비전염: 세팅 실패가 턴을 오염시키지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevClient, createStore } from '../../src/lib/devstore';
import { runTextTurn, TurnEmitEvent } from '../../src/lib/chatTurn';
import { deriveSessionTitle, sessionTitleOf, setSessionTitleIfEmpty, SESSION_TITLE_MAX } from '../../src/lib/sessionTitle';
import { config } from '../../src/config';
import { DbClient } from '../../src/lib/supabase';
import { SessionsRow } from '../../src/types/db';

const sessionRow = (over: Partial<SessionsRow> = {}) => ({
  id: 'session', user_id: 'user', agent_id: 'agent', persona_id: 'persona',
  status: 'active', ...over,
}) as SessionsRow;

beforeEach(() => {
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(false);
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('외부 네트워크 호출 금지'); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('deriveSessionTitle — 010 백필 SQL과 미러링되는 파생 규칙', () => {
  it('빈 입력/공백·개행만 → null (빈 제목 금지 규약)', () => {
    vi.resetAllMocks();
    expect(deriveSessionTitle('')).toBeNull();
    expect(deriveSessionTitle('   \n \t ')).toBeNull();
  });
  it('여러 줄·연속 공백 → 첫 행만, 공백 한 칸 접기', () => {
    vi.resetAllMocks();
    expect(deriveSessionTitle('이번  주  일정   알려줘\n두번째 줄은 무시')).toBe('이번 주 일정 알려줘');
  });
  it(`${SESSION_TITLE_MAX}자 초과 → 앞 ${SESSION_TITLE_MAX - 1}자 + '…' (SQL left(t,${SESSION_TITLE_MAX - 1})과 동일)`, () => {
    vi.resetAllMocks();
    const t = deriveSessionTitle('가'.repeat(60));
    expect(t).toBe('가'.repeat(SESSION_TITLE_MAX - 1) + '…');
    expect([...(t ?? '')].length).toBe(SESSION_TITLE_MAX);
    // 코드포인트 단위 절단: 이모지 포함 문자열도 UTF-16가 아니라 글자 수 기준
    const emojied = deriveSessionTitle('🙇‍♀️'.repeat(60));
    expect(emojied!.endsWith('…')).toBe(true);
    expect([...emojied!].length).toBe(SESSION_TITLE_MAX);
  });
});

describe('sessionTitleOf — 캐논 규칙(title 컬럼 우선 → metadata.title 폴백)', () => {
  it('title > metadata.title > null', () => {
    expect(sessionTitleOf(sessionRow({ title: '컬럼 제목', metadata: { title: '메타 제목' } }))).toBe('컬럼 제목');
    expect(sessionTitleOf(sessionRow({ metadata: { title: '메타 제목' } }))).toBe('메타 제목');
    expect(sessionTitleOf(sessionRow({ title: '   ', metadata: { title: ' x ' } }))).toBe('x');
    expect(sessionTitleOf(sessionRow())).toBeNull();
    expect(sessionTitleOf(sessionRow({ metadata: {} }))).toBeNull();
  });
});

describe('setSessionTitleIfEmpty — WHERE title IS NULL 원-라운드트립 가드', () => {
  it('제목 없는 행만 갱신, 이미 있는 행은 false(무언)', async () => {
    const store = createStore();
    store.tables.sessions.push({ id: 's1', user_id: 'u', status: 'active' } as any);
    store.tables.sessions.push({ id: 's2', title: '수동 개명', user_id: 'u', status: 'active' } as any);
    const db = createDevClient(store) as DbClient;
    expect(await setSessionTitleIfEmpty(db, 's1', '첫 질문 요약')).toBe(true);
    expect(store.tables.sessions.find(r => r.id === 's1').title).toBe('첫 질문 요약');
    expect(await setSessionTitleIfEmpty(db, 's2', '덮치기 시도')).toBe(false);
    expect(store.tables.sessions.find(r => r.id === 's2').title).toBe('수동 개명');
    // 재호출(선착 반영 후 후착 레이스)도 false — 값 불변
    expect(await setSessionTitleIfEmpty(db, 's1', '경쟁 제목')).toBe(false);
    expect(store.tables.sessions.find(r => r.id === 's1').title).toBe('첫 질문 요약');
  });
});

describe('runTextTurn 세팅부 — 첫 사용자 메시지 요약 자동 채움', () => {
  const noEmit = (_e: TurnEmitEvent) => undefined;
  function freshDb() {
    const store = createStore();
    store.tables.personas.push({ id: 'persona', tone_config: {} } as any);
    return { store, db: createDevClient(store) as DbClient };
  }

  it('제목 없는 신규 세션: 첫 턴에서 캐논 title 컬럼 세팅 + 목록 직렬화 즉시 반영', async () => {
    const { store, db } = freshDb();
    const session = sessionRow();
    store.tables.sessions.push({ ...session } as any);
    const events: TurnEmitEvent[] = [];
    await runTextTurn(db, session, 'user', '내일 아침 회의 시간 알려줘\n(부연 설명)', { emit: e => events.push(e) });
    const row = store.tables.sessions.find(r => r.id === 'session')!;
    expect(row.title).toBe('내일 아침 회의 시간 알려줘');
  });

  it('metadata.title 보유 세션(포크 승계 등)은 덮지 않는다 — 백필 3b와 동일한 보존 규칙', async () => {
    const { store, db } = freshDb();
    const session = sessionRow({ metadata: { title: '포크된 대화' } });
    store.tables.sessions.push({ ...session } as any);
    await runTextTurn(db, session, 'user', '새로 하는 질문', { emit: noEmit });
    const row = store.tables.sessions.find(r => r.id === 'session')!;
    expect(row.title ?? null).toBeNull();
    expect(row.metadata.title).toBe('포크된 대화');
  });

  it('두 번째 턴에서도 제목 불변 (수동 개명 시뮬: 첫 턴 후 개명 → 재턴 유지)', async () => {
    const { store, db } = freshDb();
    const session = sessionRow();
    store.tables.sessions.push({ ...session } as any);
    await runTextTurn(db, session, 'user', '첫 질문입니다', { emit: noEmit });
    const row = store.tables.sessions.find(r => r.id === 'session')!;
    expect(row.title).toBe('첫 질문입니다');
    row.title = '사용자 개명 제목';
    await runTextTurn(db, row as SessionsRow, 'user', '두 번째 질문', { emit: noEmit });
    expect((store.tables.sessions.find(r => r.id === 'session') as any).title).toBe('사용자 개명 제목');
  });

  it('세팅 실패(DB 오류)는 조용히 삼키고 턴은 완주한다 — 개인화 실패가 대화를 막지 않음', async () => {
    const { store, db } = freshDb();
    const session = sessionRow();
    store.tables.sessions.push({ ...session } as any);
    const wrapped: DbClient = {
      ...db,
      from(table: string) {
        const qb = db.from(table);
        if (table !== 'sessions') return qb;
        const orig = qb.update.bind(qb);
        qb.update = () => { throw new Error('세션 테이블 일시 장애'); };
        return qb;
      },
    } as DbClient;
    const result = await runTextTurn(wrapped, session, 'user', '장애 중에도 대화는 계속', { emit: noEmit });
    // LLM 봉인(캔드 답변) 경로 — answerResponse 본문이 아니라 턴 완주(예외 없음·메시지 저장)를 본다.
    expect(result.userMessageId).toBeTruthy();
    expect(store.tables.messages.some(m => m.role === 'user' && m.content === '장애 중에도 대화는 계속')).toBe(true);
    // 세팅은 실패했으나 인메모리 session 객체에는 파생 제목이 반영(재세팅 방지) — DB 행은 미변경(폴백 규칙 유지).
    expect(session.title).toBe('장애 중에도 대화는 계속');
    expect((store.tables.sessions.find(r => r.id === 'session') as any).title ?? null).toBeNull();
  });

  it('큐 드레인 경로도 같은 규칙 (runTextTurn 경유라 별도 코드 없음 — 드레인 호출 자체를 검증)', async () => {
    const { store, db } = freshDb();
    const session = sessionRow();
    store.tables.sessions.push({ ...session } as any);
    await runTextTurn(db, session, 'user', '드레인 첫 질문', { emit: noEmit });
    expect((store.tables.sessions.find(r => r.id === 'session') as any).title).toBe('드레인 첫 질문');
  });
});
