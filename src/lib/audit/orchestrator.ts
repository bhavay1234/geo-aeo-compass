import { pollChatGPT } from '../llm';
import { parseCitations } from './citation-parser';
import { generateQueries, type BuyerQuery } from './query-bank';
import { competitorToDomain, normalizeDomain } from './source-classifier';
import { classifyDiscoveredDomains } from '../llm/domain-classifier';
import { getSupabaseAdmin, type Env } from '../db/supabase';
import type {
  AuditSummary,
  AuditInsights,
  PollResult,
  CategoryStats,
  Citation,
  Suggestion,
  SuggestionSituation,
  CompetitorCitation,
  DiscoveredCompetitor,
  DiscoveredInQuery,
} from '../db/types';

const BATCH_SIZE = 3;

/**
 * Runs an audit end-to-end inside a single Cloudflare Worker invocation:
 *   1. Fetch audit row
 *   2. Generate 20 buyer-intent queries
 *   3. Process them in batches of 3 (parallel within a batch)
 *   4. Persist poll_results and progress after each batch
 *   5. Compute summary + visibility score, mark completed
 *
 * Tried a self-invoking pattern in Phase 3.12 to multiply waitUntil budgets;
 * Cloudflare blocks Worker→own-zone fetches (error 1042), so we're back to a
 * single ctx.waitUntil. Total wall time ~70-100s for 20 queries with
 * concurrency=3; well under Cloudflare's free-tier ~5 min subrequest budget.
 *
 * On failure, marks status='failed' with error_message and returns.
 */
