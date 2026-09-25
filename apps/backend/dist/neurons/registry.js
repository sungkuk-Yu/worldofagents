"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CORE_NEURONS = void 0;
exports.ensureDefaultNeurons = ensureDefaultNeurons;
exports.getNeuronBySlug = getNeuronBySlug;
exports.getNeuronById = getNeuronById;
exports.recordConnectionEvent = recordConnectionEvent;
exports.activateNeuronInstance = activateNeuronInstance;
exports.deactivateNeuronInstance = deactivateNeuronInstance;
exports.setInstanceStatus = setInstanceStatus;
exports.listActiveInstances = listActiveInstances;
exports.recordNeuronUsage = recordNeuronUsage;
exports.listInstalledCustomNeuronSlugs = listInstalledCustomNeuronSlugs;
const errors_1 = require("../lib/errors");
exports.CORE_NEURONS = [
    { slug: 'empathy', alwaysActive: true },
    { slug: 'answer', alwaysActive: false },
    { slug: 'queue', alwaysActive: false },
    { slug: 'visual', alwaysActive: false },
];
/** 기본 뉴런이 부족하면 시드 (로컬/테스트 환경 안전망) */
async function ensureDefaultNeurons(db) {
    const { data, error } = await db.from('neurons').select('slug').eq('status', 'active');
    if (error)
        return;
    const existing = new Set((data || []).map((n) => n.slug));
    for (const core of exports.CORE_NEURONS) {
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
async function getNeuronBySlug(db, slug) {
    const { data, error } = await db.from('neurons').select('*').eq('slug', slug).maybeSingle();
    if (error || !data)
        return null;
    return data;
}
async function getNeuronById(db, id) {
    const { data, error } = await db.from('neurons').select('*').eq('id', id).maybeSingle();
    if (error || !data)
        return null;
    return data;
}
/** 연결/해제 이벤트 기록 (append-only) */
async function recordConnectionEvent(db, sessionId, neuronId, eventType, opts) {
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
async function activateNeuronInstance(db, sessionId, neuronSlug) {
    const neuron = await getNeuronBySlug(db, neuronSlug);
    if (!neuron || neuron.status !== 'active') {
        throw new errors_1.ApiError(errors_1.ERROR_CODES.NEURON_NOT_FOUND, `뉴런을 찾을 수 없습니다: ${neuronSlug}`);
    }
    // 이미 활성 인스턴스가 있으면 재사용
    const { data: existing } = await db
        .from('neuron_instances')
        .select('*')
        .eq('session_id', sessionId)
        .eq('neuron_id', neuron.id)
        .eq('status', 'active')
        .maybeSingle();
    if (existing)
        return existing;
    const now = new Date().toISOString();
    const { data, error } = await db
        .from('neuron_instances')
        .insert({
        session_id: sessionId,
        neuron_id: neuron.id,
        status: 'active',
        config: {},
        activated_at: now,
        last_activity_at: now,
        deactivated_at: null,
    })
        .select()
        .single();
    if (error)
        throw new errors_1.ApiError(errors_1.ERROR_CODES.NEURON_ACTIVATION_FAILED, `뉴런 활성화 실패: ${error.message}`);
    const instance = data;
    await recordConnectionEvent(db, sessionId, neuron.id, 'activate', {
        instanceId: instance.id,
        prevStatus: null,
        newStatus: 'active',
        reason: 'router_activated',
    });
    return instance;
}
/** 뉴런 인스턴스 비활성화 */
async function deactivateNeuronInstance(db, sessionId, instanceId, reason = 'deactivated') {
    const { data, error } = await db
        .from('neuron_instances')
        .select('*')
        .eq('id', instanceId)
        .maybeSingle();
    if (error || !data)
        return;
    const instance = data;
    await db.from('neuron_instances').update({ status: 'idle', deactivated_at: new Date().toISOString() }).eq('id', instanceId);
    await recordConnectionEvent(db, sessionId, instance.neuron_id, 'deactivate', {
        instanceId,
        prevStatus: instance.status,
        newStatus: 'idle',
        reason,
    });
}
/** 인스턴스 상태 전이 + 이벤트 기록 */
async function setInstanceStatus(db, instanceId, status, sessionId, reason) {
    const { data } = await db.from('neuron_instances').select('*').eq('id', instanceId).maybeSingle();
    if (!data)
        return;
    const instance = data;
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
async function listActiveInstances(db, sessionId) {
    const { data } = await db
        .from('neuron_instances')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
    const rows = data || [];
    const result = [];
    for (const row of rows) {
        const neuron = await getNeuronById(db, row.neuron_id);
        if (neuron)
            result.push({ ...row, neuron });
    }
    return result;
}
/** 뉴런 사용량 집계 */
async function recordNeuronUsage(db, neuronId, success) {
    await db.rpc('increment_neuron_usage', { p_neuron_id: neuronId, p_success: success });
}
/** 에이전트에 설치된 커스텀 뉴런 슬러그 목록 (스킬 마켓 연동) */
async function listInstalledCustomNeuronSlugs(db, userId) {
    const { data } = await db
        .from('skill_installations')
        .select('*, skills(slug, category)')
        .eq('user_id', userId)
        .eq('is_enabled', true);
    const slugs = [];
    for (const row of data || []) {
        const skill = row.skills;
        if (skill?.category === 'neuron' && skill.slug) {
            slugs.push(skill.slug.replace(/^neuron-/, ''));
        }
    }
    return slugs;
}
//# sourceMappingURL=registry.js.map