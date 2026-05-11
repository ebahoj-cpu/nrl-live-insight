// ============================================================================
// Multi-source merge.
//
// Combines normalised payloads from NRL.com (primary), Zyla (enrichment) and
// cache (fallback). Always prefers NRL.com when present; uses Zyla only to
// fill missing fields; falls through to cache and finally to the deterministic
// engine's existing snapshot if everything else is gone.
//
// The merge functions are intentionally narrow — one per data kind — so a
// future change to merge logic for ladder doesn't accidentally affect player
// stats. The frontend never calls these directly; they sit between the data
// clients and the simulation/insights engines.
// ============================================================================

import type {
  NormalisedFixture,
  NormalisedLadder,
  NormalisedTeamStats,
  NormalisedTeamList,
  SourceCoverage,
} from "./nrl-data-types";
import { mergeCoverage, makeCoverage } from "./source-coverage";

type Maybe<T> = T | null | undefined;

// Merge two ladder payloads. NRL.com rows win on every field; Zyla fills gaps.
export function mergeLadder(
  primary: Maybe<NormalisedLadder>,
  enrichment: Maybe<NormalisedLadder>,
): NormalisedLadder | null {
  if (!primary && !enrichment) return null;
  if (!primary) return enrichment!;
  if (!enrichment) return primary;
  const byNick = new Map<string, NormalisedLadder["rows"][number]>();
  for (const row of enrichment.rows) byNick.set(row.nickname.toLowerCase(), row);
  // Overwrite with primary
  for (const row of primary.rows) byNick.set(row.nickname.toLowerCase(), row);
  return {
    season: primary.season,
    rows: Array.from(byNick.values()).sort((a, b) => a.position - b.position),
    coverage: mergeCoverage(primary.coverage, enrichment.coverage),
  };
}

// Merge fixtures by matchId. Primary wins; enrichment fills missing scalar fields.
export function mergeFixtures(
  primary: Maybe<NormalisedFixture[]>,
  enrichment: Maybe<NormalisedFixture[]>,
): NormalisedFixture[] {
  const out = new Map<string, NormalisedFixture>();
  for (const f of enrichment ?? []) out.set(f.matchId, f);
  for (const f of primary ?? []) {
    const existing = out.get(f.matchId);
    if (!existing) { out.set(f.matchId, f); continue; }
    out.set(f.matchId, {
      ...existing,
      ...stripUndefined(f),
      coverage: mergeCoverage(existing.coverage, f.coverage),
    });
  }
  return Array.from(out.values()).sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));
}

// Merge per-team stats (one entry per nickname).
export function mergeTeamStats(
  primary: Maybe<NormalisedTeamStats[]>,
  enrichment: Maybe<NormalisedTeamStats[]>,
): NormalisedTeamStats[] {
  const out = new Map<string, NormalisedTeamStats>();
  for (const t of enrichment ?? []) out.set(t.nickname.toLowerCase(), t);
  for (const t of primary ?? []) {
    const existing = out.get(t.nickname.toLowerCase());
    if (!existing) { out.set(t.nickname.toLowerCase(), t); continue; }
    out.set(t.nickname.toLowerCase(), { ...existing, ...stripZero(t) });
  }
  return Array.from(out.values());
}

// Merge a team list. Primary wins; enrichment fills headshot URLs / metadata
// only when the primary's player has a missing field.
export function mergeTeamList(
  primary: Maybe<NormalisedTeamList>,
  enrichment: Maybe<NormalisedTeamList>,
): NormalisedTeamList | null {
  if (!primary && !enrichment) return null;
  if (!primary) return enrichment!;
  if (!enrichment) return primary;
  const enrichmentById = new Map(enrichment.players.map((p) => [p.playerId, p]));
  const players = primary.players.map((p) => {
    const e = enrichmentById.get(p.playerId);
    if (!e) return p;
    return {
      ...p,
      headshotUrl: p.headshotUrl ?? e.headshotUrl,
      jerseyNumber: p.jerseyNumber ?? e.jerseyNumber,
      position: p.position || e.position,
    };
  });
  return {
    ...primary,
    players,
    coverage: mergeCoverage(primary.coverage, enrichment.coverage),
  };
}

// Helpers -------------------------------------------------------------------
function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}
function stripZero<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== 0 && v !== "") out[k] = v;
  }
  return out;
}

// Re-export so callers can build a coverage record without two imports.
export { makeCoverage };
export type { SourceCoverage };
