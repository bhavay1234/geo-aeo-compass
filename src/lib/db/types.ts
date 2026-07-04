/**
 * Database row types matching the Supabase schema.
 * See supabase/migrations/0001_initial.sql
 */

export type AuditStatus =
  | 'pending'
  | 'running'
  | 'finalizing'
  | 'completed'
  | 'failed';

export type QueryCategory =
  | 'problem'
  | 'solution'
  | 'comparison'
  | 'alternative'
  | 'use_case'
  | 'brand';

export interface CompetitorCitation {
  name: string;
  position: number;
}

export interface CategoryStats {
  cited: number;
  total: number;
}

/**
 * How a cited domain relates to the brand being audited. Drives the
 * suggestion engine. Classification rules live in source-classifier.ts.
 */
export type SourceType =
  | 'own'
  | 'competitor'
  | 'review_directory'
  | 'analyst'
  | 'editorial'
  | 'other';

/** A web-search citation returned by gpt-4o-search-preview, classified (deduped). */
export interface Citation {
  url: string;
  title: string;
  domain: string;
  source_type: SourceType;
  /** True when the URL came from the LLM's real web-search sources
   *  (DFS `annotations` / OpenAI url_citations). False when it was mined from
   *  inline markdown links in an UNGROUNDED answer — i.e. the model listed a
   *  recommended product and linked its own homepage, not a third-party source.
   *  Absent on legacy rows (predates the flag). */
  grounded?: boolean;
}

/**
 * Faithful inline citation: ordered, un-deduped, classified, with the
 * sentence it anchors to. Powers the "why this source is in the answer"
 * trail in the UI.
 */
export interface InlineCitation {
  order: number;
  url: string;
  title: string;
  domain: string;
  source_type: SourceType;
  start_index: number | null;
  end_index: number | null;
  anchor_text: string;
  /** See Citation.grounded. */
  grounded?: boolean;
}

export type SuggestionSituation =
  | 'winning'
  | 'weak_position'
  | 'losing_to_competitor'
  | 'open_opportunity'
  | 'authority_gap';

/** Deterministic, per-query recommendation built from citation data. */
export interface Suggestion {
  situation: SuggestionSituation;
  severity: 'low' | 'medium' | 'high';
  action: string;
  evidence: string;
}

/** Best-guess role of a domain ChatGPT cited that the user didn't name. */
export type DiscoveredLabel = 'competitor' | 'aggregator' | 'editorial' | 'other';

/** Classifier's confidence in a discovered-domain label. */
export type Confidence = 'high' | 'medium' | 'low';

/** An unnamed brand/domain ChatGPT repeatedly cites — a competitor the user may not know about. */
export interface DiscoveredCompetitor {
  domain: string;
  citation_count: number;
  queries_seen_in: number;
  label: DiscoveredLabel;
  confidence: Confidence;
  sample_url: string;
}

/**
 * Per-query view of every EXTERNAL domain cited in one answer (excludes own
 * brand + named competitors). url/title/source_type come from the stored
 * citation; label/confidence are present only when the domain also recurs at
 * audit level (from the single gpt-4o-mini classification), null otherwise.
 */
export interface DiscoveredInQuery {
  domain: string;
  url: string;
  title: string;
  source_type: SourceType;
  label: DiscoveredLabel | null;
  confidence: Confidence | null;
}

/** Per-query LLM judgment of a cited domain's role (rides on the suggestion call). */
export interface CitationRole {
  domain: string;
  role: 'competitor' | 'source' | 'unsure';
}

/** "How ChatGPT describes [brand]" — one-line verdict from a 'what is X?' poll. */
export interface BrandVerdict {
  name: string;
  domain: string | null;
  verdict: string;
}

/** Page type heuristic for a cited/own page. */
export type PageType = "dedicated" | "blog" | "other";

