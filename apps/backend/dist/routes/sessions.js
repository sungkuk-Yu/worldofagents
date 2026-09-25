"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionRoutes = sessionRoutes;
const supabase_1 = require("../lib/supabase");
async function sessionRoutes(app) {
    // GET /api/sessions - List user sessions
    app.get('/', async (request) => {
        const userId = request.user?.sub;
        const { data } = await supabase_1.supabaseAdmin
            .from('sessions')
            .select('*, agents(display_name)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);
        return { sessions: data || [] };
    });
    // POST /api/sessions - Create session
    app.post('/', async (request, reply) => {
        const { user_id, agent_id, title } = request.body;
        const { data, error } = await supabase_1.supabaseAdmin
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
        const { id } = request.params;
        const { data: session, error } = await supabase_1.supabaseAdmin
            .from('sessions')
            .select('*, agents(display_name)')
            .eq('id', id)
            .single();
        if (error) {
            return reply.status(404).send({ error: 'Session not found' });
        }
        // Get messages
        const { data: messages } = await supabase_1.supabaseAdmin
            .from('messages')
            .select('*')
            .eq('session_id', id)
            .order('created_at', { ascending: true });
        return { ...session, messages: messages || [] };
    });
    // POST /api/sessions/:id/messages - Add message
    app.post('/:id/messages', async (request, reply) => {
        const { id } = request.params;
        const { role, content, metadata, segment_type } = request.body;
        const { data, error } = await supabase_1.supabaseAdmin
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
//# sourceMappingURL=sessions.js.map