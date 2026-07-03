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
        model_name: 'gemini-2.0-flash',
        web_search: true,
      },
    ],
    env
  );
  return normalize(data, 'gemini', 'gemini-2.0-flash');
}

// ── normalization ──────────────────────────────────────────────────────────

interface AnyObj {
  [k: string]: unknown;
}

function pickAnswerText(item: AnyObj): string {
  // DFS field names vary between LLMs/versions — try the common ones in order.
  const candidates = [
    item.response,
    item.answer,
    item.text,
    item.content,
    (item.message as AnyObj | undefined)?.content,
  ];
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c;
  return '';
}

function pickReferences(item: AnyObj): AnyObj[] {
  const candidates = [item.references, item.citations, item.links, item.sources];
  for (const c of candidates) if (Array.isArray(c)) return c as AnyObj[];
  return [];
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
  const item = items[0] ?? {};

  const response_text = pickAnswerText(item);
  const references = pickReferences(item);

  const citations: RawCitation[] = [];
  const raw_citations: RawInlineCitation[] = [];
  const seen = new Set<string>();

  references.forEach((ref, i) => {
    const url = typeof ref.url === 'string' ? ref.url : '';
    if (!url) return;
    const title = typeof ref.title === 'string' ? ref.title : '';
    const domain = extractDomain(url);
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

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
