"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
exports.build = build;
exports.start = start;
exports.stop = stop;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const config_1 = require("./config");
const errors_1 = require("./lib/errors");
const auth_1 = require("./routes/auth");
const agents_1 = require("./routes/agents");
const sessions_1 = require("./routes/sessions");
const tasks_1 = require("./routes/tasks");
const skills_1 = require("./routes/skills");
const neurons_1 = require("./routes/neurons");
const me_1 = require("./routes/me");
const handler_1 = require("./websocket/handler");
const logger_1 = require("./utils/logger");
exports.app = (0, fastify_1.default)({
    logger: true,
    bodyLimit: 5 * 1024 * 1024, // 5MB (STT 메타/첨부 대비)
});
async function build() {
    // 공통 에러 핸들러
    exports.app.setErrorHandler(errors_1.errorHandler);
    await exports.app.register(cors_1.default, {
        origin: config_1.config.cors.origin,
        credentials: true,
    });
    await exports.app.register(jwt_1.default, { secret: config_1.config.jwt.secret });
    await exports.app.register(websocket_1.default);
    // Health check
    exports.app.get('/health', async () => {
        return { status: 'ok', timestamp: new Date().toISOString(), mode: config_1.config.devMode ? 'dev' : 'prod' };
    });
    exports.app.get('/', async () => {
        return {
            service: 'agenttalk-backend',
            version: '1.0.0',
            mode: config_1.config.devMode ? 'dev' : 'prod',
            docs: '/api-version',
            websocket: '/ws?session_id=<uuid>&token=<jwt>',
        };
    });
    // REST 라우트 (api-design.md §3)
    await exports.app.register(auth_1.authRoutes, { prefix: '/api/auth' });
    await exports.app.register(agents_1.agentRoutes, { prefix: '/api/agents' });
    await exports.app.register(sessions_1.sessionRoutes, { prefix: '/api/sessions' });
    await exports.app.register(tasks_1.taskRoutes, { prefix: '/api/tasks' });
    await exports.app.register(skills_1.skillRoutes, { prefix: '/api/skills' });
    await exports.app.register(neurons_1.neuronRoutes, { prefix: '/api/neurons' });
    await exports.app.register(me_1.meRoutes, { prefix: '/api/me' });
    // API 버전/목록
    exports.app.get('/api-version', async () => {
        return {
            version: 'v1',
            api: ['/api/auth', '/api/agents', '/api/sessions', '/api/tasks', '/api/skills', '/api/neurons', '/api/me'],
            docs: 'apps/backend/docs/api-design.md',
        };
    });
    // WebSocket 엔드포인트 (api-design.md §4)
    exports.app.register(async function (app) {
        app.get('/ws', { websocket: true }, handler_1.websocketHandler);
    });
}
async function start() {
    await build();
    await exports.app.listen({ port: config_1.config.port, host: config_1.config.host });
    logger_1.logger.info(`🚀 AgentTalk Backend running on ${config_1.config.host}:${config_1.config.port} (mode: ${config_1.config.devMode ? 'dev' : 'prod'})`);
}
async function stop() {
    await exports.app.close();
}
// 직접 실행 시에만 listen (테스트에서는 start/stop 사용)
if (require.main === module || process.env.STANDALONE === 'true') {
    start().catch((err) => {
        exports.app.log.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map