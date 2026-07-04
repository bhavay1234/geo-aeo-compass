import type { Env } from '../db/supabase';
import { cheerioScrape } from './apify';
import { fetchPageSignals, type ExtractedPage } from './page-fetch';
import {
  dfsLlmJson,
  dfsKeywordSuggestions,
  type KeywordSuggestion,
} from '../llm/dataforseo-client';
import { normalizeDomain } from './source-classifier';

/**
 * Brand DNA — what the website actually is, distilled from a live scrape.
 * Everything downstream (auto-picked queries, positioning display) hangs off
 * this. Generated with Apify (scrape) + DataForSEO (LLM synthesis + Labs
 * keyword data); no OpenAI dependency.
 */
export interface BrandDna {
  brand_name: string;
  domain: string;
  positioning: string;
  category: string;
  products: string[];
  audience: string;
  seed_phrases: string[];
}

export type IntentMode = 'transactional' | 'general';

export interface DnaQueryPick {
  keyword: string;
  volume: number;
  intent: string;
}

export interface DnaResult {
  dna: BrandDna;
  queries: DnaQueryPick[];
  /** How the queries were sourced — 'labs' (DFS volume data) or 'llm' fallback. */
  query_source: 'labs' | 'llm';
}

// DFS caps BOTH user_prompt and system_message at ~500 chars (live-verified:
// longer values fail with "Invalid Field"). Keep this under 460.
const DNA_SYSTEM =
  'Distill the company at the given domain into Brand DNA. Use the scraped ' +
  'content if useful, else your own knowledge of the company. Never refuse. ' +
  'Return ONLY valid JSON: {"brand_name":string,"positioning":string one ' +
  'sentence,"category":string 2-4 word buyer category,"products":string[] up ' +
  'to 4,"audience":string short phrase,"seed_phrases":string[] exactly 5 ' +
  'generic buyer search phrases for this category, never the brand name}';

/** Scrape the homepage — Apify cheerio primary (per config), plain fetch fallback. */
async function scrapeHomepage(domain: string, env: Env): Promise<ExtractedPage | null> {
  const url = `https://${normalizeDomain(domain)}/`;
  if (env.APIFY_TOKEN) {
    try {
      const pages = await cheerioScrape([url], env);
      if (pages.length > 0 && pages[0].text_sample) return pages[0];
    } catch (err: any) {
      console.error('[dna] apify scrape failed, falling back to fetch:', err?.message);
    }
  }
  return await fetchPageSignals(url);
}

/** Word-set signature — kills keyword permutation spam ("crm software" vs "software crm"). */
function wordSig(kw: string): string {
  return kw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(' '));
  const sb = new Set(b.split(' '));
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

const TRANSACTIONAL_INTENTS = new Set(['transactional', 'commercial']);

/**
 * Merge per-seed suggestions into the 20 most relevant queries:
 * dedupe permutations, drop navigational + own-brand-only keywords, apply the
 * user's intent mode, rank by volume with a diversity guard so the list isn't
 * 20 variants of one phrase.
 */
export function pickQueries(
  suggestions: KeywordSuggestion[],
  brandName: string,
  intentMode: IntentMode,
  limit = 20
): DnaQueryPick[] {
  const brand = brandName.trim().toLowerCase();
  const bySig = new Map<string, KeywordSuggestion>();
  for (const s of suggestions) {
    const kw = s.keyword.toLowerCase();
    if (s.intent === 'navigational') continue;
    if (intentMode === 'transactional' && !TRANSACTIONAL_INTENTS.has(s.intent)) continue;
    // Own-brand keywords: keep comparisons ("brand vs x"), drop pure brand navs.
    if (brand && kw.includes(brand) && !/\bvs\b|\balternative/i.test(kw)) continue;
    const sig = wordSig(s.keyword);
    if (sig.split(' ').length < 2) continue; // single-word queries are too vague
    const ex = bySig.get(sig);
    if (!ex || s.volume > ex.volume) bySig.set(sig, s);
  }

  const ranked = Array.from(bySig.entries()).sort((a, b) => b[1].volume - a[1].volume);
  const picked: Array<[string, KeywordSuggestion]> = [];
  for (const [sig, s] of ranked) {
    if (picked.length >= limit) break;
    // Diversity guard: skip near-duplicates of anything already picked.
    if (picked.some(([psig]) => jaccard(sig, psig) >= 0.7)) continue;
    picked.push([sig, s]);
  }
  return picked.map(([, s]) => ({
    keyword: s.keyword,
    volume: s.volume,
    intent: s.intent,
  }));
}

