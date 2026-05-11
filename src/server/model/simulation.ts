// Monte Carlo match simulator.
//
// For each iteration we draw a per-team try count from a Poisson distribution
// (lambda from the predictor's expected total split by predicted score share),
// then a binomial number of conversions per try (p = team's season conversion
// rate, defaulting to 0.7). Penalty/field goals are folded into a small
// extras term. Returns the empirical distribution over winners and totals.

import type { TeamModelInputs, MatchPrediction, TotalPointsPrediction } from "./predictor";

export type SimulationResult = {
  iterations: number;
  homeWinProb: number;
  awayWinProb: number;
  drawProb: number;
  meanTotal: number;
  medianTotal: number;
  totalP10: number;
  totalP90: number;
  meanMargin: number;       // signed: positive = home wins
  marginP10: number;
  marginP90: number;
  // Probability mass for the two margin bands relative to the *winner*.
  marginBand: { "1-12": number; "13+": number };
  overUnder: (line: number) => { overProb: number; underProb: number };
};

// Box-Muller for a standard normal — used only for Poisson when lambda > 30.
function randn(): number {
  let u = 0; let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    // Knuth
    const L = Math.exp(-lambda);
    let k = 0; let p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  // Normal approximation for large lambda
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * randn()));
}

function binomial(n: number, p: number): number {
  if (n <= 0) return 0;
  let k = 0;
  for (let i = 0; i < n; i++) if (Math.random() < p) k++;
  return k;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
}

export type SimContext = {
  homeConversionRate?: number;  // 0..1, defaults to 0.7
  awayConversionRate?: number;
  // Small additive points (penalty goals, field goals) average per team.
  extrasPerTeam?: number;       // defaults to 1.5
};

export function runMonteCarlo(
  prediction: MatchPrediction,
  total: TotalPointsPrediction,
  _home: TeamModelInputs,
  _away: TeamModelInputs,
  iterations = 10_000,
  ctx: SimContext = {},
): SimulationResult {
  const homeConv = ctx.homeConversionRate ?? 0.7;
  const awayConv = ctx.awayConversionRate ?? 0.7;
  const extras = ctx.extrasPerTeam ?? 1.5;

  // Convert expected total + win prob into per-team try lambdas.
  // homeShare ∈ [0.35, 0.65] derived from homeWinProb (centred at 0.5 → 0.5).
  const homeShare = 0.5 + (prediction.homeWinProb - 0.5) * 0.3;
  const expHomePts = total.expectedTotal * homeShare;
  const expAwayPts = total.expectedTotal * (1 - homeShare);
  // ~6.5 points per try (4-try + ~70% conversion). Subtract extras average.
  const lambdaHomeTries = Math.max(0.3, (expHomePts - extras) / 6.5);
  const lambdaAwayTries = Math.max(0.3, (expAwayPts - extras) / 6.5);

  let homeWins = 0, awayWins = 0, draws = 0;
  const totals: number[] = new Array(iterations);
  const margins: number[] = new Array(iterations);
  let band1to12 = 0, band13plus = 0;

  for (let i = 0; i < iterations; i++) {
    const ht = poisson(lambdaHomeTries);
    const at = poisson(lambdaAwayTries);
    const hc = binomial(ht, homeConv);
    const ac = binomial(at, awayConv);
    const hExtras = Math.random() < 0.6 ? 2 : 0; // ~one penalty goal in 60% of games
    const aExtras = Math.random() < 0.6 ? 2 : 0;
    const homePts = ht * 4 + hc * 2 + hExtras;
    const awayPts = at * 4 + ac * 2 + aExtras;
    const total_ = homePts + awayPts;
    const margin = homePts - awayPts;

    totals[i] = total_;
    margins[i] = margin;

    if (margin > 0) homeWins++;
    else if (margin < 0) awayWins++;
    else draws++;

    const am = Math.abs(margin);
    if (am === 0) { /* draw; skip */ }
    else if (am <= 12) band1to12++;
    else band13plus++;
  }

  const sortedTotals = [...totals].sort((a, b) => a - b);
  const sortedMargins = [...margins].sort((a, b) => a - b);
  const meanTotal = totals.reduce((s, v) => s + v, 0) / iterations;
  const meanMargin = margins.reduce((s, v) => s + v, 0) / iterations;
  const decided = Math.max(1, homeWins + awayWins);
  const bandTotal = band1to12 + band13plus || 1;

  return {
    iterations,
    homeWinProb: homeWins / iterations,
    awayWinProb: awayWins / iterations,
    drawProb: draws / iterations,
    meanTotal,
    medianTotal: quantile(sortedTotals, 0.5),
    totalP10: quantile(sortedTotals, 0.1),
    totalP90: quantile(sortedTotals, 0.9),
    meanMargin,
    marginP10: quantile(sortedMargins, 0.1),
    marginP90: quantile(sortedMargins, 0.9),
    marginBand: {
      "1-12": band1to12 / bandTotal,
      "13+": band13plus / bandTotal,
    },
    overUnder: (line: number) => {
      let over = 0;
      for (const t of totals) if (t > line) over++;
      return { overProb: over / iterations, underProb: 1 - over / iterations };
    },
  };
}
