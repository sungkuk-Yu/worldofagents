/**
 * 내구성 실행 — LangGraph 체크포인터 + 런 저널 (t_7182aa8f, 자비스 오케스트레이션 [4] / 김비서 발주)
 *
 * 목적: run(턴 실행)의 그래프 상태를 슈퍼스텝 단위로 직렬화해 백엔드 재시작·재배포로도
 * 멈춘 run을 이어 완성한다 ('화면 조용해짐/답변 유실' 근본 차단).
 *
 * 저장 채널 결정 (카드 [2] 'Supabase PG 재사용, 추가 인프라 0'):
 * - 1순위 PostgresSaver(@langchain/langgraph-checkpoint-postgres)는 pg.Pool 직결 문자열을 요구한다.
 *   우리 백엔드는 Supabase 직결 DSN이 없고(운영 경로는 PostgREST/https + service 키 단일 — .env 실측),
 *   직결은 RLS/네트워크 정책도 새로 파는 길이다. 따라서 **기존 DbClient(PostgREST/devstore) 위에
 *   커스텀 saver**를 얹는다 — 추가 인프라 0, DEV/PROD 코드 경로 동일, 래치 관례(008/011/013) 준수.
 * - 직렬화/저장 계약은 PostgresSaver v1과 동일: serde.dumpsTyped/loadsTyped, 최신 checkpoint_id =
 *   사전순 최대(UUIDv6 = 시간순), 쓰기 dedup은 (task_id, idx), WRITES_IDX_MAP 특수 채널 음수 idx.
 *
 * flag: config.runCheckpoint.enabled (LANGGRAPH_CHECKPOINT=true, **기본 false = 현행 무영속 유지** —
 * 롤백 게이트). off면 이 모듈의 모든 훅이 no-op/null을 돌려주고 graph는 checkpointer 없이 돈다.
 *
 * 테이블 (마이그레이션 014 / devstore):
 * - graph_runs               : run 1행 레시피(재구성 최소 정보) + 멱등 저장 포인터(user/empathy/answer id,
 *                              tail_persisted) — 승격 대상은 'run map'뿐, presence/연결 상태는 휘발 유지(카드 [3]).
 * - graph_checkpoints        : (run_id, checkpoint_ns, checkpoint_id) 스냅샷. blob=null 셸은 getTuple가 무시.
 * - graph_checkpoint_writes  : 태스크 쓰기 (crash-window dedup — 완료 노드 재실행 방지).
 */
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type ChannelVersions,
  type PendingWrite,
  type CheckpointPendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { createHash } from 'node:crypto';
import { config } from '../config';
import type { DbClient } from './supabase';

// ── 래치 (008 PGRST205 관례): 014 미적용 실DB는 체크포인트/저널을 조용히 끈다 ────
let journalTableMissing = false;
export function isJournalKnownUnavailable(): boolean { return journalTableMissing; }
/** 테스트/진단용 래치 리셋 (재발견은 첫 호출에서 다시 일어난다). */
export function __resetCheckpointProbe(): void { journalTableMissing = false; }

export function checkpointEnabled(): boolean {
  return config.runCheckpoint.enabled && !journalTableMissing;
}

export function isMissingCheckpointTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = String(e?.message || '');
  return e?.code === 'PGRST205' || e?.code === '42P01'
    || /graph_runs|graph_checkpoint/i.test(msg);
}

/** 저널 쓰기가 '테이블 없음' 류로 실패하면 래치를 올리고 조용히 삼킨다 (턴을 죽이지 않는다). */
export function swallowJournalWrite(err: unknown): void {
  if (isMissingCheckpointTable(err)) journalTableMissing = true;
}

// ── 런 저널 (graph_runs) ─────────────────────────────────────────────

export interface JournalSeed {
  runId: string;
  sessionId: string;
  userId: string;
  content: string;
  locale: 'ko' | 'en';
  sttMetadata: Record<string, unknown> | null;
  thread: { parentMessageId: string; rootMessageId: string } | null;
  attachmentIds: string[] | null;
  replyToId: string | null;
}

