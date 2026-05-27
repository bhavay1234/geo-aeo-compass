import OpenAI from 'openai';
import pRetry from 'p-retry';
import type { Env } from '../db/supabase';

export interface OpenAIPollResult {
  response_text: string;
  error?: string;
  tokens_used?: number;
  model_used: string;
}

const MODEL = 'gpt-4o-search-preview';

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

    return {
      response_text: response.choices[0]?.message?.content || '',
      tokens_used: response.usage?.total_tokens,
      model_used: MODEL,
    };
  } catch (error: any) {
    console.error('[openai] final failure:', error.message);
    return {
      response_text: '',
      error: error.message || 'Unknown OpenAI error',
      model_used: MODEL,
    };
  }
}
