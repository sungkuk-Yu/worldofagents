"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTasksBySession = listTasksBySession;
exports.createTaskInSession = createTaskInSession;
exports.taskRoutes = taskRoutes;
const auth_1 = require("../lib/auth");
const errors_1 = require("../lib/errors");
const helpers_1 = require("../lib/helpers");
const contextSync_1 = require("../lib/contextSync");
const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'blocked', 'cancelled'];
const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** 세션의 작업 목록 (세션 라우트와 공유) */
async function listTasksBySession(db, sessionId, status) {
    let query = db.from('tasks').select('*').eq('session_id', sessionId).order('created_at', { ascending: false });
    if (status && TASK_STATUSES.includes(status))
        query = query.eq('status', status);
    const { data } = await query;
    return data || [];
}
/** 세션에 작업 생성 (세션 라우트와 공유) */
async function createTaskInSession(db, sessionId, body) {
    const b = body;
    if (!b.title?.trim())
        throw (0, errors_1.badRequest)('작업 제목(title)은 필수입니다.');
    if (b.priority && !TASK_PRIORITIES.includes(b.priority)) {
        throw (0, errors_1.badRequest)(`priority는 ${TASK_PRIORITIES.join('/')} 중 하나여야 합니다.`);
    }
    const { data, error } = await db
        .from('tasks')
        .insert({
        session_id: sessionId,
        temporal_workflow_id: null,
        title: b.title,
        description: b.description || null,
        status: 'pending',
        priority: b.priority || 'normal',
        assigned_neuron: 'answer',
        task_type: b.task_type || 'general',
        input_data: b.input_data || {},
        result: null,
        started_at: null,
        completed_at: null,
        due_at: b.due_at || null,
    })
        .select()
        .single();
    if (error)
        throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, '작업 생성 실패', { detail: error.message });
    // 컨텍스트 동기화 — task.current 반영
    void (0, contextSync_1.updateTaskContext)(db, sessionId, { id: data.id, title: data.title, status: 'pending' });
    return data;
}
async function taskRoutes(app) {
    // GET /api/tasks?session_id= — 세션의 작업 목록
    app.get('/', { preHandler: auth_1.requireAuth }, async (request) => {
        const { session_id, status } = request.query;
        if (!session_id)
            throw (0, errors_1.badRequest)('session_id 쿼리가 필요합니다.');
        await (0, helpers_1.getOwnedSession)(request.db, request.userId, session_id);
        return (0, errors_1.ok)(await listTasksBySession(request.db, session_id, status));
    });
    // POST /api/tasks — 작업 생성
    app.post('/', { preHandler: auth_1.requireAuth }, async (request, reply) => {
        const { session_id } = request.body;
        if (!session_id)
            throw (0, errors_1.badRequest)('session_id는 필수입니다.');
        await (0, helpers_1.getOwnedSession)(request.db, request.userId, session_id);
        const task = await createTaskInSession(request.db, session_id, request.body);
        return reply.status(201).send((0, errors_1.ok)(task));
    });
    // GET /api/tasks/:id — 작업 상세
    app.get('/:id', { preHandler: auth_1.requireAuth }, async (request) => {
        const { id } = request.params;
        const { data, error } = await request.db.from('tasks').select('*, sessions(user_id)').eq('id', id).maybeSingle();
        if (error || !data)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.TASK_NOT_FOUND, '작업을 찾을 수 없습니다.');
        const sessionRef = data.sessions;
        if (!sessionRef || sessionRef.user_id !== request.userId)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.TASK_NOT_FOUND, '작업을 찾을 수 없습니다.');
        delete data.sessions;
        return (0, errors_1.ok)(data);
    });
    // PATCH /api/tasks/:id — 작업 상태 변경
    app.patch('/:id', { preHandler: auth_1.requireAuth }, async (request) => {
        const { id } = request.params;
        const task = await loadOwnedTask(request.db, request.userId, id);
        const body = request.body;
        if (body.status && !TASK_STATUSES.includes(body.status)) {
            throw (0, errors_1.badRequest)(`status는 ${TASK_STATUSES.join('/')} 중 하나여야 합니다.`);
        }
        if (task.status === 'completed' && body.status) {
            throw new errors_1.ApiError(errors_1.ERROR_CODES.TASK_ALREADY_COMPLETED, '완료된 작업은 상태를 변경할 수 없습니다.');
        }
        const patch = {};
        if (body.status) {
            patch.status = body.status;
            if (body.status === 'in_progress')
                patch.started_at = new Date().toISOString();
            if (body.status === 'completed' || body.status === 'cancelled')
                patch.completed_at = new Date().toISOString();
        }
        if (body.result !== undefined)
            patch.result = body.result;
        if (body.priority && TASK_PRIORITIES.includes(body.priority))
            patch.priority = body.priority;
        const { data, error } = await request.db.from('tasks').update(patch).eq('id', task.id).select().single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        // 작업 로그 기록
        await request.db.from('task_logs').insert({
            task_id: task.id,
            log_type: 'status_change',
            message: body.status ? `상태 변경: ${task.status} → ${body.status}` : '작업 정보 수정',
            metadata: {},
            source_neuron: 'system',
        });
        // 컨텍스트 동기화
        if (body.status)
            void (0, contextSync_1.updateTaskContext)(request.db, task.session_id, { id: task.id, title: task.title, status: body.status });
        return (0, errors_1.ok)(data);
    });
    // POST /api/tasks/:id/cancel — 작업 취소 (Temporal user_stop 신호 대응)
    app.post('/:id/cancel', { preHandler: auth_1.requireAuth }, async (request) => {
        const { id } = request.params;
        const task = await loadOwnedTask(request.db, request.userId, id);
        const { data, error } = await request.db.from('tasks').update({ status: 'cancelled', completed_at: new Date().toISOString() }).eq('id', task.id).select().single();
        if (error)
            throw new errors_1.ApiError(errors_1.ERROR_CODES.INTERNAL_ERROR, error.message);
        await request.db.from('task_logs').insert({
            task_id: task.id,
            log_type: 'status_change',
            message: '작업 취소 (사용자 요청)',
            metadata: {},
            source_neuron: 'system',
        });
        void (0, contextSync_1.updateTaskContext)(request.db, task.session_id, { id: task.id, title: task.title, status: 'cancelled' });
        return (0, errors_1.ok)(data);
    });
    // GET /api/tasks/:id/logs — 작업 로그
    app.get('/:id/logs', { preHandler: auth_1.requireAuth }, async (request) => {
        const { id } = request.params;
        const task = await loadOwnedTask(request.db, request.userId, id);
        const { data } = await request.db.from('task_logs').select('*').eq('task_id', task.id).order('created_at', { ascending: true });
        return (0, errors_1.ok)(data || []);
    });
}
async function loadOwnedTask(db, userId, taskId) {
    const { data } = await db.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (!data)
        throw new errors_1.ApiError(errors_1.ERROR_CODES.TASK_NOT_FOUND, '작업을 찾을 수 없습니다.');
    const task = data;
    const { data: session } = await db.from('sessions').select('user_id').eq('id', task.session_id).maybeSingle();
    if (!session || session.user_id !== userId) {
        throw new errors_1.ApiError(errors_1.ERROR_CODES.TASK_NOT_FOUND, '작업을 찾을 수 없습니다.');
    }
    return task;
}
//# sourceMappingURL=tasks.js.map