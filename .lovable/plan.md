## Goal

Upgrade `rankTryscorers` in `src/server/insights-engine.ts` so players are no longer ranked mainly by tries. Layer in attacking-involvement metrics, role-based logic, and a value vs. market score — without replacing the existing system (mode gating, squad validation, position weighting, teamFactor, winnerBoost, blowoutBoost, odds weighting all stay).

## Stat availability audit

I inspected `src/server/season-stats.ts` and the NRL.com match-detail payload used by `src/server/nrl.ts`.

**Available today in `SeasonSnapshot.players` (per player):**
- `tries`
- `firstTries` (opening try of match)
- `firstTeamTries`
- `firstHalfTries`
- `triesPerMatch`
- `position`, `teamNickname`, `jerseyNumber`

**Available at team level (`SeasonSnapshot.teams`):**
- `ppgFor` / `ppgAgainst`, `triesFor` / `triesAgainst`, `scoringEfficiency`
- `htLeadRate`, `htConversionRate`, `last5` form

**Missing (NOT in current snapshot or per-player feed we ingest):**
- line breaks, line-break assists, try assists
- tackle busts, run metres, post-contact metres
- offloads, touches/receipts, kick return metres, support play indicators
- per-player recent-3-game involvements

NRL.com's match-detail JSON exposes per-team aggregate stat groups only — per-player advanced stats are not currently captured anywhere in the codebase. Pulling them would mean a separate scrape (NRL.com player profile pages) which is out of scope for this change.

**Decision:** build the new model so it *uses* advanced metrics if they exist on the player record, and falls back cleanly to the season-stats proxies we already have. That way the formula upgrades automatically the day we add a player-stats fetcher, without another rewrite.

## Changes

### 1. New optional fields on `PlayerSeasonStats`
In `src/server/season-stats.ts`, extend `PlayerSeasonStats` with optional advanced-stat fields (all default to `undefined`, so existing snapshots remain valid):
```
lineBreaks?, lineBreakAssists?, tryAssists?,
tackleBusts?, offloads?, runMetresPerGame?,
postContactMetres?, kickReturnMetres?,
recentTries?, recentInvolvements?  // last 3-5 games
```
No aggregator changes — these stay `undefined` until a future PR wires up a per-player feed. Cache key bumped to `season-snapshot-v2` so old snapshots are rebuilt.

### 2. New attacking-involvement scorer
In `src/server/insights-engine.ts`, add a helper:

```text
attackingInvolvement =
    tries              * 1.0
  + lineBreaks         * 0.75
  + lineBreakAssists   * 0.55
  + tryAssists         * 0.50
  + tackleBusts        * 0.18
  + offloads           * 0.12
  + runMetresScore     * 0.20    // normalised: runMetresPerGame / 100
  + recentFormBoost              // recentTries * 0.6 + recentInvolvements * 0.15
```

When a metric is `undefined`, fall back to the closest proxy we already have:
- `lineBreaks` → `firstHalfTries * 0.5` (first-half tries correlate with line breaks)
- `tryAssists` / `lineBreakAssists` → for halves/hookers, use position rank from `pickTryAssists` as a 0–1 signal
- `tackleBusts` → `triesPerMatch * teamFactor` (volume proxy)
- `runMetresScore` → 0
- `recentFormBoost` → derived from team `last5` plus the player's season `triesPerMatch`

This guarantees the model never collapses to "tries only" but also never invents data.

### 3. Combined base score (keeps every existing multiplier)
```text
baseScore =
    attackingInvolvement
  * positionWeight     // unchanged positionScoringWeight()
  * teamFactor         // unchanged
  * winnerBoost        // unchanged
  * blowoutBoost       // unchanged
+ oddsFloor            // unchanged: +0.6 if anytime price < $8
```

### 4. Role-based logic
After the base score, apply a role gate to clamp/boost specific positions:

