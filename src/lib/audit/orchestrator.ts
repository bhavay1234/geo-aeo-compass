import { pollChatGPT } from '../llm';
import { parseCitations } from './citation-parser';
import { generateQueries, type BuyerQuery } from './query-bank';
import { getSupabaseAdmin, type Env } from '../db/supabase';
import type { AuditSummary, PollResult, CategoryStats } from '../db/types';

/**
 * Runs an audit end-to-end:
 *   1. Fetch audit row from DB
 *   2. Generate 20 buyer-intent queries
 *   3. Poll ChatGPT for each (with concurrency control)
 *   4. Parse citations from each response
 *   5. Save poll_results rows to Supabase
 *   6. Update audit progress as we go
 *   7. Compute final summary + visibility_score
 *   8. Mark audit as completed
 *
 * Errors are caught at every step. If anything fails, the audit is
 * marked status='failed' with error_message set.
 */
export async function runAudit(auditId: string, env: Env): Promise<void> {
  const supabase = getSupabaseAdmin(env);

  // Step 1: Fetch audit
  const { data: audit, error: fetchErr } = await supabase
    .from('audits')
    .select('*')
    .eq('id', auditId)
    .single();

  if (fetchErr || !audit) {
    console.error('[orchestrator] Audit not found:', auditId, fetchErr);
    return;
  }

  const brandName: string = audit.brand_name;
  const domain: string = audit.domain;
  const category: string | null = audit.category;
  const competitors: string[] = Array.isArray(audit.competitors)
    ? audit.competitors
    : [];

  try {
    // Step 2: Generate queries
    const queries: BuyerQuery[] = generateQueries(
      category || 'software',
      brandName,
      competitors
    );

    // Step 3: Mark audit as running
    await supabase
      .from('audits')
      .update({
        status: 'running',
        progress_total: queries.length,
        progress_done: 0,
      })
      .eq('id', auditId);

    // Step 4: Process queries with concurrency = 3
    // Higher concurrency = faster, but more rate limit risk
    const concurrency = 3;
    let completed = 0;

    for (let i = 0; i < queries.length; i += concurrency) {
      const batch = queries.slice(i, i + concurrency);

      // Run batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (q) => {
          const result = await pollChatGPT(q.text, env);
          return { query: q, pollText: result.response_text };
        })
      );

      // Extract successful polls
      const successful = batchResults
        .filter(
          (r): r is PromiseFulfilledResult<{
            query: BuyerQuery;
            pollText: string;
          }> => r.status === 'fulfilled'
        )
        .map((r) => r.value);

      // Build rows to insert
      const rows = successful.map(({ query, pollText }) => {
        const citation = parseCitations(
          pollText,
          brandName,
          domain,
          competitors
        );
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

      // Insert poll_results
      if (rows.length > 0) {
        const { error: insertErr } = await supabase
          .from('poll_results')
          .insert(rows);
        if (insertErr) {
          console.error('[orchestrator] Insert error:', insertErr);
        }
      }

      // Update progress
      completed = Math.min(i + concurrency, queries.length);
      await supabase
        .from('audits')
        .update({ progress_done: completed })
        .eq('id', auditId);
    }

    // Step 5: Compute summary
    const summary = await computeSummary(
      auditId,
      brandName,
      competitors,
      env
    );
    const visibilityScore = Math.round(summary.visibility_rate * 100);

    // Step 6: Mark completed
    await supabase
      .from('audits')
      .update({
        status: 'completed',
        progress_done: queries.length,
        visibility_score: visibilityScore,
        summary,
        completed_at: new Date().toISOString(),
      })
      .eq('id', auditId);

    console.log(
      `[orchestrator] Audit ${auditId} completed: score=${visibilityScore}`
    );
  } catch (error: any) {
    console.error('[orchestrator] Audit failed:', error);
    await supabase
      .from('audits')
      .update({
        status: 'failed',
        error_message: (error?.message || 'Unknown error').slice(0, 500),
      })
      .eq('id', auditId);
  }
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

  // Headline copy
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
