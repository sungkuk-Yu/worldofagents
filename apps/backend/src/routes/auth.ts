import { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { config } from '../config';
import jwt from '@fastify/jwt';

interface JwtPayload {
  sub: string;
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export async function authRoutes(app: FastifyInstance) {
  // Register JWT
  await app.register(jwt, { secret: config.jwt.secret });

  // POST /api/auth/signup
  app.post('/signup', async (request, reply) => {
    const { email, password, name } = request.body as {
      email: string;
      password: string;
      name?: string;
    };

    // Dev mode: return mock user without Supabase
    if (config.devMode) {
      const mockUserId = 'dev-' + Math.random().toString(36).substr(2, 9);
      const token = app.jwt.sign(
        { sub: mockUserId, email: email! },
        { expiresIn: config.jwt.expiresIn as string }
      );
      
      return reply.status(201).send({
        message: 'User created (dev mode)',
        user: {
          id: mockUserId,
          email,
          name: name || email.split('@')[0],
        },
        token
      });
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      email_confirm: true,
    });

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    // Create user profile in public.users table
    if (data.user) {
      await supabaseAdmin.from('users').upsert({
        id: data.user.id,
        email,
        display_name: name || email.split('@')[0],
        created_at: new Date().toISOString(),
      });
    }

    return reply.status(201).send({
      user: {
        id: data.user?.id,
        email: data.user?.email,
        name,
      },
    });
  });

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const { email, password } = request.body as {
      email: string;
      password: string;
    };

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Issue our own JWT
    const token = app.jwt.sign(
      { sub: data.user.id, email: data.user.email! },
      { expiresIn: config.jwt.expiresIn as string }
    );

    return {
      token,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      supabaseSession: data.session,
    };
  });

  // GET /api/auth/me
  app.get('/me', {
    onRequest: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    },
    handler: async (request) => {
      const userId = (request.user as any).sub;
      const { data } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      return data;
    },
  });
}
