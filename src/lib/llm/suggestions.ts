import OpenAI from 'openai';
import type { Env } from '../db/supabase';
import type { Citation, CitationRole } from '../db/types';

const MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 10000;

/** Race a promise against a timeout, clearing the timer on settle. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/** Run fn over items with a fixed concurrency cap (Promise pool). Order preserved. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function stripFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Infer the brand's positioning from limited signals — ONE gpt-4o-mini call.
 * Honest caveat: this is inference from queries + answer excerpts, weaker than
 * a homepage scrape (the v1.1 Apify upgrade). Returns '' on any failure.
 */
export async function inferPositioning(
  input: {
    brandName: string;
    domain: string;
    queries: string[];
    excerpts: string[];
  },
  env: Env
): Promise<{ positioning: string; category: string }> {
  if (!env.OPENAI_API_KEY) return { positioning: '', category: '' };
  const system =
    "You infer a software brand's market positioning and category from limited " +
    'signals. Return ONLY valid JSON, no markdown: {"positioning": string, ' +
    '"category": string}. positioning = ONE concise sentence (who it\'s for + ' +
    'what it does + any wedge). category = the 2-4 word product category buyers ' +
    'would name (e.g. "CRM software", "supply chain visibility"). If signals are ' +
    'thin, give your best concrete inference.';
  const user = JSON.stringify({
    brandName: input.brandName,
    domain: input.domain,
    buyer_queries: input.queries.slice(0, 20),
    answer_excerpts: input.excerpts.slice(0, 4).map((e) => e.slice(0, 600)),
  });
  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 160,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      TIMEOUT_MS
    );
    const raw = (completion.choices[0]?.message?.content || '').trim();
    try {
      const parsed = JSON.parse(stripFences(raw)) as {
        positioning?: unknown;
        category?: unknown;
      };
      return {
        positioning:
          typeof parsed.positioning === 'string' ? parsed.positioning.trim() : '',
        category:
          typeof parsed.category === 'string' ? parsed.category.trim() : '',
      };
    } catch {
      // Model ignored the JSON contract — treat the whole reply as positioning.
      return { positioning: raw, category: '' };
    }
  } catch (err: any) {
    console.error('[positioning] failed:', err?.message);
    return { positioning: '', category: '' };
  }
}

const VERDICT_SYSTEM =
  "You answer 'what is [company]?' in ONE concise sentence: what it does and " +
  "who it's for — how you would categorize it. No preamble, no markdown, no " +
  'quotes. If you genuinely do not recognize it, reply exactly: Not well known.';

/**
 * "How ChatGPT describes [brand]" — one gpt-4o-mini 'what is X?' poll per
 * brand, batched in finalize. Returns '' on any failure.
 */
export async function inferBrandVerdict(
  name: string,
  domain: string | null,
  env: Env
): Promise<string> {
  if (!env.OPENAI_API_KEY || !name.trim()) return '';
  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 90,
        messages: [
          { role: 'system', content: VERDICT_SYSTEM },
          {
            role: 'user',
            content: `What is ${name}${domain ? ` (${domain})` : ''}?`,
          },
        ],
      }),
      TIMEOUT_MS
    );
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err: any) {
    console.error(
      '[verdict] failed:',
      JSON.stringify({
        name: err?.name,
        message: err?.message,
        status: err?.status,
        code: err?.code,
        type: err?.type,
        cause: err?.cause?.message ?? (err?.cause != null ? String(err.cause) : undefined),
      }),
      '\nstack:',
      String(err?.stack || '').slice(0, 500)
    );
    return '';
  }
}

const INFLUENCE_SYSTEM =
  'You explain what likely influenced ChatGPT to NAME a software brand as a ' +
  'recommendation in a buyer-query answer. You are given a SIGNAL SUMMARY (not ' +
  'raw HTML) for the named brand X and for the target brand (us): how many of ' +
  "this query's cited sources name each, the source types, cross-audit presence, " +
  'and whether each has a dedicated own page. Rules:\n' +
  '- EXACTLY 2 sentences, tight. Sentence 1: the single most decisive factor for X ' +
  '(citations, third-party presence, or own-site) with the concrete number. ' +
  'Sentence 2: why the target was NOT named + the closest gap to close.\n' +
  '- VARY your wording per brand — do NOT reuse a fixed template. Never open every ' +
  'verdict with "N of the ten cited sources..."; lead differently each time (the ' +
  'source type, the cross-audit pattern, the own-page gap) and cite the number ' +
  'inline. Two brands with similar signals must still read as distinct sentences.\n' +
  '- Use "likely/primarily" framing — these signals correlate with ChatGPT citation, ' +
  'they are NOT proof of its ranking algorithm. Never claim to know its exact logic.\n' +
  '- No preamble, no markdown, no bullet points, no restating the brand name twice.';

