-- Phase 3.19 — per-query discovered competitors (reuses the single audit-level
-- gpt-4o-mini classification; ZERO extra LLM calls). Run manually in Supabase.

ALTER TABLE poll_results
  ADD COLUMN IF NOT EXISTS discovered_in_query jsonb DEFAULT '[]'::jsonb;
-- per-query subset: [{ domain, label, confidence, source_type }]
