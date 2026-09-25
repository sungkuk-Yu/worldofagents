import { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';

export async function agentRoutes(app: FastifyInstance) {
  // GET /api/agents - List available agents
  app.get('/', async (request) => {
    const { data } = await supabaseAdmin
      .from('agents')
      .select('*, personas(*)')
      .order('display_name');

    return { agents: data || [] };
  });

  // GET /api/agents/:id - Get agent details
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const { data, error } = await supabaseAdmin
      .from('agents')
      .select('*, personas(*), neuron_instances(*, neurons(*))')
      .eq('id', id)
      .single();

    if (error) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    return data;
  });

  // POST /api/agents - Create agent
  app.post('/', async (request, reply) => {
    const body = request.body as {
      display_name: string;
      description?: string;
      model_provider?: string;
      model_id?: string;
    };

    const { data, error } = await supabaseAdmin
      .from('agents')
      .insert({
        display_name: body.display_name,
        description: body.description,
        model_provider: body.model_provider || 'alibaba',
        model_id: body.model_id || 'qwen3-max',
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    return reply.status(201).send(data);
  });

  // GET /api/agents/:id/neurons - List connected neurons
  app.get('/:id/neurons', async (request) => {
    const { id } = request.params as { id: string };

    const { data } = await supabaseAdmin
      .from('neuron_instances')
      .select('*, neurons(*)')
      .eq('agent_id', id)
      .eq('status', 'active');

    return { neurons: data || [] };
  });

  // POST /api/agents/:id/neurons/:neuronId/connect - Connect neuron
  app.post('/:id/neurons/:neuronId/connect', async (request, reply) => {
    const { id, neuronId } = request.params as {
      id: string;
      neuronId: string;
    };

    const { data, error } = await supabaseAdmin
      .from('neuron_instances')
      .insert({
        agent_id: id,
        neuron_id: neuronId,
        status: 'active',
        priority: 5,
        config: {},
      })
      .select()
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    return reply.status(201).send(data);
  });

  // DELETE /api/agents/:id/neurons/:instanceId/disconnect
  app.delete('/:id/neurons/:instanceId/disconnect', async (request) => {
    const { instanceId } = request.params as { instanceId: string };

    await supabaseAdmin
      .from('neuron_instances')
      .update({ status: 'inactive' })
      .eq('id', instanceId);

    return { success: true };
  });
}
