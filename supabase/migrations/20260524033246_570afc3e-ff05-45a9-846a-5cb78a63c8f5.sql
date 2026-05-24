ALTER TABLE public.prediction_snapshots
  DROP CONSTRAINT IF EXISTS prediction_snapshots_match_id_key;

CREATE INDEX IF NOT EXISTS idx_prediction_snapshots_match_version_created
  ON public.prediction_snapshots (match_id, snapshot_version, created_at DESC);