import { createServerFn } from '@tanstack/react-start';
import { getSupabaseAdmin } from '../db/supabase';
import { processBatch } from '../audit/orchestrator';
import { getEnv, getExecutionCtx } from '../server/runtime';

/**
 * POST /api/audit/start
 * Creates a new audit row, triggers runAudit async, returns audit_id.
 */
export const startAudit = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      brand_name: string;
      domain: string;
      category?: string;
      competitors?: string[];
    }) => {
      if (!data.brand_name?.trim()) {
        throw new Error('brand_name is required');
      }
      if (!data.domain?.trim()) {
        throw new Error('domain is required');
      }
      return {
        brand_name: data.brand_name.trim(),
        domain: data.domain.trim(),
        category: data.category?.trim() || null,
        competitors: (data.competitors || [])
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 5),
      };
    }
  )
  .handler(async ({ data }) => {
    const env = getEnv();
    const supabase = getSupabaseAdmin(env);

    const { data: audit, error } = await supabase
      .from('audits')
      .insert({
        brand_name: data.brand_name,
        domain: data.domain,
        category: data.category,
        competitors: data.competitors,
        status: 'pending',
      })
      .select()
      .single();

    if (error || !audit) {
      throw new Error(
        `Failed to create audit: ${error?.message || 'unknown'}`
      );
    }

    // Fire batch 0 asynchronously. processBatch self-invokes via fetch
    // for subsequent batches, so each chain link gets a fresh Cloudflare
    // ctx.waitUntil() budget. createServerFn callers don't have request.url
    // readily available, so we fall back to env.WORKER_URL (must be set
    // in Cloudflare dashboard for this code path to chain correctly).
    // The plain /api/audit/start endpoint derives workerUrl from request.url
    // and doesn't need this env var.
    const workerUrl = env.WORKER_URL || '';
    const ctx = getExecutionCtx();
    if (ctx?.waitUntil) {
      ctx.waitUntil(processBatch(audit.id, 0, env, workerUrl));
    } else {
      processBatch(audit.id, 0, env, workerUrl).catch((err) => {
        console.error('[startAudit] background error:', err);
      });
    }

    return { audit_id: audit.id };
  });

/**
 * GET /api/audit/status — poll progress while audit runs
 */
export const getAuditStatus = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: string }) => {
    if (!data.id?.trim()) throw new Error('id is required');
    return { id: data.id.trim() };
  })
  .handler(async ({ data }) => {
    const env = getEnv();
    const supabase = getSupabaseAdmin(env);

    const { data: audit, error } = await supabase
      .from('audits')
      .select('*')
      .eq('id', data.id)
      .single();

    if (error || !audit) {
      throw new Error('Audit not found');
    }

    return audit;
  });

/**
 * GET /api/audit/result — fetch audit + all poll_results for display
 */
export const getAuditResult = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: string }) => {
    if (!data.id?.trim()) throw new Error('id is required');
    return { id: data.id.trim() };
  })
  .handler(async ({ data }) => {
    const env = getEnv();
    const supabase = getSupabaseAdmin(env);

    const [auditRes, pollsRes] = await Promise.all([
      supabase.from('audits').select('*').eq('id', data.id).single(),
      supabase
        .from('poll_results')
        .select('*')
        .eq('audit_id', data.id)
        .order('created_at', { ascending: true }),
    ]);

    if (auditRes.error || !auditRes.data) {
      throw new Error('Audit not found');
    }

    return {
      audit: auditRes.data,
      polls: pollsRes.data || [],
    };
  });

/**
 * GET /api/audits/recent — list last 10 audits for dashboard
 */
export const listRecentAudits = createServerFn({ method: 'GET' }).handler(
  async () => {
    const env = getEnv();
    const supabase = getSupabaseAdmin(env);

    const { data } = await supabase
      .from('audits')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    return data || [];
  }
);
