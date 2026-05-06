CREATE TABLE public.news_model_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  source text,
  published_at timestamptz,
  teams_affected jsonb NOT NULL DEFAULT '[]'::jsonb,
  players_affected jsonb NOT NULL DEFAULT '[]'::jsonb,
  fixtures_affected jsonb NOT NULL DEFAULT '[]'::jsonb,
  impact_type text NOT NULL CHECK (impact_type IN ('positive','negative','neutral')),
  impact_area text NOT NULL,
  impact_strength text NOT NULL DEFAULT 'low' CHECK (impact_strength IN ('low','medium','high')),
  model_adjustment text,
  adjustment_summary text,
  added_by_user boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.news_model_impacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read news_model_impacts" ON public.news_model_impacts FOR SELECT USING (true);
CREATE INDEX idx_news_model_impacts_active ON public.news_model_impacts (active, expires_at);
CREATE INDEX idx_news_model_impacts_article ON public.news_model_impacts (article_id);