import OpenAI from 'openai';
import pRetry from 'p-retry';
import type { Env } from '../db/supabase';

/** A raw web-search citation, before source classification (deduped). */
export interface RawCitation {
  url: string;
  title: string;
  domain: string;
  /** True = from the model's real web-search sources; false = mined from inline
   *  markdown links in an ungrounded answer (a recommended product's own
   *  homepage, not a third-party source). */
  grounded?: boolean;
}

/**
 * One inline citation in the order it appears in the answer, un-deduped,
 * with the sentence it anchors to. source_type is added downstream by the
 * consumer (needs brand/competitor context). Indices may be null if the
 * annotation lacks them.
 */
export interface RawInlineCitation {
  order: number;
  url: string;
  title: string;
  domain: string;
  start_index: number | null;
  end_index: number | null;
  anchor_text: string;
  /** See RawCitation.grounded. */
  grounded?: boolean;
}

export interface OpenAIPollResult {
  response_text: string;
  citations: RawCitation[];
  raw_citations: RawInlineCitation[];
  error?: string;
  tokens_used?: number;
  model_used: string;
}

const MODEL = 'gpt-4o-search-preview';

const SENTENCE_BOUNDARY = /[.!?]/;
const MAX_ANCHOR = 300;
const HALF_WINDOW = 150;

/**
 * Sentence-bounded snippet around a citation's [start_index, end_index).
 * Expands left/right to the nearest sentence boundary, caps at ~300 chars
 * (falling back to ±150 chars around the span if a sentence is huge).
 * Returns '' if indices are missing or out of range.
 */
function computeAnchorText(
  text: string,
  start: number | null,
  end: number | null
): string {
  if (
    !text ||
    start === null ||
    end === null ||
    start < 0 ||
    end > text.length ||
    start >= end
  ) {
    return '';
  }

  let left = start;
  while (left > 0 && !SENTENCE_BOUNDARY.test(text[left - 1])) left--;

  let right = end;
  while (right < text.length && !SENTENCE_BOUNDARY.test(text[right])) right++;
  if (right < text.length) right++; // include the terminating punctuation

  let snippet = text.slice(left, right).trim();

  if (snippet.length > MAX_ANCHOR) {
    const from = Math.max(0, start - HALF_WINDOW);
    const to = Math.min(text.length, end + HALF_WINDOW);
    snippet = text.slice(from, to).trim();
  }

  return snippet;
}

/**
 * Extracts normalized citations from gpt-4o-search-preview's message
 * annotations. Shape (openai@4.104.0):
 *   message.annotations: Array<{ type:'url_citation',
 *     url_citation:{ url, title, start_index, end_index } }>
 * Dedupes by url; derives domain (hostname, lowercased, www stripped).
 * Never throws — skips any citation that fails to parse.
 */
function extractCitations(annotations: unknown): RawCitation[] {
  if (!Array.isArray(annotations)) return [];
  const seen = new Set<string>();
  const out: RawCitation[] = [];
  for (const ann of annotations) {
    try {
      const a = ann as {
        type?: string;
        url_citation?: { url?: string; title?: string };
      };
      if (a?.type !== 'url_citation') continue;
      const url = a.url_citation?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      out.push({ url, title: a.url_citation?.title || '', domain, grounded: true });
    } catch {
      // malformed citation — skip, never throw
    }
  }
  return out;
}

/**
 * Faithful inline citation trail: ordered, un-deduped, one entry per
 * annotation, each with the sentence it anchors to. Additive to
 * extractCitations() — this is the "why the source is in the answer" view.
 */
function extractRawCitations(
  text: string,
  annotations: unknown
): RawInlineCitation[] {
  if (!Array.isArray(annotations)) return [];
  const out: RawInlineCitation[] = [];
  let order = 0;
  for (const ann of annotations) {
    try {
      const a = ann as {
        type?: string;
        url_citation?: {
          url?: string;
          title?: string;
          start_index?: number;
          end_index?: number;
        };
      };
      if (a?.type !== 'url_citation') continue;
      const url = a.url_citation?.url;
      if (!url) continue;
      const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      const start_index =
        typeof a.url_citation?.start_index === 'number'
          ? a.url_citation.start_index
          : null;
      const end_index =
        typeof a.url_citation?.end_index === 'number'
          ? a.url_citation.end_index
          : null;
      out.push({
        order: order++,
        url,
        title: a.url_citation?.title || '',
        domain,
        start_index,
        end_index,
        anchor_text: computeAnchorText(text, start_index, end_index),
        grounded: true,
      });
    } catch {
      // malformed citation — skip, never throw
    }
  }
  return out;
}

/** Stronger model driven via the Responses API + web_search tool (below). The
 *  legacy gpt-4o-search-preview chat model gave vague, thinly-sourced answers;
 *  the web_search tool lets a full model run real searches and cite specific
 *  third-party pages. Kept as a constant so the fallback path is explicit. */
const WEBSEARCH_MODEL = 'gpt-4.1';

