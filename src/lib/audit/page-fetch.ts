import type { PageSignals, PageType } from '../db/types';
import { normalizeDomain } from './source-classifier';

/** Page signals + the lowercased text sample we cache for brand/query matching. */
export interface ExtractedPage {
  signals: PageSignals;
  text_sample: string;
}

const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 600_000;
const TEXT_SAMPLE_MAX = 24_000;

const UA =
  'Mozilla/5.0 (compatible; CompassAEO/1.0; +https://compass.aeo) AppleWebKit/537.36';

/**
 * Plain server-side fetch of a page + regex signal extraction. Returns null on
 * any failure (non-2xx, empty body, blocked, timeout) so the caller can decide
 * to fall back to an Apify scrape for that one URL.
 */
export async function fetchPageSignals(url: string): Promise<ExtractedPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html') && ct !== '') return null;
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    if (!html.trim()) return null;
    // res.url is the final URL after redirects — the real page behind Gemini's
    // vertexaisearch proxy (with its deep path), captured for free here.
    return extractSignals(url, html, res.status, 'fetch', res.url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Build PageSignals + text sample from raw HTML. Shared by fetch + apify paths. */
export function extractSignals(
  url: string,
  html: string,
  status: number,
  via: 'fetch' | 'apify',
  finalUrl?: string
): ExtractedPage {
  const title = stripTags(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)).trim();
  const h1 = stripTags(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)).trim();
  const has_meta_desc = /<meta[^>]+name=["']description["'][^>]*>/i.test(html);
  const has_canonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
  const schema_types = extractSchemaTypes(html);

  const bodyText = htmlToText(html);
  const word_count = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const text_sample = bodyText.toLowerCase().slice(0, TEXT_SAMPLE_MAX);

  return {
    signals: {
      url,
      root_domain: normalizeDomain(url),
      http_status: status,
      title,
      h1,
      word_count,
      schema_types,
      has_meta_desc,
      has_canonical,
      page_type: classifyPageType(url, title, schema_types, word_count),
      analyzed_via: via,
      final_url: finalUrl && finalUrl !== url ? finalUrl : undefined,
    },
    text_sample,
  };
}

/** Is the audited brand present on the page? Name match wins over domain match. */
export function brandPresence(
  page: { title: string; text_sample: string },
  brandName: string,
  brandDomain: string
): { brand_present: boolean; match_type: 'name' | 'domain' | 'none' } {
  const hay = (page.title + '\n' + page.text_sample).toLowerCase();
  const name = brandName.trim().toLowerCase();
  const domainCore = normalizeDomain(brandDomain);
  if (name && hay.includes(name)) return { brand_present: true, match_type: 'name' };
  if (domainCore && hay.includes(domainCore))
    return { brand_present: true, match_type: 'domain' };
  return { brand_present: false, match_type: 'none' };
}

/** Do the query's terms appear in the page's title/H1? (on-page targeting) */
export function queryInTitleOrH1(query: string, title: string, h1: string): boolean {
  const terms = significantTerms(query);
  if (terms.length === 0) return false;
  const hay = (title + ' ' + h1).toLowerCase();
  const hits = terms.filter((t) => hay.includes(t)).length;
  return hits >= Math.ceil(terms.length / 2); // at least half the meaningful terms
}

const STOP = new Set([
  'the', 'a', 'an', 'for', 'and', 'or', 'of', 'to', 'in', 'on', 'with', 'best',
  'top', 'vs', 'software', 'tool', 'tools', 'platform', 'platforms', 'app', 'apps',
]);

export function significantTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// ── helpers ────────────────────────────────────────────────────────────────

function firstMatch(s: string, re: RegExp): string {
  const m = s.match(re);
  return m ? m[1] : '';
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
}

/** Strip script/style/nav noise, then tags, collapse whitespace → plain text. */
function htmlToText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  return stripTags(cleaned).replace(/\s+/g, ' ').trim();
}

/** Collect JSON-LD @type values (handles arrays + @graph nesting). */
function extractSchemaTypes(html: string): string[] {
  const out = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      walkTypes(JSON.parse(m[1].trim()), out);
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return Array.from(out);
}

function walkTypes(node: unknown, out: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) walkTypes(n, out);
    return;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') out.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && out.add(x));
    if (obj['@graph']) walkTypes(obj['@graph'], out);
  }
}

const BLOG_PATH = /\/(blog|news|article|articles|post|posts|insights|resources)\//i;
const DEDICATED_PATH =
  /\/(product|products|solutions?|features?|platform|tracking|software|use-cases?|compare)\b/i;

function classifyPageType(
  url: string,
  title: string,
  schemaTypes: string[],
  wordCount: number
): PageType {
  if (BLOG_PATH.test(url) || schemaTypes.includes('Article') || schemaTypes.includes('BlogPosting'))
    return 'blog';
  if (
    DEDICATED_PATH.test(url) ||
    schemaTypes.includes('Product') ||
    schemaTypes.includes('FAQPage') ||
    schemaTypes.includes('SoftwareApplication')
  )
    return 'dedicated';
  // Shallow path + reasonable depth reads as a dedicated landing page.
  const pathDepth = url.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean).length;
  if (pathDepth <= 2 && wordCount >= 400) return 'dedicated';
  return 'other';
}
