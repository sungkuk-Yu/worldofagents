import { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';

export async function sessionRoutes(app: FastifyInstance) {
  // GET /api/sessions - List user sessions
  app.get('/', async (request) => {
    const userId = (request.user as any)?.sub;

    const { data } = await supabaseAdmin
      .from('sessions')
      .select('*, agents(display_name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    return { sessions: data || [] };
  });

  // POST /api/sessions - Create session
  app.post('/', async (request, reply) => {
    const { user_id, agent_id, title } = request.body as {
      user_id: string;
      agent_id: string;
      title?: string;
    };

    const { data, error } = await supabaseAdmin
      .from('sessions')
      .insert({
        user_id,
        agent_id,
        title: title || 'New Conversation',
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    return reply.status(201).send(data);
  });

  // GET /api/sessions/:id - Get session with messages
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data: session, error } = await supabaseAdmin
      .from('sessions')
      .select('*, agents(display_name)')
      .eq('id', id)
      .single();

    if (error) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    // Get messages
    const { data: messages } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('session_id', id)
      .order('created_at', { ascending: true });

    return { ...session, messages: messages || [] };
  });

  // POST /api/sessions/:id/messages - Add message
  app.post('/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { role, content, metadata, segment_type } = request.body as {
      role: 'user' | 'assistant' | 'system';
      content: string;
      metadata?: Record<string, any>;
      segment_type?: string;
    };

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert({
        session_id: id,
        role,
        content,
        segment_type: segment_type || 'information',
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    return reply.status(201).send(data);
  });
}