/**
 * Full DNA build: scrape → LLM synthesis → Labs keyword suggestions per seed
 * → pick the 20 most relevant queries for the chosen intent mode. Falls back
 * to LLM-generated queries if Labs returns nothing usable.
 */
export async function buildBrandDna(
  domain: string,
  intentMode: IntentMode,
  env: Env
): Promise<DnaResult> {
  const page = await scrapeHomepage(domain, env);
  if (!page) {
    throw new Error(`Could not read ${domain} — the site may block scrapers.`);
  }

  // DFS caps user_prompt at ~500 chars (live-verified: longer payloads fail
  // with "Invalid Field: 'user_prompt'"). Send a COMPACT scrape digest —
  // domain + title + H1 + a short snippet — and let the model's own knowledge
  // of the domain fill the rest (knowledge-only DNA probe-verified excellent).
  const compact = [
    `Domain: ${domain}`,
    page.signals.title ? `Title: ${page.signals.title.slice(0, 110)}` : '',
    page.signals.h1 ? `H1: ${page.signals.h1.slice(0, 110)}` : '',
    page.text_sample ? `Snippet: ${page.text_sample.slice(0, 170)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 460);
  const parsed = (await dfsLlmJson(DNA_SYSTEM, compact, env)) as Partial<BrandDna> | null;
  if (!parsed) console.error('[dna] synthesis returned no JSON for', domain);

  const core = normalizeDomain(domain).split('.')[0] || domain;
  const dna: BrandDna = {
    brand_name:
      (typeof parsed?.brand_name === 'string' && parsed.brand_name.trim()) ||
      core.charAt(0).toUpperCase() + core.slice(1),
    domain: normalizeDomain(domain),
    positioning: typeof parsed?.positioning === 'string' ? parsed.positioning : '',
    category: typeof parsed?.category === 'string' ? parsed.category : '',
    products: Array.isArray(parsed?.products)
      ? (parsed!.products as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, 4)
      : [],
    audience: typeof parsed?.audience === 'string' ? parsed.audience : '',
    seed_phrases: Array.isArray(parsed?.seed_phrases)
      ? (parsed!.seed_phrases as unknown[])
          .filter((p): p is string => typeof p === 'string' && p.trim().length > 2)
          .slice(0, 5)
      : [],
  };
  if (dna.seed_phrases.length === 0 && dna.category) {
    dna.seed_phrases = [dna.category, `best ${dna.category}`];
  }

  // Labs suggestions per seed — parallel, failures per-seed tolerated.
  const settled = await Promise.allSettled(
    dna.seed_phrases.map((seed) => dfsKeywordSuggestions(seed, env, 40))
  );
  const all: KeywordSuggestion[] = [];
  for (const s of settled) if (s.status === 'fulfilled') all.push(...s.value);

  let queries = pickQueries(all, dna.brand_name, intentMode);
  let source: 'labs' | 'llm' = 'labs';

  // Fallback: no usable Labs data → ask the LLM directly for buyer queries.
  if (queries.length < 5) {
    source = 'llm';
    const gen = (await dfsLlmJson(
      'Return ONLY valid JSON {"queries":string[]} with exactly 20 search ' +
        'queries buyers in this category would ask an AI assistant. ' +
        (intentMode === 'transactional'
          ? 'All transactional/commercial intent (best X, X vs Y, top X, X pricing).'
          : 'Mix commercial and informational.') +
        ' No brand names except comparisons. No year references.',
      // Compact — DFS user_prompt cap (~500 chars).
      `Company: ${dna.brand_name} (${dna.domain}). Category: ${dna.category || 'unknown'}. Positioning: ${dna.positioning.slice(0, 200)}`.slice(0, 460),
      env
    )) as { queries?: unknown } | null;
    const llmQueries = Array.isArray(gen?.queries)
      ? (gen!.queries as unknown[]).filter((q): q is string => typeof q === 'string')
      : [];
    queries = llmQueries.slice(0, 20).map((keyword) => ({
      keyword,
      volume: 0,
      intent: intentMode === 'transactional' ? 'commercial' : 'mixed',
    }));
  }

  return { dna, queries, query_source: source };
}
