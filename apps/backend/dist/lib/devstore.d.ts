export type DevRow = Record<string, any>;
export interface DevStore {
    tables: Record<string, DevRow[]>;
    usersByEmail: Map<string, {
        email: string;
        password: string;
        user: DevRow;
    }>;
    sequences: Record<string, number>;
    /** DEV_MODE 첨부 바이트 스토어 (object_path → bytes) — lib/storage.ts dev 경로 + GET /api/attachments/object/* 가 독점. */
    blobs: Map<string, {
        bytes: Buffer;
        mime: string;
    }>;
}
export declare const emptyStore: () => DevStore;
export declare function createStore(): DevStore;
/** 현재 전역 스토어 (테스트에서 초기화/검증용) */
export declare const __devStore: {
    store: DevStore | null;
};
export declare function getStore(): DevStore;
export declare function resetStore(): DevStore;
type QueryResult = {
    data: any;
    error: {
        message: string;
    } | null;
};
interface Filter {
    field: string;
    predicate: (v: unknown) => boolean;
}
interface SelectOp {
    kind: 'select';
    filters: Filter[];
    orderBy: {
        field: string;
        ascending: boolean;
    }[];
    offset: number | null;
    limit: number | null;
    single: boolean;
    maybeSingle: boolean;
    columns: string;
}
/**
 * Mutation op — insert/upsert/update/delete.
 * - `filters`: update/delete의 대상 행 필터 (supabase-js처럼 `.eq()` 체이닝으로 누적)
 * - `then`: Mutation 뒤의 `.select()/.single()` 체이닝 (Postgres RETURNING 개념).
 *   select 계열 메서드는 mutation을 소멸시키지 않고 then에 반영한다.
 */
interface MutationOp {
    kind: 'insert' | 'upsert' | 'update' | 'delete';
    filters: Filter[];
    then: SelectOp | null;
}
type PendingOperation = SelectOp | (MutationOp & {
    kind: 'insert' | 'upsert';
    rows: DevRow[];
    conflictKey: string | null;
}) | (MutationOp & {
    kind: 'update';
    values: DevRow;
}) | (MutationOp & {
    kind: 'delete';
});
export declare class DevQueryBuilder implements PromiseLike<QueryResult> {
    private store;
    private table;
    private op;
    constructor(store: DevStore, table: string, op: PendingOperation);
    select(columns?: string): DevQueryBuilder;
    eq(field: string, value: unknown): DevQueryBuilder;
    neq(field: string, value: unknown): DevQueryBuilder;
    gt(field: string, value: unknown): DevQueryBuilder;
    gte(field: string, value: unknown): DevQueryBuilder;
    lt(field: string, value: unknown): DevQueryBuilder;
    lte(field: string, value: unknown): DevQueryBuilder;
    in(field: string, values: unknown[]): DevQueryBuilder;
    /** PostgREST .is(col, value) — NULL/동등 매칭 (t_401c5bd1 첨부 링크 조건부 UPDATE).
     *  컬럼 미설정(undefined)도 SQL NULL로 취급 — insert에서 생략된 컬럼의 실DB 기본값(NULL)과 동일. */
    is(field: string, value: unknown): DevQueryBuilder;
    private addFilter;
    order(field: string, opts?: {
        ascending?: boolean;
    }): DevQueryBuilder;
    limit(n: number): DevQueryBuilder;
    /** PostgREST range(from, to) — 양끝 포함 오프셋 페이지네이션 (limit/offset parity). */
    range(from: number, to: number): DevQueryBuilder;
    single(): DevQueryBuilder;
    maybeSingle(): DevQueryBuilder;
    insert(values: DevRow | DevRow[]): DevQueryBuilder;
    upsert(values: DevRow | DevRow[], opts?: {
        onConflict?: string;
    }): DevQueryBuilder;
    update(values: DevRow): DevQueryBuilder;
    delete(): DevQueryBuilder;
    then<TResult1 = QueryResult, TResult2 = never>(onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2>;
    private execute;
    private selectRows;
    private applyThen;
    private execSelect;
}
export interface DevClient {
    from(table: string): DevQueryBuilder;
    rpc(fn: string, args?: Record<string, unknown>): Promise<QueryResult>;
    auth: {
        admin: {
            createUser(args: {
                email: string;
                password: string;
                user_metadata?: Record<string, any>;
                email_confirm?: boolean;
            }): Promise<{
                data: {
                    user: DevRow;
                } | null;
                error: {
                    message: string;
                } | null;
            }>;
            deleteUser?(id: string): Promise<{
                data: DevRow | null;
                error: null;
            }>;
        };
        signInWithPassword(args: {
            email: string;
            password: string;
        }): Promise<{
            data: {
                user: DevRow;
                session: {
                    access_token: string;
                    refresh_token: string;
                };
            } | null;
            error: {
                message: string;
            } | null;
        }>;
        signOut?(): Promise<{
            error: null;
        }>;
    };
}
export declare function createDevClient(store: DevStore): DevClient;
/** auth.users 삭제의 FK cascade를 재현한다. 공유 뉴런과 다른 사용자 데이터는 보존한다. */
export declare function deleteDevUser(store: DevStore, userId: string): void;
export {};
//# sourceMappingURL=devstore.d.ts.map