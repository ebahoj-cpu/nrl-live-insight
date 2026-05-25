// ============================================================================
// Supabase-backed cache for normalised NRL data.
//
// Two-layer cache:
//   1. In-memory (existing src/server/cache.ts) — ~15min, per-worker
//   2. Supabase nrl_source_cache table — survives across worker instances
//
// Stale-while-revalidate by default: returns stale data immediately and kicks
// off a background refresh. Used for fixtures / ladder / stats / team lists.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SourceCoverage } from "./nrl-data-types";
import { cached } from "./cache";

export type CacheKind =
  | "fixtures"
  | "ladder"
  | "team_stats"
  | "player_stats"
  | "team_list"
  | "match_result"
  | "historical"
  | "officials";

export type StoredEntry<T> = {
  payload: T;
  coverage: SourceCoverage;
  generatedAt: string;
  expiresAt: string;
  source: string;
};

const MEMORY_TTL_MS = 5 * 60_000;

export async function readCache<T>(kind: CacheKind, key: string): Promise<StoredEntry<T> | null> {
  return cached(`nrl-store:${kind}:${key}`, MEMORY_TTL_MS, async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("nrl_source_cache")
        .select("payload, source, source_coverage, generated_at, expires_at")
        .eq("kind", kind)
        .eq("cache_key", key)
        .maybeSingle();
      if (error || !data) return null;
      return {
        payload: data.payload as T,
        coverage: (data.source_coverage as SourceCoverage) ?? {
          primary: "cache",
          sourcesUsed: ["cache"],
          missingFields: [],
          lastUpdated: data.generated_at,
        },
        generatedAt: data.generated_at,
        expiresAt: data.expires_at,
        source: data.source,
      } as StoredEntry<T>;
    } catch (e) {
      console.warn(`[nrl-data-store] readCache failed kind=${kind} key=${key}:`, e);
      return null;
    }
  });
}

export async function writeCache<T>(args: {
  kind: CacheKind;
  key: string;
  payload: T;
  coverage: SourceCoverage;
  ttlMs: number;
  source: string;
}): Promise<void> {
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + args.ttlMs).toISOString();
  try {
    const { error } = await supabaseAdmin
      .from("nrl_source_cache")
      .upsert(
        [{
          kind: args.kind,
          cache_key: args.key,
          payload: args.payload as never,
          source: args.source,
          source_coverage: args.coverage as never,
          generated_at: generatedAt,
          expires_at: expiresAt,
        }],
        { onConflict: "kind,cache_key" },
      );
    if (error) {
      console.warn(`[nrl-data-store] writeCache failed kind=${args.kind} key=${args.key}:`, error.message);
    }
  } catch (e) {
    console.warn(`[nrl-data-store] writeCache exception kind=${args.kind}:`, e);
  }
}

// Stale-while-revalidate read. Returns whatever is in the cache (even expired)
// and triggers a background refresh if expired. If nothing is cached at all,
// awaits the fetcher.
const inflight = new Map<string, Promise<unknown>>();

export async function readWithRefresh<T>(args: {
  kind: CacheKind;
  key: string;
  ttlMs: number;
  source: string;
  fetcher: () => Promise<{ payload: T; coverage: SourceCoverage } | null>;
  forceRefresh?: boolean;
}): Promise<StoredEntry<T> | null> {
  const inflightKey = `${args.kind}:${args.key}`;
  const refresh = async (): Promise<StoredEntry<T> | null> => {
    if (inflight.has(inflightKey)) return inflight.get(inflightKey) as Promise<StoredEntry<T> | null>;
    const p = (async () => {
      try {
        const fetched = await args.fetcher();
        if (!fetched) return null;
        await writeCache({
          kind: args.kind,
          key: args.key,
          payload: fetched.payload,
          coverage: fetched.coverage,
          ttlMs: args.ttlMs,
          source: args.source,
        });
        return {
          payload: fetched.payload,
          coverage: fetched.coverage,
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + args.ttlMs).toISOString(),
          source: args.source,
        } as StoredEntry<T>;
      } finally {
        inflight.delete(inflightKey);
      }
    })();
    inflight.set(inflightKey, p);
    return p;
  };

  if (args.forceRefresh) return refresh();

  const existing = await readCache<T>(args.kind, args.key);
  if (existing) {
    const expired = Date.parse(existing.expiresAt) <= Date.now();
    if (expired) refresh().catch(() => {});
    return existing;
  }
  return refresh();
}

