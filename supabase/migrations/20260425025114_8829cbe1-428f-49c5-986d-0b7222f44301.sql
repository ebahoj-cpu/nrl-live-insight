-- Shared, app-wide cache for AI-generated match insights.
-- One row per match; everyone visiting the app reads the same generated payload.
CREATE TABLE public.match_insights (
  match_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_insights_expires_at ON public.match_insights (expires_at);

-- Public read: any visitor can read the shared analysis
ALTER TABLE public.match_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read of match insights"
  ON public.match_insights
  FOR SELECT
  USING (true);

-- Writes are server-only via service role (bypasses RLS) — no insert/update/delete policy needed.