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
const multipart_1 = __importDefault(require("@fastify/multipart"));
const config_1 = require("./config");
const errors_1 = require("./lib/errors");
const wsTicket_1 = require("./routes/wsTicket");
const auth_1 = require("./routes/auth");
const agents_1 = require("./routes/agents");
const messages_1 = require("./routes/messages");
const favorites_1 = require("./routes/favorites");
const sessions_1 = require("./routes/sessions");
const tasks_1 = require("./routes/tasks");
const skills_1 = require("./routes/skills");
const neurons_1 = require("./routes/neurons");
const classify_1 = require("./routes/classify");
const me_1 = require("./routes/me");
const vault_1 = require("./routes/vault");
const vaultLibrary_1 = require("./lib/vaultLibrary");
const boards_1 = require("./routes/boards");
const upload_1 = require("./routes/upload");
const attachments_1 = require("./routes/attachments");
const export_1 = require("./routes/export");
const handler_1 = require("./websocket/handler");
const logger_1 = require("./utils/logger");
const registry_1 = require("./neurons/registry");
const supabase_1 = require("./lib/supabase");
const resume_1 = require("./lib/resume");
exports.app = (0, fastify_1.default)({
    logger: true,
    bodyLimit: 5 * 1024 * 1024, // 5MB (STT 메타/첨부 대비)
});
async function build() {
    (0, config_1.validateConfig)();
    // 공통 에러 핸들러
    exports.app.setErrorHandler(errors_1.errorHandler);
    await exports.app.register(cors_1.default, {
        origin: config_1.config.cors.origin,
        credentials: true,
    });
    await exports.app.register(jwt_1.default, { secret: config_1.config.jwt.secret });
    await exports.app.register(websocket_1.default);
    // 첨부 업로드 (t_401c5bd1) — /api/upload의 POST만 multipart. 라우트 단위 bodyLimit이 더 크게 설정됨.
    await exports.app.register(multipart_1.default, {
        limits: { fileSize: config_1.config.upload.maxBytes, files: 1, fields: 0 },
    });
    // Health check
    exports.app.get('/health', async () => {
        return { status: 'ok', timestamp: new Date().toISOString(), mode: config_1.config.devMode ? 'dev' : 'prod' };
    });
    exports.app.get('/', async () => {
        return {
            service: 'myagenttalk-backend',
            version: '1.0.0',
            mode: config_1.config.devMode ? 'dev' : 'prod',
            docs: '/api-version',
            websocket: '/ws?session_id=<uuid>&ticket=<ticket>',
        };
    });
    // REST 라우트 (api-design.md §3)
    await exports.app.register(wsTicket_1.wsTicketRoutes, { prefix: '/api/ws-ticket' });
    await exports.app.register(auth_1.authRoutes, { prefix: '/api/auth' });
    await exports.app.register(agents_1.agentRoutes, { prefix: '/api/agents' });
    await exports.app.register(messages_1.messageRoutes, { prefix: '/api/messages' });
    await exports.app.register(favorites_1.favoriteRoutes, { prefix: '/api/favorites' });
    await exports.app.register(sessions_1.sessionRoutes, { prefix: '/api/sessions' });
    await exports.app.register(tasks_1.taskRoutes, { prefix: '/api/tasks' });
    await exports.app.register(skills_1.skillRoutes, { prefix: '/api/skills' });
    await exports.app.register(neurons_1.neuronRoutes, { prefix: '/api/neurons' });
    await exports.app.register(classify_1.classifyRoutes, { prefix: '/api/classify' });
    await exports.app.register(me_1.meRoutes, { prefix: '/api/me' });
    await exports.app.register(vault_1.vaultRoutes, { prefix: '/api/vault' });
    // 볼트 도서관 검색 (t_d469fac3) — 관리자 토큰 엔드, vaultRoutes와 같은 프리픽스 별개 레인
    await exports.app.register(vaultLibrary_1.vaultLibraryRoutes, { prefix: '/api/vault' });
    await exports.app.register(boards_1.boardRoutes, { prefix: '/api/boards' });
    await exports.app.register(boards_1.cardRoutes, { prefix: '/api/cards' });
    // 첨부 (t_401c5bd1) — 업로드 인입 + 열람/링크
    await exports.app.register(upload_1.uploadRoutes, { prefix: '/api/upload' });
    await exports.app.register(attachments_1.attachmentRoutes, { prefix: '/api/attachments' });
    // 카드 내보내기 (t_3116c5bc) — GET /api/messages/:id/export?fmt=pdf|docx|xlsx|hwp
    await exports.app.register(export_1.exportRoutes, { prefix: '/api/messages' });
    // API 버전/목록
    exports.app.get('/api-version', async () => {
        return {
            version: 'v1',
            api: ['/api/messages', '/api/favorites', '/api/ws-ticket', '/api/auth', '/api/agents', '/api/sessions', '/api/tasks', '/api/skills', '/api/neurons', '/api/me', '/api/vault', '/api/boards', '/api/cards', '/api/upload', '/api/attachments'],
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
    // 시드 보장 (t_8ef66bb0 / 실패로그 A5): 프로덕션은 neurons 기본값이 devstore 시드에
    // 의존하지 않으므로 부팅 시 supabaseAdmin(실DB) 경로로 upsert를 보장한다.
    // skills 카탈로그는 supabase/migrations/006_prod_seed.sql(김비서 적용) 소관 — 코드는 neurons만.
    // 실패해도 서버 기동을 막지 않는다(warn 후 계속): 006 미적용 초기에 DB 준비 지연과 무관해야 함.
    // 성공 로그는 '햇빛' 금지 원칙에 따라 실제 read-back(count>0)으로 검증하고 남긴다.
    if (!config_1.config.devMode) {
        try {
            await (0, registry_1.ensureDefaultNeurons)(supabase_1.supabaseAdmin);
            const { data: seeded, error } = await supabase_1.supabaseAdmin.from('neurons').select('slug').eq('status', 'active');
            if (error) {
                logger_1.logger.warn(`neurons 부팅 시드 검증 실패(DB 오류, 서버는 계속): ${error.message}`);
            }
            else if (!seeded || seeded.length === 0) {
                logger_1.logger.warn('neurons 부팅 시드 검증 실패(active 0행 — 006 미적용/쓰기 거부 의심, 서버는 계속)');
            }
            else {
                logger_1.logger.info(`🧬 neurons 기본 시드 보장 완료 (devstore 무관, 실DB active ${seeded.length}행 read-back 확인)`);
            }
        }
        catch (err) {
            logger_1.logger.warn(`neurons 부팅 시드 실패(서버는 계속): ${err.message}`);
        }
    }
    await exports.app.listen({ port: config_1.config.port, host: config_1.config.host });
    logger_1.logger.info(`🚀 MyAgentTalk Backend running on ${config_1.config.host}:${config_1.config.port} (mode: ${config_1.config.devMode ? 'dev' : 'prod'})`);
    // 내구성 실행 (t_7182aa8f③): 미완 run resume — listen 이후(허브 준비됨), 부팅 차단 금지(백그라운드).
    // flag off/014 래치는 no-op. 재시작·재배포로 죽은 답변을 이어 완성한다.
    void (0, resume_1.resumeOpenRuns)().then(n => {
        if (n > 0)
            logger_1.logger.info(`♻️ 부팅 resume 완료: ${n}개 run 이어 실행`);
    }).catch(err => logger_1.logger.warn(`부팅 resume 실패(서버는 계속): ${err.message}`));
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