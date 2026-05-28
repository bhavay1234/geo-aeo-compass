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
): Promise<string> {
  if (!env.OPENAI_API_KEY) return '';
  const system =
    "You infer a software brand's market positioning from limited signals. " +
    "Reply with ONE concise sentence: who it's for + what it does + any wedge/" +
    'differentiator. No preamble, no markdown, no quotes. If signals are thin, ' +
    'give your best inference and keep it short and concrete.';
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
        max_tokens: 120,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      TIMEOUT_MS
    );
    return (completion.choices[0]?.message?.content || '').trim();
  } catch (err: any) {
    console.error('[positioning] failed:', err?.message);
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
  'Return ONLY valid JSON, no markdown: ' +
  '{"suggestion_action": string, "citation_judgments": [{"domain": string, "role": ' +
  '"competitor"|"source"|"unsure"}]}';

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
): Promise<{ action: string; judgments: CitationRole[] } | null> {
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

    return { action, judgments };
  } catch (err: any) {
    console.error('[suggestion] failed:', err?.message);
    return null;
  }
}
