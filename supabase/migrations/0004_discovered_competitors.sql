-- Phase 3.18 — discovered competitors: unnamed brands ChatGPT cites that the
-- user did not list. Run manually in the Supabase SQL Editor.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS discovered_competitors jsonb DEFAULT '[]'::jsonb;
-- array of { domain, citation_count, queries_seen_in:int,
--            label:'competitor'|'aggregator'|'editorial'|'other',
--            sample_url }
