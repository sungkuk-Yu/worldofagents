import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { createDevClient, DevClient, getStore } from './devstore';

/**
 * 라우트에서 사용하는 DB 클라이언트 인터페이스.
 * 프로덕션: Supabase 클라이언트 (PostgREST, RLS 적용)
 * DEV_MODE: 인메모리 devstore 클라이언트
 */
export interface DbClient {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: any; error: any }>;
  auth: {
    admin: {
      createUser(args: { email: string; password: string; user_metadata?: Record<string, unknown>; email_confirm?: boolean }): Promise<{ data: any; error: any }>;
      deleteUser?(id: string): Promise<{ data: any; error: any }>;
    };
    signInWithPassword(args: { email: string; password: string }): Promise<{ data: any; error: any }>;
    signOut?(): Promise<{ error: any }>;
  };
}

function buildClient(
  url: string,
  key: string,
  opts?: { dev?: boolean; accessToken?: string }
): DbClient {
  if (config.devMode || opts?.dev) {
    return createDevClient(getStore()) as unknown as DbClient;
  }
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: opts?.accessToken
      ? { headers: { Authorization: `Bearer ${opts.accessToken}` } }
      : undefined,
  });
  return client as unknown as DbClient;
}

// 서비스 롤 클라이언트 (RLS 우회 — 서버에서만 사용)
export const supabaseAdmin: DbClient = buildClient(config.supabase.url, config.supabase.serviceKey);

// 익명(anon) 클라이언트 (RLS 적용)
export const supabase: DbClient = buildClient(config.supabase.url, config.supabase.anonKey);

// 사용자 JWT 기반 클라이언트 — RLS가 사용자 컨텍스트를 반영
export function createUserClient(accessToken: string): DbClient {
  if (config.devMode) return supabaseAdmin;
  return buildClient(config.supabase.url, config.supabase.anonKey, { accessToken });
}

// devstore 접근 (테스트/디버깅)
export { getStore, resetStore } from './devstore';
export type { DevStore, DevQueryBuilder } from './devstore';