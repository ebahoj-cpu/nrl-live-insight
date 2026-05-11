// ============================================================================
// Momentum Wave Model (Phase 4)
//
// Splits the 80 minutes into four 20-min windows and projects which side
// owns each phase. Drives HT/FT, late tryscorer and second-half over angles.
// ============================================================================

import type { ConfidenceTier } from "./confidence";
import type { FatigueProfile } from "./fatigue-model";
import type { RuckTempoProfile } from "./ruck-tempo-model";

export type MomentumPhase = { home: number; away: number };

export type MomentumProfile = {
  phaseScores: {
    "0-20": MomentumPhase;
    "20-40": MomentumPhase;
    "40-60": MomentumPhase;
    "60-80": MomentumPhase;
  };
  first20Lean: "home" | "away" | "neutral";
  second20Lean: "home" | "away" | "neutral";
  thirdQuarterLean: "home" | "away" | "neutral";
  final20Lean: "home" | "away" | "neutral";
  momentumSwingProbability: number;   // 0..0.6
  comebackProbability: number;        // 0..0.5
  lateTryProbability: number;         // 0..0.6
  secondHalfOverLean: number;         // -0.1..+0.1 (added to over prob)
  htftHomeHomeBoost: number;          // -0.05..+0.05
  htftAwayAwayBoost: number;
  confidence: ConfidenceTier;
  note: string;
};

export type MomentumInputs = {
  homeHtLeadRate?: number;
  awayHtLeadRate?: number;
  homeHtConversionRate?: number;
  awayHtConversionRate?: number;
  homeRecentForm?: number; // -1..+1
  awayRecentForm?: number;
  fatigue?: FatigueProfile;
  ruckTempo?: RuckTempoProfile;
};

export function neutralMomentum(): MomentumProfile {
  const flat: MomentumPhase = { home: 0.25, away: 0.25 };
  return {
    phaseScores: { "0-20": flat, "20-40": flat, "40-60": flat, "60-80": flat },
    first20Lean: "neutral", second20Lean: "neutral",
    thirdQuarterLean: "neutral", final20Lean: "neutral",
    momentumSwingProbability: 0.2, comebackProbability: 0.15,
    lateTryProbability: 0.3, secondHalfOverLean: 0,
    htftHomeHomeBoost: 0, htftAwayAwayBoost: 0,
    confidence: "low", note: "Neutral momentum baseline.",
  };
}

function leanFromPhase(p: MomentumPhase): "home" | "away" | "neutral" {
  if (p.home - p.away > 0.04) return "home";
  if (p.away - p.home > 0.04) return "away";
  return "neutral";
}

export function buildMomentumProfile(inp: MomentumInputs): MomentumProfile {
  const homeHtLead = inp.homeHtLeadRate ?? 0.5;
  const awayHtLead = inp.awayHtLeadRate ?? 0.5;
  const homeConv = inp.homeHtConversionRate ?? 0.65;
  const awayConv = inp.awayHtConversionRate ?? 0.65;
  const formH = inp.homeRecentForm ?? 0;
  const formA = inp.awayRecentForm ?? 0;
  const tempoEdge = inp.ruckTempo
    ? (inp.ruckTempo.homeRuckPressureRating - inp.ruckTempo.awayRuckPressureRating) / 100
    : 0;
  const fatigueEdge = inp.fatigue?.fatigueEdge ?? 0; // +ve = home fresher

  // Normalised share per phase. Each phase sums to ~0.5 across home+away
  // (other 0.5 = neutral / no scoring this segment).
  const baseHome = 0.25 + formH * 0.04 + tempoEdge * 0.04;
  const baseAway = 0.25 + formA * 0.04 - tempoEdge * 0.04;

  const ph0 = clampPhase(baseHome + (homeHtLead - 0.5) * 0.08, baseAway + (awayHtLead - 0.5) * 0.08);
  const ph1 = clampPhase(baseHome + homeConv * 0.05, baseAway + awayConv * 0.05);
  const ph2 = clampPhase(baseHome + fatigueEdge * 0.04, baseAway - fatigueEdge * 0.04);
  const ph3 = clampPhase(baseHome + fatigueEdge * 0.06, baseAway - fatigueEdge * 0.06);

  const swing = clamp(0.2 + Math.abs(fatigueEdge) * 0.3 + (inp.fatigue?.lateCollapseRisk
    ? Math.max(inp.fatigue.lateCollapseRisk.home, inp.fatigue.lateCollapseRisk.away) * 0.3
    : 0), 0, 0.6);
  const comeback = clamp(0.1 + (inp.fatigue?.comebackLift ?? 0) * 3, 0, 0.5);
  const lateTry = clamp(0.3 + (inp.ruckTempo?.outsideBackTryModifier ?? 0) * 4 + Math.abs(fatigueEdge) * 0.2, 0, 0.6);
  const secondHalfOverLean = clamp(((ph2.home + ph2.away + ph3.home + ph3.away) - 1.0) * 0.1, -0.1, 0.1);

  const htftHomeHomeBoost = clamp((homeHtLead - 0.5) * 0.05 + tempoEdge * 0.03, -0.05, 0.05);
  const htftAwayAwayBoost = clamp((awayHtLead - 0.5) * 0.05 - tempoEdge * 0.03, -0.05, 0.05);

  const known = [inp.homeHtLeadRate, inp.awayHtLeadRate, inp.homeHtConversionRate, inp.awayHtConversionRate]
    .filter((v) => v != null).length;
  const confidence: ConfidenceTier = known >= 3 ? "medium" : "low";

  return {
    phaseScores: { "0-20": ph0, "20-40": ph1, "40-60": ph2, "60-80": ph3 },
    first20Lean: leanFromPhase(ph0), second20Lean: leanFromPhase(ph1),
    thirdQuarterLean: leanFromPhase(ph2), final20Lean: leanFromPhase(ph3),
    momentumSwingProbability: swing, comebackProbability: comeback,
    lateTryProbability: lateTry, secondHalfOverLean,
    htftHomeHomeBoost, htftAwayAwayBoost,
    confidence,
    note: swing >= 0.4 ? "Likely momentum swings — late variance elevated." : "Stable momentum profile.",
  };
}

function clampPhase(h: number, a: number): MomentumPhase {
  return { home: clamp(h, 0.05, 0.5), away: clamp(a, 0.05, 0.5) };
}
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
