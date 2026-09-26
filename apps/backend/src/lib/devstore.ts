/**
 * DEV_MODE용 인메모리 데이터 스토어.
 * Supabase/PostgREST 클라이언트와 동일한 체이닝 API를 제공해
 * 외부 의존성 없이 서버 부팅·테스트를 가능하게 한다.
 * RLS 대신 라우트가 항상 user_id 기반 필터를 명시하는 것을 전제로 한다.
 */
import crypto from 'node:crypto';

export type DevRow = Record<string, any>;

export interface DevStore {
  tables: Record<string, DevRow[]>;
  usersByEmail: Map<string, { email: string; password: string; user: DevRow }>;
  sequences: Record<string, number>;
}

function randomUUID(): string {
  return crypto.randomUUID();
}

export const emptyStore = (): DevStore => ({
  tables: {
    users: [],
    agents: [],
    personas: [],
    sessions: [],
    neurons: [],
    neuron_instances: [],
    neuron_connections: [],
    messages: [],
    raw_transcripts: [],
    compressed_memories: [],
    tasks: [],
    task_logs: [],
    skills: [],
    skill_installations: [],
    context_patches: [],
  },
  usersByEmail: new Map(),
  sequences: {},
});

/** 기본 뉴런 4종 + 커스텀 1종 (seed.sql과 동일한 데이터) */
const DEFAULT_NEURONS: DevRow[] = [
  { name: '공감 에이뉴런', slug: 'empathy', description: '사용자 입력을 즉시 인지하고 공감 반응을 생성. 상시 활성.', category: 'core', version: '1.0.0', author: 'agenttalk', capabilities: ['empathy_response', 'active_listening', 'acknowledgment'], trigger_conditions: ['any_user_input'], resource_requirements: { cpu: '0.3', memory: '128MB', gpu: false, model: 'gpt-4o-mini' }, dependencies: [], persona_compatible: true, status: 'active', always_active: true, usage_count: 0, success_count: 0, failure_count: 0, satisfaction_sum: 0, satisfaction_count: 0 },
  { name: '답변생성 에이뉴런', slug: 'answer', description: '사용자 요청에 대한 실질적 답변 생성. 스트리밍 출력.', category: 'core', version: '1.0.0', author: 'agenttalk', capabilities: ['answer_generation', 'research', 'summarization', 'writing'], trigger_conditions: ['question_detected', 'request_detected'], resource_requirements: { cpu: '1.0', memory: '512MB', gpu: false, model: 'gpt-4o' }, dependencies: [], persona_compatible: true, status: 'active', always_active: false, usage_count: 0, success_count: 0, failure_count: 0, satisfaction_sum: 0, satisfaction_count: 0 },
  { name: '큐 에이뉴런', slug: 'queue', description: '끼어든 입력의 성격 판별 — 병합 또는 큐잉.', category: 'core', version: '1.0.0', author: 'agenttalk', capabilities: ['intent_classification', 'merge_decision', 'queue_management'], trigger_conditions: ['active_task_exists', 'user_interruption'], resource_requirements: { cpu: '0.2', memory: '128MB', gpu: false, model: 'gpt-4o-mini' }, dependencies: [], persona_compatible: true, status: 'active', always_active: false, usage_count: 0, success_count: 0, failure_count: 0, satisfaction_sum: 0, satisfaction_count: 0 },
  { name: '비주얼 에이뉴런', slug: 'visual', description: '표, 차트, 인포그래픽 등 시각 산출물 생성.', category: 'core', version: '1.0.0', author: 'agenttalk', capabilities: ['chart_generation', 'infographic', 'table_rendering', 'svg_output'], trigger_conditions: ['visual_output_needed', 'chart_request', 'data_visualization'], resource_requirements: { cpu: '1.0', memory: '1GB', gpu: false, model: 'gpt-4o' }, dependencies: [], persona_compatible: true, status: 'active', always_active: false, usage_count: 0, success_count: 0, failure_count: 0, satisfaction_sum: 0, satisfaction_count: 0 },
  { name: '번역 에이뉴런', slug: 'translation', description: '다국어 입력 감지 시 실시간 번역 제공.', category: 'custom', version: '1.0.0', author: 'agenttalk-official', capabilities: ['translation', 'language_detection'], trigger_conditions: ['multilingual_input', 'explicit_translation_request'], resource_requirements: { cpu: '0.5', memory: '256MB', gpu: false, model: 'nllb-200-distilled-600M' }, dependencies: [], persona_compatible: true, status: 'active', always_active: false, usage_count: 0, success_count: 0, failure_count: 0, satisfaction_sum: 0, satisfaction_count: 0 },
];

