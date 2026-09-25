"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertValidKey = assertValidKey;
exports.writeContextPatch = writeContextPatch;
exports.readContextValue = readContextValue;
exports.readFullContext = readFullContext;
exports.clearContextKey = clearContextKey;
exports.updateTaskContext = updateTaskContext;
const JSON_PATH_RE = /^([a-z]+\.[a-zA-Z0-9_.-]+)$/;
function assertValidKey(key) {
    if (!JSON_PATH_RE.test(key)) {
        throw new Error(`잘못된 컨텍스트 키: ${key} (형식: domain.name)`);
    }
}
/** 컨텍스트 패치 기록 */
async function writeContextPatch(db, sessionId, key, delta) {
    assertValidKey(key);
    const { error } = await db.from('context_patches').insert({
        session_id: sessionId,
        key,
        operation: delta.operation,
        delta: { value: delta.value },
        source_neuron: delta.source || 'system',
    });
    if (error)
        throw error;
}
function applyOps(current, ops) {
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
                if (Array.isArray(op.value))
                    acc = [...list, ...op.value];
                else
                    acc = [...list, op.value];
                break;
            }
            case 'delete':
                acc = null;
                break;
        }
    }
    return acc;
}
/** 특정 키의 현재 컨텍스트 값 재구성 (캐시 대신 DB에서 항상 재구성) */
async function readContextValue(db, sessionId, key) {
    assertValidKey(key);
    const { data, error } = await db
        .from('context_patches')
        .select('*')
        .eq('session_id', sessionId)
        .eq('key', key)
        .order('created_at', { ascending: true });
    if (error)
        return null;
    const ops = (data || []).map((p) => ({
        operation: p.operation,
        value: p.delta?.value,
    }));
    return applyOps(null, ops);
}
/** 세션 전체 컨텍스트 스냅샷 (키별 최신 값) */
async function readFullContext(db, sessionId) {
    const { data, error } = await db
        .from('context_patches')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
    if (error)
        return {};
    const byKey = new Map();
    for (const p of data || []) {
        if (!byKey.has(p.key) || p.created_at >= byKey.get(p.key).created_at) {
            byKey.set(p.key, { operation: p.operation, value: p.delta?.value, created_at: p.created_at });
        }
    }
    const result = {};
    for (const [key, last] of byKey) {
        // 마지막 패치만으로 스냅샷 구성 (append는 누적이 필요하므로 전체 재구성)
        if (last.operation === 'append') {
            const ops = (data || [])
                .filter((p) => p.key === key)
                .map((p) => ({ operation: p.operation, value: p.delta?.value }));
            result[key] = applyOps(null, ops);
        }
        else {
            result[key] = last.operation === 'delete' ? null : last.value;
        }
    }
    return result;
}
/** 컨텍스트 키 삭제 (사용자 요청 — 개인정보 삭제 대응) */
async function clearContextKey(db, sessionId, key) {
    assertValidKey(key);
    const { error } = await db.from('context_patches').insert({
        session_id: sessionId,
        key,
        operation: 'delete',
        delta: { value: null },
        source_neuron: 'user.request',
    });
    if (error)
        throw error;
}
/** 세션의 활성 작업 정보를 컨텍스트로 저장 (task.current) */
async function updateTaskContext(db, sessionId, task) {
    await writeContextPatch(db, sessionId, 'task.current', {
        operation: 'set',
        value: { id: task.id, title: task.title, status: task.status },
        source: 'answer',
    });
}
//# sourceMappingURL=contextSync.js.map