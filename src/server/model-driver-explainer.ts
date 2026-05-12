// ============================================================================
// Model Driver Explainer (Phase 4)
//
// Converts the advanced model outputs into compact, structured driver
// objects for the Insights / Script / Bets surfaces. Each driver is short
// and useful — never a paragraph.
// ============================================================================

import type { HeadToHeadProfile } from "./head-to-head-model";
import type { RefereeProfile } from "./referee-model";
import type { FatigueProfile } from "./fatigue-model";
import type { RuckTempoProfile } from "./ruck-tempo-model";
import type { EdgeAttackProfile } from "./edge-attack-model";
import type { CalibrationResult } from "./probability-calibration";

export type ModelDriver = {
  label: string;
  direction: "home" | "away" | "neutral";
  strength: "small" | "medium" | "strong";
  marketImpact: string;
  note: string;
};

function strengthFromAbs(v: number, mediumAt: number, strongAt: number): "small" | "medium" | "strong" {
  const a = Math.abs(v);
  if (a >= strongAt) return "strong";
  if (a >= mediumAt) return "medium";
  return "small";
}

export function buildModelDrivers(args: {
  homeNickname: string;
  awayNickname: string;
  h2h: HeadToHeadProfile;
  referee: RefereeProfile;
  fatigue: FatigueProfile;
  ruckTempo: RuckTempoProfile;
  edgeAttack: EdgeAttackProfile;
  calibration?: CalibrationResult | null;
  injuriesOutHome?: number;
  injuriesOutAway?: number;
  weatherWet?: boolean;
  // Pre-calibration team-strength delta (sim home - away win prob).
  teamStrengthDelta?: number;
}): ModelDriver[] {
  const drivers: ModelDriver[] = [];

  // Team strength
  if (args.teamStrengthDelta != null) {
    const d = args.teamStrengthDelta;
    drivers.push({
      label: "Team strength",
      direction: d > 0.04 ? "home" : d < -0.04 ? "away" : "neutral",
      strength: strengthFromAbs(d, 0.08, 0.18),
      marketImpact: "match winner",
      note: d > 0 ? `${args.homeNickname} model edge` : d < 0 ? `${args.awayNickname} model edge` : "Even matchup",
    });
  }

  // Ruck / tempo
  drivers.push({
    label: "Ruck tempo",
    direction: args.ruckTempo.tempoLean === "fast" ? "neutral" : args.ruckTempo.tempoLean === "slow" ? "neutral" : "neutral",
    strength: strengthFromAbs(args.ruckTempo.totalPointsModifier, 1.5, 3),
    marketImpact: "total points",
    note: args.ruckTempo.note,
  });

  // Fatigue
  drivers.push({
    label: "Fatigue",
    direction: args.fatigue.fatigueEdge > 0.1 ? "home" : args.fatigue.fatigueEdge < -0.1 ? "away" : "neutral",
    strength: strengthFromAbs(args.fatigue.fatigueEdge, 0.1, 0.3),
    marketImpact: "second-half / margin",
    note: args.fatigue.benchStressNote,
  });

  // Referee
  if (args.referee.confidence !== "low") {
    drivers.push({
      label: "Referee",
      direction: args.referee.homeBias > 0.2 ? "home" : args.referee.homeBias < -0.2 ? "away" : "neutral",
      strength: strengthFromAbs(args.referee.totalsTendency, 0.2, 0.5),
      marketImpact: "total / sin-bin variance",
      note: args.referee.note,
    });
  }

  // Edge attack
  if (args.edgeAttack.confidence !== "low" && args.edgeAttack.bestAttackChannel) {
    drivers.push({
      label: "Edge attack",
      direction: args.edgeAttack.bestAttackChannel.team,
      strength: "medium",
      marketImpact: "tryscorers",
      note: args.edgeAttack.note,
    });
  }

  // Injuries
  const injOutHome = args.injuriesOutHome ?? 0;
  const injOutAway = args.injuriesOutAway ?? 0;
  if (injOutHome + injOutAway > 0) {
    const d = injOutAway - injOutHome;
    drivers.push({
      label: "Injuries",
      direction: d > 0 ? "home" : d < 0 ? "away" : "neutral",
      strength: strengthFromAbs(d, 1, 3),
      marketImpact: "team strength",
      note: `${injOutHome} ${args.homeNickname} out, ${injOutAway} ${args.awayNickname} out.`,
    });
  }

  // Market value
  if (args.calibration && args.calibration.valueSignal !== "none") {
    drivers.push({
      label: "Market value",
      direction: args.calibration.valueSignal,
      strength: "medium",
      marketImpact: "match winner / EV",
      note: args.calibration.calibrationNote,
    });
  }

  // Head-to-head
  if (args.h2h.recentHeadToHeadGames > 0) {
    drivers.push({
      label: "Head-to-head",
      direction: args.h2h.avgMargin > 1 ? "home" : args.h2h.avgMargin < -1 ? "away" : "neutral",
      strength: strengthFromAbs(args.h2h.marginModifier, 1, 2.5),
      marketImpact: "margin / total",
      note: args.h2h.stylisticNote,
    });
  }

  // Weather
  if (args.weatherWet) {
    drivers.push({
      label: "Weather",
      direction: "neutral",
      strength: "small",
      marketImpact: "total points",
      note: "Wet conditions — total leans down.",
    });
  }

  return drivers;
}
