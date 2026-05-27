import { getSupabaseAdmin } from '../db/supabase';
import { processBatch } from '../audit/orchestrator';
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
 * Audit execution uses a self-invoking batched pattern:
 *   /api/audit/start         — kicks off batch 0
 *   /api/audit/process-batch — internal endpoint, each invocation handles
 *                              one batch of ~3 queries and chains to the
 *                              next via fetch(). Each chain link gets a
 *                              fresh Cloudflare ctx.waitUntil() budget.
 */
export async function handleApiRoute(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const workerUrl = url.origin;

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
        ctx.waitUntil(processBatch(auditId, 0, env, workerUrl));
      } else {
        processBatch(auditId, 0, env, workerUrl).catch((err) => {
          console.error('[api] background processBatch error:', err);
        });
      }

      return Response.json({ audit_id: auditId });
    }

    // Internal self-invoke endpoint used by the orchestrator to chain
    // batches across Worker invocations. No auth — anyone could trigger
    // a re-process of an existing audit. v2: add HMAC signing.
    if (path === '/api/audit/process-batch' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        audit_id?: string;
        batch_index?: number;
      };

      const auditId = body.audit_id?.trim();
      const batchIndex = body.batch_index;
      if (!auditId) return jsonError(400, 'audit_id is required');
      if (typeof batchIndex !== 'number' || batchIndex < 0 || !Number.isInteger(batchIndex)) {
        return jsonError(400, 'batch_index must be a non-negative integer');
      }

      const ctx = getExecutionCtx();
      if (ctx?.waitUntil) {
        ctx.waitUntil(processBatch(auditId, batchIndex, env, workerUrl));
      } else {
        processBatch(auditId, batchIndex, env, workerUrl).catch((err) => {
          console.error('[api] background processBatch error:', err);
        });
      }

      return new Response(
        JSON.stringify({ audit_id: auditId, batch_index: batchIndex }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
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
