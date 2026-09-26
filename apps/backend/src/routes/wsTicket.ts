import { randomBytes } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth';
import { ok } from '../lib/errors';

const tickets = new Map<string, { userId: string; expiresAt: number; used: boolean }>();
const TTL_SECONDS = 30;

export function issueTicket(userId: string): { ticket: string; expiresIn: number } {
  const now = Date.now();
  if (tickets.size > 10_000) {
    for (const [ticket, entry] of tickets) {
      if (entry.expiresAt <= now) tickets.delete(ticket);
    }
  }
  const ticket = randomBytes(16).toString('hex');
  tickets.set(ticket, { userId, expiresAt: now + TTL_SECONDS * 1000, used: false });
  return { ticket, expiresIn: TTL_SECONDS };
}

export function consumeTicket(ticket: string): string | null {
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.used || entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}

export async function wsTicketRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: requireAuth }, async request => {
    const { ticket, expiresIn } = issueTicket(request.userId);
    return ok({ ticket, expires_in: expiresIn });
  });
}
