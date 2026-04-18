
The user reaffirmed the same token string. I cannot test it from chat mode (read-only), but I can plan the build and verify the token via a server function as the very first implementation step. If the token still 401s in default mode, I'll surface "Live data unavailable" everywhere and stop — per the no-fake-data rule.

## Plan: Build LINEBREAK – NRL Betting Insights

### Step 1 — Verify ZylaLabs token (first thing in default mode)
- Hit `/5577/fixture?season=2026&round=1`, `/5576/ladder?season=2026`, `/5578/match+details?match_id=...` from a server function with `Authorization: Bearer $ZYLA_NRL_TOKEN`.
- Try a few base URLs (`zylalabs.com/api/...`) and document the working shape.
- If still 401: stop and report back. No mock data.

### Step 2 — Server functions (all in `src/server/`)
Each uses 15-min in-memory cache + manual bypass via `?refresh=1`:
- `getCurrentRound()` — derives round from today using NZ time + fixture probing. Auto-rolls Sun 23:59 Pacific/Auckland.
- `getFixtures(round)` — Zyla `/5577/fixture`.
- `getMatchDetails(matchId)` — Zyla `/5578/match+details`.
- `getLadder()` — Zyla `/5576/ladder`.
- `getOdds()` — The Odds API `americanfootball_nrl` / `rugbyleague_nrl` H2H. Cached, refreshed on demand.
- `getTeamAssets(teamName)` — TheSportsDB lookup for logo (free tier OK for logos via team search).
- `getPlayerHeadshot(playerName, teamId)` — TheSportsDB; falls back to initial avatar.
- `generateBettingInsights(matchData)` — Lovable AI Gateway (`google/gemini-2.5-flash`) with structured JSON schema: predicted score, win %, O/U, HT/FT, anytime try scorers, first try scorer — each with reasoning + confidence.

All return `{ data, error }`. UI shows "Live data unavailable" on error. No partial fakery.

### Step 3 — Routes
```text
src/routes/
  __root.tsx          # Header + QueryClientProvider + refresh button (top-right)
  index.tsx           # Current round fixtures
  match.$matchId.tsx  # Full match analytics
```

### Step 4 — Homepage (`/`)
- Header: LINEBREAK logo, "Round X", refresh button (top-right, triggers re-fetch + odds refresh).
- Grid of match cards: team logos, names, kickoff time (NZ), venue, weather (icon/temp/wind from match details), H2H odds, "Updated Xm ago".
- Card → `/match/$matchId`.

### Step 5 — Match page (`/match/$matchId`)
1. **Header** — teams, logos, venue, weather, odds, last updated.
2. **Team Lists** — current squad from match details, side-by-side, key outs flagged.
3. **Stats** — W/L, last 5, PF/PA, H2H (from ladder + recent fixtures).
4. **Game Script** — AI-generated tactical breakdown.
5. **Betting Insights** — AI predictions with reasoning + confidence %.

### Step 6 — Refresh system
- Top-right refresh button in `__root.tsx` calls `queryClient.invalidateQueries()`.
- Auto-refetch on app open + route change (TanStack Query `refetchOnMount`).
- 15-min stale time.

### Step 7 — Validation guards
Before render: assert team names are in the canonical 17-team NRL list. Drop/error otherwise.

### Step 8 — UI / Theme
- Black `#0A0A0A`, white, grey scale, accent green `#00D26A`.
- Tailwind v4 tokens in `src/styles.css`. Mobile-first. Premium typography (Inter / SF-style stack).
- Loading skeletons; error states say "Live data unavailable".

### Tech notes
- Need to add **`ODDS_API_KEY`** secret too (already present per secrets list ✓).
- `LOVABLE_API_KEY` for AI Gateway ✓.
- TheSportsDB logos work on free tier (`key=3` test key) — no secret needed for logo lookups.
- All Zyla/Odds/AI calls server-only; tokens never reach the browser.

### Open question
The `13463|TIO94...` string you pasted is identical to the token from earlier when probing returned 401 Unauthenticated. Two possibilities:
1. The token is correct but Zyla's plan needed reactivating (which you did) — it'll now work.
2. The token format `<id>|<secret>` is wrong and Zyla actually expects only the part after `|`.

I'll test both formats in Step 1. If both 401, I'll stop and ask you to paste the exact `curl` command (including headers) from the Zyla "Test Endpoint" page so I can match it byte-for-byte.

### Files I'll create
```text
src/server/zyla.ts
src/server/odds.ts
src/server/sportsdb.ts
src/server/ai-insights.ts
src/server/cache.ts
src/server/round.ts
src/server/index.functions.ts   # all createServerFn wrappers
src/lib/teams.ts                # canonical NRL team list + name normalization
src/components/MatchCard.tsx
src/components/TeamLogo.tsx
src/components/PlayerCard.tsx
src/components/RefreshButton.tsx
src/components/WeatherBadge.tsx
src/components/OddsDisplay.tsx
src/components/InsightCard.tsx
src/routes/__root.tsx           # update
src/routes/index.tsx            # replace
src/routes/match.$matchId.tsx   # new
src/styles.css                  # theme tokens
```

Approve and I'll start with the token verification, then build top-to-bottom.
