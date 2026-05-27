import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cloudflare Workers environment bindings.
 * These are set in Cloudflare dashboard:
 *   Workers & Pages → geo-aeo-compass → Settings → Variables and Secrets
 */
export type Env = {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY: string;
  // Optional: only consumed by callers that don't have access to the
  // incoming request URL (e.g. createServerFn handlers in src/lib/api/audit.ts).
  // The plain /api/* handler derives workerUrl from request.url instead.
  WORKER_URL?: string;
};

/**
 * Server-side Supabase client with elevated privileges.
 * Bypasses Row-Level Security. Use only in server functions.
 */
export function getSupabaseAdmin(env: Env): SupabaseClient {
  if (!env.VITE_SUPABASE_URL) {
    throw new Error('Missing VITE_SUPABASE_URL env var');
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY env var');
  }

  return createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
