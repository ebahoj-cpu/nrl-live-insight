-- Generic normalised data cache for the new NRL data layer.
-- One row per (kind, key); payload is the normalised JSON shape.
CREATE TABLE public.nrl_source_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind text NOT NULL,           -- 'fixtures' | 'ladder' | 'team_stats' | 'player_stats' | 'team_list' | 'match_result' | 'historical' | 'officials'
  cache_key text NOT NULL,      -- e.g. 'season:2026:round:14' or 'match:20260514001'
  payload jsonb NOT NULL,
  source text NOT NULL,         -- 'nrl.com' | 'zyla' | 'merged' | 'fallback'
  source_coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (kind, cache_key)
);
CREATE INDEX idx_nrl_source_cache_kind_key ON public.nrl_source_cache (kind, cache_key);
CREATE INDEX idx_nrl_source_cache_expires ON public.nrl_source_cache (expires_at);
ALTER TABLE public.nrl_source_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read nrl_source_cache" ON public.nrl_source_cache FOR SELECT USING (true);

-- Cached Monte Carlo simulation summaries per match, per model mode.
CREATE TABLE public.simulation_summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id text NOT NULL,
  season integer,
  round integer,
  home_team text NOT NULL,
  away_team text NOT NULL,
  model_mode text NOT NULL,     -- early | squad | market | final
  iterations integer NOT NULL DEFAULT 10000,
  seed bigint NOT NULL,
  -- Probability summary
  home_win_prob numeric NOT NULL,
  away_win_prob numeric NOT NULL,
  draw_prob numeric NOT NULL,
  expected_total numeric NOT NULL,
  expected_margin numeric NOT NULL,
  margin_band_1_12 numeric NOT NULL,
  margin_band_13_plus numeric NOT NULL,
  upset_prob numeric NOT NULL DEFAULT 0,
  blowout_prob numeric NOT NULL DEFAULT 0,
  -- Full structured payload (markets, fair odds, EV, top-N picks)
  payload jsonb NOT NULL,
  confidence text NOT NULL,     -- low | medium | high
  source_coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (match_id, model_mode)
);
CREATE INDEX idx_simulation_summaries_match ON public.simulation_summaries (match_id);
CREATE INDEX idx_simulation_summaries_season_round ON public.simulation_summaries (season, round);
CREATE INDEX idx_simulation_summaries_expires ON public.simulation_summaries (expires_at);
ALTER TABLE public.simulation_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read simulation_summaries" ON public.simulation_summaries FOR SELECT USING (true);