/** Brand-agnostic on-page signals for a single URL (cached in citation_pages). */
export interface PageSignals {
  url: string;
  root_domain: string;
  http_status: number;
  title: string;
  h1: string;
  word_count: number;
  schema_types: string[]; // JSON-LD @types: Organization, Product, FAQPage, Review, Article…
  has_meta_desc: boolean;
  has_canonical: boolean;
  page_type: PageType;
  analyzed_via: "fetch" | "apify";
  /** Final URL after redirects (captured from the fetch) — the REAL destination
   *  for Gemini vertexaisearch grounding proxies, with the deep path intact.
   *  In-memory only (not cached); absent on cache hits and the apify path. */
  final_url?: string;
}

/** Per-cited-source rollup for the Citations tab (audits.citation_analysis). */
export interface CitationAnalysisEntry {
  url: string;
  domain: string;
  source_type: SourceType;
  /** Distinct QUERY texts (not polls) citing this URL — the buyer-facing count. */
  query_count: number;
  /** Which LLMs cited this URL across the audit — the multi-LLM leverage
   *  signal. A source cited by all 3 is a "universal source" (get-listed
   *  priority). Legacy single-LLM entries default to ["chatgpt"]. */
  llms_citing: LlmSource[];
  brand_present: boolean;
  match_type: "name" | "domain" | "none";
  /** HTTP status of the cited URL (after following redirects). >=400 = dead —
   *  filtered from the UI. Absent on audits run before status-checking shipped. */
  status_code?: number;
  /** Final URL after redirects — the real destination for Gemini's
   *  vertexaisearch grounding-redirect proxies. Absent = use `url`. */
  resolved_url?: string;
  /** For roundup/listicle sources: did an LLM judge this list to be in the
   *  brand's actual niche (vs merely sharing a word — "trade finance" / stock
   *  "trading" for a supply-chain brand)? Absent = not judged (kept). */
  niche_relevant?: boolean;
  /** One-line LLM reason WHY getting this brand listed here would help its AI
   *  visibility. Empty/absent for off-niche or unjudged sources. */
  get_listed_reason?: string;
  /** Can the brand REALISTICALLY be listed here? True only for multi-vendor
   *  roundups / comparisons / directories / multi-tool discussions that already
   *  name ≥2 competitors — where adding the brand is natural. FALSE for pages
   *  centered on ONE brand (single-product review/profile, single-company news,
   *  a press release, an opinion piece that ranks no products). Absent = not
   *  judged (kept, for legacy audits). */
  get_listable?: boolean;
}

/** Which of the three influence factors most likely drove a naming. */
export type DecisiveFactor = "citations" | "third_party" | "own_site";

/** A cited source that named a brand (Factor-1 evidence trail). */
export interface InfluenceSource {
  url: string;
  domain: string;
  source_type: SourceType;
}

/** Normalized 0..1 influence factor scores (citations weighted highest). */
export interface InfluenceFactors {
  cited: number; // share of THIS query's cited sources that name the brand
  third_party: number; // presence across the audit's cited sources (authority)
  own_site: number; // dedicated page / schema strength (weighted least)
}

/** A target's most-relevant page signals (Factor 3 detail). */
export interface PageRef {
  exists: boolean;
  url: string | null;
  page_type: PageType;
  schema_types: string[];
}

/**
 * Why ChatGPT NAMED brand X as a recommendation in one query — led by which
 * cited sources name it (Factor 1), then cross-audit third-party presence
 * (Factor 2), then own-site signals (Factor 3, least). Verdict is one cheap
 * LLM call over the factor summary (deterministic fallback on failure).
 */
export interface WhyNamed {
  brand: string;
  decisive: DecisiveFactor;
  factors: InfluenceFactors;
  named_in_sources: InfluenceSource[]; // cited sources (this query) that name the brand
  cited_total: number; // # analyzable cited sources this query
  third_party_count: number; // # distinct cited sources across the audit naming it
  own_page: PageRef | null;
  verdict: string;
}

/** The TARGET brand's influence on the SAME query — powers "why not you" + the
 *  YOU comparison bars. Stored in poll_results.own_page (jsonb). */
export interface YouInfluence {
  factors: InfluenceFactors;
  named_in_sources: InfluenceSource[];
  cited_total: number;
  third_party_count: number;
  own_page: PageRef | null;
}

