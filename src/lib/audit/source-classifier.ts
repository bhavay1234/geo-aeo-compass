import type { SourceType } from '../db/types';

/**
 * Domain classification lists. THESE ARE THE LEVER the operator tunes —
 * add domains here as you discover which sources ChatGPT pulls from in
 * your category. Everything not matched falls through to 'other'.
 */

export const REVIEW_DOMAINS = new Set<string>([
  'g2.com',
  'capterra.com',
  'getapp.com',
  'softwareadvice.com',
  'trustradius.com',
  'sourceforge.net',
  'slashdot.org',
  'saasworthy.com',
  'financesonline.com',
  'producthunt.com',
]);

export const ANALYST_DOMAINS = new Set<string>([
  'gartner.com',
  'forrester.com',
  'idc.com',
  'everestgrp.com',
]);

export const EDITORIAL_DOMAINS = new Set<string>([
  'techcrunch.com',
  'forbes.com',
  'supplychaindive.com',
  'theloadstar.com',
  'freightwaves.com',
  'logisticsmgmt.com',
]);

/**
 * Competitor names whose domain isn't simply lowercase(name)+'.com'.
 * Keyed by the normalized name (lowercase, alphanumerics only).
 */
export const COMPETITOR_DOMAIN_ALIASES: Record<string, string> = {
  project44: 'project44.com',
  fourkites: 'fourkites.com',
  shippeo: 'shippeo.com',
};

// PR / press-release wires — syndicated vendor announcements, not editorial.
export const PR_DOMAINS = new Set<string>([
  'prnewswire.com',
  'businesswire.com',
  'globenewswire.com',
  'prweb.com',
  'einpresswire.com',
  'newswire.com',
  'accesswire.com',
  'prlog.org',
  '24-7pressrelease.com',
  'openpr.com',
]);

// General news (beyond the trade-press EDITORIAL_DOMAINS list).
export const NEWS_DOMAINS = new Set<string>([
  'reuters.com',
  'bloomberg.com',
  'cnbc.com',
  'wsj.com',
  'nytimes.com',
  'theverge.com',
  'wired.com',
  'businessinsider.com',
  'venturebeat.com',
  'zdnet.com',
  'cnet.com',
  'axios.com',
  'theinformation.com',
]);

// Community / user-generated: Q&A, blogging platforms, social (excl. the
// platform-specific Reddit/YouTube/LinkedIn buckets handled separately).
export const UGC_DOMAINS = new Set<string>([
  'quora.com',
  'medium.com',
  'substack.com',
  'stackexchange.com',
  'stackoverflow.com',
  'dev.to',
  'blogspot.com',
  'wordpress.com',
  'tumblr.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'tiktok.com',
  'threads.net',
  'news.ycombinator.com',
]);

/** The ≤10 buyer-facing buckets we club cited sources into on the Citations tab. */
export type CitationCategory =
  | 'reddit'
  | 'youtube'
  | 'linkedin'
  | 'reviews'
  | 'listicles'
  | 'editorial'
  | 'pr'
  | 'vendor'
  | 'ugc'
  | 'other';

/** Roundup / "best-X-software" listicle URL pattern (host-agnostic). */
const LISTICLE_URL =
  /\b(best|top)\b[-\w/]*\b(software|tools?|platforms?|solutions?|systems?|apps?|vendors?|companies|services|providers?)\b|\b(alternatives?|vs|versus|comparison)\b/i;

/**
 * Club a cited source into one of ≤10 categories, deterministically, from its
 * domain + URL + existing source_type. First match wins; order matters (a
 * competitor's own listicle is still "vendor").
 */
export function citationCategory(
  url: string,
  domain: string,
  sourceType: SourceType
): CitationCategory {
  const d = normalizeDomain(domain);
  const u = (url || '').toLowerCase();
  const host = (x: string) => d === x || d.endsWith('.' + x);

  if (host('reddit.com')) return 'reddit';
  if (host('youtube.com') || d === 'youtu.be') return 'youtube';
  if (host('linkedin.com')) return 'linkedin';
  // Authoritative vendor classification wins over content-shape heuristics.
  if (sourceType === 'own' || sourceType === 'competitor') return 'vendor';
  if (REVIEW_DOMAINS.has(d) || ANALYST_DOMAINS.has(d) || u.includes('peerinsights'))
    return 'reviews';
  if (PR_DOMAINS.has(d) || /\b(press-?release|newswire)\b/.test(u)) return 'pr';
  if (UGC_DOMAINS.has(d) || host('medium.com') || host('substack.com')) return 'ugc';
  if (LISTICLE_URL.test(u)) return 'listicles';
  if (sourceType === 'editorial' || EDITORIAL_DOMAINS.has(d) || NEWS_DOMAINS.has(d))
    return 'editorial';
  // Reference / non-commercial: encyclopedic, academic, government, docs/support.
  if (
    host('wikipedia.org') ||
    d.endsWith('.edu') ||
    d.endsWith('.gov') ||
    d.endsWith('.ac.uk') ||
    /^(docs|support|help|developer|developers|kb)\./.test(d)
  )
    return 'other';
  // Default in an AI buyer answer: a product/company (vendor) website. This is
  // the dominant citation type — LLMs mostly pull from the products' own sites —
  // so it is the catch-all rather than dumping everything into "Other".
  return 'vendor';
}

/** Display labels + fixed display order for the citation categories. */
export const CITATION_CATEGORY_META: Record<
  CitationCategory,
  { label: string; order: number }
> = {
  vendor: { label: 'Vendor & Product Sites', order: 0 },
  reviews: { label: 'Reviews & Directories', order: 1 },
  listicles: { label: 'Listicles & Roundups', order: 2 },
  editorial: { label: 'Editorial & News', order: 3 },
  reddit: { label: 'Reddit', order: 4 },
  youtube: { label: 'YouTube', order: 5 },
  linkedin: { label: 'LinkedIn', order: 6 },
  ugc: { label: 'Forums & UGC', order: 7 },
  pr: { label: 'PR & Press Releases', order: 8 },
  other: { label: 'Other & Reference', order: 9 },
};

export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

/** Derive a competitor's likely domain from its display name. */
export function competitorToDomain(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return '';
  return COMPETITOR_DOMAIN_ALIASES[key] ?? `${key}.com`;
}

/**
 * Classify a cited domain relative to the brand. Rules evaluated in order;
 * first match wins.
 */
export function classifySource(
  domain: string,
  opts: { brandDomain: string; competitorDomains: string[] }
): SourceType {
  const d = normalizeDomain(domain);
  const brand = normalizeDomain(opts.brandDomain);

  // 1. own
  if (brand && (d === brand || d.endsWith('.' + brand))) return 'own';

  // 2. competitor
  for (const comp of opts.competitorDomains) {
    const c = normalizeDomain(comp);
    if (c && (d === c || d.endsWith('.' + c))) return 'competitor';
  }

  // 3. review / directory
  if (REVIEW_DOMAINS.has(d)) return 'review_directory';

  // 4. analyst
  if (ANALYST_DOMAINS.has(d)) return 'analyst';

  // 5. editorial
  if (EDITORIAL_DOMAINS.has(d)) return 'editorial';

  // 6. fallback
  return 'other';
}
