import { getSupabaseAdmin } from '../db/supabase';
import { getEnv } from '../server/runtime';

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
 * Audit execution: /api/audit/start inserts the audit row, enqueues one
 * message per user-supplied query to AUDIT_QUEUE, and returns. The queue()
 * handler in src/server.ts consumes batches in parallel — each query gets
 * its own fresh CPU budget, so the free-tier waitUntil kill (Phase 3.13)
 * no longer applies. Query count is dynamic (no upper limit).
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
        queries?: string[];
      };

      if (!body.brand_name?.trim()) return jsonError(400, 'brand_name is required');
      if (!body.domain?.trim()) return jsonError(400, 'domain is required');

      const brandName = body.brand_name.trim();
      const domain = body.domain.trim();
      const category = body.category?.trim() || null;
      const competitors = (body.competitors || [])
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 5);

      // Queries are user-supplied (one per line from the UI). Trim, drop
      // empties, dedupe exact matches. No upper limit on count.
      const rawQueries = Array.isArray(body.queries) ? body.queries : [];
      const cleaned = Array.from(
        new Set(rawQueries.map((q) => q.trim()).filter((q) => q.length > 0))
      );
      if (cleaned.length === 0) {
        return jsonError(400, 'No valid queries provided');
      }

      // Insert audit row already in 'running' state with the dynamic query
      // count as progress_total — the queue consumer increments progress_done
      // per message and finalizes when done >= total.
      const { data: audit, error } = await supabase
        .from('audits')
        .insert({
          brand_name: brandName,
          domain,
          category,
          competitors,
          status: 'running',
          progress_total: cleaned.length,
          progress_done: 0,
        })
        .select()
        .single();

      if (error || !audit) {
        return jsonError(500, `Failed to create audit: ${error?.message || 'unknown'}`);
      }

      const auditId = audit.id as string;

      // Fan out to the queue — one message per cleaned query. Marked
      // query_category 'user' since these aren't from the generated bank.
      try {
        await Promise.all(
          cleaned.map((q, i) =>
            env.AUDIT_QUEUE.send({
              audit_id: auditId,
              query_text: q,
              query_category: 'user',
              query_index: i,
            })
          )
        );
      } catch (enqueueErr: any) {
        console.error('[api] enqueue failed:', enqueueErr);
        await supabase
          .from('audits')
          .update({
            status: 'failed',
            error_message: (enqueueErr?.message || 'enqueue failed').slice(0, 500),
          })
          .eq('id', auditId);
        return jsonError(500, `Failed to enqueue audit: ${enqueueErr?.message || 'unknown'}`);
      }

      return Response.json({ audit_id: auditId, query_count: cleaned.length });
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
