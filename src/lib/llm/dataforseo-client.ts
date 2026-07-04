import type { Env } from '../db/supabase';
import type {
  OpenAIPollResult,
  RawCitation,
  RawInlineCitation,
} from './openai-client';

/**
 * DataForSEO client for AI-response polling (Perplexity + Gemini). Returns the
 * same shape as our direct-OpenAI `OpenAIPollResult` so downstream extraction /
 * classification / brands_named / why-cited runs unchanged regardless of source.
 *
 * We keep the direct OpenAI ChatGPT poller (proven working) alongside DFS — DFS
 * only adds the two other LLMs. If DFS response field names differ from what
 * this normalizer expects, extend `pickAnswerText` / `pickReferences` — every
 * fallback is defensive.
 */

const API = 'https://api.dataforseo.com/v3';
const FETCH_TIMEOUT_MS = 45_000;

function basicAuth(env: Env): string {
  const raw = `${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`;
  // btoa is available in the Worker runtime.
  return 'Basic ' + btoa(raw);
}

async function callDFS(path: string, body: unknown, env: Env): Promise<unknown> {
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    throw new Error('DATAFORSEO credentials not configured');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuth(env),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Never include auth in the message — path + status only.
      throw new Error(`DFS ${path} ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ChatGPT via DataForSEO — used when OPENAI_API_KEY is not configured, so the
 * whole tool can run on DFS credentials alone. Same normalized result shape as
 * the direct-OpenAI poller.
 */
export async function pollChatGPTviaDFS(
  query: string,
  env: Env
): Promise<OpenAIPollResult> {
  const data = await callDFS(
    '/ai_optimization/chat_gpt/llm_responses/live',
    [
      {
        user_prompt: query,
        model_name: 'gpt-5.3-chat-latest',
        web_search: true,
        // Live-verified: without this nudge gpt-5.3 often answers product
        // queries from training with ZERO sources; with it, it searches and
        // returns annotations + inline links (matching chatgpt.com behavior
        // for shopping-style queries).
        system_message:
          'When the question involves products, brands, comparisons, or ' +
          'recommendations, use web search to ground your answer and cite ' +
          'your sources with links.',
      },
    ],
    env
  );
  return normalize(data, 'chatgpt', 'gpt-5.3-chat-latest (dataforseo)');
}

export async function pollPerplexity(
  query: string,
  env: Env
): Promise<OpenAIPollResult> {
  const data = await callDFS(
    '/ai_optimization/perplexity/llm_responses/live',
    [
      {
        user_prompt: query,
        model_name: 'sonar',
        web_search: true,
      },
    ],
    env
  );
  return normalize(data, 'perplexity', 'sonar');
}

export async function pollGemini(
  query: string,
  env: Env
): Promise<OpenAIPollResult> {
  const data = await callDFS(
    '/ai_optimization/gemini/llm_responses/live',
    [
      {
        user_prompt: query,
        model_name: 'gemini-2.5-flash',
        web_search: true,
      },
    ],
    env
  );
  return normalize(data, 'gemini', 'gemini-2.5-flash');
}

/**
 * Generic DFS LLM call (no web search) that must return JSON — powers Brand
 * DNA synthesis without an OpenAI key. Returns the parsed object or null.
 */
export async function dfsLlmJson(
  systemMessage: string,
  userPrompt: string,
  env: Env
): Promise<unknown | null> {
  try {
    const data = await callDFS(
      '/ai_optimization/chat_gpt/llm_responses/live',
      [
        {
          // DFS rejects user_prompt/system_message over ~500 chars
          // ("Invalid Field") — hard-slice as a safety net; prompts are
          // designed to fit.
          user_prompt: userPrompt.slice(0, 490),
          model_name: 'gpt-4o',
          system_message: systemMessage.slice(0, 490),
          web_search: false,
          temperature: 0.2,
        },
      ],
      env
    );
    const norm = normalize(data, 'chatgpt', 'gpt-4o (dfs json)');
    if (!norm.response_text && norm.error)
      console.error('[dfs-llm-json] task error:', norm.error);
    const text = norm.response_text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (!text) return null;
    // Model sometimes wraps JSON in prose — grab the outermost object.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      console.error('[dfs-llm-json] no JSON object in reply:', text.slice(0, 200));
      return null;
    }
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      console.error('[dfs-llm-json] JSON.parse failed:', text.slice(0, 200));
      return null;
    }
  } catch (err: any) {
    console.error('[dfs-llm-json] failed:', err?.message);
    return null;
  }
}

export interface KeywordSuggestion {
  keyword: string;
  volume: number;
  intent: string; // informational | navigational | commercial | transactional
}

/**
 * DataForSEO Labs keyword_suggestions for one seed phrase, volume-ranked.
 * Includes per-keyword search-intent classification.
 */
export async function dfsKeywordSuggestions(
  seed: string,
  env: Env,
  limit = 40
): Promise<KeywordSuggestion[]> {
  const data = (await callDFS(
    '/dataforseo_labs/google/keyword_suggestions/live',
    [
      {
        keyword: seed,
        location_code: 2840,
        language_code: 'en',
        limit,
        order_by: ['keyword_info.search_volume,desc'],
      },
    ],
    env
  )) as AnyObj;
  const tasks = (data?.tasks as AnyObj[] | undefined) ?? [];
  const result = (tasks[0]?.result as AnyObj[] | undefined) ?? [];
  const items = (result[0]?.items as AnyObj[] | undefined) ?? [];
  const out: KeywordSuggestion[] = [];
  for (const i of items) {
    const keyword = typeof i.keyword === 'string' ? i.keyword.trim() : '';
    if (!keyword) continue;
    const info = (i.keyword_info as AnyObj | undefined) ?? {};
    const intent =
      ((i.search_intent_info as AnyObj | undefined)?.main_intent as string) ??
      'informational';
    out.push({
      keyword,
      volume: typeof info.search_volume === 'number' ? info.search_volume : 0,
      intent,
    });
  }
  return out;
}

// ── normalization ──────────────────────────────────────────────────────────

interface AnyObj {
  [k: string]: unknown;
}

/**
 * Extract answer text + ordered {url,title} annotations from DFS llm_responses
 * items. Verified live shape (all three LLMs share it):
 *   result[0].items[] = { type: "message",
 *     sections: [{ type: "text", text: "...", annotations: [{url,title}] }] }
 * The legacy flat-field fallbacks are kept for shape drift across DFS versions.
 */
function extractFromItems(items: AnyObj[]): { text: string; refs: AnyObj[] } {
  let text = '';
  const refs: AnyObj[] = [];
  for (const item of items) {
    const sections = item.sections as AnyObj[] | undefined;
    if (Array.isArray(sections)) {
      for (const sec of sections) {
        if (typeof sec.text === 'string' && sec.text.trim()) {
          text += (text ? '\n\n' : '') + sec.text;
        }
        const anns = sec.annotations as AnyObj[] | undefined;
        if (Array.isArray(anns)) refs.push(...anns);
      }
      continue;
    }
    // Legacy/fallback flat fields.
    const flat = [item.response, item.answer, item.text, item.content,
      (item.message as AnyObj | undefined)?.content];
    for (const c of flat)
      if (typeof c === 'string' && c.trim()) {
        text += (text ? '\n\n' : '') + c;
        break;
      }
    const flatRefs = [item.references, item.citations, item.links, item.sources];
    for (const c of flatRefs)
      if (Array.isArray(c)) {
        refs.push(...(c as AnyObj[]));
        break;
      }
  }
  return { text, refs };
}

/**
 * ChatGPT-via-DFS embeds its web citations as inline markdown links in the
 * answer text — "([forbes.com](https://forbes.com/...?utm_source=openai))" —
 * with EMPTY structured annotations (verified live). When no annotations came
 * back, mine the text for markdown links so the citation rail isn't empty.
 */
function refsFromMarkdown(text: string): AnyObj[] {
  const out: AnyObj[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g)) {
    // Skip markdown images ![alt](url) — they're assets, not citations.
    if (m.index !== undefined && m.index > 0 && text[m.index - 1] === '!') continue;
    const url = m[2];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: m[1] });
  }
  return out;
}

function normalize(
  raw: unknown,
  llm: string,
  modelUsed: string
): OpenAIPollResult {
  const outer = raw as AnyObj;
  const tasks = (outer?.tasks as AnyObj[] | undefined) ?? [];
  const t0 = tasks[0] ?? {};
  const result = (t0.result as AnyObj[] | undefined) ?? [];
  const r0 = result[0] ?? {};
  const items = (r0.items as AnyObj[] | undefined) ?? [r0];

  const extracted = extractFromItems(items);
  const response_text = extracted.text;
  const references =
    extracted.refs.length > 0 ? extracted.refs : refsFromMarkdown(response_text);

  const citations: RawCitation[] = [];
  const raw_citations: RawInlineCitation[] = [];
  const seen = new Set<string>();

  references.forEach((ref, i) => {
    const url = typeof ref.url === 'string' ? ref.url : '';
    if (!url) return;
    const title = typeof ref.title === 'string' ? ref.title : '';
    const domain = citationDomain(url, title);
    raw_citations.push({
      order: i,
      url,
      title,
      domain,
      start_index: null,
      end_index: null,
      anchor_text: '',
    });
    if (!seen.has(url)) {
      seen.add(url);
      citations.push({ url, title, domain });
    }
  });

  const errMsg =
    typeof t0.status_message === 'string' && t0.status_code !== 20000
      ? String(t0.status_message)
      : undefined;

  return {
    response_text,
    citations,
    raw_citations,
    error: response_text ? undefined : errMsg ?? `DFS ${llm}: empty response`,
    model_used: modelUsed,
  };
}

// Gemini grounding wraps every source in a vertexaisearch redirect proxy
// (https://vertexaisearch.cloud.google.com/grounding-api-redirect/<token>); the
// real publisher domain rides in the annotation's `title` ("oracle.com"). Prefer
// that over the proxy host so the citation rail shows the true source instead of
// N identical "vertexaisearch.cloud.google.com" chips. The proxy URL is kept for
// click-through (it 302s to the exact page); only the displayed domain changes.
function citationDomain(url: string, title: string): string {
  const host = extractDomain(url);
  if (host === 'vertexaisearch.cloud.google.com') {
    const fromTitle = domainFromTitle(title);
    if (fromTitle) return fromTitle;
  }
  return host;
}

/** A bare-domain title ("emotrans-global.com") → normalized domain, else ''. */
function domainFromTitle(title: string): string {
  const t = (title || '').trim().toLowerCase().replace(/^www\./, '');
  return /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}$/.test(t) ? t : '';
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
