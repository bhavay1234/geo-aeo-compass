-- Phase 4G — citation-source analysis + "why cited".
-- Brand-presence (Part 1) and the Citations tab (Part 2) are fast (plain fetch);
-- the "why cited" factors + own-page check (Parts 3-4) are Apify-powered and run
-- in a separate citations queue stage, populating progressively.
-- Run manually in the Supabase SQL Editor.

-- URL-keyed cache of brand-agnostic page signals — avoids re-fetch / re-Apify.
-- Re-runs within 7 days reuse rows by url (and by root_domain for the own crawl).
create table if not exists citation_pages (
  url           text primary key,
  root_domain   text,
  http_status   int,
  title         text,
  h1            text,
  word_count    int default 0,
  schema_types  jsonb default '[]'::jsonb,
  has_meta_desc boolean default false,
  has_canonical boolean default false,
  page_type     text,                       -- 'dedicated' | 'blog' | 'other'
  text_sample   text,                       -- truncated lowercased text for brand/query matching
  analyzed_via  text,                       -- 'fetch' | 'apify'
  fetched_at    timestamptz default now()
);
create index if not exists citation_pages_domain_idx on citation_pages (root_domain);

-- Audit-level rollup for the Citations tab + headline, and a progress flag.
alter table audits
  add column if not exists citation_analysis jsonb default '[]'::jsonb,
  add column if not exists citation_status   text default null;  -- null | 'analyzing' | 'done'
-- citation_analysis: [{ url, domain, source_type, query_count, brand_present, match_type }]

-- Per-query "why cited" (vendor/competitor sources) + our own relevant page.
alter table poll_results
  add column if not exists why_cited jsonb default '[]'::jsonb,
  add column if not exists own_page  jsonb default null;
-- why_cited: [{ brand, url, domain, factors:{on_page_targeting,content_depth,schema_richness,page_type,domain_freq}, verdict }]
-- own_page:  { exists, url, page_type, schema_types, word_count, on_page_targeting }
