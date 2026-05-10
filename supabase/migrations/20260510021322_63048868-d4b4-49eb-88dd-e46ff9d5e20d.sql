ALTER TABLE public.news_model_impacts
ADD COLUMN IF NOT EXISTS timeframe text NOT NULL DEFAULT 'short';

ALTER TABLE public.news_model_impacts
DROP CONSTRAINT IF EXISTS news_model_impacts_timeframe_check;

ALTER TABLE public.news_model_impacts
ADD CONSTRAINT news_model_impacts_timeframe_check
CHECK (timeframe IN ('short','mid','long'));