// ============================================================================
// High-level per-kind getters. These are what nrl-data-refresh.ts and the
// match-insights flow call. Each one:
//   1. Tries Supabase cache (stale-while-revalidate) for the right TTL.
//   2. Fetches NRL.com via nrlcom-client (primary).
//   3. Optionally fetches Zyla (enrichment) and merges.
//   4. Returns null on total failure — callers fall back to deterministic.
// ============================================================================

import * as nrlcom from "./nrlcom-client";
import * as zyla from "./zyla-client";
import * as M from "./nrl-data-merge";
import { makeCoverage } from "./source-coverage";
import type {
  NormalisedFixture,
  NormalisedLadder,
  NormalisedTeamList,
  NormalisedTeamStats,
  NormalisedPlayerStats,
  NormalisedMatchOfficial,
  NormalisedInjury,
  NormalisedHistoricalMatch,
} from "./nrl-data-types";

// ---------- TTL helpers ----------
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function fixtureTtl(f: NormalisedFixture | undefined, kickoffMs?: number): number {
  if (!f) return 6 * HOUR;
  if (f.status === "live") return MIN;
  if (f.status === "completed") {
    const ko = kickoffMs ?? Date.parse(f.kickoffUtc);
    const ageH = (Date.now() - ko) / HOUR;
    return ageH < 2 ? 5 * MIN : DAY;
  }
  // Scheduled — pre-match
  const ko = kickoffMs ?? Date.parse(f.kickoffUtc);
  const hoursUntil = (ko - Date.now()) / HOUR;
  if (hoursUntil > 24) return 6 * HOUR;
  return 15 * MIN;
}

function ladderTtl(): number {
  const day = new Date().getUTCDay();
  // Match days (Thu=4..Mon=1)
  const matchDay = day === 0 || day === 1 || day === 4 || day === 5 || day === 6;
  return matchDay ? 15 * MIN : 60 * MIN;
}

// Aggressive team-list TTLs so newly named/changed lineups are picked up fast.
// NRL publishes team lists Tuesday ~4pm AEST and revises them through to
// 1 hour before kickoff (late mail). We bias heavily toward freshness as
// kickoff approaches:
//   >48h  → 15min   (early week — squad shape rarely changes hour-to-hour)
//   ≤48h  → 5min    (Tuesday drop window + Wed/Thu changes)
//   ≤12h  → 2min    (match-day adjustments, illness, late ins/outs)
//   ≤3h   → 60s     (late mail / 1h-before-kick changes — must be fresh)
//   no kickoff info → 15min (safe default — assume mid-week)
// Stale-while-revalidate still serves instantly; TTL only controls when a
// background refetch is fired.
export function teamListTtl(kickoffUtc?: string): number {
  if (!kickoffUtc) return 15 * MIN;
  const hoursUntil = (Date.parse(kickoffUtc) - Date.now()) / HOUR;
  if (hoursUntil <= 3) return 60_000;          // 60s
  if (hoursUntil <= 12) return 2 * MIN;
  if (hoursUntil <= 48) return 5 * MIN;
  return 15 * MIN;
}

// ---------- Fixtures ----------
export async function getFixtures(args: { season: number; round?: number; forceRefresh?: boolean }): Promise<NormalisedFixture[] | null> {
  const key = `${args.season}:${args.round ?? "all"}`;
  const entry = await readWithRefresh<NormalisedFixture[]>({
    kind: "fixtures",
    key,
    ttlMs: 15 * MIN,
    source: "merged",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const primary = await nrlcom.getNrlDraw(args.season, args.round);
      let enrichment: NormalisedFixture[] | null = null;
      if (args.round != null) enrichment = await zyla.getZylaFixtures(args.season, args.round).catch(() => null);
      const merged = M.mergeFixtures(primary, enrichment);
      if (!merged.length) return null;
      return {
        payload: merged,
        coverage: makeCoverage({
          primary: primary?.length ? "nrl.com" : "zyla",
          sourcesUsed: [primary?.length ? "nrl.com" : null, enrichment?.length ? "zyla" : null].filter(Boolean) as ("nrl.com" | "zyla")[],
        }),
      };
    },
  });
  return entry?.payload ?? null;
}

export async function getFixtureByMatchId(args: { matchId: string; forceRefresh?: boolean }): Promise<NormalisedFixture | null> {
  // Parse season/round from matchId (e.g. "2026/round-8/...").
  const parts = args.matchId.split("/");
  const season = Number(parts[0]);
  const round = Number((parts[1] ?? "").replace(/\D/g, ""));
  if (!Number.isFinite(season) || !Number.isFinite(round)) return null;
  const list = await getFixtures({ season, round, forceRefresh: args.forceRefresh });
  return list?.find((f) => f.matchId === args.matchId) ?? null;
}

