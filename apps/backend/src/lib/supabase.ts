import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Admin client (bypasses RLS)
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Public client (RLS applied)
export const supabase = createClient(
  config.supabase.url,
  config.supabase.anonKey
);

// Create client from user JWT
export function createSupabaseClient(accessToken: string) {
  return createClient(
    config.supabase.url,
    config.supabase.anonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );
}
