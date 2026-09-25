"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
exports.authMiddleware = authMiddleware;
const supabase_1 = require("../lib/supabase");
const config_1 = require("../config");
const jwt_1 = __importDefault(require("@fastify/jwt"));
async function authRoutes(app) {
    // Register JWT
    await app.register(jwt_1.default, { secret: config_1.config.jwt.secret });
    // POST /api/auth/signup
    app.post('/signup', async (request, reply) => {
        const { email, password, name } = request.body;
        const { data, error } = await supabase_1.supabaseAdmin.auth.admin.createUser({
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
            await supabase_1.supabaseAdmin.from('users').upsert({
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
        const { email, password } = request.body;
        const { data, error } = await supabase_1.supabaseAdmin.auth.signInWithPassword({
            email,
            password,
        });
        if (error || !data.session) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }
        // Issue our own JWT
        const token = app.jwt.sign({ sub: data.user.id, email: data.user.email }, { expiresIn: config_1.config.jwt.expiresIn });
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
        preHandler: [app.authenticate],
        handler: async (request) => {
            const userId = request.user.sub;
            const { data } = await supabase_1.supabaseAdmin
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();
            return data;
        },
    });
}
// Middleware
async function authMiddleware(app) {
    app.decorate('authenticate', async function (request, reply) {
        try {
            await request.jwtVerify();
        }
        catch (err) {
            reply.code(401).send({ error: 'Unauthorized' });
        }
    });
}
//# sourceMappingURL=auth.js.map