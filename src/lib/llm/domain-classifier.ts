import OpenAI from 'openai';
import type { Env } from '../db/supabase';
import type { DiscoveredLabel, Confidence } from '../db/types';

const MODEL = 'gpt-4o-mini';

const VALID_LABELS = new Set<DiscoveredLabel>([
  'competitor',
  'aggregator',
  'editorial',
  'other',
]);
const VALID_CONFIDENCE = new Set<Confidence>(['high', 'medium', 'low']);

/** One domain to classify, with the signals we feed the model. */
export interface DomainToClassify {
  domain: string;
  sample_url: string;
  sample_title: string;
  example_queries: string[];
}

export interface DomainLabel {
  label: DiscoveredLabel;
  confidence: Confidence;
}

function buildSystemPrompt(brandName: string, category: string): string {
  return (
    `You classify domains by their PRIMARY role relative to ${brandName}, ` +
    `which competes in: ${category}. Choose exactly one label per domain:\n` +
    `- 'competitor': a company offering a product/service that competes ` +
    `with ${brandName} in ${category} or an adjacent software/logistics ` +
    `category. Vendor sites, SaaS platforms, and logistics-tech companies ` +
    `are competitors.\n` +
    `- 'aggregator': review/directory/listing/comparison sites ` +
    `(g2, capterra, softwareadvice, getapp, trustradius, etc.).\n` +
    `- 'editorial': news/magazine/blog/media publishers covering the ` +
    `industry but NOT selling a competing product.\n` +
    `- 'other': ONLY if it genuinely fits none of the above.\n` +
    `Use the page title and the queries the domain was cited for as ` +
    `evidence. A domain cited as an answer to 'best X software' / 'top X ` +
    `platforms' queries is very likely a competitor or aggregator, NOT ` +
    `'other'. Prefer 'competitor' or 'aggregator' over 'other' when ` +
    `evidence leans that way. Do not default to 'other' out of caution.\n` +
    `Return ONLY valid JSON: {results:[{domain,label,confidence}]} where ` +
    `confidence is one of 'high'|'medium'|'low'. No prose, no markdown.`
  );
}

function isValidLabel(value: unknown): value is DiscoveredLabel {
  return typeof value === 'string' && VALID_LABELS.has(value as DiscoveredLabel);
}

function isValidConfidence(value: unknown): value is Confidence {
  return typeof value === 'string' && VALID_CONFIDENCE.has(value as Confidence);
}

/**
 * Classify a small set of unknown domains by their role relative to the
 * brand. Exactly ONE gpt-4o-mini call per audit (cheap; NOT search-preview),
 * up to ~8 domains, negligible tokens. Each domain carries its page title
 * and example buyer queries so the model has real signal instead of just a
 * URL. Fully defensive: any failure (no key, API error, bad JSON) falls back
 * to {label:'other', confidence:'low'} for every domain — a failed
 * classification must never fail the audit.
 */
export async function classifyDiscoveredDomains(
  domains: DomainToClassify[],
  brandName: string,
  category: string | null,
  env: Env
): Promise<Record<string, DomainLabel>> {
  const fallback: Record<string, DomainLabel> = {};
  for (const d of domains) fallback[d.domain] = { label: 'other', confidence: 'low' };

  if (domains.length === 0 || !env.OPENAI_API_KEY) return fallback;

  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(brandName, category || 'software'),
        },
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
      results?: Array<{ domain?: unknown; label?: unknown; confidence?: unknown }>;
    };

    const labels: Record<string, DomainLabel> = { ...fallback };
    for (const r of parsed.results || []) {
      if (r && typeof r.domain === 'string' && r.domain in labels) {
        labels[r.domain] = {
          label: isValidLabel(r.label) ? r.label : 'other',
          confidence: isValidConfidence(r.confidence) ? r.confidence : 'low',
        };
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
