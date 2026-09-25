"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const config_1 = require("./config");
const auth_1 = require("./routes/auth");
const agents_1 = require("./routes/agents");
const sessions_1 = require("./routes/sessions");
const tasks_1 = require("./routes/tasks");
const handler_1 = require("./websocket/handler");
const logger_1 = require("./utils/logger");
const app = (0, fastify_1.default)({
    logger: true,
});
async function start() {
    try {
        // Register plugins
        await app.register(cors_1.default, {
            origin: config_1.config.cors.origin,
            credentials: true,
        });
        await app.register(websocket_1.default);
        // Health check
        app.get('/health', async () => {
            return { status: 'ok', timestamp: new Date().toISOString() };
        });
        // Register routes
        await app.register(auth_1.authRoutes, { prefix: '/api/auth' });
        await app.register(agents_1.agentRoutes, { prefix: '/api/agents' });
        await app.register(sessions_1.sessionRoutes, { prefix: '/api/sessions' });
        await app.register(tasks_1.taskRoutes, { prefix: '/api/tasks' });
        // WebSocket endpoint
        app.register(async function (app) {
            app.get('/ws', { websocket: true }, handler_1.websocketHandler);
        });
        // Start server
        await app.listen({ port: config_1.config.port, host: config_1.config.host });
        logger_1.logger.info(`🚀 AgentTalk Backend running on ${config_1.config.host}:${config_1.config.port}`);
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map