import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, type Env } from '../db/supabase';
import { normalizeDomain } from './source-classifier';
import {
  fetchPageSignals,
  brandPresence,
  queryInTitleOrH1,
  significantTerms,
  type ExtractedPage,
} from './page-fetch';
import { cheerioScrape, crawlOwnSite, type CrawledPage } from './apify';
import { buildWhyVerdict } from './why-verdict';
import { mapWithConcurrency } from '../llm/suggestions';
import type {
  Citation,
  CitationRole,
  CitationAnalysisEntry,
  PageSignals,
  WhyCited,
  WhyFactors,
  OwnPage,
} from '../db/types';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WHY_TOP_N = 3; // top-3 vendor/competitor pages per query (Apify cap)

type PollRow = {
  id: string;
  query_text: string;
  citations: Citation[] | null;
  citation_roles: CitationRole[] | null;
};

interface CachedPage {
  signals: PageSignals;
  text_sample: string;
  fetched_at: number;
}

function brandFromDomain(domain: string): string {
  const core = normalizeDomain(domain).split('.')[0] || domain;
  return core ? core.charAt(0).toUpperCase() + core.slice(1) : domain;
}

/** Read citation_pages rows for the given urls → fresh (within TTL) cache map. */
async function loadCache(
  supabase: SupabaseClient,
  urls: string[]
): Promise<Map<string, CachedPage>> {
  const out = new Map<string, CachedPage>();
  if (urls.length === 0) return out;
  const { data } = await supabase
    .from('citation_pages')
    .select('*')
    .in('url', urls);
  for (const r of (data as any[]) || []) {
    const fetchedAt = r.fetched_at ? new Date(r.fetched_at).getTime() : 0;
    if (Date.now() - fetchedAt > CACHE_TTL_MS) continue;
    out.set(r.url, {
      fetched_at: fetchedAt,
      text_sample: r.text_sample ?? '',
      signals: {
        url: r.url,
        root_domain: r.root_domain ?? normalizeDomain(r.url),
        http_status: r.http_status ?? 200,
        title: r.title ?? '',
        h1: r.h1 ?? '',
        word_count: r.word_count ?? 0,
        schema_types: Array.isArray(r.schema_types) ? r.schema_types : [],
        has_meta_desc: !!r.has_meta_desc,
        has_canonical: !!r.has_canonical,
        page_type: r.page_type ?? 'other',
        analyzed_via: r.analyzed_via ?? 'fetch',
      },
    });
  }
  return out;
}

async function upsertCache(
  supabase: SupabaseClient,
  pages: ExtractedPage[]
): Promise<void> {
  if (pages.length === 0) return;
  const rows = pages.map((p) => ({
    url: p.signals.url,
    root_domain: p.signals.root_domain,
    http_status: p.signals.http_status,
    title: p.signals.title,
    h1: p.signals.h1,
    word_count: p.signals.word_count,
    schema_types: p.signals.schema_types,
    has_meta_desc: p.signals.has_meta_desc,
    has_canonical: p.signals.has_canonical,
    page_type: p.signals.page_type,
    text_sample: p.text_sample,
    analyzed_via: p.signals.analyzed_via,
    fetched_at: new Date().toISOString(),
  }));
  await supabase.from('citation_pages').upsert(rows, { onConflict: 'url' });
}

/**
 * Resolve signals for a set of URLs: fresh cache → plain fetch → ONE batched
 * cheerio fallback for the ones plain fetch couldn't read. Upserts new results.
 */
async function resolveSignals(
  supabase: SupabaseClient,
  urls: string[],
  env: Env
): Promise<Map<string, CachedPage>> {
  const unique = Array.from(new Set(urls));
  const cache = await loadCache(supabase, unique);
  const missing = unique.filter((u) => !cache.has(u));

  const fetched = await mapWithConcurrency(missing, 6, (u) => fetchPageSignals(u));
  const ok: ExtractedPage[] = [];
  const failed: string[] = [];
  fetched.forEach((r, i) => (r ? ok.push(r) : failed.push(missing[i])));

  // Fallback only on failure — one batched Apify cheerio run for blocked pages.
  let recovered: ExtractedPage[] = [];
  if (failed.length > 0 && env.APIFY_TOKEN) {
    try {
      recovered = await cheerioScrape(failed, env);
    } catch (e: any) {
      console.error('[citations] cheerio fallback failed:', e?.message);
    }
  }

  const all = [...ok, ...recovered];
  await upsertCache(supabase, all);
  for (const p of all) {
    cache.set(p.signals.url, {
      signals: p.signals,
      text_sample: p.text_sample,
      fetched_at: Date.now(),
    });
  }
  return cache;
}

/** Cited URLs that are vendor/competitor (skip aggregator/editorial/own). */
function vendorUrls(poll: PollRow, ownNorm: string): string[] {
  const compDomains = new Set<string>();
  for (const r of poll.citation_roles ?? [])
    if (r.role === 'competitor') compDomains.add(normalizeDomain(r.domain));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of poll.citations ?? []) {
    const d = normalizeDomain(c.domain);
    if (!d || d === ownNorm || d.endsWith('.' + ownNorm)) continue;
    const isVendor = c.source_type === 'competitor' || compDomains.has(d);
    if (!isVendor || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c.url);
  }
  return out.slice(0, WHY_TOP_N);
}