/**
 * "Why was brand X named (and not you)" — ONE gpt-4o-mini call over the
 * three-factor signal summary only. Returns '' on failure so the caller can
 * fall back to the deterministic influence verdict.
 */
export async function inferInfluenceVerdict(
  summary: {
    query: string;
    you: string;
    brand: string;
    brand_signals: Record<string, unknown>;
    your_signals: Record<string, unknown>;
  },
  env: Env
): Promise<string> {
  if (!env.OPENAI_API_KEY) return '';
  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        temperature: 0.6,
        max_tokens: 160,
        messages: [
          { role: 'system', content: INFLUENCE_SYSTEM },
          { role: 'user', content: JSON.stringify(summary) },
        ],
      }),
      TIMEOUT_MS
    );
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err: any) {
    console.error(
      '[influence] failed:',
      JSON.stringify({
        name: err?.name,
        message: err?.message,
        status: err?.status,
        code: err?.code,
        type: err?.type,
        cause: err?.cause?.message ?? (err?.cause != null ? String(err.cause) : undefined),
      }),
      '\nstack:',
      String(err?.stack || '').slice(0, 500)
    );
    return '';
  }
}

const SUGGESTION_SYSTEM =
  'You are an Answer-Engine-Optimization strategist. ChatGPT was asked a buyer ' +
  'query and produced an answer with web citations. Given the brand, its inferred ' +
  'positioning, the query, the actual answer, and the cited domains, write ONE ' +
  'specific play for THIS query. Rules:\n' +
  '- 2-3 sentences. Anchor to the brand positioning and the REAL framing/citations ' +
  'in the answer. Name the actual wedge.\n' +
  "- No boilerplate. Never say generic things like 'create an authoritative page' " +
  'without saying what, where, and why for this query.\n' +
  '- If it is genuinely open territory, say WHY in terms of what is missing from the ' +
  'current answer/citations.\n' +
  '- Also judge EACH cited domain: is it a rival product/company (competitor) or a ' +
  'directory/review/editorial source (source)? Use "unsure" only if truly unclear.\n' +
  '- Also list brands_named: ONLY real, specifically-named PRODUCTS or COMPANIES ' +
  'that genuinely COMPETE with the audited brand in the same category, presented ' +
  'in the answer as options/recommendations (proper nouns, e.g. "FourKites", ' +
  '"Salesforce"). A brand qualifies only if a buyer could choose it INSTEAD of the ' +
  'audited brand. STRICTLY EXCLUDE, returning none of: generic software categories ' +
  'or their acronyms (e.g. "CRM", "WMS", "TMS", "ERP", "warehouse management ' +
  'system", "supply chain visibility"); features or capabilities; abstract benefits/outcomes (e.g. "operational efficiency", "real-time insights", "traceability", "IoT sensors"); section headings;' +
  'the audited brand itself; and publishers/review sites/aggregators/sources (those ' +
  'go in citation_judgments). If the answer is generic/educational and names no real ' +
  'competing product, return []. Names exactly as written.\n' +
  'Return ONLY valid JSON, no markdown: ' +
  '{"suggestion_action": string, "citation_judgments": [{"domain": string, "role": ' +
  '"competitor"|"source"|"unsure"}], "brands_named": [string]}';

/**
 * Positioning-aware per-query suggestion + per-citation role judgments —
 * ONE gpt-4o-mini call. Returns null on any failure so the caller can fall
 * back to the deterministic suggestion.
 */
