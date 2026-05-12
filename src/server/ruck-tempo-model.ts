// ============================================================================
// Ruck / Tempo Model (Phase 4)
//
// Upgrades the existing Ruck Pressure Rating into a richer tempo and
// territory profile. Outputs bounded modifiers for total points and outside
// back try probabilities.
// ============================================================================

import type { ConfidenceTier } from "./confidence";

export type RuckTempoSideInput = {
  nickname: string;
  runMetresPerGame?: number;
  postContactMetresPerGame?: number;
  tackleBreaksPerGame?: number;
  completionRate?: number;
  errorsPerGame?: number;
  penaltiesPerGame?: number;
  lineBreaksPerGame?: number;
};

export type RuckTempoProfile = {
  homeRuckPressureRating: number;       // 0..100
  awayRuckPressureRating: number;       // 0..100
  tempoLean: "fast" | "average" | "slow";
  territoryLean: "home" | "away" | "neutral";
  middleDominance: "home" | "away" | "neutral";
  edgeExposureRisk: "home" | "away" | "neutral";
  totalPointsModifier: number;          // ±3 pts
  outsideBackTryModifier: number;       // ±0.05 (added to per-player anytime prob)
  weatherSlowdown: number;              // -0.1..0
  confidence: ConfidenceTier;
  note: string;
};

const LEAGUE = {
  runMetres: 1500,
  postContact: 500,
  tackleBreaks: 28,
  completion: 0.78,
  errors: 10,
  penalties: 6,
  lineBreaks: 6,
};

function rpr(s: RuckTempoSideInput | undefined): number {
  if (!s) return 50;
  let r = 50;
  if (s.postContactMetresPerGame != null) r += (s.postContactMetresPerGame - LEAGUE.postContact) / 10;
  if (s.tackleBreaksPerGame != null) r += (s.tackleBreaksPerGame - LEAGUE.tackleBreaks) * 0.5;
  if (s.runMetresPerGame != null) r += (s.runMetresPerGame - LEAGUE.runMetres) / 60;
  if (s.completionRate != null) r += (s.completionRate - LEAGUE.completion) * 60;
  if (s.errorsPerGame != null) r -= (s.errorsPerGame - LEAGUE.errors) * 0.6;
  if (s.lineBreaksPerGame != null) r += (s.lineBreaksPerGame - LEAGUE.lineBreaks) * 0.8;
  return clamp(r, 20, 90);
}

export function neutralRuckTempo(): RuckTempoProfile {
  return {
    homeRuckPressureRating: 50, awayRuckPressureRating: 50,
    tempoLean: "average", territoryLean: "neutral",
    middleDominance: "neutral", edgeExposureRisk: "neutral",
    totalPointsModifier: 0, outsideBackTryModifier: 0, weatherSlowdown: 0,
    confidence: "low", note: "Neutral ruck/tempo baseline.",
  };
}

export function buildRuckTempoProfile(args: {
  home?: RuckTempoSideInput;
  away?: RuckTempoSideInput;
  weatherTempoModifier?: number; // -1..+1, negative = wet/slow
}): RuckTempoProfile {
  if (!args.home && !args.away) return neutralRuckTempo();
  const h = rpr(args.home);
  const a = rpr(args.away);
  const avg = (h + a) / 2;
  const tempoLean: RuckTempoProfile["tempoLean"] = avg >= 60 ? "fast" : avg <= 42 ? "slow" : "average";
  const territoryLean: RuckTempoProfile["territoryLean"] = h - a >= 8 ? "home" : a - h >= 8 ? "away" : "neutral";
  const middleDominance = territoryLean;
  const edgeExposureRisk: RuckTempoProfile["edgeExposureRisk"] = territoryLean === "home" ? "away" : territoryLean === "away" ? "home" : "neutral";

  const weather = args.weatherTempoModifier ?? 0;
  const weatherSlowdown = weather < 0 ? clamp(weather * 0.05, -0.1, 0) : 0;
  // Total points modifier: tempo lean drives ±3 max.
  let totalPointsModifier = clamp((avg - 50) / 8, -3, 3);
  totalPointsModifier += weatherSlowdown * 30; // slow weather drops total
  totalPointsModifier = clamp(totalPointsModifier, -4, 4);
  // Outside back try uplift when high tempo / many tackle breaks.
  const outsideBackTryModifier = clamp((avg - 50) / 600, -0.05, 0.05);

  // Confidence based on how many fields known.
  const known =
    [args.home?.completionRate, args.home?.runMetresPerGame, args.home?.tackleBreaksPerGame,
     args.away?.completionRate, args.away?.runMetresPerGame, args.away?.tackleBreaksPerGame]
    .filter((v) => v != null).length;
  const confidence: ConfidenceTier = known >= 4 ? "medium" : "low";

  return {
    homeRuckPressureRating: h, awayRuckPressureRating: a,
    tempoLean, territoryLean, middleDominance, edgeExposureRisk,
    totalPointsModifier, outsideBackTryModifier, weatherSlowdown,
    confidence,
    note:
      tempoLean === "fast" ? "High tempo expected — total points lean up."
      : tempoLean === "slow" ? "Slow ruck — total points lean down."
      : "Average tempo profile.",
  };
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
