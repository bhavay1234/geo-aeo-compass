import { pollChatGPT } from '../llm';
import { parseCitations } from './citation-parser';
import { generateQueries, type BuyerQuery } from './query-bank';
import { competitorToDomain, normalizeDomain } from './source-classifier';
import {
  inferPositioning,
  generateQuerySuggestion,
  inferBrandVerdict,
} from '../llm/suggestions';
import { getSupabaseAdmin, type Env } from '../db/supabase';
import type {
  AuditSummary,
  AuditInsights,
  PollResult,
  CategoryStats,
  Citation,
  CitationRole,
  Suggestion,
  SuggestionSituation,
  SourceType,
  CompetitorCitation,
  DiscoveredCompetitor,
  DiscoveredLabel,
  Confidence,
  DiscoveredInQuery,
  BrandVerdict,
} from '../db/types';

const BATCH_SIZE = 3;
/** Max brand-verdict LLM calls per enrich invocation — bounds subrequest fan-out. */
const VERDICT_CAP = 8;

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

/** Map a rule-based source_type to a discovered-list label for non-competitor domains. */
function sourceTypeToLabel(st: SourceType): DiscoveredLabel {
  if (st === 'review_directory' || st === 'analyst') return 'aggregator';
  if (st === 'editorial') return 'editorial';
  return 'other';
}

type FinalizePoll = {
  id: string;
  query_text: string;
  full_response: string | null;
  citations: Citation[] | null;
  brand_cited: boolean;
  brand_position: number | null;
  suggestion: Suggestion | null;
};

type ExternalDomainStat = {
  domain: string;
  norm: string;
  citation_count: number;
  queries: Set<string>;
  sample_url: string;
  source_type: SourceType;
};

/** Aggregate every external (non-own, non-named-competitor) cited domain. */
function aggregateExternalDomains(
  polls: Array<{ query_text: string; citations: Citation[] | null }>,
  ownNorm: string,
  namedNorm: Set<string>
): Map<string, ExternalDomainStat> {
  const stats = new Map<string, ExternalDomainStat>();
  for (const p of polls) {
    for (const c of p.citations || []) {
      const d = normalizeDomain(c.domain);
      if (!d) continue;
      if (ownNorm && (d === ownNorm || d.endsWith('.' + ownNorm))) continue;
      if (namedNorm.has(d)) continue;
      const ex = stats.get(d);
      if (ex) {
        ex.citation_count++;
        ex.queries.add(p.query_text);
      } else {
        stats.set(d, {
          domain: c.domain,
          norm: d,
          citation_count: 1,
          queries: new Set([p.query_text]),
          sample_url: c.url,
          source_type: c.source_type,
        });
      }
    }
  }
  return stats;
}

/**
 * FAST finalize — deterministic only, NO LLM calls. Wins a CAS claim
 * (running → finalizing), writes the rule-based summary/insights/discovered,
 * flips status to 'completed', and returns true. The UI renders as soon as
 * status is 'completed'; enrichAudit then upgrades tiers/positioning in place.
 *
 * The CAS (conditional update on status='running') ensures only ONE worker
 * finalizes — kills the double-finalize race.
 */
