import { pollChatGPT } from '../llm';
import { parseCitations } from './citation-parser';
import { generateQueries, type BuyerQuery } from './query-bank';
import { getSupabaseAdmin, type Env } from '../db/supabase';
import type { AuditSummary, PollResult, CategoryStats } from '../db/types';

const BATCH_SIZE = 3;

/**
 * Runs ONE batch of an audit (3 queries) inside the current Cloudflare Worker
 * invocation, then self-invokes for the next batch via HTTP.
 *
 * Why batched + self-invoking: Cloudflare's ctx.waitUntil() has a ~30s budget
 * after the response returns, but a 20-query audit takes ~60-90s. Each
 * self-invoke is a fresh invocation with its own 30s budget, so the audit
 * can run to completion by chaining 7 invocations.
 *
 * Idempotency: this function reads current state from Supabase before doing
 * work. If a batch is re-dispatched (Cloudflare retry, double-invoke), it
 * inserts duplicate poll_results rows — acceptable for v1. v2 should add a
 * unique constraint on (audit_id, query_text).
 */
export async function processBatch(
  auditId: string,
  batchIndex: number,
  env: Env,
  workerUrl: string
): Promise<void> {
  const supabase = getSupabaseAdmin(env);

  const { data: audit, error: fetchErr } = await supabase
    .from('audits')
    .select('*')
    .eq('id', auditId)
    .single();

  if (fetchErr || !audit) {
    console.error('[orchestrator] audit not found:', auditId, fetchErr);
    return;
  }

  // Early exit if a previous batch already finalized the audit.
  if (audit.status === 'completed' || audit.status === 'failed') {
    console.log(
      `[orchestrator] audit ${auditId} already ${audit.status}, skipping batch ${batchIndex}`
    );
    return;
  }

  const brandName: string = audit.brand_name;
  const domain: string = audit.domain;
  const category: string | null = audit.category;
  const competitors: string[] = Array.isArray(audit.competitors)
    ? audit.competitors
    : [];

  try {
    const queries: BuyerQuery[] = generateQueries(
      category || 'software',
      brandName,
      competitors
    );

    const start = batchIndex * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, queries.length);
    console.log('[orchestrator] batch', batchIndex, 'start', start, 'end', end);

    // Defensive: someone invoked us past the last batch. Finalize and exit.
    if (start >= queries.length) {
      console.log(
        '[orchestrator] start >= queries.length, finalizing without processing'
      );
      await finalize(auditId, brandName, competitors, queries.length, env);
      return;
    }

    // First batch flips the audit into "running" with the query total.
    if (batchIndex === 0 && audit.status === 'pending') {
      await supabase
        .from('audits')
        .update({
          status: 'running',
          progress_total: queries.length,
          progress_done: 0,
        })
        .eq('id', auditId);
    }

    const batch = queries.slice(start, end);

    const batchResults = await Promise.allSettled(
      batch.map(async (q) => {
        const result = await pollChatGPT(q.text, env);
        return { query: q, pollText: result.response_text };
      })
    );

    const successful = batchResults
      .filter(
        (r): r is PromiseFulfilledResult<{
          query: BuyerQuery;
          pollText: string;
        }> => r.status === 'fulfilled'
      )
      .map((r) => r.value);

    const rows = successful.map(({ query, pollText }) => {
      const citation = parseCitations(pollText, brandName, domain, competitors);
      return {
        audit_id: auditId,
        query_text: query.text,
        query_category: query.category,
        llm_source: 'openai',
        raw_response: (pollText || '').slice(0, 5000),
        brand_cited: citation.brand_cited,
        brand_position: citation.brand_position,
        competitors_cited: citation.competitors_cited,
      };
    });

    if (rows.length > 0) {
      const { error: insertErr } = await supabase
        .from('poll_results')
        .insert(rows);
      if (insertErr) {
        console.error('[orchestrator] insert error:', insertErr);
      }
    }

    await supabase
      .from('audits')
      .update({ progress_done: end })
      .eq('id', auditId);
    console.log(
      '[orchestrator] batch',
      batchIndex,
      'done, progress_done:',
      end
    );

    if (end < queries.length) {
      // Chain to the next batch in a fresh Worker invocation.
      console.log('[orchestrator] self-invoking batch', batchIndex + 1);
      try {
        const response = await fetch(`${workerUrl}/api/audit/process-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audit_id: auditId,
            batch_index: batchIndex + 1,
          }),
        });
        if (!response.ok) {
          console.error(
            '[orchestrator] self-invoke returned',
            response.status,
            await response.text().catch(() => '')
          );
        }
      } catch (err: any) {
        console.error('[orchestrator] self-invoke failed:', err?.message);
      }
    } else {
      // Last batch — finalize inline so we don't pay an extra invocation.
      console.log('[orchestrator] all batches complete, computing summary');
      await finalize(auditId, brandName, competitors, queries.length, env);
    }
  } catch (error: any) {
    console.error('[orchestrator] batch failed:', error);
    await supabase
      .from('audits')
      .update({
        status: 'failed',
        error_message: (error?.message || 'Unknown error').slice(0, 500),
      })
      .eq('id', auditId);
  }
}

async function finalize(
  auditId: string,
  brandName: string,
  competitors: string[],
  totalQueries: number,
  env: Env
): Promise<void> {
  const supabase = getSupabaseAdmin(env);
  const summary = await computeSummary(auditId, brandName, competitors, env);
  const visibilityScore = Math.round(summary.visibility_rate * 100);
  await supabase
    .from('audits')
    .update({
      status: 'completed',
      progress_done: totalQueries,
      visibility_score: visibilityScore,
      summary,
      completed_at: new Date().toISOString(),
    })
    .eq('id', auditId);
  console.log(
    `[orchestrator] audit ${auditId} completed: score=${visibilityScore}`
  );
}

/**
 * After all queries have been polled, computes:
 * - Visibility rate (% queries where brand cited)
 * - Top competitor by citation count
 * - Category breakdown (cited/total per query category)
 * - Top winning queries (brand cited at position 1-2)
 * - Top losing queries (brand not cited at all)
 * - Headline copy
 */
async function computeSummary(
  auditId: string,
  brandName: string,
  competitors: string[],
  env: Env
): Promise<AuditSummary> {
  const supabase = getSupabaseAdmin(env);

  const { data: polls } = await supabase
    .from('poll_results')
    .select('*')
    .eq('audit_id', auditId);

  const pollResults = (polls as PollResult[]) || [];
  const total = pollResults.length;
  const cited = pollResults.filter((p) => p.brand_cited).length;
  const visibilityRate = total > 0 ? cited / total : 0;

  // Competitor leaderboard
  const competitorCounts = new Map<string, number>();
  competitors.forEach((c) => competitorCounts.set(c, 0));

  pollResults.forEach((p) => {
    const compsCited = (p.competitors_cited || []) as Array<{
      name: string;
      position: number;
    }>;
    compsCited.forEach((c) => {
      if (competitorCounts.has(c.name)) {
        competitorCounts.set(c.name, (competitorCounts.get(c.name) || 0) + 1);
      }
    });
  });

  const competitorRanked = Array.from(competitorCounts.entries()).sort(
    (a, b) => b[1] - a[1]
  );
  const topCompetitor = competitorRanked[0] || null;

  // Category breakdown
  const categoryBreakdown: Record<string, CategoryStats> = {};
  pollResults.forEach((p) => {
    const cat = p.query_category || 'unknown';
    if (!categoryBreakdown[cat]) {
      categoryBreakdown[cat] = { cited: 0, total: 0 };
    }
    categoryBreakdown[cat].total++;
    if (p.brand_cited) categoryBreakdown[cat].cited++;
  });

  // Top winning queries (cited at position 1 or 2)
  const winning = pollResults
    .filter((p) => p.brand_cited && (p.brand_position || 99) <= 2)
    .slice(0, 5)
    .map((p) => p.query_text);

  // Top losing queries (not cited)
  const losing = pollResults
    .filter((p) => !p.brand_cited)
    .slice(0, 5)
    .map((p) => p.query_text);

  let headline: string;
  if (visibilityRate >= 0.7) {
    headline = `${brandName} is cited in ${cited} of ${total} buyer queries on ChatGPT. Strong AEO position.`;
  } else if (visibilityRate >= 0.4) {
    headline = `${brandName} is cited in ${cited} of ${total} buyer queries. Visible, but losing comparison searches.`;
  } else if (visibilityRate >= 0.15) {
    headline = `${brandName} is cited in only ${cited} of ${total} buyer queries. Major AEO gap.`;
  } else {
    headline = `${brandName} is nearly invisible on ChatGPT — cited in just ${cited} of ${total} queries.`;
  }

  return {
    headline,
    visibility_rate: visibilityRate,
    brand_cited_queries: cited,
    total_queries: total,
    top_competitor: topCompetitor
      ? { name: topCompetitor[0], cited_queries: topCompetitor[1] }
      : null,
    category_breakdown: categoryBreakdown,
    top_winning_queries: winning,
    top_losing_queries: losing,
  };
}
