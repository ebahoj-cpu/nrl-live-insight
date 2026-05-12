ALTER TABLE public.simulation_summaries
  ADD COLUMN IF NOT EXISTS model_drivers jsonb,
  ADD COLUMN IF NOT EXISTS calibration jsonb,
  ADD COLUMN IF NOT EXISTS head_to_head jsonb,
  ADD COLUMN IF NOT EXISTS referee_impact jsonb,
  ADD COLUMN IF NOT EXISTS fatigue_profile jsonb,
  ADD COLUMN IF NOT EXISTS ruck_tempo_profile jsonb,
  ADD COLUMN IF NOT EXISTS edge_attack_profile jsonb,
  ADD COLUMN IF NOT EXISTS momentum_profile jsonb,
  ADD COLUMN IF NOT EXISTS advanced_model_version text,
  ADD COLUMN IF NOT EXISTS data_quality jsonb,
  ADD COLUMN IF NOT EXISTS value_edges jsonb,
  ADD COLUMN IF NOT EXISTS market_snapshot jsonb;

ALTER TABLE public.prediction_snapshots
  ADD COLUMN IF NOT EXISTS raw_simulation_prob jsonb,
  ADD COLUMN IF NOT EXISTS calibrated_prob jsonb,
  ADD COLUMN IF NOT EXISTS model_drivers jsonb,
  ADD COLUMN IF NOT EXISTS advanced_model_version text,
  ADD COLUMN IF NOT EXISTS value_edges jsonb,
  ADD COLUMN IF NOT EXISTS market_snapshot jsonb;

ALTER TABLE public.prediction_scores
  ADD COLUMN IF NOT EXISTS calibration_accuracy numeric,
  ADD COLUMN IF NOT EXISTS confidence_bucket text,
  ADD COLUMN IF NOT EXISTS expected_total_error numeric,
  ADD COLUMN IF NOT EXISTS predicted_margin_error numeric,
  ADD COLUMN IF NOT EXISTS score_error numeric;