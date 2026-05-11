// Deterministic bet builder. Replaces the ad-hoc 6-leg multi system.
//
// 4 risk tiers, gated by ModelMode, capped at 8 total bets.
//   low    → Match Winner + Over/Under          (always)
//   medium → Margin 1-12 / 13+                  (always)
//   high   → Anytime tryscorers (squad+),
//            First tryscorer (market+)
//   ultra  → ONE small multi, max 3 legs        (market/final only)

import type { DeterministicInsights } from "./insights-engine";
import type { ModelMode } from "./model-mode";
import type { RealOdds } from "./ai-insights";
import type { BetPlay, BetLeg } from "./ai-insights";
import type { SimulationSummary } from "./simulation-types";

const MAX_BETS = 8;

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

function combine(legs: BetLeg[]): number {
  return legs.reduce((acc, l) => acc * (l.decimalOdds || 1), 1);
}

function play(args: {
  category: BetPlay["category"];
  title: string;
  legs: BetLeg[];
  reasoning: string;
  hitRateScore: number;
  scriptAlignment: string;
}): BetPlay {
  const combined = combine(args.legs);
  const stake = 10;
  return {
    category: args.category,
    title: args.title,
    legs: args.legs,
    combinedOdds: Number(combined.toFixed(2)),
    estimatedOdds: fmtPrice(combined),
    stake: `$${stake}`,
    potentialReturn: `$${(stake * combined).toFixed(2)}`,
    reasoning: args.reasoning,
    hitRateScore: args.hitRateScore,
    scriptAlignment: args.scriptAlignment,
    legCount: args.legs.length,
  };
}

export function buildDeterministicBets(args: {
  engine: DeterministicInsights;
  realOdds?: RealOdds | null;
  homeNickname: string;
  awayNickname: string;
  mode: ModelMode;
  // Optional Phase 2 simulation. When confidence is "low" we suppress the
  // first-tryscorer leg. When "high" we re-order anytime picks by simulated
  // anytime probability (only among players already deemed eligible by the
  // deterministic engine — never invents a player not in the named squads).
  simulation?: SimulationSummary | null;
}): BetPlay[] {
  const { engine, realOdds, homeNickname, awayNickname, mode, simulation } = args;
  const winnerNick = engine.matchWinner.nickname;
  const winnerIsHome = winnerNick.toLowerCase() === homeNickname.toLowerCase();
  const winnerPrice = (winnerIsHome ? realOdds?.h2h.home?.price : realOdds?.h2h.away?.price) ?? 1.85;
  const totalLine = engine.totalPoints.line;
  const totalLean = engine.totalPoints.lean;
  const totalPrice =
    (totalLean === "over" ? realOdds?.totals[0]?.over : realOdds?.totals[0]?.under) ?? 1.91;
  const marginPrice = engine.margin.bucket === "1-12" ? 1.85 : 2.6;

  const bets: BetPlay[] = [];

  // ---- LOW: Match winner ----
  bets.push(
    play({
      category: "low",
      title: `${winnerNick} to Win`,
      legs: [{ pick: `${winnerNick} to win`, decimalOdds: winnerPrice }],
      reasoning: engine.matchWinner.reasoning,
      hitRateScore: mode === "early" ? 60 : 72,
      scriptAlignment: "head-to-head",
    }),
  );

  // ---- LOW: Over/Under ----
  bets.push(
    play({
      category: "low",
      title: `${totalLean === "over" ? "Over" : "Under"} ${totalLine}`,
      legs: [{ pick: `${totalLean === "over" ? "Over" : "Under"} ${totalLine} total points`, decimalOdds: totalPrice }],
      reasoning: engine.totalPoints.reasoning,
      hitRateScore: mode === "early" ? 58 : 68,
      scriptAlignment: "total-points",
    }),
  );

  // ---- MEDIUM: Margin (no duplicate winner) ----
  bets.push(
    play({
      category: "medium",
      title: `${winnerNick} ${engine.margin.bucket}`,
      legs: [{ pick: `${winnerNick} to win by ${engine.margin.bucket}`, decimalOdds: marginPrice }],
      reasoning: engine.margin.reasoning,
      hitRateScore: engine.margin.bucket === "1-12" ? 55 : 42,
      scriptAlignment: "winning-margin",
    }),
  );

  // ---- HIGH: tryscorer-driven (squad+) ----
  if (mode !== "early") {
    let anytime = (engine.topAnytime || []).filter((p) => p.name && p.name !== "Awaiting team list");

    // If we have a high-confidence simulation, re-order anytime picks by the
    // simulator's per-player anytime probability. Players the deterministic
    // engine never surfaced are NEVER added — keeps named-squad invariant.
    if (simulation && simulation.confidence === "high") {
      const probByName = new Map<string, number>();
      for (const p of simulation.playerProbabilities) probByName.set(p.name.toLowerCase(), p.anytimeProb);
      anytime = [...anytime].sort((a, b) => (probByName.get(b.name.toLowerCase()) ?? 0) - (probByName.get(a.name.toLowerCase()) ?? 0));
    }

    const limit = mode === "squad" ? 2 : 3;
    for (const pick of anytime.slice(0, limit)) {
      const price = pick.price ?? 3.5;
      bets.push(
        play({
          category: "high",
          title: `${pick.name.split(" ").pop()} Anytime Try`,
          legs: [{ pick: `${pick.name} to score anytime`, decimalOdds: price }],
          reasoning: pick.reasoning,
          hitRateScore: mode === "squad" ? 38 : 46,
          scriptAlignment: "anytime-tryscorer",
        }),
      );
      if (bets.length >= MAX_BETS) return bets;
    }

    // First tryscorer only once odds exist AND simulation isn't low-confidence.
    const simBlocksFirstTry = simulation && simulation.confidence === "low";
    if (!simBlocksFirstTry && (mode === "market" || mode === "final") && engine.firstTryscorer?.name && engine.firstTryscorer.name !== "Awaiting team list") {
      const fp = engine.firstTryscorer;
      const price = fp.price ?? 9;
      bets.push(
        play({
          category: "high",
          title: `${fp.name.split(" ").pop()} First Try`,
          legs: [{ pick: `${fp.name} to score first`, decimalOdds: price }],
          reasoning: fp.reasoning,
          hitRateScore: 22,
          scriptAlignment: "first-tryscorer",
        }),
      );
      if (bets.length >= MAX_BETS) return bets;
    }
  }

  // ---- ULTRA: small multi (market/final only, max 3 legs) ----
  if ((mode === "market" || mode === "final") && bets.length < MAX_BETS) {
    const legs: BetLeg[] = [
      { pick: `${winnerNick} to win`, decimalOdds: winnerPrice },
      { pick: `${totalLean === "over" ? "Over" : "Under"} ${totalLine} total points`, decimalOdds: totalPrice },
    ];
    const topAnytime = (engine.topAnytime || []).filter((p) => p.name && p.name !== "Awaiting team list")[0];
    if (topAnytime) legs.push({ pick: `${topAnytime.name} to score anytime`, decimalOdds: topAnytime.price ?? 3.5 });
    bets.push(
      play({
        category: "ultra",
        title: `${winnerNick} Script Multi`,
        legs,
        reasoning: `Three correlated legs: ${winnerNick} controlling the contest, the projected total, and ${legs.length === 3 ? `${topAnytime!.name.split(" ").pop()} on the scoring side of the script` : "the scoreboard pace"}.`,
        hitRateScore: 28,
        scriptAlignment: "correlated-script",
      }),
    );
  }

  return bets.slice(0, MAX_BETS);
}