const DEFAULT_SKILLS: DevRow[] = [
  { name: '캘린더 마법사', slug: 'calendar-magic', description: '일정 생성·관리 자동화 스킬', category: 'productivity', version: '1.0.0', author_id: null, author_name: 'agenttalk', content: { prompt: '일정을 관리해주세요' }, icon_url: null, price: 0, status: 'published', security_scan: {}, install_count: 12, usage_count: 30, satisfaction_sum: 24, satisfaction_count: 6 },
  { name: '이메일 비서', slug: 'email-assistant', description: '이메일 작성·정리 자동화 스킬', category: 'productivity', version: '1.0.0', author_id: null, author_name: 'agenttalk', content: { prompt: '이메일을 작성해주세요' }, icon_url: null, price: 0, status: 'published', security_scan: {}, install_count: 8, usage_count: 20, satisfaction_sum: 18, satisfaction_count: 5 },
  { name: '차트 생성기', slug: 'chart-generator', description: '데이터에서 차트·그래프 생성', category: 'analysis', version: '1.0.0', author_id: null, author_name: 'agenttalk', content: { prompt: '차트를 만들어주세요' }, icon_url: null, price: 100, status: 'published', security_scan: {}, install_count: 5, usage_count: 10, satisfaction_sum: 10, satisfaction_count: 3 },
];

function seedStore(store: DevStore) {
  const now = new Date().toISOString();
  for (const n of DEFAULT_NEURONS) {
    store.tables.neurons.push({ id: randomUUID(), ...n, created_at: now, updated_at: now });
  }
  for (const s of DEFAULT_SKILLS) {
    store.tables.skills.push({ id: randomUUID(), ...s, created_at: now, updated_at: now });
  }
}

export function createStore(): DevStore {
  const store = emptyStore();
  seedStore(store);
  return store;
}

/** 현재 전역 스토어 (테스트에서 초기화/검증용) */
export const __devStore: { store: DevStore | null } = { store: null };

export function getStore(): DevStore {
  if (!__devStore.store) __devStore.store = createStore();
  return __devStore.store;
}

export function resetStore(): DevStore {
  __devStore.store = null;
  return getStore();
}

type QueryResult = { data: any; error: { message: string } | null };

// ── 연산 타입 ──────────────────────────────────────────
interface Filter {
  field: string;
  predicate: (v: unknown) => boolean;
}

interface SelectOp {
  kind: 'select';
  filters: Filter[];
  orderBy: { field: string; ascending: boolean }[];
  limit: number | null;
  single: boolean;
  maybeSingle: boolean;
  columns: string;
}

/**
 * Mutation op — insert/upsert/update/delete.
 * - `filters`: update/delete의 대상 행 필터 (supabase-js처럼 `.eq()` 체이닝으로 누적)
 * - `then`: Mutation 뒤의 `.select()/.single()` 체이닝 (Postgres RETURNING 개념).
 *   select 계열 메서드는 mutation을 소멸시키지 않고 then에 반영한다.
 */
interface MutationOp {
  kind: 'insert' | 'upsert' | 'update' | 'delete';
  filters: Filter[];
  then: SelectOp | null;
}

type PendingOperation =
  | SelectOp
  | (MutationOp & { kind: 'insert' | 'upsert'; rows: DevRow[]; conflictKey: string | null })
  | (MutationOp & { kind: 'update'; values: DevRow })
  | (MutationOp & { kind: 'delete' });

function freshSelect(): SelectOp {
  return { kind: 'select', filters: [], orderBy: [], limit: null, single: false, maybeSingle: false, columns: '*' };
}

function cloneSelect(op: SelectOp | null): SelectOp | null {
  return op ? { ...op, filters: [...op.filters] } : null;
}

