import type { Env } from '../db/supabase';
import { extractSignals, type ExtractedPage } from './page-fetch';

const API = 'https://api.apify.com/v2/acts';

/** POST run-sync-get-dataset-items for an actor; returns the dataset items. */
async function runActor(
  actor: string,
  input: unknown,
  env: Env,
  timeoutSecs: number
): Promise<unknown[]> {
  if (!env.APIFY_TOKEN) throw new Error('APIFY_TOKEN not configured');
  const url = `${API}/${actor}/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}&timeout=${timeoutSecs}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // Never include the token (it's only in the query string we don't echo).
    throw new Error(`Apify ${actor} failed: ${res.status}`);
  }
  const items = (await res.json()) as unknown[];
  return Array.isArray(items) ? items : [];
}

const CHEERIO_PAGE_FUNCTION = `async function pageFunction(context) {
  const { request, body } = context;
  return { url: request.loadedUrl || request.url, html: typeof body === 'string' ? body : String(body || '') };
}`;

/**
 * Apify cheerio-scraper over a fixed set of URLs (no link-following). Used only
 * as a FALLBACK for pages plain fetch couldn't read (bot-blocked / thin), via
 * Apify proxy. Returns extracted signals keyed the same way as plain fetch.
 */
export async function cheerioScrape(urls: string[], env: Env): Promise<ExtractedPage[]> {
  if (urls.length === 0) return [];
  const items = await runActor(
    'apify~cheerio-scraper',
    {
      startUrls: urls.map((u) => ({ url: u })),
      pageFunction: CHEERIO_PAGE_FUNCTION,
      linkSelector: '',
      maxRequestsPerCrawl: urls.length + 2,
      maxConcurrency: 5,
      maxRequestRetries: 1,
      proxyConfiguration: { useApifyProxy: true },
    },
    env,
    120
  );
  const out: ExtractedPage[] = [];
  for (const it of items) {
    const row = it as { url?: string; html?: string };
    if (!row.url || !row.html) continue;
    out.push(extractSignals(row.url, row.html, 200, 'apify'));
  }
  return out;
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

/**
 * Apify Website Content Crawler - limited same-domain crawl of the TARGET site
 * to discover whether a relevant page already exists for each query (Part 4).
 * cheerio crawler type keeps it cheap; capped at maxCrawlPages.
 */
export async function crawlOwnSite(domain: string, env: Env): Promise<CrawledPage[]> {
  const items = await runActor(
    'apify~website-content-crawler',
    {
      startUrls: [{ url: `https://${domain}/` }],
      crawlerType: 'cheerio',
      maxCrawlPages: 12,
      maxCrawlDepth: 2,
      saveMarkdown: false,
      saveHtml: false,
      proxyConfiguration: { useApifyProxy: true },
    },
    env,
    180
  );
  const out: CrawledPage[] = [];
  for (const it of items) {
    const row = it as { url?: string; text?: string; metadata?: { title?: string } };
    if (!row.url) continue;
    out.push({ url: row.url, title: row.metadata?.title ?? '', text: row.text ?? '' });
  }
  return out;
}