export async function generateQuerySuggestion(
  input: {
    brandName: string;
    domain: string;
    positioning: string;
    query: string;
    fullResponse: string;
    citations: Citation[];
    brandCited: boolean;
    brandPosition: number | null;
  },
  env: Env
): Promise<{ action: string; judgments: CitationRole[]; brandsNamed: string[] } | null> {
  if (!env.OPENAI_API_KEY) return null;

  const cited = input.citations.map((c) => ({
    domain: c.domain,
    title: c.title,
    source_type: c.source_type,
  }));
  const user = JSON.stringify({
    brand: input.brandName,
    domain: input.domain,
    inferred_positioning: input.positioning || '(unknown)',
    query: input.query,
    brand_cited: input.brandCited,
    brand_position: input.brandPosition,
    chatgpt_answer: (input.fullResponse || '').slice(0, 2500),
    cited_domains: cited,
  });

  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SUGGESTION_SYSTEM },
          { role: 'user', content: user },
        ],
      }),
      TIMEOUT_MS
    );
    const content = stripFences(completion.choices[0]?.message?.content || '');
    const parsed = JSON.parse(content) as {
      suggestion_action?: unknown;
      citation_judgments?: unknown;
      brands_named?: unknown;
    };
    const action =
      typeof parsed.suggestion_action === 'string'
        ? parsed.suggestion_action.trim()
        : '';
    if (!action) return null;

    const judgments: CitationRole[] = Array.isArray(parsed.citation_judgments)
      ? (parsed.citation_judgments as unknown[])
          .map((j) => j as { domain?: unknown; role?: unknown })
          .filter(
            (j) =>
              typeof j.domain === 'string' &&
              (j.role === 'competitor' || j.role === 'source' || j.role === 'unsure')
          )
          .map((j) => ({ domain: j.domain as string, role: j.role as CitationRole['role'] }))
      : [];

    const brandsNamed: string[] = Array.isArray(parsed.brands_named)
      ? Array.from(
          new Set(
            (parsed.brands_named as unknown[])
              .filter((b): b is string => typeof b === 'string')
              .map((b) => b.trim())
              .filter(Boolean)
          )
        )
      : [];

    return { action, judgments, brandsNamed };
  } catch (err: any) {
    console.error('[suggestion] failed:', err?.message);
    return null;
  }
}

const CLASSIFY_SYSTEM =
  'You are given an AUDITED brand (name, category, positioning) and a list of ' +
  'BRAND NAMES that AI assistants surfaced when answering buyer queries in this ' +
  'space. Decide which are GENUINE competitors — a product a buyer could ' +
  'realistically choose INSTEAD of the audited brand — judged by INTENT and ' +
  'FEATURES, not by how often the name appeared. Rules:\n' +
  '1. CONSOLIDATE product variants of the same company to ONE parent brand ' +
  '("Oracle Transportation Management", "Oracle SCM Cloud" → "Oracle"; ' +
  '"Descartes MacroPoint" → "Descartes"). Never return two entries for one company.\n' +
  '2. tier "direct" = same core category / overlapping features. tier ' +
  '"adjacent" = a neighboring category a buyer might cross-shop (e.g. a pure TMS ' +
  'or a broad SCM/ERP suite when the audited brand is a visibility platform).\n' +
  '3. DROP non-competitors: generic BI/analytics/spreadsheet tools (Tableau, ' +
  'Power BI, Qlik, Excel, SAS), accounting-only software (Sage), freight carriers ' +
  'or 3PLs that are not software products (Schneider), and anything outside this ' +
  'software space. When unsure whether something is a real product rival, DROP it.\n' +
  '4. "domain" = the company\'s OFFICIAL website domain from your knowledge — the ' +
  'real registrable domain, correct TLD (e.g. "onebeat.co", "portcast.io", ' +
  '"loginext.com"), lowercase, no protocol/path/www. Do NOT just append ".com" to ' +
  'the name; if you are not confident of the real domain, use "".\n' +
  'Return ONLY JSON: ' +
  '{"competitors":[{"name":string,"tier":"direct"|"adjacent","domain":string}]}.';

/**
 * Map discovered brand names to genuine same-category competitors by intent +
 * features — ONE gpt-4o-mini call. Consolidates variants, drops wrong-category
 * noise. Returns [] on no key / failure so the caller falls back to the
 * recurrence heuristic. This is the judgment that replaces the ">= 2 queries"
 * gate: a real rival named once survives; a one-off BI tool does not.
 */
