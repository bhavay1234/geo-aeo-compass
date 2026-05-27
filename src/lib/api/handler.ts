import { getSupabaseAdmin } from '../db/supabase';
import { runAudit } from '../audit/orchestrator';
import { getEnv, getExecutionCtx } from '../server/runtime';

/**
 * Plain-JSON HTTP API handler for /api/audit/*.
 *
 * Why this exists alongside src/lib/api/audit.ts (createServerFn):
 * TanStack Start server functions use Seroval-encoded JSON on the wire,
 * which means manual `fetch('/_serverFn/...', { body: JSON.stringify(...) })`
 * tests fail with a deserialization error. These routes accept plain JSON
 * so curl, Postman, and ad-hoc browser-console tests work.
 *
 * Routing is dispatched from src/server.ts before TanStack Start sees the
 * request, so /api/* never enters the createServerFn RPC pipeline.
 *
 * Audit execution: /api/audit/start kicks off runAudit() via ctx.waitUntil.
 * runAudit processes all 20 queries sequentially in batches of 3, ~70-100s
 * total. The self-invoke chaining tried in Phase 3.12 doesn't work on
 * Cloudflare's free tier (error 1042: Worker→own-zone subrequest blocked).
 */
export async function handleApiRoute(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  try {
    const env = getEnv();
    const supabase = getSupabaseAdmin(env);

    if (path === '/api/audit/start' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        brand_name?: string;
        domain?: string;
        category?: string;
        competitors?: string[];
      };

      if (!body.brand_name?.trim()) return jsonError(400, 'brand_name is required');
      if (!body.domain?.trim()) return jsonError(400, 'domain is required');

      const { data: audit, error } = await supabase
        .from('audits')
        .insert({
          brand_name: body.brand_name.trim(),
          domain: body.domain.trim(),
          category: body.category?.trim() || null,
          competitors: (body.competitors || [])
            .map((c) => c.trim())
            .filter(Boolean)
            .slice(0, 5),
          status: 'pending',
        })
        .select()
        .single();

      if (error || !audit) {
        return jsonError(500, `Failed to create audit: ${error?.message || 'unknown'}`);
      }

      const auditId = audit.id as string;
      const ctx = getExecutionCtx();
      if (ctx?.waitUntil) {
        ctx.waitUntil(runAudit(auditId, env));
      } else {
        runAudit(auditId, env).catch((err) => {
          console.error('[api] background runAudit error:', err);
        });
      }

      return Response.json({ audit_id: auditId });
    }

    if (path === '/api/audit/status' && method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id?.trim()) return jsonError(400, 'id query param is required');

      const { data: audit, error } = await supabase
        .from('audits')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !audit) return jsonError(404, 'Audit not found');
      return Response.json(audit);
    }

    if (path === '/api/audit/result' && method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id?.trim()) return jsonError(400, 'id query param is required');

      const [auditRes, pollsRes] = await Promise.all([
        supabase.from('audits').select('*').eq('id', id).single(),
        supabase
          .from('poll_results')
          .select('*')
          .eq('audit_id', id)
          .order('created_at', { ascending: true }),
      ]);

      if (auditRes.error || !auditRes.data) return jsonError(404, 'Audit not found');
      return Response.json({ audit: auditRes.data, polls: pollsRes.data || [] });
    }

    if (path === '/api/audits/recent' && method === 'GET') {
      const { data } = await supabase
        .from('audits')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      return Response.json(data || []);
    }

    return jsonError(404, `Not found: ${method} ${path}`);
  } catch (error: any) {
    console.error('[api] unhandled error:', error);
    return jsonError(500, error?.message || 'Internal error');
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
