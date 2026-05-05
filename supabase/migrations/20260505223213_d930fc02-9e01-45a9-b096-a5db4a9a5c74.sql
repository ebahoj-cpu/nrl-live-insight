
-- prediction_snapshots: locked pre-kickoff predictions
CREATE TABLE public.prediction_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  round INTEGER,
  season INTEGER,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  kickoff_utc TIMESTAMPTZ,
  model_mode TEXT NOT NULL,
  predicted_winner TEXT,
  predicted_margin_band TEXT,
  predicted_total_lean TEXT,
  predicted_total_line NUMERIC,
  predicted_htft TEXT,
  predicted_score_home INTEGER,
  predicted_score_away INTEGER,
  first_try_pick TEXT,
  anytime_try_picks JSONB NOT NULL DEFAULT '[]'::jsonb,
  secondary_tier_picks JSONB NOT NULL DEFAULT '[]'::jsonb,
  script_prediction JSONB,
  confidence_scores JSONB,
  odds_snapshot JSONB,
  data_sources JSONB,
  locked_before_kickoff BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prediction_snapshots_round ON public.prediction_snapshots(season, round);

-- prediction_results: actual outcomes
CREATE TABLE public.prediction_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  actual_winner TEXT,
  actual_margin_band TEXT,
  actual_total_points INTEGER,
  actual_total_result TEXT,           -- 'over' | 'under' relative to snapshot line
  actual_htft TEXT,
  actual_score_home INTEGER,
  actual_score_away INTEGER,
  actual_first_try_scorer TEXT,
  actual_try_scorers JSONB NOT NULL DEFAULT '[]'::jsonb,
  actual_try_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  team_stats JSONB,
  player_stats JSONB,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- prediction_scores: per-category scoring
CREATE TABLE public.prediction_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  winner_correct BOOLEAN,
  margin_correct BOOLEAN,
  total_correct BOOLEAN,
  htft_correct BOOLEAN,
  first_try_correct BOOLEAN,
  anytime_hits INTEGER NOT NULL DEFAULT 0,
  anytime_checked INTEGER NOT NULL DEFAULT 0,
  anytime_hit_rate NUMERIC,
  secondary_hits INTEGER NOT NULL DEFAULT 0,
  secondary_checked INTEGER NOT NULL DEFAULT 0,
  script_accuracy NUMERIC,            -- 0..1 fraction of script dimensions correct
  team_market_score NUMERIC,          -- 0..1 (winner+margin+total+htft)
  player_market_score NUMERIC,        -- 0..1 (first + anytime + secondary)
  total_model_score NUMERIC,          -- 0..1 weighted overall
  risk_tier TEXT,                     -- low/medium/high based on model_mode
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- model_lessons: structured carry-forward signals
CREATE TABLE public.model_lessons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id TEXT NOT NULL,
  category TEXT NOT NULL,             -- 'winner' | 'margin' | 'total' | 'htft' | 'first_try' | 'anytime' | 'script' | 'overall'
  lesson TEXT NOT NULL,
  adjustment_signal TEXT,             -- 'increase' | 'decrease' | 'hold'
  confidence_impact NUMERIC NOT NULL DEFAULT 0, -- -1..+1 nudge for future confidence
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_model_lessons_category ON public.model_lessons(category, created_at DESC);
CREATE INDEX idx_model_lessons_match ON public.model_lessons(match_id);

-- RLS: public read, server-only write (service role bypasses RLS)
ALTER TABLE public.prediction_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_scores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_lessons        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read prediction_snapshots" ON public.prediction_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read prediction_results"   ON public.prediction_results   FOR SELECT USING (true);
CREATE POLICY "Public read prediction_scores"    ON public.prediction_scores    FOR SELECT USING (true);
CREATE POLICY "Public read model_lessons"        ON public.model_lessons        FOR SELECT USING (true);
