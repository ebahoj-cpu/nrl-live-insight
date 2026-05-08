CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  base_url text := 'https://project--74ebdc8e-deaf-40ed-ab5a-fa30c4277ca5.lovable.app';
BEGIN
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname IN (
    'precompute-insights-team-list-drop',
    'precompute-insights-hourly',
    'precompute-insights-pregame'
  );

  PERFORM cron.schedule(
    'precompute-insights-team-list-drop',
    '0 6 * * 2',
    format($job$SELECT net.http_get(url := %L)$job$, base_url || '/api/public/hooks/precompute-insights')
  );

  PERFORM cron.schedule(
    'precompute-insights-hourly',
    '15 * * * 2,3,4,5,6,0',
    format($job$SELECT net.http_get(url := %L)$job$, base_url || '/api/public/hooks/precompute-insights')
  );

  PERFORM cron.schedule(
    'precompute-insights-pregame',
    '*/15 * * * 4,5,6,0',
    format($job$SELECT net.http_get(url := %L)$job$, base_url || '/api/public/hooks/precompute-insights')
  );
END $$;

-- Force immediate regeneration so current Round 10 picks reflect latest team lists.
DELETE FROM public.match_insights WHERE match_id LIKE '2026/round-10/%';