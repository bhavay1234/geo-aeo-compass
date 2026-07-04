import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, type Env } from '../db/supabase';
import { normalizeDomain, competitorToDomain, citationCategory } from './source-classifier';
import {
  fetchPageSignals,
  brandPresence,
  significantTerms,
  type ExtractedPage,
} from './page-fetch';
import { cheerioScrape, crawlOwnSite, type CrawledPage } from './apify';
import { decisiveFactor, buildInfluenceFallback, type InfluenceSide } from './why-verdict';
import {
  mapWithConcurrency,
  inferInfluenceVerdict,
  judgeGetListedSources,
} from '../llm/suggestions';
import type {
  Citation,
  CitationRole,
  CitationAnalysisEntry,
  LlmSource,
  PageSignals,
  PageRef,
  InfluenceSource,
  InfluenceFactors,
  WhyNamed,
  YouInfluence,
} from '../db/types';

/** Normalize legacy `llm_source` values ('openai') to the current 'chatgpt'
 *  key so cross-LLM counts don't split into stray buckets. */
function normalizeLlm(s: string | null | undefined): LlmSource {
  if (s === 'perplexity' || s === 'gemini') return s;
  return 'chatgpt';
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOP_BRANDS_PER_QUERY = 3; // Apify/LLM cap → ~24 verdict calls/audit

type PollRow = {
  id: string;
  query_text: string;
  llm_source: string | null;
  citations: Citation[] | null;
  citation_roles: CitationRole[] | null;
  competitors_cited: { name: string }[] | null;
  brands_named: string[] | null;
};

interface CachedPage {
  signals: PageSignals;
  text_sample: string;
  fetched_at: number;
}

// ── caching ──────────────────────────────────────────────────────────────

async function loadCache(
  supabase: SupabaseClient,
  urls: string[]
): Promise<Map<string, CachedPage>> {
  const out = new Map<string, CachedPage>();
  if (urls.length === 0) return out;
  let data: any[] | null = null;
  try {
    ({ data } = await supabase.from('citation_pages').select('*').in('url', urls));
  } catch (e: any) {
    console.error('[citations] cache read failed (degrading to fetch):', e?.message);
    return out;
  }
  for (const r of data || []) {
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

async function upsertCache(supabase: SupabaseClient, pages: ExtractedPage[]): Promise<void> {
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
  try {
    await supabase.from('citation_pages').upsert(rows, { onConflict: 'url' });
  } catch (e: any) {
    console.error('[citations] cache write failed (non-fatal):', e?.message);
  }
}

/** Fresh cache → plain fetch → ONE batched cheerio fallback for failures. */
async function resolveSignals(
  supabase: SupabaseClient,
  urls: string[],
  env: Env
): Promise<Map<string, CachedPage>> {
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const cache = await loadCache(supabase, unique);
  const missing = unique.filter((u) => !cache.has(u));

  const fetched = await mapWithConcurrency(missing, 6, (u) => fetchPageSignals(u));
  const ok: ExtractedPage[] = [];
  const failed: string[] = [];
  fetched.forEach((r, i) => (r ? ok.push(r) : failed.push(missing[i])));

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
  for (const p of all)
    cache.set(p.signals.url, {
      signals: p.signals,
      text_sample: p.text_sample,
      fetched_at: Date.now(),
    });
  return cache;
}

// ── helpers ────────────────────────────────────────────────────────────────

function namedBrands(poll: PollRow, ownLower: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n: string) => {
    const t = (n || '').trim();
    const k = t.toLowerCase();
    if (t && k !== ownLower && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };
  for (const c of poll.competitors_cited ?? []) add(c.name);
  for (const b of poll.brands_named ?? []) add(b);
  return out;
}

/** Does this cited page mention the brand (by name or its domain core)? */
function pageNamesBrand(brand: string, page: CachedPage | undefined): boolean {
  if (!page) return false;
  const hay = (page.signals.title + '\n' + page.text_sample).toLowerCase();
  const name = brand.trim().toLowerCase();
  if (name.length >= 3 && hay.includes(name)) return true;
  const core = competitorToDomain(brand).split('.')[0];
  if (core.length >= 4 && hay.includes(core)) return true;
  return false;
}

function ownSiteScore(s?: PageSignals): number {
  if (!s) return 0;
  let v = s.page_type === 'dedicated' ? 0.5 : s.page_type === 'blog' ? 0.2 : 0.1;
  if (s.schema_types.some((t) => ['Organization', 'Product', 'FAQPage', 'SoftwareApplication'].includes(t)))
    v += 0.5;
  return Math.min(1, v);
}

function pageRef(url: string | null, s?: PageSignals): PageRef {
  return {
    exists: !!url,
    url,
    page_type: s?.page_type ?? 'other',
    schema_types: s?.schema_types ?? [],
  };
}

function bestOwnPage(query: string, candidates: CrawledPage[]): CrawledPage | null {
  const terms = significantTerms(query);
  if (terms.length === 0 || candidates.length === 0) return null;
  let best: CrawledPage | null = null;
  let score = 0;
  for (const c of candidates) {
    const hay = (c.url + ' ' + c.title + ' ' + c.text).toLowerCase();
    const s = terms.filter((t) => hay.includes(t)).length;
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return score > 0 ? best : null;
}

/** Best-effort citation_status write — never throws (a missing column / DB
 *  error is logged, not propagated), so the terminal-state guard can't fail. */
async function setStatus(
  supabase: SupabaseClient,
  auditId: string,
  status: 'analyzing' | 'done' | 'failed'
): Promise<void> {
  try {
    const { error } = await supabase
      .from('audits')
      .update({ citation_status: status })
      .eq('id', auditId);
    if (error) console.error(`[citations] setStatus(${status}) error:`, error.message);
  } catch (e: any) {
    console.error(`[citations] setStatus(${status}) threw:`, e?.message);
  }
}

const STATUS_UA =
  'Mozilla/5.0 (compatible; CompassAEO/1.0; +https://compass.aeo) AppleWebKit/537.36';

/**
 * Lightweight liveness + final-URL probe for a cited URL. HEAD first (cheap),
 * GET fallback when HEAD is rejected. Follows redirects, so `finalUrl` is the
 * real destination — resolving Gemini's vertexaisearch grounding proxies to the
 * actual page. status 0 = unknown (network error/timeout) — never treated dead.
 */
async function resolveUrlStatus(url: string): Promise<{ status: number; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': STATUS_UA },
    });
    if ([403, 405, 501].includes(res.status)) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': STATUS_UA, accept: 'text/html,*/*' },
      });
    }
    return { status: res.status, finalUrl: res.url || url };
  } catch {
    return { status: 0, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a Gemini vertexaisearch proxy URL to its real destination CHEAPLY —
 * a manual-redirect GET that reads the Location header without downloading the
 * page body. Returns the real URL or null. Much lighter than a full page fetch,
 * so we can resolve many without blowing the subrequest/CPU budget.
 */
async function resolveRedirect(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': STATUS_UA },
    });
    const loc = res.headers.get('location');
    return loc && /^https?:\/\//i.test(loc) ? loc : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── main ─────────────────────────────────────────────────────────────────

/**
 * Post-finalize influence analysis. The question is "ChatGPT NAMED brand X —
 * what influenced that, and why not you?" — led by which CITED SOURCES name X
 * (Factor 1), then cross-audit third-party presence (Factor 2), then own-site
 * (Factor 3, least). Runs in the dedicated citations queue stage.
 */
export async function analyzeCitations(auditId: string, env: Env): Promise<void> {
  const supabase = getSupabaseAdmin(env);

  const { data: audit } = await supabase
    .from('audits')
    .select('id, brand_name, domain, competitors, insights, positioning, category')
    .eq('id', auditId)
    .single();
  if (!audit) return;
  const you: string = audit.brand_name;
  const ownLower = you.trim().toLowerCase();
  const brandDomain: string = audit.domain;
  const ownNorm = normalizeDomain(brandDomain);

  // Real rival domains (tracked + intent-classified) — used to PRIORITIZE their
  // cited pages into the fetch set so every competitor page resolves its deep
  // URL (not just the top-150 by leverage).
  const competitorDomains = new Set<string>();
  for (const c of (audit.competitors as string[] | null) ?? []) {
    const d = normalizeDomain(competitorToDomain(c));
    if (d) competitorDomains.add(d);
  }
  const cbrands = (audit.insights as { competitor_brands?: Array<{ domain?: string; name: string }> } | null)
    ?.competitor_brands;
  for (const c of cbrands ?? []) {
    const d = normalizeDomain(c.domain || competitorToDomain(c.name));
    if (d) competitorDomains.add(d);
  }
  const isCompetitorDomain = (d: string): boolean =>
    competitorDomains.has(d) || [...competitorDomains].some((cd) => d.endsWith('.' + cd));

  // Terminal-state guard: mark 'analyzing' up front and ALWAYS finish at 'done'
  // in finally — a thrown Apify / verdict / DB error can never leave the stage
  // stuck on 'analyzing' (or null) and hang the UI.
  await setStatus(supabase, auditId, 'analyzing');
  let terminal: 'done' | 'failed' = 'done';
  try {
  const { data: pollData } = await supabase
    .from('poll_results')
    .select('id, query_text, llm_source, citations, citation_roles, competitors_cited, brands_named')
    .eq('audit_id', auditId);
  const polls = (pollData as PollRow[]) || [];

  // ── Part 1/2: fetch every cited URL, brand presence (us), Citations rollup ──
  // Track distinct QUERY texts and distinct LLMs per URL — the two multi-LLM
  // leverage signals. Universal sources (cited by all LLMs across many queries)
  // are the get-listed priority.
  const urlMeta = new Map<
    string,
    {
      domain: string;
      source_type: Citation['source_type'];
      queries: Set<string>; // distinct query_text
      llms: Set<string>; // distinct llm_source
    }
  >();
  for (const p of polls) {
    const llm = normalizeLlm(p.llm_source);
    for (const c of p.citations ?? []) {
      if (!c.url) continue;
      const ex = urlMeta.get(c.url);
      if (ex) {
        ex.queries.add(p.query_text);
        ex.llms.add(llm);
      } else {
        urlMeta.set(c.url, {
          domain: normalizeDomain(c.domain),
          source_type: c.source_type,
          queries: new Set([p.query_text]),
          llms: new Set([llm]),
        });
      }
    }
  }
  const allUrls = Array.from(urlMeta.keys());

  // Bound the heaviest cost on large (20-query) audits: only fetch page signals
  // for the top-N URLs by cross-LLM leverage. Without this, a 200+ URL audit
  // exhausts the Worker subrequest budget and the stage is killed mid-run,
  // hanging citation_status on 'analyzing'. Lower-ranked sources still appear —
  // just without brand-presence / status.
  const PAGE_FETCH_CAP = 150;
  const rankedUrls = allUrls.slice().sort((a, b) => {
    const ma = urlMeta.get(a)!;
    const mb = urlMeta.get(b)!;
    if (mb.llms.size !== ma.llms.size) return mb.llms.size - ma.llms.size;
    return mb.queries.size - ma.queries.size;
  });
  // Competitor-domain pages ALWAYS get fetched (so their deep URL resolves),
  // then fill the rest of the cap with the highest-leverage remaining sources.
  const compUrls = rankedUrls.filter((u) => isCompetitorDomain(urlMeta.get(u)!.domain));
  const nonCompUrls = rankedUrls.filter((u) => !isCompetitorDomain(urlMeta.get(u)!.domain));
  const fetchUrls = [...compUrls, ...nonCompUrls].slice(0, Math.max(PAGE_FETCH_CAP, compUrls.length));
  const pages = await resolveSignals(supabase, fetchUrls, env);

  // Status probe — ONLY the dead candidates among the fetched set (content fetch
  // returned nothing: 404 / block / non-html), hard-capped so it can never
  // dominate the budget. Gemini vertexaisearch redirects are resolved to their
  // real domain-root DETERMINISTICALLY below (no network). Never throws.
  const STATUS_PROBE_CAP = 40;
  const deadCandidates = fetchUrls.filter((u) => !pages.has(u)).slice(0, STATUS_PROBE_CAP);
  const statusByUrl = new Map<string, { status: number; finalUrl: string }>();
  try {
    const probed = await mapWithConcurrency(deadCandidates, 10, (u) => resolveUrlStatus(u));
    deadCandidates.forEach((u, i) => statusByUrl.set(u, probed[i]));
  } catch (e: any) {
    console.error('[citations] status probe failed (non-fatal):', e?.message);
  }

  // Gemini wraps EVERY source in a vertexaisearch proxy; only the few we
  // page-fetched have their real deep URL, so most collapse to a domain-root
  // (homepage) and the Gemini-only view looks empty. Resolve the rest CHEAPLY
  // (manual-redirect Location read, no body) — bounded + non-fatal — so they
  // categorize as real content.
  const GEMINI_RESOLVE_CAP = 140;
  const geminiFinal = new Map<string, string>();
  for (const u of allUrls) {
    const pf = pages.get(u)?.signals.final_url;
    if (u.includes('vertexaisearch.cloud.google.com') && pf) geminiFinal.set(u, pf);
  }
  const geminiToResolve = allUrls
    .filter((u) => u.includes('vertexaisearch.cloud.google.com') && !geminiFinal.has(u))
    .slice(0, GEMINI_RESOLVE_CAP);
  try {
    const resolved = await mapWithConcurrency(geminiToResolve, 12, (u) => resolveRedirect(u));
    geminiToResolve.forEach((u, i) => {
      if (resolved[i]) geminiFinal.set(u, resolved[i]!);
    });
  } catch (e: any) {
    console.error('[citations] gemini resolve failed (non-fatal):', e?.message);
  }

  const analysis: CitationAnalysisEntry[] = allUrls.map((url) => {
    const meta = urlMeta.get(url)!;
    const page = pages.get(url);
    const presence = page
      ? brandPresence({ title: page.signals.title, text_sample: page.text_sample }, you, brandDomain)
      : { brand_present: false, match_type: 'none' as const };
    const probe = statusByUrl.get(url);
    // Alive pages (in `pages`) → their 2xx status; probed dead-candidates → real
    // status; everything else → unknown (undefined, never treated as dead).
    const status_code = probe
      ? probe.status || undefined
      : page
        ? page.signals.http_status
        : undefined;
    // Real destination URL. For Gemini's vertexaisearch proxy: the DEEP page URL
    // captured from the content fetch (res.url) when we fetched it — so a cited
    // competitor article shows its real path, not the bare homepage — else a
    // clean domain-root fallback. Non-Gemini: the probe's resolved URL, then the
    // fetch's final URL.
    const pageFinal = page?.signals.final_url;
    const isGeminiProxy = url.includes('vertexaisearch.cloud.google.com');
    const geminiReal = isGeminiProxy ? geminiFinal.get(url) : undefined;
    const resolved_url = isGeminiProxy
      ? geminiReal || (pageFinal && pageFinal !== url ? pageFinal : `https://${meta.domain}/`)
      : probe && probe.finalUrl && probe.finalUrl !== url
        ? probe.finalUrl
        : pageFinal && pageFinal !== url
          ? pageFinal
          : undefined;
    return {
      url,
      domain: meta.domain,
      source_type: meta.source_type,
      query_count: meta.queries.size,
      llms_citing: Array.from(meta.llms) as LlmSource[],
      brand_present: presence.brand_present,
      match_type: presence.match_type,
      status_code,
      resolved_url,
    };
  });
  // Rank by cross-LLM leverage first (# distinct LLMs citing), then breadth
  // across queries. A source cited by all LLMs is the universal opportunity.
  analysis.sort((a, b) => {
    if (b.llms_citing.length !== a.llms_citing.length)
      return b.llms_citing.length - a.llms_citing.length;
    return b.query_count - a.query_count;
  });
  const targetNamedUrls = new Set(analysis.filter((a) => a.brand_present).map((a) => a.url));

  // Semantic niche filter for roundup/listicle sources — separates a genuine
  // in-category "best X" list from one that merely shares a word ("trade
  // finance" / stock "trading" for a supply-chain brand). Keyword matching can't
  // tell these apart; an LLM judgment can. Mutates entries in place; non-fatal.
  const titleByUrl = new Map<string, string>();
  for (const p of polls)
    for (const c of p.citations ?? [])
      if (c.url && c.title && !titleByUrl.has(c.url)) titleByUrl.set(c.url, c.title);
  // Judge every get-listable CONTENT surface (roundups, editorial, videos, social,
  // community) — not vendor/competitor/review-directory pages, which are inherently
  // in-niche or handled elsewhere. Anchored on the brand's real competitors.
  const JUDGE_CATS = new Set([
    'listicles', 'editorial', 'youtube', 'community', 'reddit', 'linkedin', 'pr', 'reviews',
  ]);
  const contentEntries = analysis.filter((e) =>
    JUDGE_CATS.has(citationCategory(e.resolved_url || e.url, e.domain, e.source_type, competitorDomains))
  );
  if (contentEntries.length > 0) {
    const dna = audit.insights as { competitor_brands?: Array<{ name: string }> } | null;
    const competitorNames = Array.from(
      new Set([
        ...((audit.competitors as string[] | null) ?? []),
        ...((dna?.competitor_brands ?? []).map((c) => c.name)),
      ])
    );
    const brandDna = (audit as { brand_dna?: { products?: string[] } }).brand_dna;
    try {
      const verdicts = await judgeGetListedSources(
        {
          brandName: you,
          category: (audit.category as string | null) || '',
          positioning: (audit.positioning as string | null) || '',
          competitors: competitorNames,
          products: brandDna?.products ?? [],
          items: contentEntries.map((e) => ({
            title: titleByUrl.get(e.url) || '',
            url: e.resolved_url || e.url,
          })),
        },
        env
      );
      contentEntries.forEach((e, i) => {
        e.niche_relevant = verdicts[i].relevant;
        if (verdicts[i].reason) e.get_listed_reason = verdicts[i].reason;
      });
    } catch (err: any) {
      console.error('[citations] get-listed judge failed (non-fatal):', err?.message);
    }
  }

  await supabase
    .from('audits')
    .update({ citation_analysis: analysis })
    .eq('id', auditId);

  // Brands we'll analyze (top-N named per query, deduped across the audit).
  const analyzedBrands = new Map<string, string>(); // lower -> display
  const topByPoll = new Map<string, string[]>();
  for (const p of polls) {
    const top = namedBrands(p, ownLower).slice(0, TOP_BRANDS_PER_QUERY);
    topByPoll.set(p.id, top);
    for (const b of top) analyzedBrands.set(b.toLowerCase(), b);
  }

  // Factor 2 index: brand -> distinct cited URLs across the audit naming it.
  const brandToSources = new Map<string, Set<string>>();
  for (const [lower, display] of analyzedBrands) {
    const set = new Set<string>();
    for (const url of allUrls) if (pageNamesBrand(display, pages.get(url))) set.add(url);
    brandToSources.set(lower, set);
  }

  // Factor 3 sources: competitor homepages (plain fetch, cached) + our WCC crawl.
  const compHomeUrls = Array.from(analyzedBrands.values()).map(
    (b) => `https://${competitorToDomain(b)}/`
  );
  const compHome = await resolveSignals(supabase, compHomeUrls, env);
  const compSignalByBrand = (b: string): PageSignals | undefined =>
    compHome.get(`https://${competitorToDomain(b)}/`)?.signals;

  let ownCandidates: CrawledPage[] = [];
  if (env.APIFY_TOKEN) {
    try {
      ownCandidates = await crawlOwnSite(ownNorm, env);
    } catch (e: any) {
      console.error('[citations] own-site crawl failed:', e?.message);
    }
  }
  const ownByPoll = new Map<string, CrawledPage | null>();
  const ownUrls = new Set<string>();
  for (const p of polls) {
    const own = bestOwnPage(p.query_text, ownCandidates);
    ownByPoll.set(p.id, own);
    if (own) ownUrls.add(own.url);
  }
  const ownSig = await resolveSignals(supabase, Array.from(ownUrls), env);

  const sourcesNaming = (brand: string, urls: string[]): InfluenceSource[] =>
    urls
      .filter((u) => pageNamesBrand(brand, pages.get(u)))
      .map((u) => ({ url: u, domain: urlMeta.get(u)!.domain, source_type: urlMeta.get(u)!.source_type }));

  const tpNorm = (n: number) => Math.min(1, n / 4); // ~4 sources = saturated

  // ── Parts 3 & 4: per query, per top-named brand → factors + LLM verdict ──
  await Promise.allSettled(
    polls.map(async (p) => {
      const citedUrls = (p.citations ?? [])
        .map((c) => c.url)
        .filter((u) => u && pages.get(u));
      const citedTotal = citedUrls.length;

      // Target ("you") influence on this query — computed once.
      const ownC = ownByPoll.get(p.id) ?? null;
      const ownSignals = ownC ? ownSig.get(ownC.url)?.signals : undefined;
      const youNamed = citedUrls
        .filter((u) => targetNamedUrls.has(u))
        .map((u) => ({ url: u, domain: urlMeta.get(u)!.domain, source_type: urlMeta.get(u)!.source_type }));
      const youTp = targetNamedUrls.size;
      const youSide: InfluenceSide = {
        factors: {
          cited: citedTotal ? youNamed.length / citedTotal : 0,
          third_party: tpNorm(youTp),
          own_site: ownCandidates.length ? ownSiteScore(ownSignals) : 0,
        },
        named_in_sources: youNamed,
        cited_total: citedTotal,
        third_party_count: youTp,
        own_page: ownCandidates.length ? pageRef(ownC?.url ?? null, ownSignals) : null,
      };
      const youInfluence: YouInfluence = { ...youSide };

      const why: WhyNamed[] = [];
      for (const brand of topByPoll.get(p.id) ?? []) {
        const named = sourcesNaming(brand, citedUrls);
        const tpCount = brandToSources.get(brand.toLowerCase())?.size ?? named.length;
        const xSig = compSignalByBrand(brand);
        const factors: InfluenceFactors = {
          cited: citedTotal ? named.length / citedTotal : 0,
          third_party: tpNorm(tpCount),
          own_site: ownSiteScore(xSig),
        };
        const xSide: InfluenceSide = {
          factors,
          named_in_sources: named,
          cited_total: citedTotal,
          third_party_count: tpCount,
          own_page: pageRef(`https://${competitorToDomain(brand)}/`, xSig),
        };

        const llm = await inferInfluenceVerdict(
          {
            query: p.query_text,
            you,
            brand,
            brand_signals: {
              named_in_cited_sources: `${named.length} of ${citedTotal}`,
              cited_source_types: named.map((s) => s.source_type),
              third_party_sources_across_audit: tpCount,
              has_dedicated_own_page: xSig?.page_type === 'dedicated',
              own_page_schema: xSig?.schema_types ?? [],
            },
            your_signals: {
              named_in_cited_sources: `${youNamed.length} of ${citedTotal}`,
              third_party_sources_across_audit: youTp,
              has_dedicated_own_page: youSide.own_page?.exists && ownSignals?.page_type === 'dedicated',
            },
          },
          env
        );

        why.push({
          brand,
          decisive: decisiveFactor(factors),
          factors,
          named_in_sources: named,
          cited_total: citedTotal,
          third_party_count: tpCount,
          own_page: xSide.own_page,
          verdict: llm || buildInfluenceFallback({ brand, you, x: xSide, me: youSide }),
        });
      }

      await supabase
        .from('poll_results')
        .update({ why_cited: why, own_page: youInfluence })
        .eq('id', p.id);
    })
  );

    console.log(
      `[citations] audit ${auditId} — ${analysis.length} sources, ` +
        `${analysis.filter((a) => a.brand_present).length} naming you, ` +
        `${analyzedBrands.size} brands analyzed`
    );
  } catch (err: any) {
    terminal = 'failed';
    console.error(
      `[citations] analysis failed for ${auditId}:`,
      JSON.stringify({
        name: err?.name,
        message: err?.message,
        cause: err?.cause?.message ?? (err?.cause != null ? String(err.cause) : undefined),
      }),
      '\nstack:',
      String(err?.stack || '').slice(0, 400)
    );
  } finally {
    // Guaranteed terminal state — never leave the UI stuck on 'analyzing'.
    // 'done' on success (partial data kept), 'failed' on a thrown error.
    await setStatus(supabase, auditId, terminal);
  }
}
