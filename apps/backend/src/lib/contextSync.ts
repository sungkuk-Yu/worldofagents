/**
 * 뉴런 간 컨텍스트 동기화 (neuron-architecture-spec §6)
 * - context_patches append-only 패치로 기록 (감사 추적)
 * - 패치 시퀀스를 재구성해 현재 컨텍스트 값 조회
 * - 컨텍스트 키 체계: conversation.*, task.*, visual.*, persona.state, user.preferences 등
 */
import { DbClient } from './supabase';
import { fetchVerifiedPatches } from './contextArchive';
import { logger } from '../utils/logger';

export type ContextOperation = 'set' | 'append' | 'replace' | 'delete';

export interface ContextDelta {
  operation: ContextOperation;
  value: unknown;
  source?: string;
}

const JSON_PATH_RE = /^([a-z]+\.[a-zA-Z0-9_.-]+)$/;

export function assertValidKey(key: string): void {
  if (!JSON_PATH_RE.test(key)) {
    throw new Error(`잘못된 컨텍스트 키: ${key} (형식: domain.name)`);
  }
}

/** 컨텍스트 패치 기록 */
export async function writeContextPatch(
  db: DbClient,
  sessionId: string,
  key: string,
  delta: ContextDelta
): Promise<void> {
  assertValidKey(key);
  const { error } = await db.from('context_patches').insert({
    session_id: sessionId,
    key,
    operation: delta.operation,
    delta: { value: delta.value },
    source_neuron: delta.source || 'system',
  });
  if (error) throw error;
}

function applyOps(current: unknown, ops: { operation: ContextOperation; value: unknown }[]): unknown {
  let acc = current;
  for (const op of ops) {
    switch (op.operation) {
      case 'set':
        acc = op.value;
        break;
      case 'replace':
        acc = op.value;
        break;
      case 'append': {
        const list = Array.isArray(acc) ? acc : acc == null ? [] : [acc];
        if (Array.isArray(op.value)) acc = [...list, ...op.value];
        else acc = [...list, op.value];
        break;
      }
      case 'delete':
        acc = null;
        break;
    }
  }
  return acc;
}

/** 컨텍스트 패치 행 로더 — hot 전량 + (존재 시) 검증된 cold 객체 병합.
 *  t_848d0c3b 콜드 아카이브 폴백: cold는 **verified_at 있는 배치만** 사용(설계 §3),
 *  hot 행과 id가 겹치면 hot 우선(이관 후 복원/부분 실패 창에서 원본 진실 = hot).
 *  순서는 readContextValue/readFullContext 계약대로 (created_at, id) 오름차순. */
async function loadPatchesWithCold(db: DbClient, sessionId: string): Promise<any[]> {
  const { data, error } = await db
    .from('context_patches')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  const hot = (data as any[]) || [];
  let cold: any[];
  try {
    cold = await fetchVerifiedPatches(db, sessionId);
  } catch (err) {
    // cold 폴백 실패는 hot 답변을 막지 않는다 — 설계 §(d) '조용히 hot만 계속'.
    logger.warn(`context cold 폴백 실패(hot만 사용): session=${sessionId} — ${(err as Error).message}`);
    cold = [];
  }
  if (!cold.length) return hot;
  const hotIds = new Set(hot.map((p) => String(p.id)));
  const merged = [...hot, ...cold.filter((p) => !hotIds.has(String(p.id)))];
  merged.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id));
  return merged;
}

/** 특정 키의 현재 컨텍스트 값 재구성 (캐시 대신 DB에서 항상 재구성) */
export async function readContextValue(
  db: DbClient,
  sessionId: string,
  key: string
): Promise<unknown> {
  assertValidKey(key);
  let rows: any[];
  try {
    rows = await loadPatchesWithCold(db, sessionId);
  } catch {
    return null;
  }
  const ops = rows.filter((p) => p.key === key).map((p) => ({
    operation: p.operation as ContextOperation,
    value: (p.delta as { value?: unknown })?.value,
  }));
  return applyOps(null, ops);
}

/** 세션 전체 컨텍스트 스냅샷 (키별 최신 값) */
export async function readFullContext(db: DbClient, sessionId: string): Promise<Record<string, unknown>> {
  let data: any[];
  try {
    data = await loadPatchesWithCold(db, sessionId);
  } catch {
    return {};
  }

  const byKey = new Map<string, { operation: ContextOperation; value: unknown; created_at: string }>();
  for (const p of (data as any[]) || []) {
    if (!byKey.has(p.key) || p.created_at >= byKey.get(p.key)!.created_at) {
      byKey.set(p.key, { operation: p.operation, value: (p.delta as { value?: unknown })?.value, created_at: p.created_at });
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, last] of byKey) {
    // 마지막 패치만으로 스냅샷 구성 (append는 누적이 필요하므로 전체 재구성)
    if (last.operation === 'append') {
      const ops = ((data as any[]) || [])
        .filter((p) => p.key === key)
        .map((p) => ({ operation: p.operation as ContextOperation, value: (p.delta as { value?: unknown })?.value }));
      result[key] = applyOps(null, ops);
    } else {
      result[key] = last.operation === 'delete' ? null : last.value;
    }
  }
  return result;
}

/** 컨텍스트 키 삭제 (사용자 요청 — 개인정보 삭제 대응) */
export async function clearContextKey(db: DbClient, sessionId: string, key: string): Promise<void> {
  assertValidKey(key);
  const { error } = await db.from('context_patches').insert({
    session_id: sessionId,
    key,
    operation: 'delete',
    delta: { value: null },
    source_neuron: 'user.request',
  });
  if (error) throw error;
}

/** 세션의 활성 작업 정보를 컨텍스트로 저장 (task.current) */
export async function updateTaskContext(db: DbClient, sessionId: string, task: { id: string; title: string; status: string }): Promise<void> {
  await writeContextPatch(db, sessionId, 'task.current', {
    operation: 'set',
    value: { id: task.id, title: task.title, status: task.status },
    source: 'answer',
  });
}