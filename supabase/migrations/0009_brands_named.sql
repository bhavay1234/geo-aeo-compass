-- Phase 4F — separate BRANDS NAMED (products ChatGPT recommends in prose) from
-- CITED SOURCES (the domain rail). brands_named is the real competitor signal;
-- cited domains stay the "where ChatGPT sourced this / get listed" signal.
-- LLM-extracted per query in the enrich step. Run manually in the SQL Editor.

ALTER TABLE poll_results
  ADD COLUMN IF NOT EXISTS brands_named jsonb DEFAULT '[]'::jsonb;
-- brands_named: ["The Parcel Tracker", "17TRACK", ...]  (excludes the audited brand)
