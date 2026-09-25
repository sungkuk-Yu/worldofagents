import { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';

export async function taskRoutes(app: FastifyInstance) {
  // GET /api/tasks - List tasks for user
  app.get('/', async (request) => {
    const userId = (request.user as any)?.sub;

    const { data } = await supabaseAdmin
      .from('tasks')
      .select('*, sessions(title)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    return { tasks: data || [] };
  });

  // POST /api/tasks - Create task
  app.post('/', async (request, reply) => {
    const body = request.body as {
      user_id: string;
      session_id?: string;
      title: string;
      description?: string;
      task_type: string;
      priority?: number;
      approval_required?: boolean;
    };

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        user_id: body.user_id,
        session_id: body.session_id,
        title: body.title,
        description: body.description,
        task_type: body.task_type,
        status: 'pending',
        priority: body.priority || 5,
        approval_required: body.approval_required || false,
      })
      .select()
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    return reply.status(201).send(data);
  });

  // PATCH /api/tasks/:id - Update task status
  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status, result, error_message } = request.body as {
      status?: string;
      result?: any;
      error_message?: string;
    };

    const updateData: Record<string, any> = {};
    if (status) {
      updateData.status = status;
      if (status === 'running') updateData.started_at = new Date().toISOString();
      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }
    }
    if (result !== undefined) updateData.result = result;
    if (error_message) updateData.error_message = error_message;

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    return data;
  });

  // POST /api/tasks/:id/approve - Approve task execution
  app.post('/:id/approve', async (request) => {
    const { id } = request.params as { id: string };

    const { data } = await supabaseAdmin
      .from('tasks')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    return data;
  });

  // POST /api/tasks/:id/cancel - Cancel task
  app.post('/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };

    const { data } = await supabaseAdmin
      .from('tasks')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .select()
      .single();

    return data;
  });

  // GET /api/tasks/:id/logs - Get task execution logs
  app.get('/:id/logs', async (request) => {
    const { id } = request.params as { id: string };

    const { data } = await supabaseAdmin
      .from('task_logs')
      .select('*')
      .eq('task_id', id)
      .order('created_at', { ascending: true });

    return { logs: data || [] };
  });
}
