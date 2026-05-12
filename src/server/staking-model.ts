// ============================================================================
// Staking model (Phase 5).
//
// Suggests bet sizing using fractional Kelly with hard guardrails:
//   - never recommends sizing if there is no market price
//   - returns 0 stake on negative or zero EV
//   - low confidence is capped harshly
//   - high confidence with positive EV returns a small bounded stake
//   - default $10 stake remains the user-editable starting point in the UI
//
// This module is pure — no I/O, no UI assumptions.
// ============================================================================

import type { ConfidenceTier } from "./confidence";

export type StakeRecommendation = {
  recommendedStake: number;          // dollars, rounded to 0.5
  fractionOfBankroll: number;        // 0..1
  edgePct: number;                   // EV%
  reason: string;
  capped: boolean;                   // true when guardrail kicked in
};

export type StakeInputs = {
  modelProb: number;                 // 0..1
  marketOdds: number | null | undefined; // decimal odds
  bankroll?: number;                 // default 100
  confidence: ConfidenceTier;
  // Risk tier for the bet (mirrors bets-engine tiers).
  riskTier?: "low" | "medium" | "high" | "ultra";
};

const KELLY_FRACTION_BY_CONFIDENCE: Record<ConfidenceTier, number> = {
  low: 0.05,    // very small fraction of full Kelly
  medium: 0.15,
  high: 0.25,   // quarter-Kelly is the highest we ever go
};

const HARD_CAP_BY_CONFIDENCE: Record<ConfidenceTier, number> = {
  low: 0.005,   // 0.5% bankroll
  medium: 0.015,
  high: 0.03,
};

const TIER_MULT: Record<NonNullable<StakeInputs["riskTier"]>, number> = {
  low: 1.0,
  medium: 0.8,
  high: 0.5,
  ultra: 0.25,
};

export function recommendStake(inp: StakeInputs): StakeRecommendation {
  const empty = (reason: string): StakeRecommendation => ({
    recommendedStake: 0,
    fractionOfBankroll: 0,
    edgePct: 0,
    reason,
    capped: false,
  });

  if (!Number.isFinite(inp.modelProb) || inp.modelProb <= 0 || inp.modelProb >= 1) {
    return empty("Invalid model probability.");
  }
  const odds = inp.marketOdds;
  if (typeof odds !== "number" || !Number.isFinite(odds) || odds <= 1.01) {
    return empty("No market odds available.");
  }

  const b = odds - 1;                        // net odds
  const p = inp.modelProb;
  const q = 1 - p;
  const kellyFull = (b * p - q) / b;         // can be negative
  const evPct = (p * b - q) * 100;

  if (!Number.isFinite(kellyFull) || kellyFull <= 0 || evPct <= 0) {
    return empty("Negative or zero EV — no stake.");
  }

  const fracMult = KELLY_FRACTION_BY_CONFIDENCE[inp.confidence];
  const hardCap = HARD_CAP_BY_CONFIDENCE[inp.confidence];
  const tierMult = TIER_MULT[inp.riskTier ?? "medium"];

  let frac = kellyFull * fracMult * tierMult;
  let capped = false;
  if (frac > hardCap) { frac = hardCap; capped = true; }
  if (frac < 0.0005) {
    return empty("Edge too small to size confidently.");
  }

  const bankroll = Math.max(1, inp.bankroll ?? 100);
  const dollars = Math.round((frac * bankroll) * 2) / 2;
  return {
    recommendedStake: dollars,
    fractionOfBankroll: Math.round(frac * 10_000) / 10_000,
    edgePct: Math.round(evPct * 10) / 10,
    reason: capped ? "Capped by confidence guardrail." : "Fractional Kelly sizing.",
    capped,
  };
}
