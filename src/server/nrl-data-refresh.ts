// ============================================================================
// Refresh orchestrator. Used by /api/public/hooks/refresh-nrl-data.
// Each function force-refreshes a kind via the data store and returns a
// safe summary (no secrets, no raw payloads).
// ============================================================================

import * as store from "./nrl-data-store";

export type RefreshSummary = {
  mode: string;
  refreshed: number;
  failed: number;
  keys: string[];
  coverageSummary: Record<string, number>;
};

function summarise(mode: string, results: { ok: boolean; key: string; primary?: string }[]): RefreshSummary {
  const refreshed = results.filter((r) => r.ok).length;
  const cov: Record<string, number> = {};
  for (const r of results) if (r.ok && r.primary) cov[r.primary] = (cov[r.primary] ?? 0) + 1;
  return {
    mode,
    refreshed,
    failed: results.length - refreshed,
    keys: results.filter((r) => r.ok).map((r) => r.key),
    coverageSummary: cov,
  };
}

export async function refreshFixtures(season: number, round?: number): Promise<RefreshSummary> {
  const out = await store.getFixtures({ season, round, forceRefresh: true }).catch(() => null);
  return summarise("fixtures", [{ ok: !!out, key: `${season}:${round ?? "all"}`, primary: out?.[0]?.coverage.primary }]);
}
export async function refreshLadder(season: number): Promise<RefreshSummary> {
  const out = await store.getLadder({ season, forceRefresh: true }).catch(() => null);
  return summarise("ladder", [{ ok: !!out, key: String(season), primary: out?.coverage.primary }]);
}
export async function refreshMatch(matchId: string): Promise<RefreshSummary> {
  const out = await store.getMatchDetails({ matchId, forceRefresh: true }).catch(() => null);
  return summarise("match", [{ ok: !!out, key: matchId, primary: "nrl.com" }]);
}
export async function refreshTeamLists(matchId: string): Promise<RefreshSummary> {
  const out = await store.getTeamLists({ matchId, forceRefresh: true }).catch(() => null);
  return summarise("teamlists", [{ ok: !!out, key: matchId, primary: out?.home.coverage.primary }]);
}
export async function refreshInjuries(matchId: string): Promise<RefreshSummary> {
  const out = await store.getInjuries({ matchId, forceRefresh: true }).catch(() => null);
  return summarise("injuries", [{ ok: !!out, key: matchId, primary: "nrl.com" }]);
}
export async function refreshOfficials(matchId: string): Promise<RefreshSummary> {
  const out = await store.getMatchOfficials({ matchId, forceRefresh: true }).catch(() => null);
  return summarise("officials", [{ ok: !!out, key: matchId, primary: "nrl.com" }]);
}
export async function refreshHistorical(season: number, rounds?: number[]): Promise<RefreshSummary> {
  const out = await store.getHistoricalMatches({ season, rounds, forceRefresh: true }).catch(() => null);
  return summarise("historical", [{ ok: !!out, key: `${season}:${rounds?.join(",") ?? "all"}`, primary: "nrl.com" }]);
}
export async function refreshTeamStats(season: number): Promise<RefreshSummary> {
  const out = await store.getTeamStats({ season, forceRefresh: true }).catch(() => null);
  return summarise("teamstats", [{ ok: !!out, key: String(season), primary: "nrl.com" }]);
}
export async function refreshPlayerStats(season: number): Promise<RefreshSummary> {
  const out = await store.getPlayerStats({ season, forceRefresh: true }).catch(() => null);
  return summarise("playerstats", [{ ok: !!out, key: String(season), primary: "nrl.com" }]);
}

export async function refreshAll(args: { season: number; round?: number; matchId?: string }): Promise<RefreshSummary> {
  const sub = await Promise.all([
    refreshFixtures(args.season, args.round),
    refreshLadder(args.season),
    refreshTeamStats(args.season),
    refreshPlayerStats(args.season),
    ...(args.matchId ? [
      refreshMatch(args.matchId),
      refreshTeamLists(args.matchId),
      refreshInjuries(args.matchId),
      refreshOfficials(args.matchId),
    ] : []),
  ]);
  const refreshed = sub.reduce((a, b) => a + b.refreshed, 0);
  const failed = sub.reduce((a, b) => a + b.failed, 0);
  const keys = sub.flatMap((s) => s.keys);
  const cov: Record<string, number> = {};
  for (const s of sub) for (const [k, v] of Object.entries(s.coverageSummary)) cov[k] = (cov[k] ?? 0) + v;
  return { mode: "all", refreshed, failed, keys, coverageSummary: cov };
}
