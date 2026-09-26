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
import { classifyRoutes } from './routes/classify';
import { meRoutes } from './routes/me';
import { vaultRoutes } from './routes/vault';
import { boardRoutes, cardRoutes } from './routes/boards';
import { websocketHandler } from './websocket/handler';
import { logger } from './utils/logger';
import { ensureDefaultNeurons } from './neurons/registry';
import { supabaseAdmin } from './lib/supabase';

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
  await app.register(classifyRoutes, { prefix: '/api/classify' });
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
  // 시드 보장 (t_8ef66bb0 / 실패로그 A5): 프로덕션은 neurons 기본값이 devstore 시드에
  // 의존하지 않으므로 부팅 시 supabaseAdmin(실DB) 경로로 upsert를 보장한다.
  // skills 카탈로그는 supabase/migrations/006_prod_seed.sql(김비서 적용) 소관 — 코드는 neurons만.
  // 실패해도 서버 기동을 막지 않는다(warn 후 계속): 006 미적용 초기에 DB 준비 지연과 무관해야 함.
  // 성공 로그는 '햇빛' 금지 원칙에 따라 실제 read-back(count>0)으로 검증하고 남긴다.
  if (!config.devMode) {
    try {
      await ensureDefaultNeurons(supabaseAdmin);
      const { data: seeded, error } = await supabaseAdmin.from('neurons').select('slug').eq('status', 'active');
      if (error) {
        logger.warn(`neurons 부팅 시드 검증 실패(DB 오류, 서버는 계속): ${error.message}`);
      } else if (!seeded || seeded.length === 0) {
        logger.warn('neurons 부팅 시드 검증 실패(active 0행 — 006 미적용/쓰기 거부 의심, 서버는 계속)');
      } else {
        logger.info(`🧬 neurons 기본 시드 보장 완료 (devstore 무관, 실DB active ${seeded.length}행 read-back 확인)`);
      }
    } catch (err) {
      logger.warn(`neurons 부팅 시드 실패(서버는 계속): ${(err as Error).message}`);
    }
  }
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