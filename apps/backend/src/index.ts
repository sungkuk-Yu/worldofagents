import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config';
import { authRoutes } from './routes/auth';
import { agentRoutes } from './routes/agents';
import { sessionRoutes } from './routes/sessions';
import { taskRoutes } from './routes/tasks';
import { websocketHandler } from './websocket/handler';
import { logger } from './utils/logger';

const app = Fastify({
  logger: true,
});

async function start() {
  try {
    // Register plugins
    await app.register(cors, {
      origin: config.cors.origin,
      credentials: true,
    });

    await app.register(websocket);

    // Health check
    app.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Register routes
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(agentRoutes, { prefix: '/api/agents' });
    await app.register(sessionRoutes, { prefix: '/api/sessions' });
    await app.register(taskRoutes, { prefix: '/api/tasks' });

    // WebSocket endpoint
    app.register(async function (app) {
      app.get('/ws', { websocket: true }, websocketHandler as any);
    });

    // Start server
    await app.listen({ port: config.port, host: config.host });
    logger.info(`🚀 AgentTalk Backend running on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
