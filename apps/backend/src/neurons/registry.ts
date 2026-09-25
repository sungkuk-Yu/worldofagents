/**
 * 뉴런 레지스트리 & 인스턴스 관리 — neuron-architecture-spec §3, §7
 * - 기본 뉴런 4종 보장 (empathy/answer/queue/visual — seed와 동일)
 * - 세션별 뉴런 인스턴스 활성/비활성 (상태 머신: idle→active→processing→degraded)
 * - 뉴런 연결/해제 이력 기록 (neuron_connections append-only)
 * - 사용량 집계 (increment_neuron_usage)
 */
import { NeuronInstancesRow, NeuronsRow, NeuronInstanceStatus } from '../types/db';
import { DbClient } from '../lib/supabase';
import { ApiError, ERROR_CODES } from '../lib/errors';

export const CORE_NEURONS = [
  { slug: 'empathy', alwaysActive: true },
  { slug: 'answer', alwaysActive: false },
  { slug: 'queue', alwaysActive: false },
  { slug: 'visual', alwaysActive: false },
];

/** 기본 뉴런이 부족하면 시드 (로컬/테스트 환경 안전망) */
export async function ensureDefaultNeurons(db: DbClient): Promise<void> {
  const { data, error } = await db.from('neurons').select('slug').eq('status', 'active');
  if (error) return;
  const existing = new Set((data as { slug: string }[] || []).map((n) => n.slug));
  for (const core of CORE_NEURONS) {
    if (!existing.has(core.slug)) {
      await db.from('neurons').insert({
        name: core.slug === 'empathy' ? '공감 에이뉴런' : core.slug === 'answer' ? '답변생성 에이뉴런' : core.slug === 'queue' ? '큐 에이뉴런' : '비주얼 에이뉴런',
        slug: core.slug,
        description: '기본 뉴런',
        category: 'core',
        version: '1.0.0',
        author: 'agenttalk',
        capabilities: [],
        trigger_conditions: [],
        resource_requirements: {},
        dependencies: [],
        persona_compatible: true,
        status: 'active',
        always_active: core.alwaysActive,
        usage_count: 0,
        success_count: 0,
        failure_count: 0,
        satisfaction_sum: 0,
        satisfaction_count: 0,
      });
    }
  }
}

export async function getNeuronBySlug(db: DbClient, slug: string): Promise<NeuronsRow | null> {
  const { data, error } = await db.from('neurons').select('*').eq('slug', slug).maybeSingle();
  if (error || !data) return null;
  return data as NeuronsRow;
}

export async function getNeuronById(db: DbClient, id: string): Promise<NeuronsRow | null> {
  const { data, error } = await db.from('neurons').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as NeuronsRow;
}

export type NeuronEventType = 'activate' | 'deactivate' | 'connect' | 'disconnect' | 'error' | 'status_change';

/** 연결/해제 이벤트 기록 (append-only) */
export async function recordConnectionEvent(
  db: DbClient,
  sessionId: string,
  neuronId: string,
  eventType: NeuronEventType,
  opts?: { instanceId?: string; prevStatus?: string | null; newStatus?: string | null; reason?: string; metadata?: Record<string, unknown>; sourceInstanceId?: string; targetInstanceId?: string }
): Promise<void> {
  await db.from('neuron_connections').insert({
    session_id: sessionId,
    source_neuron_instance_id: opts?.sourceInstanceId || opts?.instanceId || null,
    target_neuron_instance_id: opts?.targetInstanceId || null,
    neuron_id: neuronId,
    event_type: eventType,
    prev_status: opts?.prevStatus ?? null,
    new_status: opts?.newStatus ?? null,
    reason: opts?.reason ?? null,
    metadata: opts?.metadata || {},
  });
}

