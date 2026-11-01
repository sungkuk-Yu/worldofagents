import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { groupChatRoutes } from '../src/routes/groupChat';

vi.mock('../src/lib/auth', () => ({ requireAuth: async (req: any) => { req.userId = '00000000-0000-4000-8000-000000000001'; } }));

const owner = '00000000-0000-4000-8000-000000000001';
const agent = '00000000-0000-4000-8000-000000000002';
const room = '00000000-0000-4000-8000-000000000003';
const members = [{ room_id: room, member_type: 'user', member_id: owner }, { room_id: room, member_type: 'agent', member_id: agent }];

describe('PATCH /:id group room', () => {
  const app = Fastify();
  const rpc = vi.fn();
  const agentQuery: any = { select: () => agentQuery, eq: () => agentQuery, in: async () => ({ data: [{ id: agent }], error: null }) };
  const roomQuery: any = { eq: () => roomQuery, maybeSingle: async () => ({ data: { id: room }, error: null }) };
  app.decorateRequest('userId', null);
  app.decorateRequest('db', null);
  app.addHook('onRequest', async req => {
    (req as any).db = {
      from: (table: string) => ({ select: () => roomQuery }),
      rpc,
      ...( { agentsQuery: agentQuery } as any),
    };
    const original = (req as any).db.from;
    (req as any).db.from = (table: string) => table === 'agents' ? agentQuery : original(table);
  });
  beforeAll(async () => { await app.register(groupChatRoutes, { prefix: '/rooms' }); });
  afterAll(async () => { await app.close(); });

  it('updates name and members together through one RPC and returns members', async () => {
    rpc.mockResolvedValueOnce({ data: { room: { id: room, name: 'New' }, members }, error: null });
    const res = await app.inject({ method: 'PATCH', url: `/rooms/${room}`, payload: { name: ' New ', members: [{ type: 'agent', id: agent }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(members);
    expect(rpc).toHaveBeenCalledWith('update_group_room', { p_room_id: room, p_owner_id: owner, p_name: 'New', p_members: [{ member_type: 'user', member_id: owner }, { member_type: 'agent', member_id: agent }] });
  });

  it('keeps the name-only response shape', async () => {
    rpc.mockResolvedValueOnce({ data: { room: { id: room, name: 'New' }, members: null }, error: null });
    const res = await app.inject({ method: 'PATCH', url: `/rooms/${room}`, payload: { name: 'New' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ id: room, name: 'New' });
  });

  it('does not call the RPC for invalid members', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/rooms/${room}`, payload: { name: 'New', members: [{ type: 'user', id: owner }] } });
    expect(res.statusCode).toBe(400);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});