export async function finalizeAuditFast(
  auditId: string,
  env: Env
): Promise<boolean> {
  const supabase = getSupabaseAdmin(env);

  const { data: claimed, error: claimErr } = await supabase
    .from('audits')
    .update({ status: 'finalizing' })
    .eq('id', auditId)
    .eq('status', 'running')
    .select('id');
  if (claimErr) {
    console.error('[finalize:fast] claim error:', claimErr.message);
    return false;
  }
  if (!claimed || claimed.length === 0) return false; // another worker won

  try {
    const { data: audit } = await supabase
      .from('audits')
      .select('*')
      .eq('id', auditId)
      .single();
    if (!audit) return false;

    const brandName: string = audit.brand_name;
    const brandDomain: string = audit.domain;
    const namedCompetitors: string[] = Array.isArray(audit.competitors)
      ? audit.competitors
      : [];

    const { data: pollData } = await supabase
      .from('poll_results')
      .select('query_text, citations')
      .eq('audit_id', auditId);
    const polls =
      (pollData as Array<{ query_text: string; citations: Citation[] | null }>) ||
      [];

    const ownNorm = normalizeDomain(brandDomain);
    const namedNorm = new Set(
      namedCompetitors
        .map((c) => normalizeDomain(competitorToDomain(c)))
        .filter(Boolean)
    );

    // Rule-based discovered list (no LLM): label by source_type. Competitor
    // promotion happens later in enrichAudit via per-query judgments.
    const stats = aggregateExternalDomains(polls, ownNorm, namedNorm);
    const discovered: DiscoveredCompetitor[] = Array.from(stats.values())
      .map((s) => ({
        domain: s.domain,
        citation_count: s.citation_count,
        queries_seen_in: s.queries.size,
        label: sourceTypeToLabel(s.source_type),
        confidence: 'low' as Confidence,
        sample_url: s.sample_url,
      }))
      .sort((a, b) => b.queries_seen_in - a.queries_seen_in)
      .slice(0, 12);

    const insights = await computeInsights(auditId, env);
    insights.discovered_competitor_count = 0; // enrich fills this in
    const summary = await computeSummary(auditId, brandName, namedCompetitors, env);
    summary.headline = buildInsightHeadline(summary, insights);
    const visibilityScore = Math.round((summary.visibility_rate ?? 0) * 100);

    // positioning stays NULL → the UI marker that enrichment is still pending.
    await supabase
      .from('audits')
      .update({
        status: 'completed',
        visibility_score: visibilityScore,
        summary,
        insights,
        discovered_competitors: discovered,
        completed_at: new Date().toISOString(),
      })
      .eq('id', auditId);

    console.log(
      `[finalize:fast] audit ${auditId} completed (deterministic), score ${visibilityScore}`
    );
    return true;
  } catch (err: any) {
    console.error('[finalize:fast] failed:', err?.message);
    await supabase
      .from('audits')
      .update({
        status: 'failed',
        error_message: (err?.message || 'finalize failed').slice(0, 500),
      })
      .eq('id', auditId);
    return false;
  }
}

/**
 * ENRICH — the LLM step, run AFTER status is already 'completed'. Cost:
 *   - 1 gpt-4o-mini positioning-inference call
 *   - N gpt-4o-mini per-query suggestion calls, ALL fired in parallel
 *     (Promise.allSettled) each with a per-call timeout; a timed-out/failed
 *     call falls back to the deterministic suggestion + rule-based label so a
 *     single slow call never hangs the whole finalize.
 *
 * Patches suggestion.action, citation_roles, and discovered_in_query per poll,
 * reclassifies discovered competitors from the aggregated judgments, and sets
 * audits.positioning (non-null = enrichment done; the UI stops refetching).
 *
 * Caveat: positioning + competitor judgments are page-context inference, not
 * ground truth (a homepage scrape is the v1.1 Apify upgrade).
 */
