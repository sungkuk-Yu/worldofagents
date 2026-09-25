import { FastifyInstance } from 'fastify';
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
export declare function authRoutes(app: FastifyInstance): Promise<void>;
declare module 'fastify' {
    interface FastifyInstance {
        authenticate: any;
    }
}
export declare function authMiddleware(app: FastifyInstance): Promise<void>;
export {};
//# sourceMappingURL=auth.d.ts.map