// ---------- Ladder ----------
export async function getLadder(args: { season: number; forceRefresh?: boolean }): Promise<NormalisedLadder | null> {
  const entry = await readWithRefresh<NormalisedLadder>({
    kind: "ladder",
    key: String(args.season),
    ttlMs: ladderTtl(),
    source: "merged",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const primary = await nrlcom.getNrlLadder(args.season);
      const enrichment = await zyla.getZylaLadder(args.season).catch(() => null);
      const merged = M.mergeLadder(primary, enrichment);
      if (!merged) return null;
      return { payload: merged, coverage: merged.coverage };
    },
  });
  return entry?.payload ?? null;
}

// ---------- Match details (passthrough cached) ----------
export async function getMatchDetails(args: { matchId: string; forceRefresh?: boolean }) {
  const entry = await readWithRefresh<unknown>({
    kind: "match_result",
    key: args.matchId,
    ttlMs: 5 * MIN,
    source: "nrl.com",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const d = await nrlcom.getNrlMatchDetails(args.matchId);
      if (!d) return null;
      return { payload: d, coverage: makeCoverage({ primary: "nrl.com" }) };
    },
  });
  return entry?.payload ?? null;
}

// ---------- Team lists ----------
// Tracks which rounds have had a recent round-wide background sweep so
// requesting one match's team list doesn't fan out NRL.com calls every
// single time. One sweep per round per 2 minutes is plenty.
const roundSweepAt = new Map<string, number>();
const ROUND_SWEEP_INTERVAL_MS = 2 * MIN;

export async function getTeamLists(args: { matchId: string; kickoffUtc?: string; forceRefresh?: boolean }): Promise<{ home: NormalisedTeamList; away: NormalisedTeamList } | null> {
  const entry = await readWithRefresh<{ home: NormalisedTeamList; away: NormalisedTeamList }>({
    kind: "team_list",
    key: args.matchId,
    ttlMs: teamListTtl(args.kickoffUtc),
    source: "nrl.com",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const tl = await nrlcom.getNrlTeamLists(args.matchId);
      if (!tl) return null;
      return { payload: tl, coverage: tl.home.coverage };
    },
  });

  // Soft background sweep: opening one match keeps the whole round fresh.
  // Throttled per (season, round) so we never hammer NRL.com. Each sibling
  // match is fetched through readWithRefresh, so its own TTL/SWR rules apply —
  // if a sibling is still fresh, nothing is refetched. Errors are swallowed.
  void maybeSweepRoundTeamLists(args.matchId).catch(() => {});

  return entry?.payload ?? null;
}

async function maybeSweepRoundTeamLists(triggerMatchId: string): Promise<void> {
  const parts = triggerMatchId.split("/");
  const season = Number(parts[0]);
  const round = Number((parts[1] ?? "").replace(/\D/g, ""));
  if (!Number.isFinite(season) || !Number.isFinite(round)) return;
  const roundKey = `${season}:${round}`;
  const last = roundSweepAt.get(roundKey) ?? 0;
  if (Date.now() - last < ROUND_SWEEP_INTERVAL_MS) return;
  roundSweepAt.set(roundKey, Date.now());

  const fixtures = await getFixtures({ season, round }).catch(() => null);
  if (!fixtures) return;
  const now = Date.now();
  // Only sweep matches that haven't kicked off yet (or finished long ago is N/A).
  const upcoming = fixtures.filter((f) => {
    if (f.matchId === triggerMatchId) return false;
    const ko = Date.parse(f.kickoffUtc);
    return Number.isFinite(ko) && ko > now - 30 * MIN; // include just-kicked-off
  });
  // Fire-and-forget; each call is SWR + throttled by its own TTL.
  await Promise.allSettled(
    upcoming.map((f) => getTeamLists({ matchId: f.matchId, kickoffUtc: f.kickoffUtc })),
  );
}


// ---------- Injuries ----------
export async function getInjuries(args: { matchId: string; forceRefresh?: boolean }): Promise<NormalisedInjury[] | null> {
  const entry = await readWithRefresh<NormalisedInjury[]>({
    kind: "officials",
    key: `injuries:${args.matchId}`,
    ttlMs: 2 * HOUR,
    source: "nrl.com",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const inj = await nrlcom.getNrlInjuries(args.matchId);
      if (!inj) return null;
      return { payload: inj, coverage: makeCoverage({ primary: "nrl.com" }) };
    },
  });
  return entry?.payload ?? null;
}

