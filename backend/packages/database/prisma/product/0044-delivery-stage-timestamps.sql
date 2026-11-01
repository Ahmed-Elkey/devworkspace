-- Phase 9 follow-up: add per-stage timestamps to delivery for latency attribution
-- Date: 2026-11-01

BEGIN;

-- Add stage timestamps; existing rows remain NULL until backfilled
ALTER TABLE public.delivery
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_started_at timestamptz;

-- Backfill claimed_at from lease_until for historical completed rows
UPDATE public.delivery d
SET claimed_at = d.lease_until
WHERE d.claimed_at IS NULL
  AND d.lease_until IS NOT NULL
  AND d.completed_at IS NOT NULL;

-- queued_at and worker_started_at are unknown from current schema for historical rows
-- They will be populated by future application code after this migration

COMMIT;
