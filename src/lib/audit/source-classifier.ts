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

// Tech media that primarily REVIEW products (product reviews / "hands-on"),
// distinct from vendor sites — e.g. techradar.com/reviews/motive-fleet-management.
export const REVIEW_MEDIA_DOMAINS = new Set<string>([
  'techradar.com',
  'pcmag.com',
  'tomsguide.com',
  'cnet.com',
  'zdnet.com',
  'trustpilot.com',
  'business.com',
  'expertinsights.com',
  'crozdesk.com',
]);

/** The 10 buyer-facing buckets we club cited sources into on the Citations tab. */
export type CitationCategory =
  | 'competitor'
  | 'vendor'
  | 'reviews'
  | 'listicles'
  | 'editorial'
  | 'pr'
  | 'reddit'
  | 'youtube'
  | 'linkedin'
  | 'community';

/** Roundup / "best-X-software" listicle URL pattern (host-agnostic). */
const LISTICLE_URL =
  /\b(best|top)\b[-\w/]*\b(software|tools?|platforms?|solutions?|systems?|apps?|vendors?|companies|services|providers?)\b|\b(alternatives?|vs|versus|comparison)\b/i;

/** Product-review URL pattern (a review section on any host). */
const REVIEW_URL = /\/reviews?\//i;

/** True if `d` is, or is a subdomain of, any competitor domain in the set. */
function inDomainSet(d: string, set: Set<string> | undefined): boolean {
  if (!set || set.size === 0) return false;
  if (set.has(d)) return true;
  for (const c of set) if (c && d.endsWith('.' + c)) return true;
  return false;
}

/**
 * Club a cited source into one of 10 categories, deterministically, from its
 * domain + URL + source_type (+ the audit's known competitor domains). First
 * match wins; order matters. `competitorDomains` lets a rival's own product
 * site land in "Competitors" instead of the generic "Vendor" bucket.
 */
export function citationCategory(
  url: string,
  domain: string,
  sourceType: SourceType,
  competitorDomains?: Set<string>
): CitationCategory {
  const d = normalizeDomain(domain);
  const u = (url || '').toLowerCase();
  const host = (x: string) => d === x || d.endsWith('.' + x);

  if (host('reddit.com')) return 'reddit';
  if (host('youtube.com') || d === 'youtu.be') return 'youtube';
  if (host('linkedin.com')) return 'linkedin';
  // A rival's OWN website — kept separate from generic vendor/product sites.
  if (sourceType === 'competitor' || inDomainSet(d, competitorDomains)) return 'competitor';
  // Reviews & directories: software-review sites, analysts, review-media, and
  // any "/reviews/" section (techradar.com/reviews/...).
  if (
    REVIEW_DOMAINS.has(d) ||
    ANALYST_DOMAINS.has(d) ||
    REVIEW_MEDIA_DOMAINS.has(d) ||
    u.includes('peerinsights') ||
    REVIEW_URL.test(u)
  )
    return 'reviews';
  if (PR_DOMAINS.has(d) || /\b(press-?release|newswire)\b/.test(u)) return 'pr';
  // Community / UGC / reference: forums, Q&A, blogging platforms, social, plus
  // encyclopedic / academic / government / docs.
  if (
    UGC_DOMAINS.has(d) ||
    host('medium.com') ||
    host('substack.com') ||
    host('wikipedia.org') ||
    d.endsWith('.edu') ||
    d.endsWith('.gov') ||
    d.endsWith('.ac.uk') ||
    /^(docs|support|help|developer|developers|kb)\./.test(d)
  )
    return 'community';
  if (LISTICLE_URL.test(u)) return 'listicles';
  if (sourceType === 'editorial' || EDITORIAL_DOMAINS.has(d) || NEWS_DOMAINS.has(d))
    return 'editorial';
  // Default in an AI buyer answer: a product/company (vendor) website — incl. the
  // brand's own site (source_type 'own'). The dominant citation type.
  return 'vendor';
}

/** Display labels + fixed display order for the citation categories. */
export const CITATION_CATEGORY_META: Record<
  CitationCategory,
  { label: string; order: number }
> = {
  competitor: { label: 'Competitors', order: 0 },
  vendor: { label: 'Vendor & Product Sites', order: 1 },
  reviews: { label: 'Reviews & Directories', order: 2 },
  listicles: { label: 'Listicles & Roundups', order: 3 },
  editorial: { label: 'Editorial & News', order: 4 },
  pr: { label: 'PR & Press Releases', order: 5 },
  reddit: { label: 'Reddit', order: 6 },
  youtube: { label: 'YouTube', order: 7 },
  linkedin: { label: 'LinkedIn', order: 8 },
  community: { label: 'Community & Reference', order: 9 },
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
