/**
 * Deterministic extraction of product/brand names from an LLM answer's PROSE -
 * zero LLM calls. Used as the brands_named fallback when OPENAI_API_KEY is not
 * configured (the LLM extraction in generateQuerySuggestion is skipped).
 *
 * "Best X software" answers are heavily markdown-formatted; the recommended
 * products almost always appear as **bold spans** or ### headings. But generic
 * EDUCATIONAL answers ("what is integrated logistics IT?") bold CATEGORY terms
 * and section headings ("WMS (Warehouse Management System)", "Core idea") - we
 * must never mistake those for vendor brands. isBrandLike() is the gate.
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
  'core idea', 'key components', 'how it works', 'in practice',
]);

// Generic software-category acronyms - categories, never brands.
const CATEGORY_ACRONYM =
  /^(erp|wms|tms|oms|crm|scm|aps|esi|plm|hcm|hrm|ipaas|paas|saas|api|apis|ai|ml|rpa|iot|edi|b2b|b2c|kpi|kpis|roi|sku|3pl|4pl|ocr|nlp|llm|sdk|ui|ux)$/i;

// Trailing generic descriptors that mark a CATEGORY or a BENEFIT/CAPABILITY
// phrase, not a product name ("Operational efficiency", "Real-time insights",
// "IoT sensors", "Customer satisfaction" - the LLM extractor leaks these).
const CATEGORY_TAIL =
  /\b(system|systems|software|platform|platforms|solution|solutions|planning|management|middleware|tool|tools|suite|services|service|technologies|technology|ecosystems?|capabilities|analytics|integration|automation|infrastructure|frameworks?|modules?|tracking|visibility|optimization|intelligence|reporting|forecasting|orchestration|monitoring|procurement|fulfillment|dashboards?|efficiency|insights?|satisfaction|transparency|compliance|traceability|reduction|sensors?|sustainability|productivity|collaboration|resilience|accuracy|reliability|connectivity|scalability|learning|exchange|governance|execution|enablement|experience|engagement|performance|savings|security)$/i;

// Section-heading / non-noun openers.
const HEADING_START =
  /^(how|why|what|when|where|which|key|core|advanced|example|examples|getting|benefit|benefits|overview|understanding|choosing|comparing|top|best|pros|cons|note|summary|conclusion|introduction|modern|typical|common|popular|leading|other|additional|main|basic|general)\b/i;

/**
 * True only for strings that plausibly name a real product/vendor - short,
 * capitalized, not a category acronym / descriptor / heading. Shared with the
 * UI so category junk from OLD audits is filtered at read time too.
 */
export function isBrandLike(raw: string): boolean {
  const n = (raw || '').trim();
  if (n.length < 2 || n.length > 30) return false;
  const words = n.split(/\s+/);
  if (words.length > 4) return false; // brands are 1-4 words
  if (/[()/[\]{}]/.test(n)) return false; // parens/slashes = acronym gloss / category
  if (/^\d/.test(n) && !/[a-z]/i.test(n)) return false; // pure numbers
  if (!/^[A-Za-z0-9]/.test(n)) return false;
  const low = n.toLowerCase();
  if (GENERIC.has(low)) return false;
  if (CATEGORY_ACRONYM.test(n)) return false;
  if (CATEGORY_TAIL.test(n)) return false;
  if (HEADING_START.test(n)) return false;
  return true;
}

/**
 * True if `name` actually appears in the answer prose. Guards against the LLM
 * extractor INVENTING competitor names that were never in the answer (the
 * hallucinated "recommended instead of you" on educational answers). Matches
 * the full name, or its distinctive first token as a whole word ("Oracle" for
 * "Oracle Transportation Management"), so a real brand written in short form in
 * the answer isn't dropped. No answer text → cannot verify → keep (don't drop).
 */
export function brandInProse(name: string, prose: string | null | undefined): boolean {
  const text = (prose || '').toLowerCase();
  if (!text) return true;
  const nm = (name || '').trim().toLowerCase();
  if (!nm) return false;
  if (text.includes(nm)) return true;
  const first = nm.split(/\s+/)[0];
  if (first.length < 3) return false;
  const esc = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`).test(text);
}

export function extractProseBrands(text: string, ownName: string): string[] {
  if (!text) return [];
  const own = ownName.trim().toLowerCase();
  const found = new Map<string, string>();

  const add = (raw: string) => {
    let n = raw.replace(/[*_`#]/g, '').trim();
    // Drop list numbering: "1. HubSpot CRM" → "HubSpot CRM".
    n = n.replace(/^\d{1,2}[.)]\s+/, '');
    // Drop trailing descriptions: "VYLO – AI dialer for teams" → "VYLO".
    n = n.split(/\s+[-–]\s+/)[0].split(/:\s/)[0].trim();
    n = n.replace(/[.,;:!?]+$/, '').trim();
    const low = n.toLowerCase();
    // Exclude the audited brand AND its product variants ("HubSpot CRM").
    if (low === own || (own && low.startsWith(own + ' '))) return;
    if (!isBrandLike(n)) return;
    if (!found.has(low)) found.set(low, n);
  };

  // Markdown bold spans - the dominant "named product" pattern.
  for (const m of text.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) add(m[1]);
  // Markdown headings (## / ### / #### Product).
  for (const m of text.matchAll(/^#{2,4}\s+(.+)$/gm)) add(m[1]);
  // Numbered list leads: "1. Product - description" / "2) Product: blurb".
  for (const m of text.matchAll(/^\s*\d{1,2}[.)]\s+([A-Z][^\n:–-]{1,50})(?=[\s:–-]|$)/gm))
    add(m[1]);

  return Array.from(found.values()).slice(0, 10);
}
