import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Message body for the audit-jobs queue. One message per query - the
 * consumer fans out, polls ChatGPT, and writes a poll_results row.
 */
export interface AuditQueueMessage {
  audit_id: string;
  query_text: string;
  query_category: string;
  query_index: number;
  /** 'query' (default) = poll one LLM for this query. 'citations' = run the
   *  post-finalize citation/why-cited analysis stage for the whole audit. */
  kind?: "query" | "citations";
  /** Which LLM to poll for this query message. Defaults to 'chatgpt' for
   *  backward-compat with legacy single-LLM audits. */
  llm_source?: "chatgpt" | "perplexity" | "gemini";
}

/**
 * Minimal shape of Cloudflare's Queue binding. We don't depend on
 * @cloudflare/workers-types - just the one method we call.
 */
export interface QueueBinding<T> {
  send(message: T, options?: { contentType?: string; delaySeconds?: number }): Promise<void>;
  sendBatch(
    messages: Array<{ body: T; contentType?: string; delaySeconds?: number }>
  ): Promise<void>;
}

/**
 * Cloudflare Workers environment bindings.
 * Plaintext + secrets are set in Cloudflare dashboard:
 *   Workers & Pages → geo-aeo-compass → Settings → Variables and Secrets
 * VITE_SUPABASE_URL is also pinned in wrangler.jsonc to prevent stripping.
 * AUDIT_QUEUE is provided by the queues.producers binding in wrangler.jsonc.
 */
export type Env = {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY: string;
  /** Apify API token - Worker secret + .dev.vars. Never log or expose. */
  APIFY_TOKEN: string;
  /** DataForSEO Basic-Auth credentials (login/password). Powers the Perplexity
   *  + Gemini pollers alongside our direct OpenAI ChatGPT path. */
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
  AUDIT_QUEUE: QueueBinding<AuditQueueMessage>;
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
