// tests/fakeDb.ts — 그룹채팅 P1/P2 테스트 공용 supabase-like 인메모리 db
import type { AgentEnvelope, AgentEnvelopeMessage } from '../src/lib/groupChatContext';

export function fakeDb(store: Record<string, any[]>, opts: { failTables?: Set<string> } = {}) {
  const queries: string[] = [];
  const db = {
    queries,
    from(table: string) {
      queries.push(table);
      let ins: any = null;
      let upd: any = null;
      const filt: Array<[string, any, string?]> = [];
      let ord: [string, boolean] | null = null;
      let lim = 0;
      const self: any = {
        select: () => self,
        insert: (row: any) => { ins = row; return self; },
        update: (patch: any) => { upd = patch; return self; },
        eq: (f: string, v: any) => { filt.push([f, v]); return self; },
        in: (f: string, v: any[]) => { filt.push([f, v, 'in']); return self; },
        order: (f: string, o?: any) => { ord = [f, !!o?.ascending]; return self; },
        limit: (n: number) => { lim = n; return self; },
        single: () => run().then((r) => (r.error ? r : { data: r.data[0] ?? null, error: r.data.length ? null : { message: 'no rows' } })),
        maybeSingle: () => run().then((r) => (r.error ? r : { data: r.data[0] ?? null, error: null })),
        then: (cb: any, eb?: any) => run().then(cb, eb),
      };
      const match = (r: any) => filt.every(([f, v, mode]) => (mode === 'in' ? (v as any[]).includes(r[f]) : r[f] === v));
      async function run(): Promise<{ data: any[]; error: any }> {
        if (opts.failTables?.has(table)) return { data: [], error: { message: `injected ${table}` } };
        const rows = (store[table] ||= []);
        if (ins) { const row = { id: `row-${rows.length + 1}`, created_at: new Date(Date.now() + rows.length * 1000).toISOString(), ...ins }; rows.push(row); return { data: [row], error: null }; }
        if (upd) { const hit = rows.filter(match); for (const h of hit) Object.assign(h, upd); return { data: hit, error: null }; }
        let out = rows.filter(match);
        if (ord) {
          const [key, asc] = ord;
          out = [...out].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (asc ? 1 : -1));
        }
        if (lim) out = out.slice(0, lim);
        return { data: out, error: null };
      }
      return self;
    },
  };
  return db as any;
}

export const OWNER = '00000000-0000-4000-8000-000000000001';
export const A1 = '00000000-0000-4000-8000-000000000002';
export const A2 = '00000000-0000-4000-8000-000000000003';
export const ROOM = '00000000-0000-4000-8000-000000000004';

export function em(id: string, over: Partial<AgentEnvelopeMessage> = {}): AgentEnvelopeMessage {
  return { id, parent_id: null, author_type: 'user', author_id: OWNER, content: `text-${id}`, kind: 'text', created_at: '2026-01-01T00:00:00Z', ...over };
}

export function envelope(agentId: string, over: Partial<AgentEnvelope> = {}): AgentEnvelope {
  return {
    agent_id: agentId, mode: 'single', sequence_index: 0, pm_summary: 'PM-SUMMARY',
    root: null, anchor: em('anchor', { content: '질문입니다' }), own_thread: [], handoffs: [],
    boundary_marker: 'GCX-B-1:gcx-boundary-v1', ...over,
  };
}
