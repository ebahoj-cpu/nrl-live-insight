// ============================================================================
// Probability Calibration (Phase 4)
//
// Blends raw simulation probability with deterministic and market-implied
// probability. Removes bookmaker overround. Stabilises low-confidence model
// output toward the market; preserves disagreement when model confidence
// is high (and surfaces it as a value signal).
// ============================================================================

import type { ConfidenceTier } from "./confidence";

export type CalibrationInputs = {
  simulationProb: { home: number; away: number; draw: number };
  deterministicProb?: { home: number; away: number; draw: number } | null;
  marketOdds?: { home?: number | null; away?: number | null; draw?: number | null } | null;
  modelConfidence: ConfidenceTier;
};

export type CalibrationResult = {
  calibratedHomeWinProb: number;
  calibratedAwayWinProb: number;
  calibratedDrawProb: number;
  marketImplied?: { home: number; away: number; draw: number } | null;
  marketAgreement: number;        // 0..1, 1 = perfect agreement on winner
  marketDisagreement: number;     // 0..1
  valueSignal: "home" | "away" | "none";
  calibrationNote: string;
};

// Strip overround from up-to-3 odds, returning normalised probabilities.
export function impliedFromOdds(odds: { home?: number | null; away?: number | null; draw?: number | null } | null | undefined): { home: number; away: number; draw: number } | null {
  if (!odds) return null;
  const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 1.01;
  const h = valid(odds.home) ? 1 / (odds.home as number) : 0;
  const a = valid(odds.away) ? 1 / (odds.away as number) : 0;
  const d = valid(odds.draw) ? 1 / (odds.draw as number) : 0;
  const sum = h + a + d;
  if (sum <= 0) return null;
  return { home: h / sum, away: a / sum, draw: d / sum };
}

const WEIGHT_BY_CONFIDENCE: Record<ConfidenceTier, { sim: number; det: number; market: number }> = {
  // Low confidence → market dominates.
  low:    { sim: 0.25, det: 0.25, market: 0.50 },
  medium: { sim: 0.45, det: 0.20, market: 0.35 },
  // High confidence → preserve model edge; market only stabilises.
  high:   { sim: 0.60, det: 0.20, market: 0.20 },
};

export function calibrateProbabilities(inp: CalibrationInputs): CalibrationResult {
  const sim = inp.simulationProb;
  const det = inp.deterministicProb ?? sim;
  const market = impliedFromOdds(inp.marketOdds ?? null);
  const w = { ...WEIGHT_BY_CONFIDENCE[inp.modelConfidence] };
  if (!market) { w.sim += w.market * 0.7; w.det += w.market * 0.3; w.market = 0; }

  const blend = (s: number, d: number, m: number | null): number => {
    const total = w.sim + w.det + (m == null ? 0 : w.market);
    if (total <= 0) return s;
    return (s * w.sim + d * w.det + (m == null ? 0 : m * w.market)) / total;
  };

  let h = blend(sim.home, det.home, market?.home ?? null);
  let a = blend(sim.away, det.away, market?.away ?? null);
  let d = blend(sim.draw, det.draw, market?.draw ?? null);
  const norm = h + a + d;
  if (norm > 0) { h /= norm; a /= norm; d /= norm; }

  // Agreement / value signal vs market.
  let marketAgreement = 0.5, marketDisagreement = 0.5, valueSignal: "home" | "away" | "none" = "none";
  let note = "Calibrated without market input.";
  if (market) {
    const simWinner = sim.home >= sim.away ? "home" : "away";
    const marketWinner = market.home >= market.away ? "home" : "away";
    marketAgreement = simWinner === marketWinner ? 1 - Math.abs(sim[simWinner] - market[simWinner]) : 0;
    marketDisagreement = 1 - marketAgreement;
    if (inp.modelConfidence === "high") {
      // Surface value where model is meaningfully ahead of market.
      if (sim.home - market.home > 0.06) valueSignal = "home";
      else if (sim.away - market.away > 0.06) valueSignal = "away";
    }
    note =
      marketAgreement >= 0.85 ? "Model agrees with market."
      : valueSignal !== "none" ? `Model sees value on ${valueSignal} vs market.`
      : "Model and market disagree — calibrated toward market because confidence is not high.";
  }

  return {
    calibratedHomeWinProb: h,
    calibratedAwayWinProb: a,
    calibratedDrawProb: d,
    marketImplied: market,
    marketAgreement, marketDisagreement, valueSignal,
    calibrationNote: note,
  };
}