export interface JournalRow {
  run_id: string;
  session_id: string;
  user_id: string;
  status: 'running' | 'completed' | 'failed' | 'abandoned';
  content: string;
  locale: 'ko' | 'en';
  stt_metadata: Record<string, unknown> | null;
  thread: JournalSeed['thread'];
  attachment_ids: string[] | null;
  reply_to_id: string | null;
  engine: 'langgraph' | 'simple' | null;
  user_message_id: string | null;
  empathy_message_id: string | null;
  answer_message_id: string | null;
  tail_persisted: boolean;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

/** 저널 open (flag off면 null = 현행 동작). 실패는 래치 후 null — 발화 경로 무영향. */
export async function openRun(db: DbClient, seed: JournalSeed): Promise<void> {
  if (!checkpointEnabled()) return;
  const row = {
    run_id: seed.runId,
    session_id: seed.sessionId,
    user_id: seed.userId,
    status: 'running' as const,
    content: seed.content,
    locale: seed.locale,
    stt_metadata: seed.sttMetadata,
    thread: seed.thread,
    attachment_ids: seed.attachmentIds,
    reply_to_id: seed.replyToId,
    engine: null,
    user_message_id: null,
    empathy_message_id: null,
    answer_message_id: null,
    tail_persisted: false,
    error_code: null,
  };
  const { error } = await db.from('graph_runs').insert(row);
  if (error) swallowJournalWrite(error);
}

export async function stampRun(db: DbClient, runId: string, patch: Record<string, unknown>): Promise<void> {
  if (!checkpointEnabled()) return;
  const { error } = await db.from('graph_runs').update({ ...patch, updated_at: new Date().toISOString() }).eq('run_id', runId);
  if (error) swallowJournalWrite(error);
}

export const journalStamp = {
  engine: (db: DbClient, runId: string, engine: 'langgraph' | 'simple') => stampRun(db, runId, { engine }),
  user: (db: DbClient, runId: string, messageId: string) => stampRun(db, runId, { user_message_id: messageId }),
  empathy: (db: DbClient, runId: string, messageId: string) => stampRun(db, runId, { empathy_message_id: messageId }),
  answer: (db: DbClient, runId: string, messageId: string) => stampRun(db, runId, { answer_message_id: messageId }),
  tail: (db: DbClient, runId: string) => stampRun(db, runId, { tail_persisted: true }),
  finish: (db: DbClient, runId: string, status: 'completed' | 'failed' | 'abandoned', errorCode?: string | null) =>
    stampRun(db, runId, { status, error_code: errorCode ?? null }),
};

/** run-scoped 결정적 메시지 id (t_7182aa8f②). resume 재실행이 크래시-스탬프 공백으로
 *  같은 저장 지점을 다시 지나도 upsert 수렴 — PK가 (run_id, tag)에서 결정적이므로
 *  user/empathy/answer 행 복제가 구조적으로 불가능하다. flag off 경로는 기존 randomUUID 유지. */
export function runScopedId(runId: string, tag: string): string {
  const h = createHash('sha256').update(`${runId}:${tag}`).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * processTurn의 저널 뷰 — resume 시드 행에서 시작해 저장 지점마다 스탬프를 누적한다.
 * persist는 checkpointEnabled()를 매 호출 재확인: openRun 이후 래치가 켜지면(014 미적용
 * 실DB) 후속 스탬프가 조용히 중단된다. 실패도 삼킨다(답변 완료 우선, 008 관례).
 */
export class JournalState {
  private userId: string | null;
  private empathyId: string | null;
  private answerId: string | null;
  private tail: boolean;
  constructor(private readonly db: DbClient, private readonly runId: string, seed: JournalRow | null) {
    this.userId = seed?.user_message_id ?? null;
    this.empathyId = seed?.empathy_message_id ?? null;
    this.answerId = seed?.answer_message_id ?? null;
    this.tail = seed?.tail_persisted === true;
  }
  get userMessageId(): string | null { return this.userId; }
  get empathyMessageId(): string | null { return this.empathyId; }
  get answerMessageId(): string | null { return this.answerId; }
  get tailPersisted(): boolean { return this.tail; }
  async stampUser(id: string) { this.userId = id; await this.persist({ user_message_id: id }); }
  async stampEmpathy(id: string) { this.empathyId = id; await this.persist({ empathy_message_id: id }); }
  async stampAnswer(id: string) { this.answerId = id; await this.persist({ answer_message_id: id }); }
  async markTail() { this.tail = true; await this.persist({ tail_persisted: true }); }
  async finish(status: 'completed' | 'failed' | 'abandoned', errorCode?: string | null) {
    await this.persist({ status, error_code: errorCode ?? null });
  }
  private async persist(patch: Record<string, unknown>) {
    if (!checkpointEnabled()) return;
    await stampRun(this.db, this.runId, patch);
  }
}

/** 부팅 resume 스캔: 미완 running (created_at 오름, cap). flag off면 빈 배열. */
export async function listOpenRuns(db: DbClient): Promise<JournalRow[]> {
  if (!checkpointEnabled()) return [];
  const { data, error } = await db.from('graph_runs').select('*')
    .eq('status', 'running').order('created_at', { ascending: true }).limit(config.runCheckpoint.maxResumePerBoot);
  if (error) { swallowJournalWrite(error); return []; }
  return (data as JournalRow[]) || [];
}

// ── 체크포인터 saver (graph_checkpoints / graph_checkpoint_writes) ──────

interface CheckpointRow {
  run_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  ts: string | null;
  type: string | null;
  checkpoint: unknown;
  metadata: unknown;
}
interface WriteRow {
  run_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  task_id: string;
  idx: number;
  channel: string;
  type: string;
  value: unknown;
}

/** serde 페이로드 → DB 값. dumpsTyped의 json 계열은 ["json", Uint8Array(JSON 문자열 바이트)]
 *  이다 (jsonplus._dumps = TextEncoder) — JSONB에는 디코딩+파싱한 객체 그대로 넣는다
 *  (PostgREST가 jsonb 리터럴로 직렬화, devstore는 참조 저장). bytes 계열(미사용)만 base64. */
function encodePayload(type: string, payload: unknown): unknown {
  if (type === 'json') {
    if (typeof payload === 'string') return JSON.parse(payload) as unknown;
    if (payload instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(payload)) as unknown;
    return payload; // 안전망: 이미 객체
  }
  if (Buffer.isBuffer(payload)) return payload.toString('base64');
  if (payload instanceof Uint8Array) return Buffer.from(payload).toString('base64');
  return payload;
}

async function decodePayload(type: string | null, stored: unknown): Promise<unknown> {
  const t = type || 'json';
  // jsonb 컬럼은 읽기 시 파싱된 JS 값으로 온다(PostgREST·devstore 공통). 재직렬화된
  // 문자열일 수 없다 — '문자열이면 parse' 안전망은 값 자체가 문자열인 채널(예: 채널
  // write 'value-a')을 훼손하므로 금지. json 계열 = 저장 참조 그대로 반환.
  if (t === 'json') return stored;
  return stored; // 비json 계열(binary 등)은 미사용 — 나오면 저장 시점에 실패로 드러난다
}

/**
 * LangGraph v1 BaseCheckpointSaver 구현 — Supabase transport(DbClient) 공유 계정.
 * thread_id = run_id (run 단위 스레드, 카드 [2]). checkpoint_ns는 루트 ''만 지원.
 * - getTuple: (run_id)의 최신 blob 행 + 태스크 쓰기. 최신 = checkpoint_id 사전순 최대
 *   (PostgresSaver/MemorySaver와 동일 규칙). put이 항상 superstep 스냅샷을 먼저 쓰므로
 *   최신 blob-있는 행이 resume 지점이다. 행 없으면 undefined → 그래프는 정상 fresh 실행.
 * - put: (run_id,ns,id) 업서트 (parent는 cfg.configurable.checkpoint_id — Pregel 호출 관례).
 * - putWrites: (…,task,idx) dedup — idx>=0 선점 스킵은 upsert가 덮어쓰므로 무해(같은 값).
 * - deleteThread: 세션 파기·수동 정리.
 * 014 미적용: 조회 실패(PGRST205) → 래치, 이후 checkpointEnabled() false =全员 no-op.
 */
export class SupabaseCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly db: DbClient) { super(); }

