import { getSupabaseAdmin } from '../db/supabase';
import { buildBrandDna } from '../audit/brand-dna';
import { getEnv } from '../server/runtime';
import { probeChatGPTModels, listChatGPTModels } from '../llm/dataforseo-client';

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

    // TEMPORARY DIAGNOSTIC — which DFS ChatGPT models actually ground?
    // GET /api/dfs-probe?q=...&models=gpt-4o,o4-mini,gpt-5.3-chat-latest
    if (path === '/api/dfs-probe' && method === 'GET') {
      const q =
        url.searchParams.get('q') || 'best AI supply chain visibility platforms';
      const models = (
        url.searchParams.get('models') ||
        'gpt-4o,gpt-4o-search-preview,o4-mini,gpt-5.3-chat-latest'
      )
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      const probe = await probeChatGPTModels(q, models, env);
      return Response.json({ query: q, probe });
    }
    if (path === '/api/dfs-models' && method === 'GET') {
      return Response.json({ models: await listChatGPTModels(env) });
    }

    if (path === '/api/audit/start' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        brand_name?: string;
        domain?: string;
        category?: string;
        competitors?: string[];
        queries?: string[];
        brand_dna?: unknown;
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

      // Multi-LLM fan-out: each query is polled against N LLMs, one row per
      // (query, llm) in poll_results. Cross-LLM aggregations later derive
      // consensus + universal-source rank. Kept small (3) so the demo audit
      // stays snappy and DFS + OpenAI costs stay bounded.
      const LLMS: Array<'chatgpt' | 'perplexity' | 'gemini'> = [
        'chatgpt',
        'perplexity',
        'gemini',
      ];

      // Insert audit row already in 'running' state. progress_total counts
      // queries × LLMs — the consumer increments per (query, llm) poll.
      const { data: audit, error } = await supabase
        .from('audits')
        .insert({
          brand_name: brandName,
          domain,
          category,
          competitors,
          status: 'running',
          progress_total: cleaned.length * LLMS.length,
          progress_done: 0,
          llms_polled: LLMS,
        })
        .select()
        .single();

      if (error || !audit) {
        return jsonError(500, `Failed to create audit: ${error?.message || 'unknown'}`);
      }

      const auditId = audit.id as string;

      // brand_dna persisted in an ISOLATED best-effort write — if migration
      // 0012 hasn't been applied yet, audit creation must not break (the
      // llms_polled lesson). Failure only loses the DNA display, not the run.
      if (body.brand_dna) {
        const { error: dnaErr } = await supabase
          .from('audits')
          .update({ brand_dna: body.brand_dna })
          .eq('id', auditId);
        if (dnaErr) console.error('[api] brand_dna write failed (non-fatal):', dnaErr.message);
      }

      // Fan out to the queue — one message per (query × llm). Marked
      // query_category 'user' since these aren't from the generated bank.
      try {
        await Promise.all(
          cleaned.flatMap((q, i) =>
            LLMS.map((llm) =>
              env.AUDIT_QUEUE.send({
                audit_id: auditId,
                query_text: q,
                query_category: 'user',
                query_index: i,
                llm_source: llm,
              })
            )
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


    // Operator's strategic note, added after reviewing the auto-generated
    // per-query suggestions. Wired to the UI in Phase 4.
    if (path === '/api/audit/notes' && method === 'PATCH') {
      const body = (await request.json().catch(() => ({}))) as {
        audit_id?: string;
        notes?: string;
      };
      const auditId = body.audit_id?.trim();
      if (!auditId) return jsonError(400, 'audit_id is required');

      const { error } = await supabase
        .from('audits')
        .update({ notes: body.notes ?? null })
        .eq('id', auditId);

      if (error) return jsonError(500, `Failed to update notes: ${error.message}`);
      return Response.json({ ok: true });
    }

    // Re-run ONLY the citation-analysis stage for an existing audit (no
    // re-polling). Recovers an audit whose citation stage was killed mid-run
    // (hung on 'analyzing'), and lets the operator refresh categorization/status
    // after a logic change. Idempotent — analyzeCitations overwrites its outputs.
    if (path === '/api/audit/recite' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { audit_id?: string };
      const auditId = body.audit_id?.trim();
      if (!auditId) return jsonError(400, 'audit_id is required');
      await supabase.from('audits').update({ citation_status: 'analyzing' }).eq('id', auditId);
      try {
        await env.AUDIT_QUEUE.send({
          audit_id: auditId,
          query_text: '',
          query_category: '',
          query_index: -1,
          kind: 'citations',
        });
      } catch (e: any) {
        await supabase.from('audits').update({ citation_status: 'failed' }).eq('id', auditId);
        return jsonError(500, `enqueue failed: ${e?.message || 'unknown'}`);
      }
      return Response.json({ ok: true, audit_id: auditId });
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

    // Brand DNA: scrape the site (Apify), synthesize DNA + pick the 20 most
    // relevant queries (DataForSEO Labs), honoring the caller's intent mode.
    // Synchronous — the launcher shows an analyzing state (~30-70s).
    if (path === '/api/dna' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        domain?: string;
        intent?: string;
      };
      const domain = body.domain?.trim();
      if (!domain) return jsonError(400, 'domain is required');
      const intent = body.intent === 'transactional' ? 'transactional' : 'general';
      try {
        const result = await buildBrandDna(domain, intent, env);
        return Response.json(result);
      } catch (err: any) {
        console.error('[api] dna failed:', err?.message);
        return jsonError(502, err?.message || 'DNA analysis failed');
      }
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
