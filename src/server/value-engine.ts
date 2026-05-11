// ============================================================================
// Value engine.
//
// Compares simulation probabilities against (optional) market odds to surface
// betting value. Produces ranked picks per market with EV and edge strength.
// Suppresses noise via the fair-odds engine's confidence-aware filter.
// ============================================================================

import type { SimulationSummary, PlayerProbability } from "./simulation-types";
import { summariseEdge, type EdgeSummary } from "./fair-odds";
import type { ConfidenceTier } from "./confidence";

export type MarketKind =
  | "match_winner"
  | "margin"
  | "totals"
  | "anytime_tryscorer"
  | "first_tryscorer"
  | "multi_tryscorer";

export type ValuePick = {
  market: MarketKind;
  selection: string;
  modelProb: number;
  edge: EdgeSummary;
  rationale: string;
};

export type MarketPrices = {
  homeWin?: number;
  awayWin?: number;
  drawPrice?: number;
  marginHome112?: number;
  marginHome13Plus?: number;
  marginAway112?: number;
  marginAway13Plus?: number;
  overAtLine?: number;
  underAtLine?: number;
  // Player markets keyed by lowercased player name.
  anytime?: Record<string, number>;
  firstTry?: Record<string, number>;
  multiTry?: Record<string, number>;
};

const MIN_PLAYER_PROB = 0.08;     // suppress player picks under 8%

export function buildValuePicks(args: {
  sim: SimulationSummary;
  prices: MarketPrices;
  confidence: ConfidenceTier;
  homeNickname: string;
  awayNickname: string;
}): ValuePick[] {
  const { sim, prices, confidence, homeNickname, awayNickname } = args;
  const picks: ValuePick[] = [];

  // ---- Match winner ----
  picks.push({
    market: "match_winner",
    selection: `${homeNickname} to win`,
    modelProb: sim.homeWinProb,
    edge: summariseEdge(sim.homeWinProb, prices.homeWin ?? null, { confidence }),
    rationale: `Sim wins ${(sim.homeWinProb * 100).toFixed(0)}% of iterations`,
  });
  picks.push({
    market: "match_winner",
    selection: `${awayNickname} to win`,
    modelProb: sim.awayWinProb,
    edge: summariseEdge(sim.awayWinProb, prices.awayWin ?? null, { confidence }),
    rationale: `Sim wins ${(sim.awayWinProb * 100).toFixed(0)}% of iterations`,
  });

  // ---- Margin (winner-side splits) ----
  const winnerIsHome = sim.homeWinProb >= sim.awayWinProb;
  const winnerNick = winnerIsHome ? homeNickname : awayNickname;
  const m112 = sim.marginBands["1-12"];
  const m13 = sim.marginBands["13+"];
  const margin112Price = winnerIsHome ? prices.marginHome112 : prices.marginAway112;
  const margin13Price = winnerIsHome ? prices.marginHome13Plus : prices.marginAway13Plus;
  picks.push({
    market: "margin",
    selection: `${winnerNick} 1-12`,
    modelProb: m112 * (winnerIsHome ? sim.homeWinProb : sim.awayWinProb),
    edge: summariseEdge(m112 * (winnerIsHome ? sim.homeWinProb : sim.awayWinProb), margin112Price ?? null, { confidence }),
    rationale: `${(m112 * 100).toFixed(0)}% of decided games land 1-12`,
  });
  picks.push({
    market: "margin",
    selection: `${winnerNick} 13+`,
    modelProb: m13 * (winnerIsHome ? sim.homeWinProb : sim.awayWinProb),
    edge: summariseEdge(m13 * (winnerIsHome ? sim.homeWinProb : sim.awayWinProb), margin13Price ?? null, { confidence }),
    rationale: `${(m13 * 100).toFixed(0)}% of decided games land 13+`,
  });

  // ---- Totals ----
  const overProb = sim.overProbAtLine;
  picks.push({
    market: "totals",
    selection: `Over ${sim.totalLine}`,
    modelProb: overProb,
    edge: summariseEdge(overProb, prices.overAtLine ?? null, { confidence }),
    rationale: `Expected total ${sim.expectedTotal.toFixed(1)}; ${(overProb * 100).toFixed(0)}% > ${sim.totalLine}`,
  });
  picks.push({
    market: "totals",
    selection: `Under ${sim.totalLine}`,
    modelProb: 1 - overProb,
    edge: summariseEdge(1 - overProb, prices.underAtLine ?? null, { confidence }),
    rationale: `Expected total ${sim.expectedTotal.toFixed(1)}; ${((1 - overProb) * 100).toFixed(0)}% under`,
  });

  // ---- Player markets ----
  const surfacePlayer = (p: PlayerProbability, market: MarketKind, prob: number, priceMap?: Record<string, number>) => {
    if (prob < MIN_PLAYER_PROB) return;
    const price = priceMap?.[p.name.toLowerCase()] ?? null;
    picks.push({
      market,
      selection: `${p.name} (${market.replace("_", " ")})`,
      modelProb: prob,
      edge: summariseEdge(prob, price, { confidence }),
      rationale: `${(prob * 100).toFixed(0)}% across ${sim.iterations.toLocaleString()} sims`,
    });
  };

  for (const p of sim.playerProbabilities.slice(0, 6)) surfacePlayer(p, "anytime_tryscorer", p.anytimeProb, prices.anytime);
  for (const p of [...sim.playerProbabilities].sort((a, b) => b.firstTryProb - a.firstTryProb).slice(0, 4)) {
    surfacePlayer(p, "first_tryscorer", p.firstTryProb, prices.firstTry);
  }
  for (const p of [...sim.playerProbabilities].sort((a, b) => b.multiTryProb - a.multiTryProb).slice(0, 3)) {
    surfacePlayer(p, "multi_tryscorer", p.multiTryProb, prices.multiTry);
  }

  // Sort by EV descending, suppressed last.
  return picks.sort((a, b) => {
    if (a.edge.suppressed !== b.edge.suppressed) return a.edge.suppressed ? 1 : -1;
    return b.edge.evPct - a.edge.evPct;
  });
}
