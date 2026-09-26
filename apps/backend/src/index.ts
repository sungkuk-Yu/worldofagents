import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config, validateConfig } from './config';
import { errorHandler } from './lib/errors';
import { wsTicketRoutes } from './routes/wsTicket';
import { authRoutes } from './routes/auth';
import { agentRoutes } from './routes/agents';
import { messageRoutes } from './routes/messages';
import { favoriteRoutes } from './routes/favorites';
import { sessionRoutes } from './routes/sessions';
import { taskRoutes } from './routes/tasks';
import { skillRoutes } from './routes/skills';
import { neuronRoutes } from './routes/neurons';
import { meRoutes } from './routes/me';
import { vaultRoutes } from './routes/vault';
import { boardRoutes, cardRoutes } from './routes/boards';
import { websocketHandler } from './websocket/handler';
import { logger } from './utils/logger';

export const app = Fastify({
  logger: true,
  bodyLimit: 5 * 1024 * 1024, // 5MB (STT 메타/첨부 대비)
});

export async function build() {
  validateConfig();
  // 공통 에러 핸들러
  app.setErrorHandler(errorHandler);

  await app.register(cors, {
    origin: config.cors.origin,
    credentials: true,
  });

  await app.register(jwt, { secret: config.jwt.secret });

  await app.register(websocket);

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString(), mode: config.devMode ? 'dev' : 'prod' };
  });

  app.get('/', async () => {
    return {
      service: 'myagenttalk-backend',
      version: '1.0.0',
      mode: config.devMode ? 'dev' : 'prod',
      docs: '/api-version',
      websocket: '/ws?session_id=<uuid>&ticket=<ticket>',
    };
  });

  // REST 라우트 (api-design.md §3)
  await app.register(wsTicketRoutes, { prefix: '/api/ws-ticket' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(agentRoutes, { prefix: '/api/agents' });
  await app.register(messageRoutes, { prefix: '/api/messages' });
  await app.register(favoriteRoutes, { prefix: '/api/favorites' });
  await app.register(sessionRoutes, { prefix: '/api/sessions' });
  await app.register(taskRoutes, { prefix: '/api/tasks' });
  await app.register(skillRoutes, { prefix: '/api/skills' });
  await app.register(neuronRoutes, { prefix: '/api/neurons' });
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.register(vaultRoutes, { prefix: '/api/vault' });
  await app.register(boardRoutes, { prefix: '/api/boards' });
  await app.register(cardRoutes, { prefix: '/api/cards' });

  // API 버전/목록
  app.get('/api-version', async () => {
    return {
      version: 'v1',
      api: ['/api/messages', '/api/favorites', '/api/ws-ticket', '/api/auth', '/api/agents', '/api/sessions', '/api/tasks', '/api/skills', '/api/neurons', '/api/me', '/api/vault', '/api/boards', '/api/cards'],
      docs: 'apps/backend/docs/api-design.md',
    };
  });

  // WebSocket 엔드포인트 (api-design.md §4)
  app.register(async function (app) {
    app.get('/ws', { websocket: true }, websocketHandler as any);
  });
}

export async function start(): Promise<void> {
  await build();
  await app.listen({ port: config.port, host: config.host });
  logger.info(`🚀 MyAgentTalk Backend running on ${config.host}:${config.port} (mode: ${config.devMode ? 'dev' : 'prod'})`);
}

export async function stop(): Promise<void> {
  await app.close();
}

// 직접 실행 시에만 listen (테스트에서는 start/stop 사용)
if (require.main === module || process.env.STANDALONE === 'true') {
  start().catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}