// ---------- Match officials ----------
export async function getMatchOfficials(args: { matchId: string; forceRefresh?: boolean }): Promise<NormalisedMatchOfficial[] | null> {
  const entry = await readWithRefresh<NormalisedMatchOfficial[]>({
    kind: "officials",
    key: args.matchId,
    ttlMs: DAY,
    source: "nrl.com",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const offs = await nrlcom.getNrlMatchOfficials(args.matchId);
      if (!offs) return null;
      return { payload: offs, coverage: makeCoverage({ primary: "nrl.com" }) };
    },
  });
  return entry?.payload ?? null;
}

// ---------- Historical ----------
export async function getHistoricalMatches(args: { season: number; rounds?: number[]; forceRefresh?: boolean }): Promise<NormalisedHistoricalMatch[] | null> {
  const entry = await readWithRefresh<NormalisedHistoricalMatch[]>({
    kind: "historical",
    key: `${args.season}:${args.rounds?.join(",") ?? "all"}`,
    ttlMs: 12 * HOUR,
    source: "nrl.com",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const hist = await nrlcom.getNrlHistoricalMatches(args.season, args.rounds);
      if (!hist) return null;
      return { payload: hist, coverage: makeCoverage({ primary: "nrl.com" }) };
    },
  });
  return entry?.payload ?? null;
}

// ---------- Team / player season stats ----------
export async function getTeamStats(args: { season: number; forceRefresh?: boolean }): Promise<NormalisedTeamStats[] | null> {
  const entry = await readWithRefresh<NormalisedTeamStats[]>({
    kind: "team_stats",
    key: String(args.season),
    ttlMs: 6 * HOUR,
    source: "nrl.com",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const stats = await nrlcom.getNrlTeamStats(args.season);
      if (!stats || !stats.length) return null;
      return { payload: stats, coverage: makeCoverage({ primary: "nrl.com" }) };
    },
  });
  return entry?.payload ?? null;
}

export async function getPlayerStats(args: { season: number; forceRefresh?: boolean }): Promise<NormalisedPlayerStats[] | null> {
  const entry = await readWithRefresh<NormalisedPlayerStats[]>({
    kind: "player_stats",
    key: String(args.season),
    ttlMs: 6 * HOUR,
    source: "merged",
    forceRefresh: args.forceRefresh,
    fetcher: async () => {
      const primary = await nrlcom.getNrlPlayerStats(args.season);
      // Zyla "all players" is fine at season level as enrichment for missing fields.
      const merged = M.mergePlayerStats(primary, null);
      if (!merged.length) return null;
      return {
        payload: merged,
        coverage: makeCoverage({ primary: primary?.length ? "nrl.com" : "zyla" }),
      };
    },
  });
  return entry?.payload ?? null;
}

// ---------- Bundle for simulation feature builder ----------
export type EnrichedMatchBundle = {
  fixture: NormalisedFixture | null;
  teamLists: { home: NormalisedTeamList; away: NormalisedTeamList } | null;
  homeTeamStats: NormalisedTeamStats | null;
  awayTeamStats: NormalisedTeamStats | null;
  playerStats: NormalisedPlayerStats[];
  injuries: NormalisedInjury[];
  officials: NormalisedMatchOfficial[];
};

export async function getEnrichedMatchBundle(args: {
  matchId: string;
  season: number;
  homeNickname: string;
  awayNickname: string;
  kickoffUtc?: string;
  forceRefresh?: boolean;
}): Promise<EnrichedMatchBundle> {
  const [fixture, teamLists, teamStats, playerStats, injuries, officials] = await Promise.all([
    getFixtureByMatchId({ matchId: args.matchId, forceRefresh: args.forceRefresh }).catch(() => null),
    getTeamLists({ matchId: args.matchId, kickoffUtc: args.kickoffUtc, forceRefresh: args.forceRefresh }).catch(() => null),
    getTeamStats({ season: args.season, forceRefresh: args.forceRefresh }).catch(() => null),
    getPlayerStats({ season: args.season, forceRefresh: args.forceRefresh }).catch(() => null),
    getInjuries({ matchId: args.matchId, forceRefresh: args.forceRefresh }).catch(() => null),
    getMatchOfficials({ matchId: args.matchId, forceRefresh: args.forceRefresh }).catch(() => null),
  ]);
  const lc = (s: string) => s.toLowerCase();
  return {
    fixture,
    teamLists,
    homeTeamStats: teamStats?.find((t) => lc(t.nickname) === lc(args.homeNickname)) ?? null,
    awayTeamStats: teamStats?.find((t) => lc(t.nickname) === lc(args.awayNickname)) ?? null,
    playerStats: playerStats ?? [],
    injuries: injuries ?? [],
    officials: officials ?? [],
  };
}