export async function classifyCompetitors(
  input: {
    brandName: string;
    category: string;
    positioning: string;
    candidates: string[];
  },
  env: Env
): Promise<Array<{ name: string; tier: 'direct' | 'adjacent'; domain?: string }>> {
  if (!env.OPENAI_API_KEY || input.candidates.length === 0) return [];
  const user = JSON.stringify({
    audited_brand: input.brandName,
    category: input.category || '(unknown)',
    positioning: input.positioning.slice(0, 300),
    brand_names: input.candidates.slice(0, 80),
  });
  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 700,
        messages: [
          { role: 'system', content: CLASSIFY_SYSTEM },
          { role: 'user', content: user },
        ],
      }),
      15000
    );
    const parsed = JSON.parse(
      stripFences(completion.choices[0]?.message?.content || '')
    ) as { competitors?: unknown };
    if (!Array.isArray(parsed.competitors)) return [];
    const seen = new Set<string>();
    const out: Array<{ name: string; tier: 'direct' | 'adjacent'; domain?: string }> = [];
    for (const c of parsed.competitors as unknown[]) {
      const o = c as { name?: unknown; tier?: unknown; domain?: unknown };
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      // Accept only a plausibly-real bare domain; reject the model echoing a
      // name+".com" guess is left to the caller's citation grounding.
      const rawDom = typeof o.domain === 'string' ? o.domain.trim().toLowerCase() : '';
      const domain = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/.test(rawDom.replace(/^www\./, ''))
        ? rawDom.replace(/^www\./, '')
        : undefined;
      out.push({ name, tier: o.tier === 'adjacent' ? 'adjacent' : 'direct', domain });
    }
    return out;
  } catch (err: any) {
    console.error('[classify-competitors] failed:', err?.message);
    return [];
  }
}

const NICHE_SYSTEM =
  'You are an AEO strategist. For each cited item (title + url) decide if it is ' +
  "ON THE BRAND'S NICHE — content where the brand being listed, mentioned, or " +
  'featured would help it show up in AI answers. Return {i, relevant, reason}.\n' +
  'Judge by TOPIC, NOT format. relevant=TRUE if the item is genuinely about the ' +
  "brand's category — whether it's a \"best/top X\" roundup, a software directory/" +
  'comparison, OR an on-topic discussion, forum thread, Q&A, post, or video in that ' +
  'category — such that the brand and brands like its named competitors are ' +
  'relevant to it. An on-topic Reddit/LinkedIn/YouTube/Quora item COUNTS (the play ' +
  'is to get mentioned/featured, not "listed"). Use the competitor list as your ' +
  'anchor for whether the TOPIC matches.\n' +
  'relevant=FALSE when the TOPIC is a DIFFERENT category that merely shares a word: ' +
  'stock/forex TRADING vs trade software; trade FINANCE / customs paperwork; fleet ' +
  'dashcams / telematics; HR; generic AI/developer tutorials; B2B trading ' +
  'marketplaces built for a different purpose (Alibaba / IndiaMART-style); pure ' +
  'news with no participation angle; unrelated industries. When the topic is off ' +
  "the brand's niche, FALSE.\n" +
  'reason (ONLY when relevant; ONE specific sentence — name the TOPIC, a named ' +
  'competitor that is/would be there, and the concrete gain; FIT THE FORMAT: "get ' +
  'listed" for a roundup/directory, "get mentioned in this thread" for a forum/' +
  'post, "get featured" for a video). No generic filler; if no specific reason, ' +
  'relevant=false, reason "". Vary wording. Return ONLY JSON: ' +
  '{"items":[{"i":number,"relevant":boolean,"reason":string}]}.';

export interface GetListedVerdict {
  relevant: boolean;
  reason: string;
}

/**
 * For each cited content source: is it a place the brand should get listed, and
 * if so WHY (one line). Semantic + competitor-anchored, so it separates "global
 * trade software" from "trade finance" / stock "trading" / fleet "route
 * optimization" — and asking for a concrete reason forces out the off-niche ones.
 * Batched (≤25/call, gpt-4o-mini). Returns a verdict per input item. On no key /
 * failure returns relevant=true with no reason so nothing is wrongly hidden.
 */
