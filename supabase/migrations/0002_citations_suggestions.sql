-- Phase 3.16 — citation capture, per-query suggestions, audit notes & insights.
-- Run manually in the Supabase SQL Editor. Does not edit 0001.

-- Per-query: classified web-search citations + deterministic suggestion.
ALTER TABLE poll_results
  ADD COLUMN IF NOT EXISTS citations jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggestion jsonb DEFAULT NULL;

-- Per-audit: operator's strategic note + aggregate insights rollup.
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS insights jsonb DEFAULT NULL;