export async function enrichAudit(auditId: string, env: Env): Promise<void> {
  const supabase = getSupabaseAdmin(env);
  try {
    const { data: audit } = await supabase
      .from('audits')
      .select('*')
      .eq('id', auditId)
      .single();
    if (!audit) return;

    const brandName: string = audit.brand_name;
    const brandDomain: string = audit.domain;
    const namedCompetitors: string[] = Array.isArray(audit.competitors)
      ? audit.competitors
      : [];

    const { data: pollData } = await supabase
      .from('poll_results')
      .select(
        'id, query_text, full_response, citations, brand_cited, brand_position, suggestion'
      )
      .eq('audit_id', auditId);
    const polls = (pollData as FinalizePoll[]) || [];

    // 1) Positioning + market category — ONE mini call.
    const { positioning, category } = await inferPositioning(
      {
        brandName,
        domain: brandDomain,
        queries: polls.map((p) => p.query_text),
        excerpts: polls.map((p) => p.full_response || '').filter(Boolean),
      },
      env
    );

    // 2) Per-query suggestions — ALL fired in parallel; each call self-limits
    //    via its own timeout and returns null on failure (→ deterministic).
    const settled = await Promise.allSettled(
      polls.map((p) =>
        generateQuerySuggestion(
          {
            brandName,
            domain: brandDomain,
            positioning,
            query: p.query_text,
            fullResponse: p.full_response || '',
            citations: (p.citations as Citation[]) || [],
            brandCited: p.brand_cited,
            brandPosition: p.brand_position,
          },
          env
        )
      )
    );
    const perQuery = polls.map((poll, i) => {
      const s = settled[i];
      return { poll, llm: s.status === 'fulfilled' ? s.value : null };
    });

    // 3) Aggregate citation judgments per normalized domain. Competitor wins.
    const ownNorm = normalizeDomain(brandDomain);
    const namedNorm = new Set(
      namedCompetitors
        .map((c) => normalizeDomain(competitorToDomain(c)))
        .filter(Boolean)
    );
    const competitorJudgedCount = new Map<string, number>();
    for (const { llm } of perQuery) {
      if (!llm) continue;
      for (const j of llm.judgments) {
        const d = normalizeDomain(j.domain);
        if (!d || d === ownNorm || namedNorm.has(d)) continue;
        if (j.role === 'competitor') {
          competitorJudgedCount.set(d, (competitorJudgedCount.get(d) || 0) + 1);
        }
      }
    }

    // 4) Reclassify discovered competitors from judgments + stats.
    const stats = aggregateExternalDomains(polls, ownNorm, namedNorm);
    const discoveredAll: DiscoveredCompetitor[] = Array.from(stats.values()).map(
      (s) => {
        const compCount = competitorJudgedCount.get(s.norm) || 0;
        const isCompetitor = compCount > 0;
        return {
          domain: s.domain,
          citation_count: s.citation_count,
          queries_seen_in: s.queries.size,
          label: (isCompetitor
            ? 'competitor'
            : sourceTypeToLabel(s.source_type)) as DiscoveredLabel,
          confidence: (isCompetitor
            ? compCount >= 2
              ? 'high'
              : 'medium'
            : 'low') as Confidence,
          sample_url: s.sample_url,
        };
      }
    );
    const competitorsList = discoveredAll
      .filter((d) => d.label === 'competitor')
      .sort((a, b) => b.queries_seen_in - a.queries_seen_in);
    const otherList = discoveredAll
      .filter((d) => d.label !== 'competitor')
      .sort((a, b) => b.queries_seen_in - a.queries_seen_in)
      .slice(0, 10);
    const discovered = [...competitorsList, ...otherList];

    const labelLookup = new Map<
      string,
      { label: DiscoveredLabel; confidence: Confidence }
    >();
    for (const d of discovered) {
      labelLookup.set(normalizeDomain(d.domain), {
        label: d.label,
        confidence: d.confidence,
      });
    }

    // 5) Patch each poll in parallel (allSettled — one bad write can't hang it).
    await Promise.allSettled(
      perQuery.map(async ({ poll, llm }) => {
        const citations = (poll.citations as Citation[]) || [];
        const byDomain = new Map<string, DiscoveredInQuery>();
        for (const c of citations) {
          const d = normalizeDomain(c.domain);
          if (!d) continue;
          if (ownNorm && (d === ownNorm || d.endsWith('.' + ownNorm))) continue;
          if (namedNorm.has(d)) continue;
          const lk = labelLookup.get(d);
          const entry: DiscoveredInQuery = {
            domain: c.domain,
            url: c.url,
            title: c.title,
            source_type: c.source_type,
            label: lk?.label ?? null,
            confidence: lk?.confidence ?? null,
          };
          const ex = byDomain.get(c.domain);
          if (!ex || (!ex.label && entry.label)) byDomain.set(c.domain, entry);
        }
        const discoveredInQuery = Array.from(byDomain.values());

        const base = poll.suggestion;
        const action = llm?.action?.trim() || base?.action || '';
        const suggestion: Suggestion | null = base ? { ...base, action } : null;
        const citationRoles: CitationRole[] = llm?.judgments ?? [];

        // Two separate writes: the LLM suggestion depends only on the long-lived
        // `suggestion` column (0002), so it lands even if the role/discovery
        // columns (0005/0006) are missing. Bundling them previously meant a
        // single absent column silently dropped the suggestion + roles together.
        await supabase
          .from('poll_results')
          .update({ suggestion })
          .eq('id', poll.id);
        await supabase
          .from('poll_results')
          .update({
            citation_roles: citationRoles,
            discovered_in_query: discoveredInQuery,
          })
          .eq('id', poll.id);
        // brands_named (0009) isolated so an unmigrated column can't drop the
        // roles/discovery write above.
        await supabase
          .from('poll_results')
          .update({ brands_named: llm?.brandsNamed ?? [] })
          .eq('id', poll.id);
      })
    );

    // Competitor signal = BRANDS NAMED in prose (not cited domains). Aggregate
    // the run's named brands; "discovered" = named in an answer but not tracked.
    const ownLower = brandName.trim().toLowerCase();
    const namedLower = new Set(namedCompetitors.map((n) => n.trim().toLowerCase()));
    const brandsNamedAll = new Map<string, string>(); // lower -> display
    for (const { llm } of perQuery) {
      for (const b of llm?.brandsNamed ?? []) {
        const nm = b.trim();
        const k = nm.toLowerCase();
        if (!nm || k === ownLower || brandsNamedAll.has(k)) continue;
        brandsNamedAll.set(k, nm);
      }
    }
    const discoveredBrands = Array.from(brandsNamedAll.entries())
      .filter(([k]) => !namedLower.has(k))
      .map(([, nm]) => nm);

    // 6) Recompute insights/summary with the corrected competitor count, then
    //    persist in THREE staged writes so a missing/unmigrated column can't
    //    cascade-drop the others (the cause of empty competitors/verdicts):
    //      a. core data — columns present since 0002/0004
    //      b. positioning + category markers — 0006 / base schema
    //      c. verdicts — 0008
    //    Verdicts are also the slowest (N mini-calls), so writing the core
    //    first means competitor data lands even if verdicts are slow or fail.
    const insights = await computeInsights(auditId, env);
    insights.discovered_competitor_count = discoveredBrands.length;
    const summary = await computeSummary(auditId, brandName, namedCompetitors, env);
    summary.headline = buildInsightHeadline(summary, insights);

    await supabase
      .from('audits')
      .update({ summary, insights, discovered_competitors: discovered })
      .eq('id', auditId);
    await supabase
      .from('audits')
      .update({ positioning: positioning ?? '', category: category || null })
      .eq('id', auditId);

    // CITATIONS ENQUEUE — fire BEFORE the verdict fan-out (fix C). positioning +
    // brands_named + citation_roles are now written (all the analysis needs), and
    // the queue.send still has subrequest budget (the verdict calls below can
    // exhaust it). The citations stage runs in its OWN invocation with a fresh
    // budget. Idempotent CAS on citation_status IS NULL. On send failure, mark
    // 'failed' (terminal) so the UI never hangs on 'analyzing'.
    try {
      const { data: claimedCit } = await supabase
        .from('audits')
        .update({ citation_status: 'analyzing' })
        .eq('id', auditId)
        .is('citation_status', null)
        .select('id');
      if (claimedCit && claimedCit.length > 0) {
        await env.AUDIT_QUEUE.send({
          audit_id: auditId,
          query_text: '',
          query_category: '',
          query_index: -1,
          kind: 'citations',
        });
        console.log(`[enrich] enqueued citations for ${auditId}`);
      }
    } catch (err: any) {
      console.error(
        `[enrich] citations enqueue failed for ${auditId}:`,
        JSON.stringify({
          audit_queue_present: typeof env.AUDIT_QUEUE,
          name: err?.name,
          message: err?.message,
          cause: err?.cause?.message ?? (err?.cause != null ? String(err.cause) : undefined),
        })
      );
      await supabase.from('audits').update({ citation_status: 'failed' }).eq('id', auditId);
    }

    // Brand verdicts — "what is X?" for the user's brand + each profiled
    // competitor (named + discovered). Fired in parallel; failures fall back ''.
    const verdictTargets: Array<{ name: string; domain: string | null; isYou: boolean }> = [
      { name: brandName, domain: brandDomain, isYou: true },
      ...namedCompetitors.map((n) => ({
        name: n,
        domain: competitorToDomain(n),
        isYou: false,
      })),
      ...discoveredBrands.map((name) => ({
        name,
        domain: competitorToDomain(name),
        isYou: false,
      })),
    ];
    const seenV = new Set<string>();
    const targets = verdictTargets.filter((t) => {
      const k = t.name.toLowerCase();
      if (!t.name || seenV.has(k)) return false;
      seenV.add(k);
      return true;
    });
    // Cap verdict fan-out (fix A) — the brand always, then the most-mentioned
    // competitors, up to VERDICT_CAP total. Bounds subrequests per invocation.
    const mentionCount = new Map<string, number>();
    for (const { llm } of perQuery)
      for (const b of llm?.brandsNamed ?? []) {
        const k = b.trim().toLowerCase();
        if (k) mentionCount.set(k, (mentionCount.get(k) ?? 0) + 1);
      }
    const ranked = targets.slice().sort((a, b) => {
      if (a.isYou !== b.isYou) return a.isYou ? -1 : 1;
      return (
        (mentionCount.get(b.name.toLowerCase()) ?? 1) -
        (mentionCount.get(a.name.toLowerCase()) ?? 1)
      );
    });
    const capped = ranked.slice(0, VERDICT_CAP);
    if (ranked.length > capped.length) {
      console.log(
        `[verdict] capped ${ranked.length} → ${capped.length} for ${auditId}; dropped: ` +
          ranked.slice(VERDICT_CAP).map((t) => t.name).join(', ')
      );
    }
    const verdictResults = await Promise.allSettled(
      capped.map((t) => inferBrandVerdict(t.name, t.domain, env))
    );
    const emptyVerdicts = capped.filter(
      (_, i) =>
        !(
          verdictResults[i].status === 'fulfilled' &&
          (verdictResults[i] as PromiseFulfilledResult<string>).value
        )
    ).length;
    if (emptyVerdicts > 0) {
      console.error(
        `[verdict] ${emptyVerdicts}/${capped.length} verdicts empty for ${auditId} — ` +
          `see [verdict] failed lines for cause (likely subrequest/connection limit)`
      );
    }
    let brandVerdict = '';
    const competitorVerdicts: BrandVerdict[] = [];
    capped.forEach((t, i) => {
      const r = verdictResults[i];
      const v = r.status === 'fulfilled' ? r.value : '';
      if (t.isYou) brandVerdict = v;
      else competitorVerdicts.push({ name: t.name, domain: t.domain, verdict: v });
    });

    await supabase
      .from('audits')
      .update({
        brand_verdict: brandVerdict,
        competitor_verdicts: competitorVerdicts,
      })
      .eq('id', auditId);

    console.log(
      `[finalize:enrich] audit ${auditId} — ${competitorsList.length} competitors, ` +
        `${polls.length} suggestion calls + 1 positioning call`
    );
  } catch (err: any) {
    console.error('[finalize:enrich] failed:', err?.message);
    // Leave the deterministic 'completed' state intact, but set positioning
    // non-null so the UI stops waiting for enrichment.
    await supabase.from('audits').update({ positioning: '' }).eq('id', auditId);
  }
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
