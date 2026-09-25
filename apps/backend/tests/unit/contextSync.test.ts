import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeContextPatch,
  readContextValue,
  readFullContext,
  clearContextKey,
  assertValidKey,
  updateTaskContext,
} from '../../src/lib/contextSync';
import { createDevClient, getStore, resetStore } from '../../src/lib/devstore';

const SID = '00000000-0000-4000-8000-000000000001';

async function makeDb() {
  resetStore();
  return createDevClient(getStore());
}

describe('컨텍스트 동기화 (context_patches)', () => {
  let db: ReturnType<typeof createDevClient>;

  beforeEach(async () => {
    db = await makeDb();
  });

  afterEach(() => resetStore());

  it('키 검증 — 올바른 형식만 허용', () => {
    expect(() => assertValidKey('conversation.recent')).not.toThrow();
    expect(() => assertValidKey('task.current')).not.toThrow();
    expect(() => assertValidKey('bad')).toThrow();
    expect(() => assertValidKey('UPPER.case')).toThrow();
    expect(() => assertValidKey('')).toThrow();
  });

  it('set 후 현재 값 재구성', async () => {
    await writeContextPatch(db, SID, 'task.current', { operation: 'set', value: { id: 't1', title: '보고서' }, source: 'answer' });
    const value = await readContextValue(db, SID, 'task.current');
    expect(value).toEqual({ id: 't1', title: '보고서' });
  });

  it('append 누적 — 배열로 재구성', async () => {
    await writeContextPatch(db, SID, 'conversation.recent', { operation: 'append', value: { role: 'user', content: '안녕' } });
    await writeContextPatch(db, SID, 'conversation.recent', { operation: 'append', value: { role: 'agent', content: '안녕하세요' } });
    const value = await readContextValue(db, SID, 'conversation.recent');
    expect(value).toHaveLength(2);
    expect((value as any[])[1].role).toBe('agent');
  });

  it('delete는 null로 리셋', async () => {
    await writeContextPatch(db, SID, 'user.preferences', { operation: 'set', value: { theme: 'dark' } });
    await clearContextKey(db, SID, 'user.preferences');
    expect(await readContextValue(db, SID, 'user.preferences')).toBeNull();
  });

  it('readFullContext — 키별 최신 스냅샷 (append는 누적)', async () => {
    await writeContextPatch(db, SID, 'task.current', { operation: 'set', value: { id: 't1' } });
    await writeContextPatch(db, SID, 'task.current', { operation: 'set', value: { id: 't2' } });
    await writeContextPatch(db, SID, 'conversation.recent', { operation: 'append', value: { content: 'a' } });
    await writeContextPatch(db, SID, 'conversation.recent', { operation: 'append', value: { content: 'b' } });
    const ctx = await readFullContext(db, SID);
    expect(ctx['task.current']).toEqual({ id: 't2' });
    expect(ctx['conversation.recent']).toHaveLength(2);
  });

  it('updateTaskContext — task.current 갱신', async () => {
    await updateTaskContext(db, SID, { id: 't1', title: '보고서', status: 'in_progress' });
    expect(await readContextValue(db, SID, 'task.current')).toMatchObject({ status: 'in_progress' });
  });

  it('세션별 격리 — 다른 세션 값 영향 없음', async () => {
    await writeContextPatch(db, SID, 'task.current', { operation: 'set', value: { id: 't1' } });
    const other = '00000000-0000-4000-8000-000000000002';
    expect(await readContextValue(db, other, 'task.current')).toBeNull();
  });
});