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

function normalizeDomain(domain: string): string {
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
