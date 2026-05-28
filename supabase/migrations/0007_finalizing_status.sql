-- Phase 4D-fix — allow the new 'finalizing' audit status.
-- Run manually in the Supabase SQL Editor.
--
-- 'finalizing' is a transient state used by the CAS finalize claim
-- (running → finalizing → completed). If audits.status has a CHECK
-- constraint restricting its values, this widens it to include 'finalizing'.
-- If status is plain text with no constraint, the DROP is a no-op and the
-- ADD just documents the allowed set.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'audits'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audits DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE audits
  ADD CONSTRAINT audits_status_check
  CHECK (status IN ('pending', 'running', 'finalizing', 'completed', 'failed'));