  /** 마지막 put이 준 config (putWrites의 checkpoint_id 폴백 — PostgresSaver 동일). */
  private lastPut: RunnableConfig | null = null;

  private threadOf(cfg: RunnableConfig): { runId: string | undefined; ns: string } {
    return {
      runId: cfg.configurable?.thread_id as string | undefined,
      ns: (cfg.configurable?.checkpoint_ns as string) || '',
    };
  }

  /** devstore는 order('checkpoint_id', desc).limit(n)이 select-후-슬라이스라 사전순 '최근 n'이
   *  보장된다. 200 캡 = run당 superstep 수(≤10) 대비 넉넉. */
  private async fetchCheckpointRows(runId: string, ns: string, checkpointId?: string): Promise<CheckpointRow[]> {
    let query = this.db.from('graph_checkpoints').select('*').eq('run_id', runId).eq('checkpoint_ns', ns);
    if (checkpointId !== undefined) query = query.eq('checkpoint_id', checkpointId);
    else query = query.order('checkpoint_id', { ascending: false }).limit(200);
    const { data, error } = await query;
    if (error) {
      if (isMissingCheckpointTable(error)) journalTableMissing = true;
      else throw error;
      return [];
    }
    const rows = ((data as CheckpointRow[]) || []).filter(r => r.checkpoint != null);
    if (checkpointId !== undefined) return rows;
    return rows.sort((a, b) => (a.checkpoint_id < b.checkpoint_id ? 1 : a.checkpoint_id > b.checkpoint_id ? -1 : 0));
  }

