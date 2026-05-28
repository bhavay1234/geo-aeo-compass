import OpenAI from 'openai';
import pRetry from 'p-retry';
import type { Env } from '../db/supabase';

/** A raw web-search citation, before source classification (deduped). */
export interface RawCitation {
  url: string;
  title: string;
  domain: string;
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
      out.push({ url, title: a.url_citation?.title || '', domain });
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
      });
    } catch {
      // malformed citation — skip, never throw
    }
  }
  return out;
}

/**
 * Polls ChatGPT with a buyer-intent query.
 * Uses gpt-4o-search-preview which has built-in web search,
 * giving us responses closest to what users see on chat.openai.com.
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
      model_used: MODEL,
    };
  }

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