export async function judgeGetListedSources(
  input: {
    brandName: string;
    category: string;
    positioning: string;
    competitors?: string[];
    products?: string[];
    items: Array<{ title: string; url: string }>;
  },
  env: Env
): Promise<GetListedVerdict[]> {
  const out: GetListedVerdict[] = input.items.map(() => ({ relevant: true, reason: '' }));
  if (!env.OPENAI_API_KEY || input.items.length === 0) return out;
  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const BATCH = 25;
  for (let start = 0; start < input.items.length; start += BATCH) {
    const batch = input.items.slice(start, start + BATCH);
    const user = JSON.stringify({
      brand: input.brandName,
      category: input.category || '(unknown)',
      positioning: input.positioning.slice(0, 240),
      competes_with: (input.competitors ?? []).slice(0, 12),
      products: (input.products ?? []).slice(0, 6),
      items: batch.map((it, i) => ({ i, title: it.title.slice(0, 140), url: it.url.slice(0, 160) })),
    });
    try {
      const completion = await withTimeout(
        openai.chat.completions.create({
          model: MODEL, // gpt-4o-mini — OpenAI's low-cost tier
          temperature: 0.2,
          max_tokens: 900,
          messages: [
            { role: 'system', content: NICHE_SYSTEM },
            { role: 'user', content: user },
          ],
        }),
        20000
      );
      const parsed = JSON.parse(
        stripFences(completion.choices[0]?.message?.content || '')
      ) as { items?: unknown };
      // Default within a successfully-parsed batch: EXCLUDE unless the model
      // returned an entry marking it relevant.
      if (Array.isArray(parsed.items)) {
        for (let i = 0; i < batch.length; i++) out[start + i] = { relevant: false, reason: '' };
        for (const it of parsed.items as unknown[]) {
          const o = it as { i?: unknown; relevant?: unknown; reason?: unknown };
          if (typeof o.i !== 'number' || o.i < 0 || o.i >= batch.length) continue;
          out[start + o.i] = {
            relevant: o.relevant === true,
            reason: typeof o.reason === 'string' ? o.reason.trim() : '',
          };
        }
      }
    } catch (err: any) {
      console.error('[get-listed] batch failed (keeping all):', err?.message);
      // leave this batch as relevant=true / no reason
    }
  }
  return out;
}

/**
 * Pick the final buyer queries for a Brand-DNA audit from DataForSEO Labs
 * candidates, with real judgment — DROPs off-category keywords that merely
 * share words ("transportation LEARNING management"), DIVERSIFIES across
 * sub-topics instead of 20 rewordings of one phrase, and honors intent mode.
 * Returns chosen keywords VERBATIM (so the caller maps back real volumes).
 * Returns [] when no key / on failure so the caller falls back to heuristics.
 */
export async function selectBuyerQueries(
  input: {
    brandName: string;
    category: string;
    positioning: string;
    intentMode: 'transactional' | 'general';
    candidates: Array<{ keyword: string; volume: number }>;
  },
  env: Env,
  limit = 20
): Promise<string[]> {
  if (!env.OPENAI_API_KEY || input.candidates.length === 0) return [];
  const intentLine =
    input.intentMode === 'transactional'
      ? 'Strongly prefer transactional/commercial intent (best X, X vs Y, top X, X pricing, X alternatives).'
      : 'Allow a mix of commercial and informational intent.';
  const system =
    `You select buyer search queries for an AI-visibility (AEO) audit. From the ` +
    `CANDIDATE keywords (each with monthly search volume "v"), choose up to ${limit} ` +
    `that best capture how real buyers research THIS product category in AI ` +
    `assistants. Rules: (1) genuinely in the brand's category — DROP keywords that ` +
    `merely share words but are a DIFFERENT software category (e.g. "transportation ` +
    `learning management", "document management" for a freight-visibility brand); ` +
    `(2) DIVERSE — cover distinct sub-topics/use-cases, NEVER many near-duplicate ` +
    `rewordings of one phrase; (3) ${intentLine} (4) drop location-specific ("... ` +
    `india", city/state) and navigational lookups. Return ONLY JSON ` +
    `{"queries":[string]} using keywords EXACTLY as given (verbatim), no new text.`;
  const user = JSON.stringify({
    brand: input.brandName,
    category: input.category || '(unknown)',
    positioning: input.positioning.slice(0, 300),
    candidates: input.candidates.slice(0, 60).map((c) => ({ k: c.keyword, v: c.volume })),
  });
  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await withTimeout(
      openai.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 800,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      15000
    );
    const parsed = JSON.parse(
      stripFences(completion.choices[0]?.message?.content || '')
    ) as { queries?: unknown };
    return Array.isArray(parsed.queries)
      ? (parsed.queries as unknown[]).filter((q): q is string => typeof q === 'string')
      : [];
  } catch (err: any) {
    console.error('[select-queries] failed:', err?.message);
    return [];
  }
}
