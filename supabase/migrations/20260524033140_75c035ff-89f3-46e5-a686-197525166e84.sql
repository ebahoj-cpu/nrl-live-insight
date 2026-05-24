-- Add immutable snapshot metadata and full payload preservation fields
ALTER TABLE public.prediction_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_version text NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN IF NOT EXISTS sealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_sealed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snapshot_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS deterministic_payload jsonb,
  ADD COLUMN IF NOT EXISTS simulation_payload jsonb,
  ADD COLUMN IF NOT EXISTS insights_payload jsonb,
  ADD COLUMN IF NOT EXISTS generated_bets jsonb,
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS source_match_insights_key text;

-- Fast lookups for version history and canonical sealed snapshots
CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_match_created
  ON public.prediction_snapshots (match_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_match_kickoff_created
  ON public.prediction_snapshots (match_id, kickoff_utc, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_prediction_snapshots_one_sealed_per_match
  ON public.prediction_snapshots (match_id)
  WHERE is_sealed;

-- Sealed historical predictions are immutable, even for privileged server writes.
CREATE OR REPLACE FUNCTION public.prevent_sealed_prediction_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_sealed THEN
    RAISE EXCEPTION 'sealed prediction snapshot rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_sealed_prediction_snapshot_update ON public.prediction_snapshots;
CREATE TRIGGER prevent_sealed_prediction_snapshot_update
BEFORE UPDATE ON public.prediction_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.prevent_sealed_prediction_snapshot_mutation();

DROP TRIGGER IF EXISTS prevent_sealed_prediction_snapshot_delete ON public.prediction_snapshots;
CREATE TRIGGER prevent_sealed_prediction_snapshot_delete
BEFORE DELETE ON public.prediction_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.prevent_sealed_prediction_snapshot_mutation();