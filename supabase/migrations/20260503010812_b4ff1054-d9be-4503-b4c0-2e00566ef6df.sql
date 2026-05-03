CREATE TABLE IF NOT EXISTS public.match_aftermatch (
  match_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.match_aftermatch ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read of match aftermatch"
ON public.match_aftermatch
FOR SELECT
USING (true);

CREATE INDEX IF NOT EXISTS match_aftermatch_generated_at_idx
ON public.match_aftermatch (generated_at DESC);