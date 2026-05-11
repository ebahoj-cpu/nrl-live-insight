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

import type {
  NormalisedPlayerStats,
  NormalisedMatchOfficial,
  NormalisedInjury,
  NormalisedHistoricalMatch,
  NormalisedMatchResult,
} from "./nrl-data-types";
import { addNote } from "./source-coverage";

// Merge a single fixture (NRL.com wins; Zyla fills missing scalars; conflict noted).
export function mergeFixture(
  primary: Maybe<NormalisedFixture>,
  enrichment: Maybe<NormalisedFixture>,
): NormalisedFixture | null {
  if (!primary && !enrichment) return null;
  if (!primary) return enrichment!;
  if (!enrichment) return primary;
  let coverage = mergeCoverage(primary.coverage, enrichment.coverage);
  // Note any score conflict.
  if (primary.homeScore != null && enrichment.homeScore != null && primary.homeScore !== enrichment.homeScore) {
    coverage = addNote(coverage, `conflict:homeScore primary=${primary.homeScore} other=${enrichment.homeScore}`);
  }
  if (primary.awayScore != null && enrichment.awayScore != null && primary.awayScore !== enrichment.awayScore) {
    coverage = addNote(coverage, `conflict:awayScore primary=${primary.awayScore} other=${enrichment.awayScore}`);
  }
  return {
    ...enrichment,
    ...stripUndefined(primary),
    coverage,
  } as NormalisedFixture;
}

// Merge match details — primary wins outright; enrichment ignored beyond coverage.
export function mergeMatchDetails<T extends { coverage?: SourceCoverage }>(
  primary: Maybe<T>,
  enrichment: Maybe<T>,
): T | null {
  if (!primary && !enrichment) return null;
  if (!primary) return enrichment!;
  if (!enrichment) return primary;
  // Primary always wins; just merge coverage if both exist.
  const coverage = primary.coverage && enrichment.coverage
    ? mergeCoverage(primary.coverage, enrichment.coverage)
    : (primary.coverage ?? enrichment.coverage);
  return { ...primary, coverage } as T;
}

// Merge two team-list dictionaries indexed by side.
export function mergeTeamLists(
  primary: Maybe<{ home: NormalisedTeamList; away: NormalisedTeamList }>,
  enrichment: Maybe<{ home: NormalisedTeamList; away: NormalisedTeamList }>,
): { home: NormalisedTeamList; away: NormalisedTeamList } | null {
  if (!primary && !enrichment) return null;
  if (!primary) return enrichment!;
  if (!enrichment) return primary;
  return {
    home: mergeTeamList(primary.home, enrichment.home)!,
    away: mergeTeamList(primary.away, enrichment.away)!,
  };
}

export function mergePlayerStats(
  primary: Maybe<NormalisedPlayerStats[]>,
  enrichment: Maybe<NormalisedPlayerStats[]>,
): NormalisedPlayerStats[] {
  const out = new Map<string, NormalisedPlayerStats>();
  for (const p of enrichment ?? []) {
    if (!p || !p.name) continue; // reject malformed rows
    out.set(p.playerId ? `id:${p.playerId}` : `n:${p.name.toLowerCase()}`, p);
  }
  for (const p of primary ?? []) {
    if (!p || !p.name) continue;
    const key = p.playerId ? `id:${p.playerId}` : `n:${p.name.toLowerCase()}`;
    const existing = out.get(key);
    if (!existing) out.set(key, p);
    else out.set(key, { ...existing, ...stripZero(p) });
  }
  return Array.from(out.values());
}

export function mergeInjuries(
  primary: Maybe<NormalisedInjury[]>,
  enrichment: Maybe<NormalisedInjury[]>,
): NormalisedInjury[] {
  const out = new Map<string, NormalisedInjury>();
  for (const i of enrichment ?? []) {
    if (!i || !i.name) continue;
    out.set(`${i.teamNickname}:${i.name.toLowerCase()}`, i);
  }
  for (const i of primary ?? []) {
    if (!i || !i.name) continue;
    out.set(`${i.teamNickname}:${i.name.toLowerCase()}`, i);
  }
  return Array.from(out.values());
}

export function mergeMatchOfficials(
  primary: Maybe<NormalisedMatchOfficial[]>,
  enrichment: Maybe<NormalisedMatchOfficial[]>,
): NormalisedMatchOfficial[] {
  // Prefer primary; only fall back to enrichment if primary is empty/missing.
  if (primary && primary.length) return primary;
  return enrichment ?? [];
}

export function mergeHistoricalMatches(
  primary: Maybe<NormalisedHistoricalMatch[]>,
  enrichment: Maybe<NormalisedHistoricalMatch[]>,
): NormalisedHistoricalMatch[] {
  const out = new Map<string, NormalisedHistoricalMatch>();
  for (const h of enrichment ?? []) {
    if (!h || !h.matchId) continue;
    out.set(h.matchId, h);
  }
  for (const h of primary ?? []) {
    if (!h || !h.matchId) continue;
    out.set(h.matchId, h);
  }
  return Array.from(out.values());
}

export function mergeMatchResult(
  primary: Maybe<NormalisedMatchResult>,
  enrichment: Maybe<NormalisedMatchResult>,
): NormalisedMatchResult | null {
  return primary ?? enrichment ?? null;
}
