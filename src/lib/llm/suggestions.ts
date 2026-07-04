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
  '- 2-4 sentences. LEAD with the citation evidence (which/how many cited sources ' +
  'name X) — that is the strongest signal.\n' +
  '- Name the SINGLE most decisive factor: citations, third-party presence, or own-site.\n' +
  '- Then explain why the target was NOT named, concretely (e.g. appears in 0 of the ' +
  'cited sources; absent from the G2/listicle pages), and the closest gap to close.\n' +
  '- Use "likely/primarily" framing — these signals correlate with ChatGPT citation, ' +
  'they are NOT proof of its ranking algorithm. Never claim to know its exact logic.\n' +
  '- No preamble, no markdown, no bullet points. One short paragraph of plain prose.';

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
        temperature: 0.3,
        max_tokens: 220,
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
  'system", "supply chain visibility"); features or capabilities; section headings; ' +
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
