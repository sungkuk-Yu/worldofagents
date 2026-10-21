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
/**
 * 로그인(signInWithPassword) 전용 — 요청마다 새로 만드는 일회용 클라이언트의 auth.
 *
 * P0 핫픽스(t_486cf23b): 공유 supabaseAdmin에서 signInWithPassword를 호출하면
 * supabase-js가 해당 인스턴스에 사용자 세션을 저장한다(persistSession=false여도
 * 메모리 세션으로 유지). 이후 공유 클라이언트의 모든 PostgREST 요청이
 * service_role 키 대신 "마지막 로그인한 사용자"의 JWT를 Authorization으로 보내
 * RLS가 발동 → 002 마이그레이션(SELECT 전용 정책) 기준으로 쓰기 전체가 거부된다.
 * 따라서 사용자 세션이 생기는 auth 호출은 절대 공유 admin 클라이언트에서 하지 말고
 * 이 팩토리로 만든 일회용 클라이언트에서 수행한 뒤 버린다(GC).
 */
export declare function createEphemeralAuthClient(): DbClient['auth'];
export declare const supabase: DbClient;
/** Phase 3 예정: 자체 JWT를 Supabase access token으로 교환한 뒤 사용할 RLS 클라이언트. */
export declare function createUserClient(accessToken: string): DbClient;
export { getStore, resetStore } from './devstore';
export type { DevStore, DevQueryBuilder } from './devstore';
//# sourceMappingURL=supabase.d.ts.map