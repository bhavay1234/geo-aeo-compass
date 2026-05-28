import OpenAI from 'openai';
import pRetry from 'p-retry';
import type { Env } from '../db/supabase';

/** A raw web-search citation, before source classification. */
export interface RawCitation {
  url: string;
  title: string;
  domain: string;
}

export interface OpenAIPollResult {
  response_text: string;
  citations: RawCitation[];
  error?: string;
  tokens_used?: number;
  model_used: string;
}

const MODEL = 'gpt-4o-search-preview';

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
    return {
      response_text: message?.content || '',
      citations: extractCitations(message?.annotations),
      tokens_used: response.usage?.total_tokens,
      model_used: MODEL,
    };
  } catch (error: any) {
    console.error('[openai] final failure:', error.message);
    return {
      response_text: '',
      citations: [],
      error: error.message || 'Unknown OpenAI error',
      model_used: MODEL,
    };
  }
}
