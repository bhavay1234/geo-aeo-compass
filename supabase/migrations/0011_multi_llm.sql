-- Phase 5 — multi-LLM audits.
-- Each query is polled against N LLMs (chatgpt + perplexity + gemini). One
-- poll_results row per (query, llm), keyed off the pre-existing llm_source
-- column. audits.llms_polled records which LLMs the audit asked, so cross-LLM
-- aggregations (consensus, universal-source rank) know the denominator.
-- Run manually in the Supabase SQL Editor.

alter table audits
  add column if not exists llms_polled jsonb default '["chatgpt"]'::jsonb;
-- llms_polled: ["chatgpt","perplexity","gemini"] etc.

-- Backfill any pre-multi-LLM audits so they render sensibly.
update audits set llms_polled = '["chatgpt"]'::jsonb
  where llms_polled is null or llms_polled = '[]'::jsonb;
