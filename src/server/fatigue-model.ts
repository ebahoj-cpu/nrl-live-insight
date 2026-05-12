// ============================================================================
// Fatigue Model (Phase 4)
//
// Estimates per-team fatigue/late-collapse risk from short turnarounds,
// recent defensive workload and squad continuity. Returns bounded modifiers
// the simulation engine can blend in safely.
// ============================================================================

import type { ConfidenceTier } from "./confidence";

export type FatigueSideInput = {
  nickname: string;
  lastMatchUtc?: string | null;
  errorsPerGame?: number;
  penaltiesPerGame?: number;
  postContactMetresAllowed?: number;
  injuriesOut?: number;
};

export type FatigueProfile = {
  homeFatigueIndex: number;       // 30..80, 50 baseline
  awayFatigueIndex: number;
  fatigueEdge: number;            // signed, +ve = home fresher
  lateCollapseRisk: { home: number; away: number }; // 0..1
  secondHalfSwing: number;        // -0.1..+0.1, +ve = home
  benchStressNote: string;
  totalPointsModifier: number;    // points
  blowoutLift: number;            // 0..0.08
  comebackLift: number;           // 0..0.08
  confidence: ConfidenceTier;
};

const BASE = 50;
const LEAGUE_ERR = 10;
const LEAGUE_PEN = 6;

function sideIndex(s: FatigueSideInput | undefined, kickoffUtc?: string): number {
  if (!s) return BASE;
  let idx = BASE;
  if (s.lastMatchUtc && kickoffUtc) {
    const days = (Date.parse(kickoffUtc) - Date.parse(s.lastMatchUtc)) / 86_400_000;
    if (Number.isFinite(days)) {
      if (days < 5) idx += (5 - days) * 6; // up to +18 on a 2-day turnaround
      else if (days > 9) idx -= Math.min(8, (days - 9) * 1.5);
    }
  }
  if (s.errorsPerGame != null) idx += (s.errorsPerGame - LEAGUE_ERR) * 0.8;
  if (s.penaltiesPerGame != null) idx += (s.penaltiesPerGame - LEAGUE_PEN) * 0.6;
  if (s.postContactMetresAllowed != null) idx += (s.postContactMetresAllowed - 600) / 50;
  if (s.injuriesOut != null) idx += s.injuriesOut * 1.5;
  return clamp(idx, 30, 80);
}

export function neutralFatigue(): FatigueProfile {
  return {
    homeFatigueIndex: BASE, awayFatigueIndex: BASE,
    fatigueEdge: 0, lateCollapseRisk: { home: 0.1, away: 0.1 },
    secondHalfSwing: 0, benchStressNote: "Neutral fatigue baseline.",
    totalPointsModifier: 0, blowoutLift: 0, comebackLift: 0,
    confidence: "low",
  };
}

export function buildFatigueProfile(args: {
  home?: FatigueSideInput;
  away?: FatigueSideInput;
  kickoffUtc?: string;
}): FatigueProfile {
  if (!args.home && !args.away) return neutralFatigue();
  const h = sideIndex(args.home, args.kickoffUtc);
  const a = sideIndex(args.away, args.kickoffUtc);
  const fatigueEdge = (a - h) / 30; // signed, normalised
  // Late collapse: scales above 55.
  const collapse = (idx: number) => clamp((idx - 55) / 30, 0, 0.7);
  const lateCollapseRisk = { home: collapse(h), away: collapse(a) };
  const secondHalfSwing = clamp(fatigueEdge * 0.08, -0.1, 0.1);
  const benchStressNote =
    Math.max(h, a) >= 65 ? "Heavy late-game leak risk for the more fatigued side."
    : Math.abs(h - a) <= 4 ? "Both sides similarly conditioned."
    : "Modest fatigue edge to the fresher side.";
  // Fatigue tends to slow late-game scoring slightly but increase comeback variance.
  const totalPointsModifier = clamp((100 - h - a) / 40, -2, 2) * -0.5; // small dip
  const blowoutLift = clamp(Math.max(lateCollapseRisk.home, lateCollapseRisk.away) * 0.08, 0, 0.08);
  const comebackLift = clamp(Math.min(lateCollapseRisk.home, lateCollapseRisk.away) * 0.06, 0, 0.06);
  // Confidence: depends on how much we know.
  const known = [
    args.home?.lastMatchUtc, args.away?.lastMatchUtc,
    args.home?.errorsPerGame != null ? 1 : null,
    args.away?.errorsPerGame != null ? 1 : null,
  ].filter(Boolean).length;
  const confidence: ConfidenceTier = known >= 3 ? "medium" : "low";

  return {
    homeFatigueIndex: h, awayFatigueIndex: a,
    fatigueEdge, lateCollapseRisk, secondHalfSwing, benchStressNote,
    totalPointsModifier, blowoutLift, comebackLift, confidence,
  };
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
