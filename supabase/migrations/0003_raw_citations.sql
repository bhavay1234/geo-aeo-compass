-- Phase 3.17 — faithful inline citations + full answer text + uncited mention flags.
-- Run manually in the Supabase SQL Editor. Does not edit 0001/0002.

ALTER TABLE poll_results
  -- ordered, un-deduped inline citations w/ anchor text + source_type
  ADD COLUMN IF NOT EXISTS raw_citations jsonb DEFAULT '[]'::jsonb,
  -- complete answer text (not truncated to 5000 like raw_response)
  ADD COLUMN IF NOT EXISTS full_response text DEFAULT NULL,
  -- brand name appears in the answer text but brand_cited is false
  ADD COLUMN IF NOT EXISTS brand_mentioned_uncited boolean DEFAULT false,
  -- competitor names found in the answer text but not in competitors_cited
  ADD COLUMN IF NOT EXISTS competitors_mentioned_uncited jsonb DEFAULT '[]'::jsonb;