/** 뉴런 인스턴스 활성화 — (session_id, neuron_id) 유일성 보장 */
export async function activateNeuronInstance(db: DbClient, sessionId: string, neuronSlug: string): Promise<NeuronInstancesRow> {
  const neuron = await getNeuronBySlug(db, neuronSlug);
  if (!neuron || neuron.status !== 'active') {
    throw new ApiError(ERROR_CODES.NEURON_NOT_FOUND, `뉴런을 찾을 수 없습니다: ${neuronSlug}`);
  }

  // 이미 활성 인스턴스가 있으면 재사용
  const { data: existing } = await db
    .from('neuron_instances')
    .select('*')
    .eq('session_id', sessionId)
    .eq('neuron_id', neuron.id)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) return existing as NeuronInstancesRow;

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('neuron_instances')
    .insert({
      session_id: sessionId,
      neuron_id: neuron.id,
      status: 'active' as NeuronInstanceStatus,
      config: {},
      activated_at: now,
      last_activity_at: now,
      deactivated_at: null,
    })
    .select()
    .single();

  if (error) throw new ApiError(ERROR_CODES.NEURON_ACTIVATION_FAILED, `뉴런 활성화 실패: ${error.message}`);
  const instance = data as NeuronInstancesRow;

  await recordConnectionEvent(db, sessionId, neuron.id, 'activate', {
    instanceId: instance.id,
    prevStatus: null,
    newStatus: 'active',
    reason: 'router_activated',
  });
  return instance;
}

/** 뉴런 인스턴스 비활성화 */
export async function deactivateNeuronInstance(db: DbClient, sessionId: string, instanceId: string, reason = 'deactivated'): Promise<void> {
  const { data, error } = await db
    .from('neuron_instances')
    .select('*')
    .eq('id', instanceId)
    .maybeSingle();
  if (error || !data) return;

  const instance = data as NeuronInstancesRow;
  await db.from('neuron_instances').update({ status: 'idle', deactivated_at: new Date().toISOString() }).eq('id', instanceId);
  await recordConnectionEvent(db, sessionId, instance.neuron_id, 'deactivate', {
    instanceId,
    prevStatus: instance.status,
    newStatus: 'idle',
    reason,
  });
}

/** 인스턴스 상태 전이 + 이벤트 기록 */
export async function setInstanceStatus(db: DbClient, instanceId: string, status: NeuronInstanceStatus, sessionId?: string, reason?: string): Promise<void> {
  const { data } = await db.from('neuron_instances').select('*').eq('id', instanceId).maybeSingle();
  if (!data) return;
  const instance = data as NeuronInstancesRow;
  await db.from('neuron_instances').update({ status, last_activity_at: new Date().toISOString() }).eq('id', instanceId);
  if (sessionId && status !== instance.status) {
    await recordConnectionEvent(db, sessionId, instance.neuron_id, 'status_change', {
      instanceId,
      prevStatus: instance.status,
      newStatus: status,
      reason,
    });
  }
}

/** 세션 활성 인스턴스 목록 (뉴런 메타 포함) */
export async function listActiveInstances(db: DbClient, sessionId: string): Promise<(NeuronInstancesRow & { neuron: NeuronsRow })[]> {
  const { data } = await db
    .from('neuron_instances')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  const rows = (data as NeuronInstancesRow[]) || [];
  const result: (NeuronInstancesRow & { neuron: NeuronsRow })[] = [];
  for (const row of rows) {
    const neuron = await getNeuronById(db, row.neuron_id);
    if (neuron) result.push({ ...row, neuron });
  }
  return result;
}

/** 뉴런 사용량 집계 */
export async function recordNeuronUsage(db: DbClient, neuronId: string, success: boolean): Promise<void> {
  await db.rpc('increment_neuron_usage', { p_neuron_id: neuronId, p_success: success });
}

/** 에이전트에 설치된 커스텀 뉴런 슬러그 목록 (스킬 마켓 연동) */
export async function listInstalledCustomNeuronSlugs(db: DbClient, userId: string): Promise<string[]> {
  const { data } = await db
    .from('skill_installations')
    .select('*, skills(slug, category)')
    .eq('user_id', userId)
    .eq('is_enabled', true);
  const slugs: string[] = [];
  for (const row of (data as any[]) || []) {
    const skill = row.skills as { slug?: string; category?: string } | undefined;
    if (skill?.category === 'neuron' && skill.slug) {
      slugs.push(skill.slug.replace(/^neuron-/, ''));
    }
  }
  return slugs;
}