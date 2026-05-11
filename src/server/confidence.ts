// ============================================================================
// Confidence system.
//
// Maps the raw signal quality of a prediction onto a discrete tier:
//   high   — model output backed by complete, fresh, primary-source data
//   medium — partial data, or single-source coverage, or moderately stale
//   low    — fallback used, team lists missing, or many fields estimated
//
// Used by the Insights tab to soften language and by the Bets tab to suppress
// weak edges.
// ============================================================================

import type { SourceCoverage } from "./nrl-data-types";
import { coverageScore } from "./source-coverage";

export type ConfidenceTier = "low" | "medium" | "high";

export type ConfidenceInputs = {
  coverage: SourceCoverage;
  // Probability mass for the predicted outcome (e.g. 0.62 home win).
  // The further from 0.5, the more confident the model itself is.
  modelProbability: number;
  // Number of Monte Carlo iterations behind the prediction.
  iterations: number;
  // Has the team list been released? Drops confidence to medium-max otherwise.
  squadsNamed: boolean;
  // True when player-level odds (anytime tryscorer) are in. Needed for "high".
  marketAvailable: boolean;
  // Optional referee data flag — adds a small boost.
  hasOfficials?: boolean;
};

export type ConfidenceResult = {
  tier: ConfidenceTier;
  score: number;             // 0..100
  drivers: string[];         // human-readable reasons used in UI tooltips
};

export function computeConfidence(inp: ConfidenceInputs): ConfidenceResult {
  const drivers: string[] = [];
  let score = coverageScore(inp.coverage);

  // Model edge: how far from a coin flip is the prediction?
  const edge = Math.abs(inp.modelProbability - 0.5) * 2; // 0..1
  score += edge * 20; // up to +20 for a near-certain outcome
  if (edge > 0.4) drivers.push("Model strongly favours one side");
  else if (edge < 0.1) drivers.push("Coin-flip game — model edge is thin");

  // Iteration count
  if (inp.iterations >= 10_000) score += 5;
  else if (inp.iterations < 2_000) { score -= 10; drivers.push("Low simulation iteration count"); }

  // Squad gating
  if (!inp.squadsNamed) {
    score -= 25;
    drivers.push("Team lists not yet named");
  }

  // Market availability
  if (inp.marketAvailable) { score += 5; drivers.push("Market odds released"); }
  if (inp.hasOfficials) score += 3;

  // Coverage notes
  if (inp.coverage.primary === "fallback") drivers.push("Using deterministic fallback");
  else if (inp.coverage.primary === "cache") drivers.push("Using cached data");
  if (inp.coverage.missingFields.length > 0) {
    drivers.push(`${inp.coverage.missingFields.length} fields missing or estimated`);
  }

  const clamped = Math.max(0, Math.min(100, score));
  const tier: ConfidenceTier =
    !inp.squadsNamed ? (clamped >= 60 ? "medium" : "low")
    : clamped >= 75 ? "high"
    : clamped >= 50 ? "medium"
    : "low";

  return { tier, score: clamped, drivers };
}

// Soften assertive language when confidence is low. Used by Insights/Script.
export function softenLanguage(text: string, tier: ConfidenceTier): string {
  if (tier === "high") return text;
  const replacements: [RegExp, string][] =
    tier === "medium"
      ? [[/\bcertain(ly)?\b/gi, "likely"], [/\bwill\b/gi, "should"]]
      : [
          [/\bcertain(ly)?\b/gi, "could"],
          [/\bwill\b/gi, "may"],
          [/\bguaranteed\b/gi, "possible"],
          [/\bbest bet\b/gi, "lean"],
        ];
  return replacements.reduce((s, [r, w]) => s.replace(r, w), text);
}
