/**
 * 내구성 실행 (t_7182aa8f) — 체크포인터 + 런 저널 + resume 계약.
 *
 * flag 기본(false): graph_* 무접촉·resume 0건 (롤백 게이트 1:1).
 * flag(true): 저널 수명주기(running→completed/failed), 저장 지점 가드(resume가
 * user/empathy 복제 없이 answerNode로 이어 완성), 결정적 메시지 id(upsert 수렴),
 * saver roundtrip(getTuple/put/putWrites/deleteThread), PGRST205 래치 강등,
 * 부팅 스캐너(아카이브 abandoned / minAge / run map만 승격).
 *
 * '크래시' 재현 = devstore에서 저널/행 상태를 surgical 하게 되돌리기 — processTurn의
 * 저장 지점 가드가 실데이터에 동작함을 확인하는 것이 목적 (SIGKILL 시뮬레이터 아님).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { config } from '../../src/config';
import { createDevClient, createStore, resetStore } from '../../src/lib/devstore';
import { runTextTurn, type TurnEmitEvent } from '../../src/lib/chatTurn';
import type { DbClient } from '../../src/lib/supabase';
import type { SessionsRow } from '../../src/types/db';
import {
  checkpointEnabled, journalStamp, listOpenRuns, openRun, runScopedId,
  SupabaseCheckpointSaver, __resetCheckpointCache, type JournalRow,
} from '../../src/lib/runCheckpoint';
import { resumeOpenRuns } from '../../src/lib/resume';

const session = { id: 'sess-ck', user_id: 'user-ck', agent_id: 'agent-ck', persona_id: 'persona-ck', status: 'active' } as SessionsRow;
let db: DbClient;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  db = createDevClient(store) as DbClient;
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(false);
  vi.spyOn(config.runCheckpoint, 'enabled', 'get').mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  __resetCheckpointCache();
  resetStore();
});

const run = (events: TurnEmitEvent[] = [], text = '오늘 일정 알려줘') =>
  runTextTurn(db, session, session.user_id, text, { emit: e => events.push(e) });

const seedRow = (over: Partial<JournalRow> = {}): JournalRow => ({
  run_id: randomUUID(), session_id: session.id, user_id: session.user_id, status: 'running',
  content: '이어 실행할 발화', locale: 'ko', stt_metadata: null, thread: null,
  attachment_ids: null, reply_to_id: null, engine: 'langgraph',
  user_message_id: null, empathy_message_id: null, answer_message_id: null,
  tail_persisted: false, error_code: null,
  created_at: new Date(Date.now() - 60_000).toISOString(), updated_at: new Date().toISOString(),
  ...over,
});

/** journal 상태를 크래시 직전으로 되돌리기 (resume 재현의 단일 지점). */
function crashAt(runId: string, stage: 'user' | 'empathy' | 'answer' | 'tail') {
  const keep = { user: stage !== 'user', empathy: stage === 'tail' || stage === 'answer', answer: false, tail: false };
  store.tables.messages = store.tables.messages.filter(m =>
    (m.role === 'user' && keep.user) || (m.source_neuron === 'empathy' && keep.empathy) || (m.source_neuron === 'answer' && keep.answer));
  if (!keep.tail) store.tables.context_patches = [];
  store.tables.graph_runs = store.tables.graph_runs.map(x => x.run_id === runId ? {
    ...x, status: 'running',
    user_message_id: keep.user ? x.user_message_id : null,
    empathy_message_id: keep.empathy ? x.empathy_message_id : null,
    answer_message_id: null, tail_persisted: keep.tail, error_code: null,
  } : x);
}

