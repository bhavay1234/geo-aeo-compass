-- Phase 4E (terminal UI) — "how ChatGPT describes [brand]" verdicts.
-- One gpt-4o-mini 'what is X?' poll per brand, batched in the finalize step.
-- Run manually in the Supabase SQL Editor.

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS brand_verdict text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS competitor_verdicts jsonb DEFAULT '[]'::jsonb;
-- competitor_verdicts: [{ name, domain, verdict }]