// ----------------------------------------------------------------------------
// Phase 5 — single-market calibration helpers.
// Each accepts a model probability, an optional market price and confidence,
// and returns a blended probability plus a value signal. Invalid odds are
// ignored (returns the model probability as-is).
// ----------------------------------------------------------------------------

export type SingleMarketCalibration = {
  modelProb: number;
  marketProb: number | null;
  calibratedProb: number;
  hasValue: boolean;
  edge: number;                 // signed: model - market
};

const SINGLE_WEIGHT_BY_CONFIDENCE: Record<ConfidenceTier, { sim: number; market: number }> = {
  low: { sim: 0.35, market: 0.65 },
  medium: { sim: 0.55, market: 0.45 },
  high: { sim: 0.7, market: 0.3 },
};

function impliedFromSinglePrice(price: number | null | undefined): number | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 1.01) return null;
  return 1 / price;
}

export function calibrateSingleMarket(args: {
  modelProb: number;
  marketPrice?: number | null;
  confidence: ConfidenceTier;
  // Suppress value claims for tryscorer markets when confidence is low.
  suppressLowConfidenceValue?: boolean;
}): SingleMarketCalibration {
  const m = args.modelProb;
  if (!Number.isFinite(m) || m < 0 || m > 1) {
    return { modelProb: m, marketProb: null, calibratedProb: m, hasValue: false, edge: 0 };
  }
  const marketImplied = impliedFromSinglePrice(args.marketPrice);
  if (marketImplied == null) {
    return { modelProb: m, marketProb: null, calibratedProb: m, hasValue: false, edge: 0 };
  }
  const w = SINGLE_WEIGHT_BY_CONFIDENCE[args.confidence];
  const calibrated = w.sim * m + w.market * marketImplied;
  const edge = m - marketImplied;
  let hasValue = edge > 0.04;
  if (hasValue && args.suppressLowConfidenceValue && args.confidence === "low") {
    hasValue = false;
  }
  return {
    modelProb: m,
    marketProb: marketImplied,
    calibratedProb: Math.max(0, Math.min(1, calibrated)),
    hasValue,
    edge: Math.round(edge * 1000) / 1000,
  };
}

// Margin market — split into 1-12 / 13+ per side.
export function calibrateMarginMarket(args: {
  modelProb: number;
  price?: number | null;
  confidence: ConfidenceTier;
}): SingleMarketCalibration {
  return calibrateSingleMarket({
    modelProb: args.modelProb,
    marketPrice: args.price,
    confidence: args.confidence,
  });
}

// Totals market — over/under at the projected line.
export function calibrateTotalsMarket(args: {
  modelProb: number;
  price?: number | null;
  confidence: ConfidenceTier;
}): SingleMarketCalibration {
  return calibrateSingleMarket({
    modelProb: args.modelProb,
    marketPrice: args.price,
    confidence: args.confidence,
  });
}

// Tryscorer markets (anytime / first / multi). Suppresses value claims at
// low confidence to avoid noisy player picks.
export function calibrateTryscorerMarket(args: {
  modelProb: number;
  price?: number | null;
  confidence: ConfidenceTier;
}): SingleMarketCalibration {
  return calibrateSingleMarket({
    modelProb: args.modelProb,
    marketPrice: args.price,
    confidence: args.confidence,
    suppressLowConfidenceValue: true,
  });
}
