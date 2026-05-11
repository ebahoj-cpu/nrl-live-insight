// ============================================================================
// Referee Tendency Model (Phase 4)
//
// Derives small bounded modifiers from match officials. Without official data
// the model is neutral. Even with data, modifiers are capped so a single
// referee never dominates the simulation.
// ============================================================================

import type { NormalisedMatchOfficial } from "./nrl-data-types";
import type { ConfidenceTier } from "./confidence";

export type RefereeProfile = {
  name: string | null;
  penaltyTendency: number;       // -1..+1 vs league avg (~7/game)
  totalsTendency: number;        // -1..+1 vs league avg (~40 pts)
  sinBinTendency: number;        // -1..+1
  homeBias: number;              // -1..+1
  ruckSpeedTolerance: number;    // -1..+1, +ve = lets ruck flow
  // Bounded modifiers consumed by simulation:
  totalPointsModifier: number;   // points added to expected total, ±2
  volatilityModifier: number;    // 0..0.05 added to draw/upset noise
  homeBiasModifier: number;      // points added to home margin, ±1
  confidence: ConfidenceTier;
  note: string;
};

export function neutralReferee(name: string | null = null): RefereeProfile {
  return {
    name,
    penaltyTendency: 0, totalsTendency: 0, sinBinTendency: 0,
    homeBias: 0, ruckSpeedTolerance: 0,
    totalPointsModifier: 0, volatilityModifier: 0, homeBiasModifier: 0,
    confidence: "low",
    note: name ? `Neutral profile for ${name} (no sample).` : "No referee assigned.",
  };
}

const LEAGUE_AVG_PEN = 7;
const LEAGUE_AVG_TOTAL = 40;
const LEAGUE_AVG_SINBIN = 0.4;

export function buildRefereeProfile(officials?: NormalisedMatchOfficial[] | null): RefereeProfile {
  const ref = officials?.find((o) => o.role === "referee") ?? null;
  if (!ref) return neutralReferee();

  const haveSample =
    ref.penaltiesPerGame != null
    || ref.averageTotal != null
    || ref.sinBinsPerGame != null
    || ref.homeBias != null;
  if (!haveSample) return neutralReferee(ref.name);

  const pen = ref.penaltiesPerGame ?? LEAGUE_AVG_PEN;
  const total = ref.averageTotal ?? LEAGUE_AVG_TOTAL;
  const sinbin = ref.sinBinsPerGame ?? LEAGUE_AVG_SINBIN;
  const homeBias = ref.homeBias ?? 0;

  const penaltyTendency = clamp((pen - LEAGUE_AVG_PEN) / 4, -1, 1);
  const totalsTendency = clamp((total - LEAGUE_AVG_TOTAL) / 10, -1, 1);
  const sinBinTendency = clamp((sinbin - LEAGUE_AVG_SINBIN) / 0.6, -1, 1);
  // Higher penalties typically slow the ruck; invert.
  const ruckSpeedTolerance = clamp(-penaltyTendency * 0.6, -1, 1);

  // Bounded modifiers.
  const totalPointsModifier = clamp(totalsTendency * 2, -2, 2);
  const volatilityModifier = clamp(Math.abs(sinBinTendency) * 0.04, 0, 0.05);
  const homeBiasModifier = clamp(homeBias * 1, -1, 1);

  return {
    name: ref.name,
    penaltyTendency, totalsTendency, sinBinTendency, homeBias, ruckSpeedTolerance,
    totalPointsModifier, volatilityModifier, homeBiasModifier,
    confidence: "medium",
    note:
      totalsTendency > 0.3 ? "High-scoring referee — small total lift."
      : totalsTendency < -0.3 ? "Tight referee — small total dip."
      : penaltyTendency > 0.4 ? "Strict whistle — penalty count elevated."
      : "Average referee profile.",
  };
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