- **Wingers / Centres:** prioritise tries + lineBreaks + tackleBusts + teamFactor + odds (small additional `roleBoost = 1.05`).
- **Fullbacks:** weight kickReturnMetres, lineBreaks, tryAssists, supportPlay (proxy: `firstTeamTries`), teamFactor — `roleBoost = 1.05`.
- **Halves (halfback / five-eighth):** down-weight raw tries, up-weight `tryAssists` + `lineBreakAssists`. Apply `triesWeight *= 0.6`, `assistsWeight *= 1.4`.
- **Back-rowers / locks:** only keep top score if (recent tries > 0) OR (lineBreaks/tackleBusts above threshold) OR (price < $9). Otherwise multiply final score by 0.75.
- **Props / hookers:** cap final score at the team's median unless (recentTries ≥ 1) OR (firstTeamTries ≥ 2 — close-range trend) OR (price < $8) OR (middle-dominance script: home team `scoringEfficiency` > 4.5 and projected winner).

### 5. Value scoring vs. market
New helper `valueTag(modelScore, price, rankPos)`:
- High model rank (top 3) **and** price ≤ $4.00 → `"High confidence"`
- High model rank **and** price ≥ $6.00 → `"Speculative value"`
- Mid model rank (4–8) with role/opportunity (winner team OR scoring position) → `"Medium confidence"`
- Default → no tag

Tag is exposed on `EnginePlayerPick` as a new optional `confidence?: "high" | "medium" | "speculative"` field. UI does not need to change — it can render or ignore it.

### 6. New reason text
Replace `buildPlayerReason` with a generator that names the actual signals used. Examples:
- "Named on the wing for Storm — opening-set carries and strong line-break profile keep them on the headline scoring lane."
- "Centre role with recent try involvement and a soft edge matchup against Cowboys' right-side defence."
- "Fullback with support-play upside, kick-return metres and line-break threat in transition."
- "Back-rower value only — edge runner with tackle-bust upside and a price the market is offering."

Each reason picks 2–3 clauses from the metrics that actually contributed most to the score (weighted contribution > 10% of base). When no advanced stats exist, falls back to the current position/role-based reason so output never reads "0 tries, 0 line breaks".

### 7. Preserved guarantees
- Squad validation via `filterToSquad` from `src/server/validate-picks.ts` stays in front of every output array.
- Mode gating untouched: `early` → "Awaiting team list", first tryscorer still locked to `market`/`final`.
- Caps unchanged: `topAnytime` max 5, `topAnytimeHome`/`Away` max 3, `forwardPicks` 2 per team.
- No new network calls, no AI calls.

### 8. Cache invalidation
Bump `src/server/insights-store.ts` cache key from `v18-modes` to `v19-involvement` so existing precomputed payloads regenerate under the new ranker.

## Files touched

- `src/server/insights-engine.ts` — new `attackingInvolvement`, role logic, value tag, reason builder, updated `rankTryscorers` and `RankedRow`.
- `src/server/season-stats.ts` — optional advanced-stat fields on `PlayerSeasonStats`; cache key bump.
- `src/server/insights-store.ts` — cache key bump.

No UI files change.

## Verification I'll run after implementing

1. **Formula** — show the final formula and the fallback chain in a short comment block at the top of `rankTryscorers`.
2. **Available vs missing stats** — print the audit above as code comments next to the new fields.
3. **Fallback behaviour** — describe what happens for a typical 2026 squad today (no advanced stats): the ranker reduces to `tries + firstHalfTries*0.5 + triesPerMatch proxies`, still gated by role logic and odds — measurably different from the old "tries-only" output because halves get assists-weighted and forwards get clamped.
4. **Example output for one match** — pick the next upcoming fixture from `getDraw`, run the engine in `final` mode with mocked odds, and paste the resulting `topAnytime` (5), per-team top 3, and confidence tags.
5. **Squad invariant** — re-run with one squad empty and confirm zero picks for that side.
6. **Mode invariants** — confirm `early` returns placeholders and `squad` returns no first-tryscorer pick.

## Notes / tradeoffs

- Without per-player advanced stats actually flowing in, the immediate behaviour change is driven by role logic + value tagging + better reason text, not the new metric weights. The metric weights become live the moment a future PR adds a player-stats fetcher — no engine rewrite needed.
- If you want the advanced stats actually populated now, that's a separate task (scrape NRL.com per-player profile pages, ~one new fetcher + extra concurrency budget in the snapshot builder). Happy to scope that as a follow-up plan.
