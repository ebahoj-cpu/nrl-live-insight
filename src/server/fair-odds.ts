// ============================================================================
// Fair odds + EV engine.
//
// Converts model probabilities into:
//   - fair decimal odds (1 / probability)
//   - implied probability of a market price
//   - expected-value edge % vs market
//
// Suppresses weak / low-confidence edges so the Bets tab never surfaces noise.
// ============================================================================

import type { ConfidenceTier } from "./confidence";

export function probabilityToFairOdds(prob: number): number {
  if (prob <= 0) return Number.POSITIVE_INFINITY;
  if (prob >= 1) return 1.0;
  return Math.round((1 / prob) * 100) / 100;
}

export function fairOddsToProbability(odds: number): number {
  if (!Number.isFinite(odds) || odds <= 1) return 0;
  return 1 / odds;
}

// Expected value as a percentage. Positive = value vs market.
//   EV% = (modelProb * (marketPrice - 1) - (1 - modelProb)) * 100
export function expectedValuePct(modelProb: number, marketPrice: number): number {
  if (!Number.isFinite(marketPrice) || marketPrice <= 1) return 0;
  const ev = modelProb * (marketPrice - 1) - (1 - modelProb);
  return Math.round(ev * 1000) / 10; // one decimal place
}

export type EdgeSummary = {
  modelProb: number;
  fairOdds: number;
  marketOdds: number | null;
  evPct: number;            // 0 if no market
  edgeStrength: "none" | "thin" | "value" | "strong";
  suppressed: boolean;      // true when confidence/edge is too weak to surface
  reason?: string;
};

export type EdgeOptions = {
  confidence: ConfidenceTier;
  // Minimum EV% to surface anything at all (defaults: low=10, medium=4, high=2).
  minEvPct?: number;
};

export function summariseEdge(modelProb: number, marketOdds: number | null, opts: EdgeOptions): EdgeSummary {
  const fairOdds = probabilityToFairOdds(modelProb);
  const evPct = marketOdds ? expectedValuePct(modelProb, marketOdds) : 0;
  const minEv = opts.minEvPct ?? (opts.confidence === "high" ? 2 : opts.confidence === "medium" ? 4 : 10);

  let strength: EdgeSummary["edgeStrength"] = "none";
  if (marketOdds) {
    if (evPct >= 12) strength = "strong";
    else if (evPct >= 5) strength = "value";
    else if (evPct >= 1) strength = "thin";
  }

  // Suppress when:
  //  - low confidence and edge < 10% EV
  //  - any tier and edge below tier threshold
  const suppressed =
    !marketOdds ||
    evPct < minEv ||
    (opts.confidence === "low" && strength !== "strong");

  let reason: string | undefined;
  if (suppressed) {
    if (!marketOdds) reason = "No market price available";
    else if (opts.confidence === "low") reason = "Confidence too low to recommend";
    else reason = `Edge below ${minEv}% threshold`;
  }

  return { modelProb, fairOdds, marketOdds, evPct, edgeStrength: strength, suppressed, reason };
}
