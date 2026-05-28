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

/** A web-search citation returned by gpt-4o-search-preview, classified. */
export interface Citation {
  url: string;
  title: string;
  domain: string;
  source_type: SourceType;
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
  brand_cited: boolean;
  brand_position: number | null;
  competitors_cited: CompetitorCitation[];
  citations: Citation[];
  suggestion: Suggestion | null;
  created_at: string;
}