function mutationWith<T extends MutationOp>(op: T, patch: Partial<MutationOp>): T {
  return { ...op, ...patch, filters: patch.filters ? [...patch.filters] : [...op.filters] };
}

export class DevQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private store: DevStore, private table: string, private op: PendingOperation) {}

  select(columns = '*'): DevQueryBuilder {
    const op = this.op;
    if (op.kind === 'select') {
      return new DevQueryBuilder(this.store, this.table, { ...op, kind: 'select', columns });
    }
    // Mutation 뒤의 RETURNING select — mutation은 유지하고 then만 갱신
    const then = cloneSelect(op.then) ?? freshSelect();
    then.columns = columns;
    return new DevQueryBuilder(this.store, this.table, mutationWith(op, { then }));
  }

  eq(field: string, value: unknown): DevQueryBuilder {
    return this.addFilter(field, (v) => v === value);
  }

  neq(field: string, value: unknown): DevQueryBuilder {
    return this.addFilter(field, (v) => v !== value);
  }

  gt(field: string, value: unknown): DevQueryBuilder {
    return this.addFilter(field, (v) => (v as number) > (value as number));
  }

  gte(field: string, value: unknown): DevQueryBuilder {
    return this.addFilter(field, (v) => (v as number) >= (value as number));
  }

  lt(field: string, value: unknown): DevQueryBuilder {
    return this.addFilter(field, (v) => (v as number) < (value as number));
  }

  lte(field: string, value: unknown): DevQueryBuilder {
    return this.addFilter(field, (v) => (v as number) <= (value as number));
  }

  in(field: string, values: unknown[]): DevQueryBuilder {
    return this.addFilter(field, (v) => values.includes(v));
  }

  private addFilter(field: string, predicate: (v: unknown) => boolean): DevQueryBuilder {
    const op = this.op;
    if (op.kind === 'select') {
      return new DevQueryBuilder(this.store, this.table, {
        ...op,
        kind: 'select',
        filters: [...op.filters, { field, predicate }],
      });
    }
    // update/delete의 대상 행 필터로 누적 (select 체이닝과 혼동 금지)
    return new DevQueryBuilder(this.store, this.table, mutationWith(op, { filters: [...op.filters, { field, predicate }] }));
  }

  order(field: string, opts?: { ascending?: boolean }): DevQueryBuilder {
    const op = this.op;
    const orderBy = { field, ascending: opts?.ascending ?? true };
    if (op.kind === 'select') {
      return new DevQueryBuilder(this.store, this.table, { ...op, kind: 'select', orderBy: [...op.orderBy, orderBy] });
    }
    const then = cloneSelect(op.then) ?? freshSelect();
    then.orderBy = [...then.orderBy, orderBy];
    return new DevQueryBuilder(this.store, this.table, mutationWith(op, { then }));
  }

  limit(n: number): DevQueryBuilder {
    const op = this.op;
    if (op.kind === 'select') {
      return new DevQueryBuilder(this.store, this.table, { ...op, kind: 'select', limit: n });
    }
    const then = cloneSelect(op.then) ?? freshSelect();
    then.limit = n;
    return new DevQueryBuilder(this.store, this.table, mutationWith(op, { then }));
  }

  single(): DevQueryBuilder {
    const op = this.op;
    if (op.kind === 'select') {
      return new DevQueryBuilder(this.store, this.table, { ...op, kind: 'select', single: true, maybeSingle: false });
    }
    const then = cloneSelect(op.then) ?? freshSelect();
    then.single = true;
    then.maybeSingle = false;
    return new DevQueryBuilder(this.store, this.table, mutationWith(op, { then }));
  }

  maybeSingle(): DevQueryBuilder {
    const op = this.op;
    if (op.kind === 'select') {
      return new DevQueryBuilder(this.store, this.table, { ...op, kind: 'select', single: false, maybeSingle: true });
    }
    const then = cloneSelect(op.then) ?? freshSelect();
    then.single = false;
    then.maybeSingle = true;
    return new DevQueryBuilder(this.store, this.table, mutationWith(op, { then }));
  }

  insert(values: DevRow | DevRow[]): DevQueryBuilder {
    const rows = Array.isArray(values) ? values : [values];
    const now = new Date().toISOString();
    const normalized = rows.map((r) => ({ ...r, id: r.id ?? (this.table === 'context_patches' ? (this.store.sequences[this.table] = (this.store.sequences[this.table] || 0) + 1) : randomUUID()), created_at: r.created_at ?? now, updated_at: r.updated_at ?? now }));
    return new DevQueryBuilder(this.store, this.table, { kind: 'insert', rows: normalized, conflictKey: null, filters: [], then: null });
  }

  upsert(values: DevRow | DevRow[], opts?: { onConflict?: string }): DevQueryBuilder {
    const rows = Array.isArray(values) ? values : [values];
    const now = new Date().toISOString();
    const normalized = rows.map((r) => ({ ...r, id: r.id ?? (this.table === 'context_patches' ? (this.store.sequences[this.table] = (this.store.sequences[this.table] || 0) + 1) : randomUUID()), created_at: r.created_at ?? now, updated_at: r.updated_at ?? now }));
    return new DevQueryBuilder(this.store, this.table, { kind: 'upsert', rows: normalized, conflictKey: opts?.onConflict || 'id', filters: [], then: null });
  }

  update(values: DevRow): DevQueryBuilder {
    return new DevQueryBuilder(this.store, this.table, { kind: 'update', values, filters: [], then: null });
  }

  delete(): DevQueryBuilder {
    return new DevQueryBuilder(this.store, this.table, { kind: 'delete', filters: [], then: null });
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    if (this.op.kind === 'insert') {
      const table = this.store.tables[this.table] || (this.store.tables[this.table] = []);
      const result: DevRow[] = [];
      for (const row of this.op.rows) {
        const existing = table.find((r) => r.id === row.id);
        if (existing) {
          Object.assign(existing, row);
          result.push(existing);
        } else {
          table.push(row);
          result.push(row);
        }
      }
      return this.applyThen(this.op.then, result);
    }
    if (this.op.kind === 'upsert') {
      const table = this.store.tables[this.table] || (this.store.tables[this.table] = []);
      const conflictKey = this.op.conflictKey || 'id';
      const result: DevRow[] = [];
      for (const row of this.op.rows) {
        const existing = table.find((r) => r[conflictKey] === row[conflictKey]);
        if (existing) {
          Object.assign(existing, row);
          result.push(existing);
        } else {
          table.push(row);
          result.push(row);
        }
      }
      return this.applyThen(this.op.then, result);
    }
    if (this.op.kind === 'update') {
      const rows = this.selectRows();
      const now = new Date().toISOString();
      for (const row of rows) {
        Object.assign(row, this.op.values, { updated_at: now });
      }
      return this.applyThen(this.op.then, rows);
    }
    if (this.op.kind === 'delete') {
      const table = this.store.tables[this.table];
      if (!table) return { data: null, error: null };
      const rows = this.selectRows();
      for (const row of rows) {
        const idx = table.indexOf(row);
        if (idx >= 0) table.splice(idx, 1);
      }
      return this.applyThen(this.op.then, rows);
    }
    // select
    if (this.op.kind !== 'select') {
      return { data: null, error: { message: 'Unexpected operation kind' } };
    }
    const rows = this.execSelect(this.op);
    if (this.op.single) {
      if (rows.length === 0) return { data: null, error: { message: 'No rows found' } };
      if (rows.length > 1) return { data: null, error: { message: 'Multiple rows returned' } };
      return { data: rows[0], error: null };
    }
    if (this.op.maybeSingle) {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private selectRows(): DevRow[] {
    const op = this.op;
    if (op.kind === 'select') return this.execSelect(op);
    // update/delete: mutation에 누적된 filters로 대상 행 선택
    return this.execSelect({ ...freshSelect(), filters: [...op.filters] });
  }

  private async applyThen(then: SelectOp | null, rows: DevRow[]): Promise<QueryResult> {
    if (!then) return { data: rows, error: null };
    const selected = this.execSelect(then, rows);
    if (then.single) {
      if (selected.length === 0) return { data: null, error: { message: 'No rows found' } };
      if (selected.length > 1) return { data: null, error: { message: 'Multiple rows returned' } };
      return { data: selected[0], error: null };
    }
    if (then.maybeSingle) return { data: selected[0] ?? null, error: null };
    return { data: selected, error: null };
  }

  private execSelect(op: SelectOp, scope?: DevRow[]): DevRow[] {
    const table = scope || this.store.tables[this.table] || [];
    let rows = [...table];
    for (const f of op.filters) rows = rows.filter((r) => f.predicate(r[f.field]));
    if (op.orderBy.length) {
      rows.sort((a, b) => {
        for (const { field, ascending } of op.orderBy) {
          const va = a[field];
          const vb = b[field];
          if (va == null && vb == null) continue;
          if (va == null) return 1;
          if (vb == null) return -1;
          const compared = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
          if (compared) return ascending ? compared : -compared;
        }
        return 0;
      });
    }
    if (op.limit != null) rows = rows.slice(0, op.limit);
    return rows;
  }
}

export interface DevClient {
  from(table: string): DevQueryBuilder;
  rpc(fn: string, args?: Record<string, unknown>): Promise<QueryResult>;
  auth: {
    admin: {
      createUser(args: { email: string; password: string; user_metadata?: Record<string, any>; email_confirm?: boolean }): Promise<{ data: { user: DevRow } | null; error: { message: string } | null }>;
      deleteUser?(id: string): Promise<{ data: DevRow | null; error: null }>;
    };
    signInWithPassword(args: { email: string; password: string }): Promise<{ data: { user: DevRow; session: { access_token: string; refresh_token: string } } | null; error: { message: string } | null }>;
    signOut?(): Promise<{ error: null }>;
  };
}

export function createDevClient(store: DevStore): DevClient {
  const client: DevClient = {
    from: (table) => new DevQueryBuilder(store, table, freshSelect()),

    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      if (fn === 'check_compaction_needed') {
        const sessionId = args.p_session_id as string;
        const lastCompacted = Math.max(0, ...store.tables.compressed_memories.filter((m) => m.session_id === sessionId).map((m) => m.source_turn_range?.upper ?? 0));
        const recent = store.tables.messages.filter((m) => m.session_id === sessionId && m.turn_index > lastCompacted).length;
        return { data: recent >= 100, error: null };
      }
      if (fn === 'increment_neuron_usage') {
        const neuron = store.tables.neurons.find((n) => n.id === args.p_neuron_id);
        if (neuron) {
          neuron.usage_count += 1;
          if (args.p_success) neuron.success_count += 1;
          else neuron.failure_count += 1;
        }
        return { data: null, error: null };
      }
      if (fn === 'record_skill_feedback') {
        const skill = store.tables.skills.find((s) => s.id === args.p_skill_id);
        if (skill) {
          skill.satisfaction_sum += Number(args.p_rating || 0);
          skill.satisfaction_count += 1;
        }
        return { data: null, error: null };
      }
      return { data: null, error: { message: `Unknown RPC: ${fn}` } };
    },

    auth: {
      admin: {
        createUser: async ({ email, password, user_metadata, email_confirm: _email_confirm }) => {
          if (store.usersByEmail.has(email)) {
            return { data: null, error: { message: 'User already registered' } };
          }
          const now = new Date().toISOString();
          const user = {
            id: randomUUID(),
            email,
            user_metadata: user_metadata || {},
            created_at: now,
          };
          store.usersByEmail.set(email, { email, password, user });
          store.tables.users.push({
            id: user.id,
            display_name: user_metadata?.name || email.split('@')[0],
            avatar_url: null,
            phone: null,
            timezone: 'Asia/Seoul',
            language: 'ko',
            preferences: {},
            profile: {},
            created_at: now,
            updated_at: now,
          });
          return { data: { user }, error: null };
        },
      },
      signInWithPassword: async ({ email, password }) => {
        const entry = store.usersByEmail.get(email);
        if (!entry || entry.password !== password) {
          return { data: null, error: { message: 'Invalid login credentials' } };
        }
        return {
          data: {
            user: entry.user,
            session: { access_token: `dev-access-${entry.user.id}`, refresh_token: `dev-refresh-${entry.user.id}` },
          },
          error: null,
        };
      },
      signOut: async () => ({ error: null }),
    },
  };
  return client;
}