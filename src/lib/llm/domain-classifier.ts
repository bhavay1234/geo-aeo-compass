import OpenAI from 'openai';
import type { Env } from '../db/supabase';
import type { DiscoveredLabel } from '../db/types';

const MODEL = 'gpt-4o-mini';

const VALID_LABELS = new Set<DiscoveredLabel>([
  'competitor',
  'aggregator',
  'editorial',
  'other',
]);

const SYSTEM_PROMPT =
  "You label domains by their role relative to a brand in a software " +
  "category. Return ONLY valid JSON, no prose, no markdown. For each input " +
  "domain output {domain, label} where label is exactly one of: " +
  "'competitor' (a company offering a competing product/service), " +
  "'aggregator' (review/listing/directory/comparison site), 'editorial' " +
  "(news/blog/media), 'other' (anything else). If unsure, use 'other'. " +
  "This is a best-guess signal, not a verdict.";

function isValidLabel(value: unknown): value is DiscoveredLabel {
  return typeof value === 'string' && VALID_LABELS.has(value as DiscoveredLabel);
}

/**
 * Classify a small set of unknown domains by their role relative to the
 * brand. Exactly ONE gpt-4o-mini call per audit (cheap; NOT search-preview),
 * ~8 domains, negligible tokens. Fully defensive: any failure (no key, API
 * error, bad JSON) falls back to labeling every domain 'other' — a failed
 * classification must never fail the audit.
 */
export async function classifyDiscoveredDomains(
  domains: Array<{ domain: string; sample_url: string }>,
  brandName: string,
  category: string | null,
  env: Env
): Promise<Record<string, DiscoveredLabel>> {
  const fallback: Record<string, DiscoveredLabel> = {};
  for (const d of domains) fallback[d.domain] = 'other';

  if (domains.length === 0 || !env.OPENAI_API_KEY) return fallback;

  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            brandName,
            category: category || 'software',
            domains,
          }),
        },
      ],
    });

    let content = completion.choices[0]?.message?.content || '';
    // Strip ```json fences if the model wraps its output despite instructions.
    content = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(content) as {
      results?: Array<{ domain?: unknown; label?: unknown }>;
    };

    const labels: Record<string, DiscoveredLabel> = { ...fallback };
    for (const r of parsed.results || []) {
      if (
        r &&
        typeof r.domain === 'string' &&
        isValidLabel(r.label) &&
        r.domain in labels
      ) {
        labels[r.domain] = r.label;
      }
    }
    return labels;
  } catch (err: any) {
    console.error(
      '[discovered] classification failed, defaulting to other:',
      err?.message
    );
    return fallback;
  }
}
