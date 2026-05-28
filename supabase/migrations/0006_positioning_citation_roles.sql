-- Phase 4D — positioning-aware suggestions + per-citation role judgments.
-- Run manually in the Supabase SQL Editor before deploy.

-- Inferred brand positioning (one gpt-4o-mini call per audit). Honest caveat:
-- inferred from queries + answer excerpts, not a homepage scrape.
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS positioning text DEFAULT NULL;

-- Per-query LLM judgment of each cited domain's role (competitor|source|unsure),
-- rides on the per-query suggestion call. Stored so reclassification is
-- recomputable. poll_results.suggestion is already jsonb — its `action` string
-- is replaced with the LLM text (situation/severity/evidence preserved).
ALTER TABLE poll_results
  ADD COLUMN IF NOT EXISTS citation_roles jsonb DEFAULT '[]'::jsonb;
