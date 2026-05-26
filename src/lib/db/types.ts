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
  created_at: string;
}
