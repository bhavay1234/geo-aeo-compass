import type { Env } from '../db/supabase';
import { cheerioScrape } from './apify';
import { fetchPageSignals, type ExtractedPage } from './page-fetch';
import {
  dfsLlmJson,
  dfsKeywordSuggestions,
  type KeywordSuggestion,
} from '../llm/dataforseo-client';
import { selectBuyerQueries } from '../llm/suggestions';
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
  /** Rival brands auto-detected from the model's knowledge of the domain. */
  competitors: string[];
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
  'to 4,"competitors":string[] up to 4 rival brands,"audience":string short ' +
  'phrase,"seed_phrases":string[] exactly 5 ' +
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

// Keywords that mark job-seeker / support / navigational noise the Labs
// suggestions sometimes carry (live example: "hsbc global trade solutions
// internship") — never buyer queries.
const JUNK_WORDS =
  /\b(internship|intern|jobs?|careers?|salary|salaries|hiring|login|log in|sign ?in|sign ?up|support|help ?desk|tutorial|course|certification|resume|cv|acquires?|acquisition|merger|edition|textbook|book|pdf|syllabus|meaning|definition|gmbh|co kg|pvt ltd|wikipedia)\b/i;

// Local-business lookups: "... pembroke pines fl", "... new castle pa" — a
// trailing US state code marks a geo/local query, never a category buyer query.
const GEO_TAIL =
  /\s(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|ia|id|il|ks|ky|la|ma|md|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|wy)\s*$/i;
// Contextual / research noise that isn't a product-buying query.
const CONTEXT_NOISE =
  /\b(near me|within the|case study|use cases|for dummies|reddit|quora|ppt|slideshare)\b/i;

/**
 * Merge per-seed suggestions into the 20 most relevant queries:
 * dedupe permutations, drop navigational + own-brand-only keywords, apply the
 * user's intent mode, rank by volume with a diversity guard so the list isn't
 * 20 variants of one phrase.
 */
/** Filter (junk/geo/intent/own-brand) + dedupe permutations by word-signature,
 *  volume-desc. Returns the clean candidate pool WITHOUT a diversity cap —
 *  callers add diversity (heuristic or LLM). */
export function rankCandidates(
  suggestions: KeywordSuggestion[],
  brandName: string,
  intentMode: IntentMode,
  opts: { enforceIntent?: boolean } = {}
): Array<{ sig: string; s: KeywordSuggestion }> {
  // enforceIntent=false PREFERS transactional (ordering) instead of hard-dropping
  // non-transactional candidates — so a seed theme whose Labs data skews
  // informational ("supply chain visibility") still contributes to the pool.
  const enforceIntent = opts.enforceIntent !== false;
  const brand = brandName.trim().toLowerCase();
  const bySig = new Map<string, KeywordSuggestion>();
  for (const s of suggestions) {
    const kw = s.keyword.toLowerCase();
    if (s.intent === 'navigational') continue;
    if (JUNK_WORDS.test(kw) || GEO_TAIL.test(kw) || CONTEXT_NOISE.test(kw)) continue;
    if (enforceIntent && intentMode === 'transactional' && !TRANSACTIONAL_INTENTS.has(s.intent))
      continue;
    // Own-brand keywords: keep comparisons ("brand vs x"), drop pure brand navs.
    if (brand && kw.includes(brand) && !/\bvs\b|\balternative/i.test(kw)) continue;
    const sig = wordSig(s.keyword);
    if (sig.split(' ').length < 2) continue; // single-word queries are too vague
    const ex = bySig.get(sig);
    if (!ex || s.volume > ex.volume) bySig.set(sig, s);
  }
  const txnFirst = !enforceIntent && intentMode === 'transactional';
  return Array.from(bySig.entries())
    .sort((a, b) => {
      if (txnFirst) {
        const at = TRANSACTIONAL_INTENTS.has(a[1].intent) ? 1 : 0;
        const bt = TRANSACTIONAL_INTENTS.has(b[1].intent) ? 1 : 0;
        if (at !== bt) return bt - at;
      }
      return b[1].volume - a[1].volume;
    })
    .map(([sig, s]) => ({ sig, s }));
}

/**
 * Balanced candidate pool for the LLM selector: rank each seed's suggestions
 * SEPARATELY (intent preferred, not enforced) and round-robin up to
 * `perSeedFloor` from each. Guarantees every seed theme reaches the selector
 * instead of one high-volume seed (e.g. "transportation management") flooding
 * the pool and crowding the other themes out before the LLM ever sees them.
 */
