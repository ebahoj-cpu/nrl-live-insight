// ============================================================================
// Referee Profile (Phase 4)
//
// Thin wrapper exposing the referee-model output. Kept as a separate file so
// future profile sources (per-season averages, historical match aggregates)
// can be plugged in without touching the model maths.
// ============================================================================

import type { NormalisedMatchOfficial } from "./nrl-data-types";
import { buildRefereeProfile, neutralReferee, type RefereeProfile } from "./referee-model";

export type { RefereeProfile } from "./referee-model";

export function getRefereeProfile(officials?: NormalisedMatchOfficial[] | null): RefereeProfile {
  if (!officials || officials.length === 0) return neutralReferee();
  return buildRefereeProfile(officials);
}