/**
 * Polls ChatGPT with a buyer-intent query. PRIMARY path: OpenAI Responses API
 * with the web_search tool on a full model (WEBSEARCH_MODEL) — grounded,
 * specific answers with real url_citation annotations. Falls back to the legacy
 * gpt-4o-search-preview chat model if the Responses call errors or comes back
 * empty (e.g. model not enabled on the account), so ChatGPT never goes dark.
 */
export async function pollChatGPT(
  query: string,
  env: Env
): Promise<OpenAIPollResult> {
  if (!env.OPENAI_API_KEY) {
    return {
      response_text: '',
      citations: [],
      raw_citations: [],
      error: 'Missing OPENAI_API_KEY env var',
      model_used: WEBSEARCH_MODEL,
    };
  }
  try {
    const r = await pollChatGPTWebSearch(query, env);
    if (r.response_text || r.citations.length > 0) return r;
    console.error('[openai] web_search empty — falling back to search-preview');
  } catch (err: any) {
    console.error('[openai] web_search failed — falling back:', err?.message);
  }
  return pollChatGPTSearchPreview(query, env);
}

/**
 * PRIMARY ChatGPT path — OpenAI Responses API with the web_search tool. A full
 * model decides its own searches, reads results, and cites specific pages via
 * url_citation annotations (grounded). Answer text prefers the assembled
 * message content, then the SDK's output_text convenience getter.
 */
async function pollChatGPTWebSearch(
  query: string,
  env: Env
): Promise<OpenAIPollResult> {
  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const response = await pRetry(
    async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const call = (openai as any).responses.create({
          model: WEBSEARCH_MODEL,
          tools: [{ type: 'web_search_preview' }],
          instructions:
            'Answer the buyer question by SEARCHING THE WEB and citing specific, ' +
            'current third-party sources (comparison articles, review sites, ' +
            'industry rankings). Name concrete products/vendors. Be specific and ' +
            'grounded — never generic.',
          input: query,
        });
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('OpenAI responses timeout 40s')),
            40000
          );
        });
        return await Promise.race([call, timeout]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    { retries: 2, factor: 2, minTimeout: 1000, maxTimeout: 8000 }
  );

  const parsed = extractResponses(response);
  return {
    response_text: parsed.text,
    citations: parsed.citations,
    raw_citations: parsed.raw_citations,
    model_used: `${WEBSEARCH_MODEL} (web_search)`,
  };
}

/** Extract answer text + url_citation annotations from a Responses API result. */
function extractResponses(response: any): {
  text: string;
  citations: RawCitation[];
  raw_citations: RawInlineCitation[];
} {
  let text = '';
  const citations: RawCitation[] = [];
  const raw_citations: RawInlineCitation[] = [];
  const seen = new Set<string>();
  let order = 0;
  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (typeof c?.text === 'string' && c.text.trim())
        text += (text ? '\n\n' : '') + c.text;
      const anns = Array.isArray(c?.annotations) ? c.annotations : [];
      for (const a of anns) {
        if (a?.type !== 'url_citation' || typeof a.url !== 'string') continue;
        const url = a.url;
        let domain = '';
        try {
          domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
          /* skip unparseable */
        }
        const title = typeof a.title === 'string' ? a.title : '';
        raw_citations.push({
          order: order++,
          url,
          title,
          domain,
          start_index: typeof a.start_index === 'number' ? a.start_index : null,
          end_index: typeof a.end_index === 'number' ? a.end_index : null,
          anchor_text: '',
          grounded: true,
        });
        if (!seen.has(url)) {
          seen.add(url);
          citations.push({ url, title, domain, grounded: true });
        }
      }
    }
  }
  if (!text && typeof response?.output_text === 'string') text = response.output_text;
  return { text, citations, raw_citations };
}

/** LEGACY fallback — gpt-4o-search-preview chat completion (built-in search). */
async function pollChatGPTSearchPreview(
  query: string,
  env: Env
): Promise<OpenAIPollResult> {
  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    const response = await pRetry(
      async () => {
        // Per-attempt 20s timeout. Without this, a hung OpenAI request
        // can eat the entire Cloudflare invocation budget and kill the
        // batch chain. Race against a timeout, clear the timer on settle.
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          const completionPromise = openai.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content: query }],
            max_tokens: 800,
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error('OpenAI timeout 20s')),
              20000
            );
          });
          return await Promise.race([completionPromise, timeoutPromise]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 8000,
        onFailedAttempt: (error) => {
          console.log(
            `[openai] attempt ${error.attemptNumber} failed: ${error.message}`
          );
        },
      }
    );

    const message = response.choices[0]?.message;
    const text = message?.content || '';
    return {
      response_text: text,
      citations: extractCitations(message?.annotations),
      raw_citations: extractRawCitations(text, message?.annotations),
      tokens_used: response.usage?.total_tokens,
      model_used: MODEL,
    };
  } catch (error: any) {
    console.error('[openai] final failure:', error.message);
    return {
      response_text: '',
      citations: [],
      raw_citations: [],
      error: error.message || 'Unknown OpenAI error',
      model_used: MODEL,
    };
  }
}
