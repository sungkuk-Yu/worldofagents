/**
 * 라우트에서 사용하는 DB 클라이언트 인터페이스.
 * 프로덕션: Supabase 클라이언트 (PostgREST, RLS 적용)
 * DEV_MODE: 인메모리 devstore 클라이언트
 */
export interface DbClient {
    from(table: string): any;
    rpc(fn: string, args?: Record<string, unknown>): Promise<{
        data: any;
        error: any;
    }>;
    auth: {
        admin: {
            createUser(args: {
                email: string;
                password: string;
                user_metadata?: Record<string, unknown>;
                email_confirm?: boolean;
            }): Promise<{
                data: any;
                error: any;
            }>;
            deleteUser?(id: string): Promise<{
                data: any;
                error: any;
            }>;
        };
        signInWithPassword(args: {
            email: string;
            password: string;
        }): Promise<{
            data: any;
            error: any;
        }>;
        signOut?(): Promise<{
            error: any;
        }>;
    };
}
export declare const supabaseAdmin: DbClient;
export declare const supabase: DbClient;
export declare function createUserClient(accessToken: string): DbClient;
export { getStore, resetStore } from './devstore';
export type { DevStore, DevQueryBuilder } from './devstore';
//# sourceMappingURL=supabase.d.ts.map