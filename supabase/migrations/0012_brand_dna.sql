-- Phase 6 — Brand DNA (scrape-derived brand profile + auto-picked queries).
-- Applied via Supabase MCP connector on 2026-07-03.
alter table audits
  add column if not exists brand_dna jsonb default null;
-- brand_dna: { brand_name, domain, positioning, category, products[], audience, seed_phrases[] }
