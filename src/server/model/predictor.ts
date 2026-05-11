// Statistical match predictor.
//
// Uses hard-coded logistic-regression coefficients (calibrated by hand against
// recent NRL seasons) to convert per-team strength signals into a home-win
// probability, an expected margin, and an expected total points value.
//
// Inputs are normalised so coefficients stay interpretable:
//   - pointsForPerGame, pointsAgainstPerGame   → centred at league avg ~22
//   - metresPerGame                            → centred at ~1500m
//   - completionRate                           → 0..1 (fraction)
//   - recentForm                               → +1 (5 wins) .. -1 (5 losses)
//   - isHome flag                              → +1 home, 0 away
//
// Designed to be deterministic, dependency-free, and overridable: a future
// retraining job can drop new coefficients into model/weights.json and the
// predictor will hot-load them.

import weights from "./weights.json" with { type: "json" };

export type TeamModelInputs = {
  pointsForPerGame: number;
  pointsAgainstPerGame: number;
  metresPerGame: number;
  completionRate: number;     // 0..1
  recentForm: number;         // -1..+1 (W-L over last 5 → normalised)
};

export type MatchPrediction = {
  homeWinProb: number;        // 0..1
  awayWinProb: number;        // 0..1 (= 1 - homeWinProb for two-way market)
  expectedMargin: number;     // signed: positive = home favoured
  marginBand: "1-12" | "13+";
  confidence: number;         // 0..1, distance from 0.5 in homeWinProb
};

export type TotalPointsPrediction = {
  expectedTotal: number;
  line: number;               // nearest .5 to expectedTotal
  lean: "over" | "under";
};

const PPG_CENTRE = 22;
const METRES_CENTRE = 1500;
const COMPLETION_CENTRE = 0.78;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- Outcome model ----------
//
// Score: a logistic regression over the *difference* between home and away
// inputs plus a home-advantage intercept. Coefficients are positive when the
// stat favours the team possessing it.
export function predictMatchOutcome(home: TeamModelInputs, away: TeamModelInputs): MatchPrediction {
  const w = weights.outcome;
  const dPF       = (home.pointsForPerGame - away.pointsForPerGame) / 10;
  const dPA       = (away.pointsAgainstPerGame - home.pointsAgainstPerGame) / 10; // higher = home defends better
  const dMetres   = (home.metresPerGame - away.metresPerGame) / 200;
  const dCompl    = (home.completionRate - away.completionRate) * 10;
  const dForm     = home.recentForm - away.recentForm;

  const z =
    w.intercept +
    w.homeAdvantage +
    w.pointsFor       * dPF +
    w.pointsAgainst   * dPA +
    w.metres          * dMetres +
    w.completion      * dCompl +
    w.recentForm      * dForm;

  const homeWinProb = clamp(sigmoid(z), 0.02, 0.98);
  const awayWinProb = 1 - homeWinProb;

  // Expected margin: linear projection from same drivers, scaled to points.
  const m = weights.margin;
  const expectedMargin =
    m.intercept +
    m.homeAdvantage +
    m.pointsFor     * (home.pointsForPerGame   - away.pointsForPerGame) +
    m.pointsAgainst * (away.pointsAgainstPerGame - home.pointsAgainstPerGame) +
    m.metres        * dMetres +
    m.completion    * dCompl +
    m.recentForm    * dForm;

  const marginBand: "1-12" | "13+" = Math.abs(expectedMargin) >= 13 ? "13+" : "1-12";
  const confidence = Math.abs(homeWinProb - 0.5) * 2; // 0..1

  return { homeWinProb, awayWinProb, expectedMargin, marginBand, confidence };
}

// ---------- Total points model ----------
//
// Expected total = home expected score + away expected score, where each
// team's expected = blend of own attack and opponent's defence, plus
// metres / completion rate adjustments shared across both sides.
export function predictTotalPoints(home: TeamModelInputs, away: TeamModelInputs): TotalPointsPrediction {
  const t = weights.total;
  const baseHome =
    t.attackOwn * home.pointsForPerGame +
    t.defenceOpp * away.pointsAgainstPerGame;
  const baseAway =
    t.attackOwn * away.pointsForPerGame +
    t.defenceOpp * home.pointsAgainstPerGame;

  const tempo =
    t.metres     * (((home.metresPerGame + away.metresPerGame) / 2 - METRES_CENTRE) / 200) +
    t.completion * (((home.completionRate + away.completionRate) / 2 - COMPLETION_CENTRE) * 20);

  const expectedTotal = clamp(baseHome + baseAway + tempo + t.intercept, 18, 80);
  const line = Math.round(expectedTotal * 2) / 2;
  const lean: "over" | "under" = expectedTotal >= line ? "over" : "under";
  return { expectedTotal, line, lean };
}

// Convenience for callers that only have W/L counts.
export function recentFormFromResults(results: ("W" | "L" | "D")[]): number {
  if (!results.length) return 0;
  const score = results.reduce((s, r) => s + (r === "W" ? 1 : r === "L" ? -1 : 0), 0);
  return clamp(score / results.length, -1, 1);
}

export { PPG_CENTRE, METRES_CENTRE, COMPLETION_CENTRE };