/** Aggregate rollup computed at audit completion (audits.insights). */
export interface AuditInsights {
  situation_distribution: Record<SuggestionSituation, number>;
  top_missing_sources: Array<{
    domain: string;
    source_type: SourceType;
    count: number;
  }>;
  top_competitors_cited: Array<{ name: string; count: number }>;
  high_severity_count: number;
  // How many of the user's NAMED competitors actually appeared in answers.
  named_competitor_count: number;
  // How many DISCOVERED (unnamed) domains the LLM labeled 'competitor'.
  discovered_competitor_count: number;
  // Discovered rivals judged genuine same-category competitors by intent +
  // features (OpenAI), consolidated to parent brand. Replaces the blunt
  // recurrence gate — a real rival named in ONE query still surfaces, while
  // wrong-category noise (BI tools, carriers) is dropped. Absent on old audits.
  competitor_brands?: ClassifiedCompetitor[];
}

/** A discovered brand the classifier judged a real competitor of the audited
 *  brand. tier: 'direct' = same core category · 'adjacent' = cross-shopped
 *  neighbor (e.g. a TMS or broad SCM suite for a visibility platform). */
export interface ClassifiedCompetitor {
  name: string;
  tier: 'direct' | 'adjacent';
  /** Official website domain, grounded in cited URLs where possible, else the
   *  model's best knowledge ("onebeat.co", "portcast.io") — NOT a name+".com"
   *  guess. Absent when unresolved (caller falls back to the guess). */
  domain?: string;
}

export interface AuditSummary {
  headline: string;
  visibility_rate: number;
  brand_cited_queries: number;
  total_queries: number;
  top_competitor: { name: string; cited_queries: number } | null;
  category_breakdown: Record<string, CategoryStats>;
  top_winning_queries: string[];
  top_losing_queries: string[];
}

export interface Audit {
  id: string;
  brand_name: string;
  domain: string;
  category: string | null;
  competitors: string[];
  status: AuditStatus;
  progress_total: number;
  progress_done: number;
  visibility_score: number | null;
  summary: AuditSummary | null;
  insights: AuditInsights | null;
  discovered_competitors: DiscoveredCompetitor[];
  positioning: string | null;
  brand_verdict: string | null;
  competitor_verdicts: BrandVerdict[];
  notes: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  citation_analysis: CitationAnalysisEntry[];
  citation_status: "analyzing" | "done" | "failed" | null;
  /** Which LLMs this audit polled — the denominator for cross-LLM signals
   *  (consensus per brand, universal citation sources). */
  llms_polled: LlmSource[];
  /** Brand DNA captured at launch (Apify scrape → LLM synthesis): category,
   *  positioning, seed_phrases, products, competitors, audience. */
  brand_dna: {
    brand_name?: string;
    positioning?: string;
    category?: string;
    audience?: string;
    products?: string[];
    competitors?: string[];
    seed_phrases?: string[];
  } | null;
}

/** Distinguishes rows in poll_results (one poll per query per LLM). */
export type LlmSource = "chatgpt" | "perplexity" | "gemini";

export interface PollResult {
  id: string;
  audit_id: string;
  query_text: string;
  query_category: QueryCategory | null;
  llm_source: string;
  raw_response: string | null;
  full_response: string | null;
  brand_cited: boolean;
  brand_position: number | null;
  brand_mentioned_uncited: boolean;
  competitors_cited: CompetitorCitation[];
  competitors_mentioned_uncited: string[];
  citations: Citation[];
  raw_citations: InlineCitation[];
  discovered_in_query: DiscoveredInQuery[];
  citation_roles: CitationRole[];
  /** Brands/products ChatGPT NAMED in the prose as answers/recommendations
   *  (LLM-extracted, excl. the audited brand). The competitor signal — distinct
   *  from cited source domains. */
  brands_named: string[];
  /** Per named-brand "why named" influence analysis (Factor 1-3 + verdict). */
  why_cited: WhyNamed[];
  /** The target brand's own influence on this query (jsonb col is "own_page"). */
  own_page: YouInfluence | null;
  suggestion: Suggestion | null;
  created_at: string;
}