/** Best matching own page for a query among crawled candidates. */
function bestOwnPage(
  query: string,
  candidates: CrawledPage[]
): CrawledPage | null {
  const terms = significantTerms(query);
  if (terms.length === 0 || candidates.length === 0) return null;
  let best: CrawledPage | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const hay = (c.url + ' ' + c.title + ' ' + c.text).toLowerCase();
    const score = terms.filter((t) => hay.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Post-finalize citation analysis. Part 1/2 (brand presence + Citations rollup)
 * land fast; Parts 3/4 (why-cited + own-page, Apify) populate after. Each write
 * is isolated so an unmigrated column can't cascade-drop the others. Runs in the
 * dedicated `citations` queue stage — never in the request path.
 */
export async function analyzeCitations(auditId: string, env: Env): Promise<void> {
  const supabase = getSupabaseAdmin(env);

  const { data: audit } = await supabase
    .from('audits')
    .select('id, brand_name, domain')
    .eq('id', auditId)
    .single();
  if (!audit) return;
  const brandName: string = audit.brand_name;
  const brandDomain: string = audit.domain;
  const ownNorm = normalizeDomain(brandDomain);

  const { data: pollData } = await supabase
    .from('poll_results')
    .select('id, query_text, citations, citation_roles')
    .eq('audit_id', auditId);
  const polls = (pollData as PollRow[]) || [];

  // ── Part 1/2: brand presence across every cited URL + Citations rollup ──
  const urlMeta = new Map<
    string,
    { domain: string; source_type: Citation['source_type']; queries: Set<string> }
  >();
  for (const p of polls) {
    for (const c of p.citations ?? []) {
      if (!c.url) continue;
      const ex = urlMeta.get(c.url);
      if (ex) ex.queries.add(p.id);
      else
        urlMeta.set(c.url, {
          domain: normalizeDomain(c.domain),
          source_type: c.source_type,
          queries: new Set([p.id]),
        });
    }
  }
  const allUrls = Array.from(urlMeta.keys());
  const signals = await resolveSignals(supabase, allUrls, env);

  const analysis: CitationAnalysisEntry[] = allUrls.map((url) => {
    const meta = urlMeta.get(url)!;
    const page = signals.get(url);
    const presence = page
      ? brandPresence(
          { title: page.signals.title, text_sample: page.text_sample },
          brandName,
          brandDomain
        )
      : { brand_present: false, match_type: 'none' as const };
    return {
      url,
      domain: meta.domain,
      source_type: meta.source_type,
      query_count: meta.queries.size,
      brand_present: presence.brand_present,
      match_type: presence.match_type,
    };
  });
  analysis.sort((a, b) => b.query_count - a.query_count);

  await supabase
    .from('audits')
    .update({ citation_analysis: analysis, citation_status: 'analyzing' })
    .eq('id', auditId);

  // domain → # distinct queries it's cited across (authority proxy).
  const domainFreq = new Map<string, number>();
  for (const e of analysis)
    domainFreq.set(e.domain, (domainFreq.get(e.domain) ?? 0) + e.query_count);

  // ── Part 4: discover the target's own pages (Apify WCC, cached by domain) ──
  let ownCandidates: CrawledPage[] = [];
  if (env.APIFY_TOKEN) {
    try {
      ownCandidates = await crawlOwnSite(ownNorm, env);
    } catch (e: any) {
      console.error('[citations] own-site crawl failed:', e?.message);
    }
  }

  // Ensure full signals (incl. schema) for the matched own pages + why targets.
  const ownByPoll = new Map<string, CrawledPage | null>();
  const needSignals = new Set<string>();
  for (const p of polls) {
    const own = bestOwnPage(p.query_text, ownCandidates);
    ownByPoll.set(p.id, own);
    if (own) needSignals.add(own.url);
    for (const u of vendorUrls(p, ownNorm)) needSignals.add(u);
  }
  const sig2 = await resolveSignals(supabase, Array.from(needSignals), env);

  // ── Part 3: per-query why-cited verdicts + own_page ──
  await Promise.allSettled(
    polls.map(async (p) => {
      const ownC = ownByPoll.get(p.id) ?? null;
      let ownPage: OwnPage | null = null;
      if (ownCandidates.length > 0) {
        if (!ownC) {
          ownPage = {
            exists: false,
            url: null,
            page_type: 'other',
            schema_types: [],
            word_count: 0,
            on_page_targeting: false,
          };
        } else {
          const s = sig2.get(ownC.url)?.signals;
          ownPage = {
            exists: true,
            url: ownC.url,
            page_type: s?.page_type ?? 'other',
            schema_types: s?.schema_types ?? [],
            word_count: s?.word_count ?? 0,
            on_page_targeting: s
              ? queryInTitleOrH1(p.query_text, s.title, s.h1)
              : false,
          };
        }
      }

      const why: WhyCited[] = [];
      for (const url of vendorUrls(p, ownNorm)) {
        const s = sig2.get(url)?.signals;
        if (!s) continue;
        const factors: WhyFactors = {
          on_page_targeting: queryInTitleOrH1(p.query_text, s.title, s.h1),
          content_depth: s.word_count,
          schema_richness: s.schema_types,
          page_type: s.page_type,
          domain_freq: domainFreq.get(s.root_domain) ?? 1,
        };
        why.push({
          brand: brandFromDomain(s.root_domain),
          url,
          domain: s.root_domain,
          factors,
          verdict: buildWhyVerdict(s.root_domain, factors, ownPage),
        });
      }

      await supabase
        .from('poll_results')
        .update({ why_cited: why, own_page: ownPage })
        .eq('id', p.id);
    })
  );

  await supabase.from('audits').update({ citation_status: 'done' }).eq('id', auditId);
  console.log(
    `[citations] audit ${auditId} — ${analysis.length} sources, ` +
      `${analysis.filter((a) => a.brand_present).length} with brand present`
  );
}
