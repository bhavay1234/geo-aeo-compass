import type { WhyFactors, OwnPage, PageType } from '../db/types';

/** Schema @types worth surfacing in the verdict (skip noise like WebSite/BreadcrumbList). */
const MEANINGFUL_SCHEMA = new Set([
  'Organization',
  'Product',
  'FAQPage',
  'Review',
  'AggregateRating',
  'Article',
  'SoftwareApplication',
  'HowTo',
]);

function humanList(items: string[]): string {
  const xs = items.slice(0, 3);
  if (xs.length <= 1) return xs[0] ?? '';
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs[0]}, ${xs[1]} and ${xs[2]}`;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function pageNoun(t: PageType): string {
  return t === 'dedicated' ? 'a dedicated page' : t === 'blog' ? 'an in-depth article' : 'a relevant page';
}

function pageLabel(t: PageType): string {
  return t === 'dedicated' ? 'dedicated page' : t === 'blog' ? 'blog post' : 'general page';
}

/**
 * Deterministic, template-built "why is this source cited" verdict — NO LLM.
 * Factors → sentence, plus an honest contrast against the target's own page.
 */
export function buildWhyVerdict(
  domain: string,
  factors: WhyFactors,
  own: OwnPage | null
): string {
  const schema = factors.schema_richness.filter((s) => MEANINGFUL_SCHEMA.has(s));

  // Lead clause: page type (+ depth) (+ schema).
  let lead = `it has ${pageNoun(factors.page_type)}`;
  if (factors.content_depth >= 800) lead += ` (${factors.content_depth.toLocaleString()} words)`;
  if (schema.length) lead += ` with ${humanList(schema)} schema`;

  const extra: string[] = [];
  if (factors.on_page_targeting) extra.push('the query terms appear in its title/H1');
  if (factors.domain_freq >= 3)
    extra.push(`it's one of the most-cited sources across your queries (${factors.domain_freq})`);

  let verdict = `${domain} is cited here because ${lead}`;
  if (extra.length) verdict += ` — ${extra.join(', and ')}`;
  verdict += '.';

  // Honest contrast with the target's own page for this query.
  if (own) {
    if (!own.exists) {
      verdict += ' You have no dedicated page targeting this query yet.';
    } else {
      const bits: string[] = [`is a ${pageLabel(own.page_type)}`];
      const ownSchema = own.schema_types.filter((s) => MEANINGFUL_SCHEMA.has(s));
      bits.push(ownSchema.length ? `with ${humanList(ownSchema)} schema` : 'no schema');
      if (!own.on_page_targeting) bits.push('query terms absent from its title');
      const where = own.url ? ` (${shortUrl(own.url)})` : '';
      verdict += ` Your closest page${where} ${bits.join(', ')}.`;
    }
  }

  return verdict;
}