export function balancedPool(
  perSeed: KeywordSuggestion[][],
  brandName: string,
  intentMode: IntentMode,
  perSeedFloor = 8
): Array<{ sig: string; s: KeywordSuggestion }> {
  const rankedPerSeed = perSeed.map((list) =>
    rankCandidates(list, brandName, intentMode, { enforceIntent: false })
  );
  const seen = new Set<string>();
  const out: Array<{ sig: string; s: KeywordSuggestion }> = [];
  for (let i = 0; i < perSeedFloor; i++) {
    for (const rl of rankedPerSeed) {
      const c = rl[i];
      if (!c || seen.has(c.sig)) continue;
      seen.add(c.sig);
      out.push(c);
    }
  }
  return out;
}

export function pickQueries(
  suggestions: KeywordSuggestion[],
  brandName: string,
  intentMode: IntentMode,
  limit = 20
): DnaQueryPick[] {
  const ranked = rankCandidates(suggestions, brandName, intentMode);
  const picked: Array<{ sig: string; s: KeywordSuggestion }> = [];
  for (const c of ranked) {
    if (picked.length >= limit) break;
    // Diversity guard: skip near-duplicates of anything already picked. 0.55 is
    // tighter than before — "transportation management X" variants share enough
    // words to be caught even when the trailing modifier differs.
    if (picked.some((p) => jaccard(c.sig, p.sig) >= 0.55)) continue;
    picked.push(c);
  }
  return picked.map(({ s }) => ({
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
    competitors: Array.isArray(parsed?.competitors)
      ? (parsed!.competitors as unknown[])
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 1)
          .slice(0, 4)
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

  // Labs suggestions per seed — parallel, failures per-seed tolerated. Cap each
  // seed's contribution so one broad seed ("transportation management") can't
  // flood the pool with 200 near-identical variants and crowd out the other
  // themes. Balanced pool → the selector actually has diverse material.
  const settled = await Promise.allSettled(
    dna.seed_phrases.map((seed) => dfsKeywordSuggestions(seed, env, 40))
  );
  const PER_SEED_CAP = 14;
  const perSeed: KeywordSuggestion[][] = [];
  const all: KeywordSuggestion[] = [];
  for (const s of settled)
    if (s.status === 'fulfilled') {
      const top = [...s.value].sort((a, b) => b.volume - a.volume).slice(0, PER_SEED_CAP);
      perSeed.push(top);
      all.push(...top);
    }

  const ranked = rankCandidates(all, dna.brand_name, intentMode); // strict — heuristic fallback
  const pool = balancedPool(perSeed, dna.brand_name, intentMode); // diverse — LLM selector
  let queries: DnaQueryPick[] = [];
  let source: 'labs' | 'llm' = 'labs';

  // JUDGMENT: when OpenAI is configured, let it pick the final 20 from the
  // BALANCED per-seed pool — drops off-category keywords and diversifies across
  // sub-topics far better than regex. Chosen keywords are verbatim, so we map
  // back the real volumes.
  if (env.OPENAI_API_KEY && pool.length >= 5) {
    const chosen = await selectBuyerQueries(
      {
        brandName: dna.brand_name,
        category: dna.category,
        positioning: dna.positioning,
        intentMode,
        candidates: pool.map((r) => ({ keyword: r.s.keyword, volume: r.s.volume })),
      },
      env,
      20
    );
    const byKw = new Map(pool.map((r) => [r.s.keyword.toLowerCase(), r.s]));
    const seenSel = new Set<string>();
    const pickedSigs: string[] = [];
    for (const kw of chosen) {
      const k = kw.trim().toLowerCase();
      if (!k || seenSel.has(k)) continue;
      seenSel.add(k);
      const hit = byKw.get(k);
      const keyword = hit ? hit.keyword : kw.trim();
      // Diversity guard: the LLM occasionally still returns near-duplicate
      // rewordings ("transportation management systems software" vs "...system
      // software"). Drop a pick sharing >=0.55 word-signature with one already
      // kept, mirroring the heuristic pickQueries guard.
      const sig = wordSig(keyword);
      if (pickedSigs.some((p) => jaccard(sig, p) >= 0.55)) continue;
      pickedSigs.push(sig);
      queries.push(
        hit
          ? { keyword: hit.keyword, volume: hit.volume, intent: hit.intent }
          : { keyword, volume: 0, intent: intentMode === 'transactional' ? 'commercial' : 'mixed' }
      );
      if (queries.length >= 20) break;
    }
  }

  // Heuristic fallback (no key, or the selector returned too little).
  if (queries.length < 5) queries = pickQueries(all, dna.brand_name, intentMode);

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
