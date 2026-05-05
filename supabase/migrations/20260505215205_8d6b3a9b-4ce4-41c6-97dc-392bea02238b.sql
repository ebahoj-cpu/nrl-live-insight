CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.odds_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.odds_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read odds cache" ON public.odds_cache;
CREATE POLICY "Public read odds cache" ON public.odds_cache FOR SELECT USING (true);