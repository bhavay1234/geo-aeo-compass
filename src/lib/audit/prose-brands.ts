/**
 * Deterministic extraction of product/brand names from an LLM answer's PROSE —
 * zero LLM calls. Used as the brands_named fallback when OPENAI_API_KEY is not
 * configured (the LLM extraction in generateQuerySuggestion is skipped).
 *
 * "Best X software" answers are heavily markdown-formatted; the recommended
 * products almost always appear as **bold spans** or ### headings. Conservative
 * by design: only those two signals, heavily filtered, so we never invent a
 * competitor out of body text.
 */

const GENERIC = new Set([
  'pros', 'cons', 'features', 'key features', 'pricing', 'price', 'overview',
  'conclusion', 'summary', 'best', 'note', 'why', 'how', 'what', 'tips',
  'benefits', 'use cases', 'use case', 'free', 'paid', 'popular', 'top',
  'recommended', 'alternatives', 'comparison', 'verdict', 'rating', 'ratings',
  'review', 'reviews', 'integrations', 'support', 'ease of use', 'cost',
  'plans', 'plan', 'trial', 'demo', 'getting started', 'faqs', 'faq',
  'disclaimer', 'table of contents', 'introduction', 'final thoughts',
  'key takeaways', 'bottom line', 'who', 'when', 'where', 'highlights',
  'limitations', 'pricing & plans', 'pricing and plans', 'best for',
  'standout features', 'drawbacks', 'why we picked it', 'quick comparison',
]);

export function extractProseBrands(text: string, ownName: string): string[] {
  if (!text) return [];
  const own = ownName.trim().toLowerCase();
  const found = new Map<string, string>();

  const add = (raw: string) => {
    let n = raw.replace(/[*_`#]/g, '').trim();
    // Drop list numbering: "1. HubSpot CRM" → "HubSpot CRM".
    n = n.replace(/^\d{1,2}[.)]\s+/, '');
    // Drop trailing descriptions: "VYLO – AI dialer for teams" → "VYLO".
    n = n.split(/\s+[–—-]\s+/)[0].split(/:\s/)[0].trim();
    n = n.replace(/[.,;:!?]+$/, '').trim();
    const low = n.toLowerCase();
    if (n.length < 2 || n.length > 40) return;
    // Exclude the audited brand AND its product variants ("HubSpot CRM").
    if (low === own || (own && low.startsWith(own + ' '))) return;
    if (GENERIC.has(low)) return;
    if (!/^[A-Z0-9]/.test(n)) return; // proper names start upper/numeric
    if (n.split(/\s+/).length > 5) return; // not a sentence fragment
    if (/^\d+[.)]?$/.test(n)) return; // bare list numbers
    if (!found.has(low)) found.set(low, n);
  };

  // Markdown bold spans — the dominant "named product" pattern.
  for (const m of text.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) add(m[1]);
  // Markdown headings (## / ### / #### Product).
  for (const m of text.matchAll(/^#{2,4}\s+(.+)$/gm)) add(m[1]);
  // Numbered list leads: "1. Product — description" / "2) Product: blurb".
  for (const m of text.matchAll(/^\s*\d{1,2}[.)]\s+([A-Z][^\n–—:-]{1,50})(?=[\s–—:-]|$)/gm))
    add(m[1]);

  return Array.from(found.values()).slice(0, 10);
}