  private async fetchWrites(runId: string, ns: string, checkpointId: string): Promise<CheckpointPendingWrite[]> {
    const { data, error } = await this.db.from('graph_checkpoint_writes').select('*')
      .eq('run_id', runId).eq('checkpoint_ns', ns).eq('checkpoint_id', checkpointId);
    if (error) {
      if (isMissingCheckpointTable(error)) journalTableMissing = true;
      else throw error;
      return [];
    }
    const rows = ((data as WriteRow[]) || []).sort((a, b) => a.idx - b.idx);
    const out: CheckpointPendingWrite[] = [];
    for (const r of rows) {
      out.push([r.task_id, r.channel, await decodePayload(r.type, r.value)] as CheckpointPendingWrite);
    }
    return out;
  }

  async getTuple(cfg: RunnableConfig): Promise<CheckpointTuple | undefined> {
    if (!checkpointEnabled()) return undefined;
    const { runId, ns } = this.threadOf(cfg);
    if (!runId) throw new Error('getTuple: thread_id(run_id) 필수 — checkpointer는 run 단위 스레드로만 동작');
    const wanted = (cfg.configurable?.checkpoint_id as string | undefined)
      ?? (cfg as { checkpointId?: string }).checkpointId ?? undefined;
    const rows = await this.fetchCheckpointRows(runId, ns, wanted);
    const row = wanted ? rows[0] : rows[0];
    if (!row) return undefined;
    const checkpoint = await decodePayload(row.type, row.checkpoint) as Checkpoint;
    const metadata = (row.metadata ? (await decodePayload('json', row.metadata)) : { source: 'loop', step: 0, parents: {} }) as CheckpointMetadata;
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: runId, checkpoint_ns: ns, checkpoint_id: row.checkpoint_id } },
      checkpoint,
      metadata,
      pendingWrites: await this.fetchWrites(runId, ns, row.checkpoint_id),
    };
    if (row.parent_checkpoint_id) {
      tuple.parentConfig = { configurable: { thread_id: runId, checkpoint_ns: ns, checkpoint_id: row.parent_checkpoint_id } };
    }
    return tuple;
  }

  async put(
    cfg: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const { runId, ns } = this.threadOf(cfg);
    if (!runId) throw new Error('put: thread_id(run_id) 필수');
    const [type, blob] = await this.serde.dumpsTyped(checkpoint);
    const [metaType, metaBlob] = await this.serde.dumpsTyped({ ...metadata });
    void metaType; // json 고정 계열 (BaseCheckpointSaver 기본 serde)
    const parent = (cfg.configurable?.checkpoint_id as string | undefined) ?? null;
    const row = {
      run_id: runId,
      checkpoint_ns: ns,
      checkpoint_id: checkpoint.id,
      parent_checkpoint_id: parent,
      ts: checkpoint.ts,
      type,
      checkpoint: encodePayload(type, blob),
      metadata: encodePayload('json', metaBlob),
      step: (metadata as { step?: number }).step ?? 0,
    };
    const { error } = await this.db.from('graph_checkpoints').upsert(row, { onConflict: 'run_id,checkpoint_ns,checkpoint_id' });
    if (error) {
      if (isMissingCheckpointTable(error)) { journalTableMissing = true; return cfg; }
      throw error;
    }
    const next: RunnableConfig = {
      configurable: { ...(cfg.configurable ?? {}), thread_id: runId, checkpoint_ns: ns, checkpoint_id: checkpoint.id },
    };
    this.lastPut = next;
    return next;
  }

  async putWrites(cfg: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    if (!checkpointEnabled()) return;
    const { runId, ns } = this.threadOf(cfg);
    if (!runId) throw new Error('putWrites: thread_id(run_id) 필수');
    let checkpointId = (cfg.configurable?.checkpoint_id as string | undefined)
      ?? (cfg as { checkpointId?: string }).checkpointId;
    if (!checkpointId && this.lastPut?.configurable?.thread_id === runId) {
      checkpointId = this.lastPut.configurable?.checkpoint_id as string;
    }
    if (!checkpointId) throw new Error(`putWrites: checkpoint_id 없음 (스레드 ${runId})`);
    for (let i = 0; i < writes.length; i++) {
      const [channel, value] = writes[i];
      const idx = WRITES_IDX_MAP[channel] ?? i;
      const [type, blob] = await this.serde.dumpsTyped(value);
      const row = {
        run_id: runId, checkpoint_ns: ns, checkpoint_id: checkpointId,
        task_id: taskId, idx, channel, type, value: encodePayload(type, blob),
      };
      const { error } = await this.db.from('graph_checkpoint_writes')
        .upsert(row, { onConflict: 'run_id,checkpoint_ns,checkpoint_id,task_id,idx' });
      if (error) {
        if (isMissingCheckpointTable(error)) { journalTableMissing = true; return; }
        throw error;
      }
    }
  }

  /** list는 resume 경로(getStateHistory)가 필요로 하지 않는다 — 저널 무결성 스캔용 최소형. */
  async *list(cfg: RunnableConfig, options?: { limit?: number; before?: RunnableConfig; filter?: Partial<CheckpointMetadata> }): AsyncGenerator<CheckpointTuple> {
    if (!checkpointEnabled()) return;
    const { runId, ns } = this.threadOf(cfg);
    if (!runId) return; // 전-테이블 스캔 금지 (PostgREST 페이징 폭주 방어)
    const beforeId = options?.before?.configurable?.checkpoint_id as string | undefined;
    let remaining = options?.limit ?? Infinity;
    for (const row of await this.fetchCheckpointRows(runId, ns)) {
      if (beforeId && row.checkpoint_id >= beforeId) continue;
      if (remaining <= 0) break;
      remaining -= 1;
      const checkpoint = await decodePayload(row.type, row.checkpoint) as Checkpoint;
      const metadata = (row.metadata ? (await decodePayload('json', row.metadata)) : { source: 'loop', step: 0, parents: {} }) as CheckpointMetadata;
      if (options?.filter && !Object.entries(options.filter).every(([k, v]) => (metadata as Record<string, unknown>)[k] === v)) continue;
      yield {
        config: { configurable: { thread_id: runId, checkpoint_ns: ns, checkpoint_id: row.checkpoint_id } },
        checkpoint,
        metadata,
        pendingWrites: await this.fetchWrites(runId, ns, row.checkpoint_id),
      };
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!checkpointEnabled()) return;
    // 체크포인트+쓰기+런 저널 동시 파기 (GDPR/세션 삭제 — 저널이 남으면 부팅 스캐너가
    // 이미 지워진 run을 resume 시도해 EmptyInputError 루프가 된다).
    for (const table of ['graph_checkpoint_writes', 'graph_checkpoints', 'graph_runs']) {
      const { error } = await this.db.from(table).delete().eq('run_id', threadId);
      if (error && !isMissingCheckpointTable(error)) throw error;
    }
  }
}

/**
 * run 전용 saver 인스턴스 — flag off/래치 on이면 null (그래프는 checkpointer 없이 돈다).
 * 인스턴스별 lastPut 캐시(putWrites의 checkpoint_id 폴백)를 쓰므로 동시 실행 간
 * 캐시 오염을 막기 위해 processTurn당 1개를 만든다 (저장소 상태는 전부 DB라 가볍다).
 */
export function createSaver(db: DbClient): SupabaseCheckpointSaver | null {
  return checkpointEnabled() ? new SupabaseCheckpointSaver(db) : null;
}
/** 테스트: 래치 초기화 + saver 재생성 유도. */
export function __resetCheckpointCache(): void { journalTableMissing = false; }