export async function runAudit(auditId: string, env: Env): Promise<void> {
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

  if (audit.status === 'completed' || audit.status === 'failed') {
    console.log(
      `[orchestrator] audit ${auditId} already ${audit.status}, skipping`
    );
    return;
  }

  const brandName: string = audit.brand_name;
  const domain: string = audit.domain;
  const category: string | null = audit.category;
  const competitors: string[] = Array.isArray(audit.competitors)
    ? audit.competitors
    : [];

  const queries: BuyerQuery[] = generateQueries(
    category || 'software',
    brandName,
    competitors
  );

  await supabase
    .from('audits')
    .update({
      status: 'running',
      progress_total: queries.length,
      progress_done: 0,
    })
    .eq('id', auditId);

  const totalBatches = Math.ceil(queries.length / BATCH_SIZE);

  try {
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, queries.length);
      const batch = queries.slice(start, end);

      console.log(
        `[orchestrator] batch ${batchIndex} start ${start} end ${end}`
      );

      const settled = await Promise.allSettled(
        batch.map(async (q) => {
          const result = await pollChatGPT(q.text, env);
          return { query: q, pollText: result.response_text };
        })
      );

      const rows = settled
        .filter(
          (s): s is PromiseFulfilledResult<{
            query: BuyerQuery;
            pollText: string;
          }> => s.status === 'fulfilled'
        )
        .map((s) => {
          const { query, pollText } = s.value;
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
        `[orchestrator] batch ${batchIndex} done, progress_done: ${end}`
      );
    }

    console.log('[orchestrator] all batches complete, computing summary');
    const summary = await computeSummary(auditId, brandName, competitors, env);
    const visibilityScore = Math.round(summary.visibility_rate * 100);

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
      `[orchestrator] audit ${auditId} completed, score: ${visibilityScore}`
    );
  } catch (error: any) {
    console.error('[orchestrator] audit failed:', error);
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
export async function computeSummary(
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

  const categoryBreakdown: Record<string, CategoryStats> = {};
  pollResults.forEach((p) => {
    const cat = p.query_category || 'unknown';
    if (!categoryBreakdown[cat]) {
      categoryBreakdown[cat] = { cited: 0, total: 0 };
    }
    categoryBreakdown[cat].total++;
    if (p.brand_cited) categoryBreakdown[cat].cited++;
  });

  const winning = pollResults
    .filter((p) => p.brand_cited && (p.brand_position || 99) <= 2)
    .slice(0, 5)
    .map((p) => p.query_text);

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

type PollResultRow = PollResult & {
  citations: Citation[] | null;
  suggestion: Suggestion | null;
};

/**
 * Aggregate rollup over all poll_results for an audit. Reads the per-query
 * suggestions + classified citations persisted by the queue consumer and
 * produces audits.insights. Zero OpenAI calls.
 */
export async function computeInsights(
  auditId: string,
  env: Env
): Promise<AuditInsights> {
  const supabase = getSupabaseAdmin(env);

  const { data: polls } = await supabase
    .from('poll_results')
    .select('*')
    .eq('audit_id', auditId);

  const rows = (polls as PollResultRow[]) || [];

  const situation_distribution: Record<SuggestionSituation, number> = {
    winning: 0,
    weak_position: 0,
    losing_to_competitor: 0,
    open_opportunity: 0,
    authority_gap: 0,
  };
  let high_severity_count = 0;

  // Domains cited in queries where the brand was NOT cited.
  const missingSources = new Map<
    string,
    { domain: string; source_type: Citation['source_type']; count: number }
  >();
  const competitorCounts = new Map<string, number>();

  for (const r of rows) {
    const suggestion = r.suggestion;
    if (suggestion) {
      if (suggestion.situation in situation_distribution) {
        situation_distribution[suggestion.situation]++;
      }
      if (suggestion.severity === 'high') high_severity_count++;
    }

    if (!r.brand_cited) {
      const cites = r.citations || [];
      for (const c of cites) {
        const existing = missingSources.get(c.domain);
        if (existing) existing.count++;
        else
          missingSources.set(c.domain, {
            domain: c.domain,
            source_type: c.source_type,
            count: 1,
          });
      }
    }

    const comps = (r.competitors_cited || []) as CompetitorCitation[];
    for (const comp of comps) {
      competitorCounts.set(comp.name, (competitorCounts.get(comp.name) || 0) + 1);
    }
  }

  const top_missing_sources = Array.from(missingSources.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const top_competitors_cited = Array.from(competitorCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    situation_distribution,
    top_missing_sources,
    top_competitors_cited,
    high_severity_count,
    // Distinct NAMED competitors that actually appeared in any answer.
    named_competitor_count: competitorCounts.size,
    // Filled at finalization once discovered competitors are classified.
    discovered_competitor_count: 0,
  };
}

type CitationRow = { query_text: string; citations: Citation[] | null };

/**
 * Discovered competitors: unnamed domains ChatGPT repeatedly cites that the
 * user never listed. Aggregates citation domains across all poll_results,
 * excludes own/named-competitor/known-source-type domains, takes the top 8
 * by reach, and runs ONE gpt-4o-mini classification call to label them.
 * Returns [] (no LLM call) if there are no candidates.
 */
export async function computeDiscoveredCompetitors(
  auditId: string,
  brandName: string,
  brandDomain: string,
  competitors: string[],
  category: string | null,
  env: Env
): Promise<DiscoveredCompetitor[]> {
  const supabase = getSupabaseAdmin(env);

  const { data: polls } = await supabase
    .from('poll_results')
    .select('query_text, citations')
    .eq('audit_id', auditId);

  const rows = (polls as CitationRow[]) || [];

  const domainStats = new Map<
    string,
    {
      domain: string;
      source_type: Citation['source_type'];
      citation_count: number;
      queries: Set<string>;
      sample_url: string;
      sample_title: string;
    }
  >();

  for (const row of rows) {
    for (const c of row.citations || []) {
      const existing = domainStats.get(c.domain);
      if (existing) {
        existing.citation_count++;
        existing.queries.add(row.query_text);
        // Capture a non-empty title if we don't have one yet — strong signal.
        if (!existing.sample_title && c.title) existing.sample_title = c.title;
      } else {
        domainStats.set(c.domain, {
          domain: c.domain,
          source_type: c.source_type,
          citation_count: 1,
          queries: new Set([row.query_text]),
          sample_url: c.url,
          sample_title: c.title || '',
        });
      }
    }
  }

  const brandNorm = normalizeDomain(brandDomain);
  const competitorDomainSet = new Set(
    competitors.map((c) => normalizeDomain(competitorToDomain(c))).filter(Boolean)
  );
  const KNOWN_SOURCE_TYPES = new Set(['review_directory', 'analyst', 'editorial']);

  const candidates = Array.from(domainStats.values()).filter((s) => {
    const d = normalizeDomain(s.domain);
    if (brandNorm && (d === brandNorm || d.endsWith('.' + brandNorm))) return false;
    if (competitorDomainSet.has(d)) return false;
    if (s.source_type === 'own' || s.source_type === 'competitor') return false;
    if (KNOWN_SOURCE_TYPES.has(s.source_type)) return false;
    return true;
  });

  candidates.sort((a, b) => {
    const byQueries = b.queries.size - a.queries.size;
    if (byQueries !== 0) return byQueries;
    return b.citation_count - a.citation_count;
  });

  const top = candidates.slice(0, 8);

  if (top.length < 1) {
    console.log('[discovered] 0 candidates for audit', auditId);
    return [];
  }

  // Feed the single call richer signal: page title + up to 2 buyer queries
  // the domain was cited for. Still ONE gpt-4o-mini call for all top domains.
  const labels = await classifyDiscoveredDomains(
    top.map((t) => ({
      domain: t.domain,
      sample_url: t.sample_url,
      sample_title: t.sample_title,
      example_queries: Array.from(t.queries).slice(0, 2),
    })),
    brandName,
    category,
    env
  );

  const discovered: DiscoveredCompetitor[] = top.map((t) => {
    const labeled = labels[t.domain] ?? { label: 'other', confidence: 'low' };
    return {
      domain: t.domain,
      citation_count: t.citation_count,
      queries_seen_in: t.queries.size,
      label: labeled.label,
      confidence: labeled.confidence,
      sample_url: t.sample_url,
    };
  });

  const labeledCompetitors = discovered.filter((d) => d.label === 'competitor').length;
  console.log(
    '[discovered]',
    candidates.length,
    'candidates,',
    labeledCompetitors,
    'labeled competitor for audit',
    auditId
  );

  return discovered;
}

const DISCOVERED_CLAUSE_MARKER = 'Discovered players winning this query:';

type DiscoveredAttachRow = {
  id: string;
  citations: Citation[] | null;
  suggestion: Suggestion | null;
};

/**
 * Reuses the audit-level discovered_competitors classification (no new LLM
 * calls) to backfill each poll_result with the discovered domains that
 * appeared in THAT query, and to append a short clause to suggestions where
 * a discovered competitor showed up. Pure map lookup. Returns rows updated.
 */
export async function attachDiscoveredToQueries(
  auditId: string,
  discovered: DiscoveredCompetitor[],
  env: Env
): Promise<number> {
  const supabase = getSupabaseAdmin(env);

  const lookup = new Map<string, { label: DiscoveredCompetitor['label']; confidence: DiscoveredCompetitor['confidence'] }>();
  for (const d of discovered) {
    lookup.set(d.domain, { label: d.label, confidence: d.confidence });
  }
  if (lookup.size === 0) return 0;

  const { data: polls } = await supabase
    .from('poll_results')
    .select('id, citations, suggestion')
    .eq('audit_id', auditId);

  const rows = (polls as DiscoveredAttachRow[]) || [];
  let rowsUpdated = 0;

  for (const row of rows) {
    const seen = new Set<string>();
    const discoveredInQuery: DiscoveredInQuery[] = [];
    for (const c of row.citations || []) {
      const hit = lookup.get(c.domain);
      if (hit && !seen.has(c.domain)) {
        seen.add(c.domain);
        discoveredInQuery.push({
          domain: c.domain,
          label: hit.label,
          confidence: hit.confidence,
          source_type: c.source_type,
        });
      }
    }

    if (discoveredInQuery.length === 0) continue;

    // Part C: append a clause naming competitor-labeled discovered players.
    let suggestion = row.suggestion;
    const competitorDomains = discoveredInQuery
      .filter((d) => d.label === 'competitor')
      .map((d) => d.domain);
    if (
      suggestion &&
      competitorDomains.length > 0 &&
      !suggestion.action.includes(DISCOVERED_CLAUSE_MARKER)
    ) {
      suggestion = {
        ...suggestion,
        action: `${suggestion.action} ${DISCOVERED_CLAUSE_MARKER} ${competitorDomains.join(
          ', '
        )} — competitors you didn't name.`,
      };
    }

    await supabase
      .from('poll_results')
      .update({ discovered_in_query: discoveredInQuery, suggestion })
      .eq('id', row.id);
    rowsUpdated++;
  }

  return rowsUpdated;
}

/**
 * One punchy headline that references the situation distribution. Replaces
 * the generic summary headline once insights are available.
 */
export function buildInsightHeadline(
  summary: AuditSummary,
  insights: AuditInsights
): string {
  const x = summary.brand_cited_queries;
  const y = summary.total_queries;
  const discovered = insights.discovered_competitor_count;

  // Discovered (unnamed) competitors are the most compelling finding —
  // lead with them when present.
  if (discovered > 0) {
    const brands = discovered === 1 ? 'brand' : 'brands';
    const verb = discovered === 1 ? 'is' : 'are';
    return `Cited in only ${x} of ${y} buyer queries — and ${discovered} ${brands} you didn't name ${verb} winning these answers.`;
  }

  const losing = insights.situation_distribution.losing_to_competitor;
  const open = insights.situation_distribution.open_opportunity;

  if (summary.visibility_rate >= 0.7) {
    return `Cited in ${x} of ${y} buyer queries — strong AEO position, with ${open} open opportunities to extend.`;
  }
  return `Cited in only ${x} of ${y} buyer queries — losing ${losing} to competitors, with ${open} open opportunities.`;
}
