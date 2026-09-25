export type DevRow = Record<string, any>;
export interface DevStore {
    tables: Record<string, DevRow[]>;
    usersByEmail: Map<string, {
        email: string;
        password: string;
        user: DevRow;
    }>;
    sequences: Record<string, number>;
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
    } | null;
    limit: number | null;
    single: boolean;
    maybeSingle: boolean;
    columns: string;
}
type PendingOperation = SelectOp | {
    kind: 'insert' | 'upsert';
    rows: DevRow[];
    conflictKey: string | null;
    then: SelectOp | null;
} | {
    kind: 'update';
    values: DevRow;
    then: SelectOp | null;
} | {
    kind: 'delete';
    then: SelectOp | null;
};
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
    private addFilter;
    order(field: string, opts?: {
        ascending?: boolean;
    }): DevQueryBuilder;
    limit(n: number): DevQueryBuilder;
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
export {};
//# sourceMappingURL=devstore.d.ts.map