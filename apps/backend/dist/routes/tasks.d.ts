import { FastifyInstance } from 'fastify';
import { DbClient } from '../lib/supabase';
import { TasksRow } from '../types/db';
/** 세션의 작업 목록 (세션 라우트와 공유) */
export declare function listTasksBySession(db: DbClient, sessionId: string, status?: string): Promise<TasksRow[]>;
/** 세션에 작업 생성 (세션 라우트와 공유) */
export declare function createTaskInSession(db: DbClient, sessionId: string, body: unknown): Promise<TasksRow>;
export declare function taskRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=tasks.d.ts.map