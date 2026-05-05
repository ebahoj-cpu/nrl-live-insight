# Timing-Aware Prediction System

No UI redesign. Tabs (Lineups → Stats → Insights → Script → Bets) stay the same. All work is in `src/server/*` and the data the existing components read.

---

## 1. Add a `model_mode` per match

New file `src/server/model-mode.ts`:

```ts
export type ModelMode = "early" | "squad" | "market" | "final";

export function resolveModelMode(args: {
  kickoffUtc: string;
  hasSquads: boolean;        // both squads have ≥13 named players
  hasPlayerOdds: boolean;    // tryscorers.hasAny === true
}): { mode: ModelMode; confidence: "low" | "medium" | "high" };
```

Rules:
- `final` — kickoff in <60 min AND hasSquads.
- `market` — hasPlayerOdds AND hasSquads.
- `squad` — hasSquads only.
- `early` — otherwise.

Confidence: early=low, squad=medium, market=high, final=high.

Surface it on the `Insights` payload so the existing match page can read `insights.modelMode` (and feed it to bets/insights/script renderers without changing layout).

---

## 2. Engine rewrite: gate outputs by mode

Edit `src/server/insights-engine.ts`:

- Accept `mode: ModelMode` in `EngineInputs`.
- **Always compute**: winner, margin (1–12 / 13+), predicted score, total points (over/under against ref line), HT/FT.
- **Tryscorer ranker** (`rankTryscorers`):
  - `early`: return `[]`. Any tryscorer card returns `{ name: "Awaiting team list", … }` with low confidence.
  - `squad`: only allow positions 1–5, 11–14 from named squads; cap at 5 picks; never produce a "first tryscorer" pick (return placeholder).
  - `market`: include odds floor; produce first tryscorer + 1st/2nd/3rd; require player exists in named squad before emitting.
  - `final`: full ranker as today, with stronger weight on live odds.
- Hard rule (added in `considerSquad`): `if (mode !== "early" && squad.length === 0) return;` — never fall back to "all season players" when squads are missing.

Total points formula already matches the brief; reaffirm:
`expected = (avg(home PF, away PA) + avg(away PF, home PA))` then compare to bookie line if present, else season ref line.

Margin: `1–12` if `|projectedMargin| < 13`, else `13+`. No other buckets.

---

## 3. Bet engine: 4 risk tiers, max 8 bets, no duplicates

Replace the current bet-build path inside `src/server/ai-insights.ts` (and any local fallback) with a deterministic builder that consumes the engine output.

New file `src/server/bets-engine.ts`:

```ts
buildBets(engine, odds, mode): BetPlay[]
```

Tier rules:
- `low` (always): Match Winner, Over/Under (2 separate single-leg bets).
- `medium` (always): Margin 1–12 OR 13+ (single bet — never duplicate winner).
- `high` (squad+): up to 3 anytime tryscorers as singles; market mode adds first tryscorer single.
- `ultra` (market/final only): ONE small multi, max 3 legs, picked from existing tier picks (winner + total + 1 tryscorer). No 6-leg defaults.

Cap total bets at 8. Skip any tier whose data isn't available in the current mode (e.g. no high/ultra in `early`).

Each bet carries `legCount`, `hitRateScore` (derived from confidence), and `scriptAlignment` — already in the `BetPlay` type, just populated deterministically.

---

## 4. AI insights: short, structured, never blocking

In `src/server/ai-insights.ts`:

- Pass `mode` + the deterministic engine result into the prompt; instruct the model to **only narrate**, never invent players or markets.
- Replace verbose Insights tab payload with the structure the brief calls for:
  - `prediction`: { winner, margin, total } — pulled straight from engine.
  - `why`: max 3 short lines.
  - `keyStat`: optional single line.
- Keep existing `Insights` type shape so the UI still renders, but populate the heavy fields (`matchOverview`, `gameScript`, etc.) from the engine when AI fails or is skipped.
- Behaviour on AI failure / timeout (already has fallback path): always return a stats-based deterministic payload — never throw, never leave the Insights tab spinning.
- In `early` mode skip the AI call entirely (deterministic-only) — saves time and avoids fabricated tryscorer prose.

---

## 5. Script tab: rebuild around 3 edges

Within the existing `scriptAnalyst` block in `Insights`, repurpose three cards:

- `leftEdge` / `rightEdge` / `middle`, each with `{ advantage: "home" | "away" | "even", why: string, betIdea: string }`.
- Derived deterministically from team `scoringEfficiency`, `triesFor/Against`, ladder, plus tryscorer positions when available. AI just polishes copy.

The Script tab component already reads from `insights.scriptAnalyst`; add the three fields and render them in the existing card shells. No layout change.

---

## 6. Cache + precompute

`src/routes/api/public/hooks/precompute-insights.ts` already exists. Update it to:

- Recompute on data-source changes (squads released, odds released, T-60min).
- Store `modelMode` alongside payload in `match_insights`.
- On read, if cached `modelMode` is older than current resolved mode, regenerate; otherwise serve cached.

Use existing `insightsTtlMs` shape but add a fast-path invalidation when mode advances.

---

## 7. Validation rules wired in one place

Add `src/server/validate-picks.ts`:

- `assertPlayerInSquad(name, squad)` — used by both engine and AI normaliser.
- Strip any AI-returned tryscorer / playmaker name not in the named squad.
- Strip any bet leg whose pick references a stripped player.

This is the single guardrail that satisfies "NEVER suggest players not in lineup".

---

## 8. Files touched

- new: `src/server/model-mode.ts`, `src/server/bets-engine.ts`, `src/server/validate-picks.ts`
- edit: `src/server/insights-engine.ts` (mode gating, tryscorer rules)
- edit: `src/server/ai-insights.ts` (prompt slimming, mode-aware skip, stats fallback, bet builder swap)
- edit: `src/server/normalise-insights.ts` (run pick validator, enforce 8-bet cap, drop duplicate-logic bets)
- edit: `src/server/insights-store.ts` (persist `modelMode`, mode-advance invalidation)
- edit: `src/routes/api/public/hooks/precompute-insights.ts` (trigger on mode change)
- edit: `src/routes/match.$matchId.tsx` — minimal: read `insights.modelMode` to label confidence on the existing badges (no layout change).

---

## 9. Acceptance checks (run after build)

1. Fixture with no squads → mode `early`; bets list contains only Winner + Over/Under + Margin; tryscorer cards show "Awaiting team list".
2. Fixture with squads, no player odds → mode `squad`; tryscorer cards populated only with named squad members; no first tryscorer; ≤8 bets, no multis.
3. Fixture with player odds → mode `market`; first tryscorer + 1st/2nd/3rd present; one ≤3-leg multi appears in `ultra`.
4. Force AI failure (env unset) → Insights tab still renders deterministic copy; no infinite spinner.
5. Spot-check three matches: every player name in bets/tryscorers exists in `homeSquad ∪ awaySquad`.