// ── [1] flag off = 무영속 1:1 ────────────────────────────────────────
describe('LANGGRAPH_CHECKPOINT=false (기본 · 롤백 게이트)', () => {
  it('턴 성공·실패 모두 graph_* 테이블 무접촉, resume 스캔 0건', async () => {
    await run();
    expect(store.tables.graph_runs).toHaveLength(0);
    expect(store.tables.graph_checkpoints).toHaveLength(0);
    expect(store.tables.graph_checkpoint_writes).toHaveLength(0);
    expect(await resumeOpenRuns(db, { minAgeMs: 0 })).toBe(0);
  });
  it('메시지 id는 기존 randomUUID 경로 유지 (결정적 id 미사용)', async () => {
    const r = await run([], '회의록 초안');
    const userRow = store.tables.messages.find(m => m.role === 'user')!;
    expect(userRow.id).not.toBe(runScopedId(r.turnId, 'user'));
  });
});

// ── [2] flag on — 저널 수명주기 + 체크포인트 적재 ────────────────────
describe('LANGGRAPH_CHECKPOINT=true — 런 저널·체크포인트 적재', () => {
  beforeEach(() => {
    vi.spyOn(config.runCheckpoint, 'enabled', 'get').mockReturnValue(true);
    store.tables.sessions = [{ ...session }];
  });

  it('성공 턴: running→completed, user/empathy/answer/tail 스탬프, superstep 스냅샷+쓰기 적재', async () => {
    vi.spyOn(config, 'neuronEngine', 'get').mockReturnValue('langgraph');
    const r = await run([], '프로젝트 브리핑 초안');
    const row = store.tables.graph_runs.find(x => x.run_id === r.turnId)!;
    expect(row.status).toBe('completed');
    expect(row.engine).toBe('langgraph');
    expect(row.user_message_id).toBe(r.userMessageId);
    if (r.empathyMessageId) expect(row.empathy_message_id).toBe(r.empathyMessageId);
    expect(row.answer_message_id).toBe(r.answerMessageId);
    expect(row.tail_persisted).toBe(true);
    const cps = store.tables.graph_checkpoints.filter(c => c.run_id === r.turnId);
    expect(cps.length).toBeGreaterThanOrEqual(3); // input + supersteps + final
    expect(cps.every(c => c.checkpoint && typeof c.checkpoint === 'object' && 'channel_values' in (c.checkpoint as any))).toBe(true);
    // 태스크 쓰기가 crash-window dedup용으로 남는다 (완료 노드 재실행 방지 근거).
    expect(store.tables.graph_checkpoint_writes.some(w => w.run_id === r.turnId)).toBe(true);
  });

  it('실패 턴: journal failed + error_code — 부팅 스캐너 재집지 대상에서 제외', async () => {
    const original = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((table: string) => {
      const q = original(table);
      if (table === 'messages') {
        for (const kind of ['insert', 'upsert'] as const) {
          const fn = q[kind].bind(q);
          (q as any)[kind] = (row: any) => (row.source_neuron ?? (Array.isArray(row) ? row[0]?.source_neuron : undefined)) === 'answer'
            ? { select: () => ({ single: async () => ({ data: null, error: { message: '답변 저장 실패' } }) }) }
            : fn(row);
        }
      }
      return q;
    });
    await expect(run([], '일정 조율해줘')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    const failed = store.tables.graph_runs.find(r => r.status === 'failed')!;
    expect(failed.error_code).toBe('INTERNAL_ERROR');
    expect(await listOpenRuns(db)).toHaveLength(0);
  });

  it('메시지 id = run_scoped 결정적 UUID (t_7182aa8f②)', async () => {
    const r = await run([], '결정적 id 확인 질문');
    expect(r.userMessageId).toBe(runScopedId(r.turnId, 'user'));
    expect(r.empathyMessageId).toBe(runScopedId(r.turnId, 'empathy'));
    expect(r.answerMessageId).toBe(runScopedId(r.turnId, 'answer'));
    expect(runScopedId(r.turnId, 'answer')).toBe(runScopedId(r.turnId, 'answer')); // 멱등
    expect(runScopedId('other-run', 'answer')).not.toBe(runScopedId(r.turnId, 'answer'));
  });
});

// ── [3] resume: 구간 재시작 — 중복 user/empathy 없음, answerNode로 이어 완성 ──
describe('resume — 크래시한 run 이어 실행', () => {
  beforeEach(() => {
    vi.spyOn(config.runCheckpoint, 'enabled', 'get').mockReturnValue(true);
    store.tables.sessions = [{ ...session }]; // resume 스캐너의 세션 존속 확인 대상
  });

  it('answer 저장 직전 크래시: user/empathy 복제 없이 answer 단 1행 완성, 저널 completed', async () => {
    const r = await run([], '이어 완성할 발화');
    const total = store.tables.messages.length; // user(+empathy)+answer
    crashAt(r.turnId, 'answer');                 // answer 행만 날림, 저널 running 회귀
    store.tables.messages = store.tables.messages.filter(m => m.source_neuron !== 'answer');

    expect(await resumeOpenRuns(db, { minAgeMs: 0 })).toBe(1);

    expect(store.tables.messages.filter(m => m.role === 'user').length).toBe(1);            // 복제 없음
    expect(store.tables.messages.filter(m => m.source_neuron === 'empathy').length).toBe(1); // 복제 없음
    const answer = store.tables.messages.find(m => m.source_neuron === 'answer')!;
    expect(answer.content).toBeTruthy();                                                      // 이어 완성
    expect(answer.id).toBe(runScopedId(r.turnId, 'answer'));                                  // 결정적 수렴
    expect(store.tables.messages.length).toBe(total);                                         // 총 행 수 불변
    const row = store.tables.graph_runs.find(x => x.run_id === r.turnId)!;
    expect(row.status).toBe('completed');
    expect(row.answer_message_id).toBe(answer.id);
    expect(row.tail_persisted).toBe(true);
    // conversation.recent 패치는 tail 가드로 복제 없음 (user/agent 2행 유지)
    expect(store.tables.context_patches.filter(p => p.key === 'conversation.recent').length).toBe(2);
  });

  it('크래시-스탬프 공백(행 쓰이고 stamp 미도달): 결정적 id 히트로 로드, 재저장·복제 없음', async () => {
    const r = await run([], '스탬프 공백 재현 발화');
    store.tables.graph_runs = store.tables.graph_runs.map(x => x.run_id === r.turnId
      ? { ...x, status: 'running', empathy_message_id: null, answer_message_id: null, tail_persisted: true } : x);
    const before = store.tables.messages.map(m => m.id).sort().join(',');

    expect(await resumeOpenRuns(db, { minAgeMs: 0 })).toBe(1);
    const after = store.tables.messages.map(m => m.id).sort().join(',');
    expect(after).toBe(before); // 같은 id 집합 = 복제 0 (upsert 수렴 검증)
    expect(store.tables.graph_runs.find(x => x.run_id === r.turnId)!.status).toBe('completed');
  });

  it('empathy 직전 크래시(그래프 미전환, 체크포인트 입력 단계): user 로드+그래프 재실행으로 완성', async () => {
    const r = await run([], '그래프 중간 크래시 재현');
    crashAt(r.turnId, 'empathy'); // user만 스탬프 유지, empathy/answer 행·패치 삭제
    const events: TurnEmitEvent[] = [];
    const row = store.tables.graph_runs.find(x => x.run_id === r.turnId) as JournalRow;
    await runTextTurn(db, session, session.user_id, row.content, { resume: { ...row }, emit: e => events.push(e) });
    const userRows = store.tables.messages.filter(m => m.role === 'user');
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe(r.userMessageId);       // 원 user 행 재사용 (turn_index 보존)
    expect(userRows[0].turn_index).toBe(store.tables.messages.find(m => m.source_neuron === 'answer')!.turn_index - 1);
    expect(store.tables.messages.find(m => m.source_neuron === 'answer')!.id).toBe(runScopedId(r.turnId, 'answer'));
    expect(events.filter(e => e.type === 'run.failed')).toHaveLength(0);
  });

  it('아카이브 세션의 미완 run: resume 스킵 + abandoned 마감', async () => {
    const row = seedRow();
    await openRun(db, { runId: row.run_id, sessionId: session.id, userId: row.user_id, content: row.content, locale: 'ko', sttMetadata: null, thread: null, attachmentIds: null, replyToId: null });
    store.tables.sessions = []; // 세션 소멸 (실DB CASCADE 재현)
    expect(await resumeOpenRuns(db, { minAgeMs: 0 })).toBe(0);
    expect(store.tables.graph_runs.find(r => r.run_id === row.run_id)!.status).toBe('abandoned');
  });

  it('minAge: 막 시작한 run은 이번 부팅 대상 아님 — running 유지', async () => {
    const row = seedRow({ created_at: new Date().toISOString() });
    await openRun(db, { runId: row.run_id, sessionId: session.id, userId: row.user_id, content: row.content, locale: 'ko', sttMetadata: null, thread: null, attachmentIds: null, replyToId: null });
    expect(await resumeOpenRuns(db, { minAgeMs: 5_000 })).toBe(0);
    expect(store.tables.graph_runs.find(r => r.run_id === row.run_id)!.status).toBe('running');
  });
});

// ── [4] saver roundtrip (PostgREST transport 위 PostgresSaver 계약) ──
describe('SupabaseCheckpointSaver 계약', () => {
  beforeEach(() => { vi.spyOn(config.runCheckpoint, 'enabled', 'get').mockReturnValue(true); });
  const mkCheckpoint = (channelValues: Record<string, unknown>, id: string) => ({
    v: 1, id, ts: new Date().toISOString(),
    channel_values: channelValues, channel_versions: { out: 1 },
    versions_seen: { __input__: {} }, pending_sends: [],
  }) as any;
  const md = (source: 'input' | 'loop', step: number) => ({ source, step, parents: {} }) as any;

  it('미지정 스레드 getTuple=undefined', async () => {
    const saver = new SupabaseCheckpointSaver(db);
    expect(await saver.getTuple({ configurable: { thread_id: 'ghost' } })).toBeUndefined();
  });

  it('put→getTuple: channel_values/parent 체인 roundtrip, 최신 = checkpoint_id 사전순 max', async () => {
    const saver = new SupabaseCheckpointSaver(db);
    const cfg1 = await saver.put({ configurable: { thread_id: 't-ck' } }, mkCheckpoint({ counter: 1 }, 'ck-01'), md('input', -1), { counter: 1 });
    expect(cfg1.configurable!.thread_id).toBe('t-ck');
    const tuple = await saver.getTuple(cfg1);
    expect(tuple!.checkpoint.channel_values).toEqual({ counter: 1 });
    expect(tuple!.metadata!.source).toBe('input');

    await saver.put(cfg1, mkCheckpoint({ counter: 2 }, 'ck-02'), md('loop', 0), { counter: 2 });
    const latest = await saver.getTuple({ configurable: { thread_id: 't-ck' } });
    expect(latest!.checkpoint.channel_values).toEqual({ counter: 2 });
    expect(latest!.parentConfig!.configurable!.checkpoint_id).toBe('ck-01');

    const ids: string[] = [];
    for await (const t of saver.list({ configurable: { thread_id: 't-ck' } })) ids.push(t.checkpoint.id);
    expect(ids).toEqual(['ck-02', 'ck-01']); // 최신→옛순
  });

  it('putWrites→getTuple.pendingWrites: (task, idx) dedup — 재put 멱등', async () => {
    const saver = new SupabaseCheckpointSaver(db);
    const cfg = await saver.put({ configurable: { thread_id: 't-w' } }, mkCheckpoint({ a: 1 }, 'ck-10'), md('loop', 0), {});
    await saver.putWrites(cfg, [['out', 'value-a'], ['__error__', null]], 'task-1');
    await saver.putWrites(cfg, [['out', 'value-a']], 'task-1'); // 재실행 재put = 수렴, 복제 없음
    const t = await saver.getTuple(cfg);
    expect(t!.pendingWrites).toHaveLength(2);
    // idx 오름: __error__ = WRITES_IDX_MAP -1, out = 0
    expect(t!.pendingWrites![0]).toEqual(['task-1', '__error__', null]);
    expect(t!.pendingWrites![1]).toEqual(['task-1', 'out', 'value-a']);
  });

  it('deleteThread = 체크포인트+writes+런저널 즉시 파기 (GDPR/세션 삭제)', async () => {
    const saver = new SupabaseCheckpointSaver(db);
    await saver.put({ configurable: { thread_id: 't-del' } }, mkCheckpoint({ a: 1 }, 'ck-20'), md('loop', 0), {});
    await openRun(db, { runId: 't-del', sessionId: session.id, userId: session.user_id, content: '삭제 대상', locale: 'ko', sttMetadata: null, thread: null, attachmentIds: null, replyToId: null });
    await saver.deleteThread('t-del');
    expect(store.tables.graph_runs.filter(r => r.run_id === 't-del')).toHaveLength(0);
    expect(store.tables.graph_checkpoints.filter(c => c.run_id === 't-del')).toHaveLength(0);
    expect(await saver.getTuple({ configurable: { thread_id: 't-del' } })).toBeUndefined();
  });

  it('014 미적용 래치: 첫 접촉 PGRST205 → checkpointEnabled false, 턴은 정상 완성 (008 관례)', async () => {
    vi.spyOn(config.runCheckpoint, 'enabled', 'get').mockReturnValue(true);
    const original = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((table: string) => {
      if (!/^graph_/.test(table)) return original(table);
      // 어떤 체이닝(insert/upsert/update/select/eq/order/limit)이든 PGRST205로 해결되는 thenable 사슬
      const chain: any = new Proxy(function () {}, {
        get: (_t, p) => p === 'then' ? (res: any) => res({ data: null, error: { code: 'PGRST205', message: `'${String(p)}' relation not found` } }) : chain,
        apply: () => chain,
      });
      return chain;
    });
    const r = await run([], '래치 후 무영속 발화');
    expect(r.answerMessageId).toBeTruthy();          // 답변 완성 — 발화 경로 무영향
    expect(checkpointEnabled()).toBe(false);          // 래치 온
    expect(store.tables.graph_runs).toHaveLength(0);  // 실 devstore 테이블 무접촉
    // 후속 턴도 조용히 무영속 (스캐너도 0)
    const r2 = await run([], '래치 후 두 번째 발화');
    expect(r2.answerMessageId).toBeTruthy();
    expect(await resumeOpenRuns(db, { minAgeMs: 0 })).toBe(0);
  });

  it('finish abandoned: 취소 경로는 스탬프 후 재resume 대상 제외', async () => {
    const row = seedRow();
    await openRun(db, { runId: row.run_id, sessionId: session.id, userId: row.user_id, content: row.content, locale: 'ko', sttMetadata: null, thread: null, attachmentIds: null, replyToId: null });
    await journalStamp.finish(db, row.run_id, 'abandoned', 'RUN_CANCELLED');
    expect(store.tables.graph_runs.find(r => r.run_id === row.run_id)!.status).toBe('abandoned');
    expect(await listOpenRuns(db)).toHaveLength(0);
    expect(await resumeOpenRuns(db, { minAgeMs: 0 })).toBe(0);
  });
});

// ── [5] 승격 범위 (카드 [3]: run map만, presence/연결 상태 휘발 유지) ──
describe('영속화 승격 범위', () => {
  it('graph_runs는 레시피+포인터 필드만 — device/presence/socket류 필드 없음', async () => {
    vi.spyOn(config.runCheckpoint, 'enabled', 'get').mockReturnValue(true);
    const r = await run([], '승격 범위 확인');
    const row = store.tables.graph_runs.find(x => x.run_id === r.turnId)!;
    expect(Object.keys(row).filter(k => /device|presence|socket|connection|seq/i.test(k))).toEqual([]);
  });
});
