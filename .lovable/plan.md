
# Phase 3 — Real NRL.com + Zyla Adapters

## Scope

Build production-safe normalised adapters for NRL.com (primary) and Zyla (enrichment-only), merge them through a Supabase-backed store, and let the simulation feature builder consume the enriched data. Keep the SeasonSnapshot / deterministic path as fallback, keep the UI unchanged, keep the `ENABLE_SIMULATION_ENGINE` flag wiring exactly as is.

Out of scope: pg_cron, Phase 4 modelling (referee/fatigue/edge/momentum), UI changes.

## Source priority

1. NRL.com (truth): fixture identity, kickoff, venue, status, scores, team lists, officials, injuries, timeline.
2. Zyla (enrichment only): player ID hints, fallback ladder, fallback fixtures, supplemental career stats.
3. Supabase `nrl_source_cache` (stale-while-revalidate).
4. SeasonSnapshot / deterministic engine (ultimate fallback).

NRL.com always wins on conflict. Zyla can only fill missing fields. All enriched outputs carry `SourceCoverage`.

## Files

### Created
- `src/server/nrlcom-client.ts` — official adapter emitting `Normalised*` types. Wraps existing `fetchDraw / fetchLadder / fetchMatchDetails` from `nrl.ts` plus team-news/season-stats data; adds new lightweight calls for officials/injuries (from match details `officials` + `team-news` casualty data we already parse).
- `src/server/zyla-client.ts` — enrichment adapter. Wraps existing `fetchZylaLadder / fetchZylaFixtures / fetchZylaMatchDetails`, plus new `getZylaAllPlayers` and `getZylaPlayerStatistics` against endpoints `17262` / `17263` (centralised endpoint config with `// TODO_VERIFY` markers). Reads `ZYLA_NRL_TOKEN` first, then `ZYLA_API_KEY` alias. Returns null safely if no key.
- `src/server/nrl-data-refresh.ts` — orchestrator used by the refresh hook; one function per kind plus a `refreshAll` summariser.
- `src/routes/api/public/hooks/refresh-nrl-data.ts` — POST/GET hook accepting `mode=fixtures|ladder|match|teamlists|injuries|officials|historical|teamstats|playerstats|all`. Returns `{ mode, refreshed, failed, keys, coverageSummary }`. No secrets in response.
- Tests: `src/server/__tests__/nrlcom-client.test.ts`, `zyla-client.test.ts`, `nrl-data-merge.test.ts`, `nrl-data-store.test.ts`, `simulation-feature-builder.enriched.test.ts`.

### Completed (extended in place — no breaking export removals)
- `src/server/nrl-data-types.ts` — add `NormalisedHistoricalMatch`, `notes?: string[]` on `SourceCoverage`, ensure all listed types exist.
- `src/server/source-coverage.ts` — `addNote()`, `withConflictNote()` helpers; tighten `coverageScore` to factor team-list / officials / injuries presence.
- `src/server/nrl-data-merge.ts` — add `mergeMatchDetails`, `mergeTeamLists`, `mergePlayerStats`, `mergeInjuries`, `mergeMatchOfficials`, `mergeHistoricalMatches`, plus reject rules (impossible scores, missing matchId/team, unparsable dates, malformed Zyla shifted-column rows).
- `src/server/nrl-data-store.ts` — add the per-kind getters listed in the prompt; each calls `readWithRefresh` with the right TTL, uses the NRL.com adapter as primary fetcher and the Zyla adapter as enrichment via the merge engine.
- `src/server/simulation-feature-builder.ts` — accept optional enriched bundle (team lists, player stats, injuries, officials) and prefer it over SeasonSnapshot per-field; map injury status → `availabilityProb`; widen coverage `missingFields`; SeasonSnapshot path untouched when bundle absent.
- `src/server/simulation-integration.ts` — pass the enriched bundle into the feature builder when present; downgrade confidence when only cache/Zyla contributed.
- `src/server/index.functions.ts` — in `getMatchInsights`, fetch the enriched bundle from `nrl-data-store` (best-effort, never throws), pass to simulation builder; deterministic path preserved.
- `src/routes/api/public/hooks/precompute-insights.ts` — opportunistically warm `nrl-data-store` (`fixtures`, `ladder`, `teamLists`, `injuries`, `officials`) before precomputing, with all errors swallowed.
- Light touch on `src/server/nrl.ts`, `zyla.ts`, `season-stats.ts`, `team-news.ts` only to expose internal helpers needed by the new adapters (no removed exports).

## Cache TTLs (in `nrl-data-store`)

| Kind | TTL |
|------|-----|
| fixtures (future round) | 6h |
| fixtures (current round, pre-match) | 15m |
| fixtures (live) | 60s |
| fixtures (completed <2h) | 5m |
| fixtures (completed ≥2h) | 24h |
| ladder | 15m on match days, 60m otherwise |
| team lists | 30m → 5m within 24h of kickoff → 2m within 90m |
| injuries | 2h |
| officials | 24h |
| historical | 12h |
| team/player season stats | 6h |

TTL chosen at call time from kickoff/status; no scheduler added in this phase.

## Confidence updates

`coverage.score` increases with: NRL.com primary + named team lists + player stats + officials + injuries + odds + weather. Decreases for: cache-only, Zyla-only, no named squads, stale (>6h) or missing fields, conflict notes, deterministic fallback. `confidence` can only reach `high` when NRL.com is primary AND team lists are named AND player stats are present.

## Tests

Mock `fetch` and `supabaseAdmin`. Cover: NRL.com parsers (draw/match/teamlist/officials/injuries) handling missing fields without throwing; Zyla returning null when no token, rejecting malformed shifted-column fixtures, coercing numeric strings, never logging the token; merge precedence and field-fill behaviour; store fresh/stale/forceRefresh/live-failure paths; feature builder consuming enriched bundles vs. falling back to SeasonSnapshot; integration: `getMatchInsights` returns same shape with and without enriched bundle.

## Verification

`bunx vitest run`, build/typecheck via the harness. Manually verify match page still renders and homepage/ladder unaffected.

## Deliverables in final reply

Files created/modified, test counts, NRL.com vs Zyla fields used, fallback-only fields, source-priority + cache description, simulation enrichment notes, known limitations (Zyla endpoint IDs `17262/17263` marked TODO_VERIFY; injuries/officials parser is best-effort against current NRL.com shape; no pg_cron yet), Phase-3 completion status, and Phase 4 focus (referee tendencies, fatigue from short turnaround, edge attack channels, live game-state, momentum waves).
