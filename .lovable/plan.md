
# Scout Intelligence Rebuild — Backend Only

**Hard constraint: zero UI changes.** `src/routes/scout.tsx` is not touched. The chat shell, layout, animations, Composer, bubbles, image, and styling stay byte-for-byte identical. Only `src/server/scout.functions.ts` (the RPC entrypoint that the UI calls) keeps its exported `scoutChat` signature — internals get replaced.

## Goal

Replace the current free-form prompt-stuffed Scout with a deterministic orchestration layer that:

1. Builds a typed **ScoutMatchContext** per fixture from existing engines (sim, calibration, value, correlation, fatigue, ruck/tempo, edge attack, momentum, referee, fair-odds, staking).
2. Feeds the LLM only that structured bundle (no raw HTML, no hallucinated stats).
3. Enforces a fixed reasoning format: **Direct answer → Why (2–3 drivers) → Confidence → Value → Risk**.
4. Supports **session-scoped news injections** (e.g. "Broncos lose halfback") that re-run a lightweight `simulateWithModifiers` pass without ever touching stored sim/insight data.
5. Exposes calibrated EV / edge / Kelly-sized stake recommendations using the existing `staking-model.ts` and `correlation-guard.ts`. Emits "No positive edge detected." when EV ≤ 0.
6. Caches match bundles aggressively (warm reuse < 800ms target).

## New files

```
src/server/scout/
├── scout-contracts.ts     // Zod schemas + TS types: ScoutMatchContext,
│                          //    NewsModifier, ScoutTurnInput, ScoutBetSuggestion
├── scout-service.ts       // buildMatchContext(matchId), getOrBuildContext (cached),
│                          //    simulateWithModifiers(matchId, modifiers)
├── scout-memory.ts        // Per-session in-memory store of active news modifiers
│                          //    keyed by a session id derived from message history hash.
│                          //    TTL 30min, capped, never persisted.
├── scout-reasoning.ts     // Pure functions: pickTopDrivers, formatConfidence,
│                          //    formatValueLine, formatRiskWarning,
│                          //    parseNewsInjection(userText) → NewsModifier|null
└── scout-functions.ts     // NEW slim createServerFn export: orchestrates
                           //   parse → resolve fixtures → build/refresh context
                           //   → ask LLM with structured system prompt + bundle
                           //   → post-validate (no fabricated numbers leak through)
```

`src/server/scout.functions.ts` becomes a thin re-export of `scout/scout-functions.ts` so the UI import path is unchanged.

## ScoutMatchContext shape (excerpt)

```ts
type ScoutMatchContext = {
  match: { id, kickoffUtc, venue, homeNick, awayNick, status }
  simulation: {
    iterations, expectedHome, expectedAway, expectedTotal,
    homeWinProb, awayWinProb, drawProb,
    marginBands: { "1-12": number, "13+": number },
    overProbAtLine, totalLine,
    htftProbs: { HH, HA, AH, AA, draws },
    playerProbabilities: PlayerProbability[]   // anytime/first/multi
  }
  calibration: { applied: boolean, method, blendWeight }
  confidence: { tier: "low"|"medium"|"high", reasons: string[] }
  drivers: ModelDriver[]                        // top 5 from existing engines
  profiles: { referee?, fatigue?, ruckTempo?, edgeAttack?, momentum? }
  market: { homeWin?, awayWin?, ... , anytime?, firstTry?, multiTry? }
  value: ValuePick[]                            // sorted, EV>0 only at top
  correlationWarnings: string[]
  modifiersApplied: NewsModifier[]              // empty when no injections
  dataGaps: string[]                            // explicit "missing market X"
}
```

## News injection flow

1. `parseNewsInjection(userText)` detects patterns like "X loses Y", "Y ruled out", "rain expected at <venue>", "Z named on bench", returning a typed `NewsModifier` or `null`.
2. Modifier is saved in `scout-memory` against the session id.
3. Next time `getOrBuildContext` runs for an affected match it calls `simulateWithModifiers`, which:
   - Loads the cached `SimulationSummary` (does not re-run the full 10k engine).
   - Applies bounded multiplicative deltas to home/away expected points, tempo, attack shape, and per-player try rates.
   - Recomputes derived probs (winner, margin bands, totals over/under, htft, anytime) deterministically from the perturbed expectations.
   - Marks `simulation.iterations = 0` reused, sets `modifiersApplied`, and adds a `dataGaps` note if confidence drops a tier.
4. Modifiers expire when session memory expires; they never reach `insights-store` or `odds-store`.

## Reasoning + tone enforcement

`scout-functions.ts` builds the LLM prompt as:

- **System**: persona rules (calm, sharp, analytical, no "lock"/"guaranteed"/"free money", no team bias, responsible-betting reminder when bets are surfaced), the required 5-section response shape, and an explicit instruction to refuse fabrication ("If a value is missing from the bundle, say 'Current data unavailable for this market.'").
- **User**: the JSON `ScoutMatchContext` (compacted, no nulls), the active modifiers, and the user's question.
- **Validator**: regex/keyword post-check strips disallowed phrases and inserts the responsible-betting line whenever a `ScoutBetSuggestion` appears.

Bet suggestions always include: implied prob, model prob, edge %, Kelly stake (via `recommendStake` from `staking-model.ts`), confidence tier. Suppressed by `correlation-guard` when stacked.

## Caching / performance

- `getOrBuildContext(matchId)` wraps `cached(...)` with `CTX_TTL = 5 min`.
- Sub-pieces (sim summary, calibration, drivers) reuse existing per-engine caches; we never re-fetch within a turn.
- LLM call uses `google/gemini-2.5-flash` (fast tier) by default with `gemini-2.5-pro` fallback only on parsing failure.

## Safety / guards preserved

- Honors existing `ENABLE_SIMULATION_ENGINE` flag — if disabled, falls back to the deterministic path and labels confidence "low".
- All numeric fields in the bundle come from existing engines; the LLM is never asked to compute probabilities.
- `simulateWithModifiers` clamps deltas (|Δ| ≤ 0.15 on attack/tempo, ≤ 0.25 on per-player try rate) so a single news line can't flip a market.

## Tests (`src/server/scout/__tests__/`)

- `news-modifiers.test.ts` — parse + clamp + applied to expected points.
- `simulate-with-modifiers.test.ts` — deterministic seed reproducibility, no DB writes.
- `calibration-blend.test.ts` — uses fixture `SimulationSummary`, verifies blend weight applied.
- `correlation-suppression.test.ts` — overlapping selections downgraded.
- `staking.test.ts` — re-asserts EV ≤ 0 → 0 stake, capped-by-confidence path.
- `missing-data.test.ts` — bundle returns `dataGaps`, prompt forbids fabrication.
- `deterministic-fallback.test.ts` — sim disabled → confidence=low, structured response still emitted.
- `match-bundle-cache.test.ts` — second build within TTL hits cache, no engine re-entry.

## Out of scope

- No UI/route/component edits.
- No schema/migration changes.
- No new pages, no new public API routes.
- Existing `scout.functions.ts` cron/insights/news web-search helpers are kept where reused; dead helpers are removed only if nothing else imports them.

## Risks

- The current `scout.functions.ts` is 954 lines and shares helpers with other modules — refactor preserves all currently exported symbols.
- `simulateWithModifiers` is an analytic perturbation, not a re-run; documented clearly in code and in the bundle (`simulation.method = "perturbed"`).

After approval I'll implement file-by-file, starting with `scout-contracts.ts` and the memory/reasoning pure modules, then service, then the new `scout-functions.ts` orchestrator, then tests.
