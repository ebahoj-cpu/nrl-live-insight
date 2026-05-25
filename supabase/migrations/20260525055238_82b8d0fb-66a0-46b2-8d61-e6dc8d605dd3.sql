
CREATE TABLE public.user_article_injections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  article_url TEXT NOT NULL,
  article_title TEXT NOT NULL,
  article_source TEXT,
  injected_insight TEXT NOT NULL,
  impact_summary TEXT NOT NULL,
  impact_direction TEXT NOT NULL DEFAULT 'neutral' CHECK (impact_direction IN ('positive','negative','neutral')),
  impact_strength TEXT NOT NULL DEFAULT 'medium' CHECK (impact_strength IN ('low','medium','high')),
  -- Optional numeric perturbations applied by applyUserArticleInjections().
  -- All deltas are clamped server-side at apply time.
  delta_expected_points NUMERIC,
  delta_attack NUMERIC,
  delta_defence NUMERIC,
  delta_tempo NUMERIC,
  delta_player_try_rate NUMERIC,
  affected_team TEXT,
  affected_player TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_article_injections_user_match
  ON public.user_article_injections(user_id, match_id);

ALTER TABLE public.user_article_injections ENABLE ROW LEVEL SECURITY;

-- Only premium users can create injections — backstop in case the server
-- function ever forgets to gate. Uses a SECURITY DEFINER helper so the
-- policy can read the caller's profile.is_premium safely.
CREATE OR REPLACE FUNCTION public.is_premium_user(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_premium FROM public.profiles WHERE id = _user_id), false)
$$;

CREATE POLICY "Users view own injections"
  ON public.user_article_injections
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Premium users insert own injections"
  ON public.user_article_injections
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_premium_user(auth.uid()));

CREATE POLICY "Users delete own injections"
  ON public.user_article_injections
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
