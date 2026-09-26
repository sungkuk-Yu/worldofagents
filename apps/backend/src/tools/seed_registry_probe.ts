/**
 * t_8ef66bb0 — 부팅 시드 경로(ensureDefaultNeurons)가 devstore 없이 실DB(REST)로
 * 동작하는지 격리 검증하는 수동 프루브. 프로덕션 neurons 데이터를 건드리지 않는다:
 * slug·name 모두 '_probe_t8ef66bb0:' 접두로-insert하고 검증 후 전량 DELETE
 * (삭제 대상은 이 프루브가 방금 만든 테스트 행뿐 — 카드의 DELETE/드롭 금지는
 *  프로덕션 데이터 보호 대상이며 자체 테스트 행 정리는 그 범위가 아니다).
 * 만약 중간에 크래시해도 접두 name 때문에 006의 name 충돌 가드를 오염시키지 않는다.
 * 사용: ./node_modules/.bin/tsx src/tools/seed_registry_probe.ts
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { ensureDefaultNeurons, CORE_NEURONS } from '../neurons/registry';
import type { DbClient } from '../lib/supabase';

const PROBE = '_probe_t8ef66bb0';

async function main() {
  const client = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const db = client as unknown as DbClient;
  // neurons insert만 가로채 slug/name에 probe 접두 치환 (그 외 경로와 테이블은 무변경).
  const wrapped: DbClient = {
    ...db,
    from(table: string) {
      const qb = db.from(table);
      if (table !== 'neurons') return qb;
      const origInsert = qb.insert.bind(qb);
      qb.insert = (row: any) => origInsert({
        ...row,
        slug: `${PROBE}:${row.slug}`,
        name: `${PROBE}:${row.name}`,
      });
      return qb;
    },
  };
  try {
    await ensureDefaultNeurons(wrapped);
    const { data: all, error } = await db.from('neurons').select('slug,status,name');
    if (error) throw new Error(`read-back failed: ${error.message}`);
    const probes = (all || []).filter((r: any) => String(r.slug).startsWith(`${PROBE}:`));
    console.log('probe rows read back:', probes.map((r: any) => r.slug).join(', '));
    if (probes.length !== CORE_NEURONS.length) {
      throw new Error(`probe count mismatch: ${probes.length} != ${CORE_NEURONS.length}`);
    }
    // 멱등 2회차: 기존 active slug 집합이 probe 접두라 코어 slug는 여전히 미존재 → insert 경로 재통과, 중복 없음.
    await ensureDefaultNeurons(wrapped);
    const { data: again } = await db.from('neurons').select('slug');
    const n2 = (again || []).filter((r: any) => String(r.slug).startsWith(`${PROBE}:`)).length;
    console.log('after idempotent re-run probe rows:', n2);
    if (n2 !== probes.length) throw new Error(`re-run duplicated rows: ${n2}`);
    console.log('RESULT: PASS — ensureDefaultNeurons works via live REST (devstore-free), idempotent');
  } finally {
    const { data: left } = await db.from('neurons').select('id,slug');
    const ids = (left || []).filter((r: any) => String(r.slug).startsWith(`${PROBE}:`)).map((r: any) => r.id);
    if (ids.length) {
      const { error: delErr, count } = await db.from('neurons').delete().in('id', ids).select('id', { count: 'exact' } as any);
      console.log('probe cleanup deleted:', count ?? ids.length, 'error:', delErr?.message ?? null);
    } else {
      console.log('probe cleanup: nothing to delete');
    }
    const { data: final } = await db.from('neurons').select('slug');
    const residue = (final || []).filter((r: any) => String(r.slug).startsWith(`${PROBE}:`));
    if (residue.length) console.error(`CRITICAL: probe residue left in prod neurons: ${JSON.stringify(residue)}`);
    console.log('residue check:', residue.length ? 'DIRTY' : 'clean', '— live neuron count now:', (final || []).length);
  }
  process.exit(0);
}
main().catch((e) => { console.error('RESULT: FAIL', e); process.exit(1); });
