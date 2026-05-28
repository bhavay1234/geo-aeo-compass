/**
 * Database row types matching the Supabase schema.
 * See supabase/migrations/0001_initial.sql
 */

export type AuditStatus = 'pending' | 'running' | 'completed' | 'failed';

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
  notes: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

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
  suggestion: Suggestion | null;
  created_at: string;
}
