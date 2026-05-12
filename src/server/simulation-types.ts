// ============================================================================
// Simulation types — the contract between the feature builder, the Monte Carlo
// engine and the consumers (insights, fair odds, value engine, Bets tab).
// ============================================================================

import type { ConfidenceTier } from "./confidence";
import type { SourceCoverage } from "./nrl-data-types";
import type { HeadToHeadProfile } from "./head-to-head-model";
import type { RefereeProfile } from "./referee-model";
import type { FatigueProfile } from "./fatigue-model";
import type { RuckTempoProfile } from "./ruck-tempo-model";
import type { EdgeAttackProfile } from "./edge-attack-model";
import type { MomentumProfile } from "./momentum-wave-model";
import type { CalibrationResult } from "./probability-calibration";
import type { ModelDriver } from "./model-driver-explainer";

export type TeamFeatures = {
  nickname: string;
  // Core attacking strength
  pointsForPerGame: number;
  pointsAgainstPerGame: number;
  triesPerGame: number;
  triesAgainstPerGame: number;
  // Possession / territory
  metresPerGame: number;
  postContactMetresPerGame: number;
  completionRate: number;        // 0..1
  errorsPerGame: number;
  penaltiesPerGame: number;
  tackleBreaksPerGame: number;
  lineBreaksPerGame: number;
  // Form
  recentForm: number;            // -1..+1
  // Tempo / fatigue
  ruckPressureRating: number;    // 0..100, normalised league-average ~50
  fatigueIndex: number;          // 0..100, higher = more fatigued / risky
  // Conversion (set goal kicker assumed)
  conversionRate: number;        // 0..1
};

export type EdgeChannel = "left" | "middle" | "right";
export type PlayerFeature = {
  playerId: number;
  name: string;
  position: string;
  teamNickname: string;
  // Per-game attacking involvement
  triesPerGame: number;
  lineBreaksPerGame: number;
  tryAssistsPerGame: number;
  tackleBreaksPerGame: number;
  // Edge usage — which channel this player attacks from most.
  edgeChannel: EdgeChannel;
  // Probability the player is on field at kickoff (0..1). Drops if listed as
  // doubtful, climbs to 1 after late mail clears them.
  availabilityProb: number;
};

export type RefereeFeatures = {
  name: string;
  penaltyTendency: number;       // -1..+1 vs league average
  totalsTendency: number;        // -1..+1 vs league average totals
  homeBias: number;              // -1..+1
};

export type SimulationInput = {
  matchId: string;
  homeFeatures: TeamFeatures;
  awayFeatures: TeamFeatures;
  homePlayers: PlayerFeature[];
  awayPlayers: PlayerFeature[];
  referee?: RefereeFeatures;
  // Modifiers
  homeAdvantage: number;         // expected-points lift for home, default ~3
  weatherTempoModifier?: number; // -1..+1, negative = wet/slow
  // Reproducibility
  seed: number;
  iterations: number;
  // Provenance
  coverage: SourceCoverage;
  modelMode: "early" | "squad" | "market" | "final";
};

// ---------- Outputs ----------
export type MarginBand = "draw" | "1-12" | "13+";

export type PlayerProbability = {
  playerId: number;
  name: string;
  teamNickname: string;
  position: string;
  // Probability they score the FIRST try.
  firstTryProb: number;
  // Probability they score AT LEAST ONE try (anytime).
  anytimeProb: number;
  // Probability they score 2+ tries.
  multiTryProb: number;
  // Per-game projection used for ranking.
  expectedTries: number;
};

export type SimulationSummary = {
  matchId: string;
  iterations: number;
  seed: number;
  // Outcome
  homeWinProb: number;
  awayWinProb: number;
  drawProb: number;
  // Score / total
  expectedHomeScore: number;
  expectedAwayScore: number;
  expectedTotal: number;
  totalLine: number;             // nearest .5 to expected
  overProbAtLine: number;
  // Margin
  expectedMargin: number;        // signed: positive = home win
  marginBands: { draw: number; "1-12": number; "13+": number };
  upsetProb: number;             // weak side wins
  blowoutProb: number;           // any side by 13+
  // HT / FT
  htftProbabilities: Record<string, number>; // e.g. "home/home", "home/away"
  // Tryscorer markets
  playerProbabilities: PlayerProbability[];
  // Confidence + provenance
  confidence: ConfidenceTier;
  coverage: SourceCoverage;
  generatedAt: string;
};
