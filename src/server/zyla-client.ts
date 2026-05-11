// ============================================================================
// Zyla NRL Data API normalised adapter (ENRICHMENT-ONLY).
//
// All Zyla calls are wrapped to:
//   1. Return null safely when ZYLA_NRL_TOKEN / ZYLA_API_KEY isn't configured.
//   2. Reject malformed rows (e.g. shifted columns) instead of throwing.
//   3. Coerce numeric strings to numbers.
//   4. Log only safe metadata (status code, count) — never the token or raw payload.
//
// IMPORTANT: never call from frontend code, never let Zyla overwrite NRL.com.
// ============================================================================

import { cached } from "./cache";
import {
  fetchZylaLadder,
  fetchZylaFixtures,
  fetchZylaMatchDetails,
  ZYLA_NAME_MAP,
} from "./zyla";
import type {
  NormalisedFixture,
  NormalisedLadder,
  NormalisedPlayer,
  NormalisedPlayerStats,
} from "./nrl-data-types";
import { makeCoverage } from "./source-coverage";

// Centralised endpoint config. IDs verified against the public Zyla portal —
// player endpoints (17262 / 17263) flagged for verification at first hit.
const BASE = "https://zylalabs.com/api/4535/nrl+data+api";
const ENDPOINTS = {
  // Verified, in production already:
  ladder: "5576/ladder",
  fixture: "5577/fixture",
  matchDetails: "5578/match+details",
  // TODO_VERIFY: confirm these IDs and shapes against the live Zyla portal
  // before relying on them in production. Marked as enrichment-only — the
  // sim engine can still run if these return null.
  allPlayers: "17262/all+players",          // TODO_VERIFY
  playerStatistics: "17263/player+statistics", // TODO_VERIFY
} as const;

const TTL_PLAYERS = 24 * 60 * 60_000; // 24h — squad lists barely change

function token(): string | null {
  const t = process.env.ZYLA_NRL_TOKEN ?? process.env.ZYLA_API_KEY;
  return t && t.length > 0 ? t : null;
}

async function safeGet<T>(pathAndQuery: string, label: string): Promise<T | null> {
  const tok = token();
  if (!tok) return null;
  try {
    const res = await fetch(`${BASE}/${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
    });
    if (!res.ok) {
      // Never log status alongside any header that might echo the token.
      console.warn(`[zyla-client] ${label} HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { status?: string; data?: unknown; message?: string };
    if (json.status && json.status !== "success") {
      console.warn(`[zyla-client] ${label} non-success: ${json.message ?? json.status}`);
      return null;
    }
    return json.data as T;
  } catch (e) {
    // Only the message — never the stack (might leak url with query strings).
    const msg = e instanceof Error ? e.message : "error";
    console.warn(`[zyla-client] ${label} error: ${msg}`);
    return null;
  }
}

function num(v: unknown, def = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }
  return def;
}

function resolveTeam(raw: string | undefined): { nickname: string; themeKey: string; teamId: number } {
  const k = (raw ?? "").trim().toLowerCase();
  return ZYLA_NAME_MAP[k] ?? { nickname: raw ?? "", themeKey: "", teamId: 0 };
}

// ---------- Ladder ----------
export async function getZylaLadder(season: number): Promise<NormalisedLadder | null> {
  const rows = await fetchZylaLadder(season);
  if (!rows || rows.length === 0) return null;
  return {
    season,
    rows: rows.map((r) => ({
      position: r.position,
      teamId: r.teamId,
      nickname: r.nickname,
      themeKey: r.themeKey,
      played: r.played,
      wins: r.wins,
      losses: r.losses,
      drawn: r.drawn,
      byes: r.byes,
      points: r.points,
      pointsFor: r.for,
      pointsAgainst: r.against,
      pointsDiff: r.diff,
    })),
    coverage: makeCoverage({ primary: "zyla" }),
  };
}

// ---------- Fixtures ----------
export async function getZylaFixtures(season: number, round: number): Promise<NormalisedFixture[] | null> {
  const raw = await fetchZylaFixtures(season, round);
  if (!raw) return null;
  const out: NormalisedFixture[] = [];
  for (const f of raw) {
    if (!f || !f.match_id) continue; // missing matchId → reject
    const home = resolveTeam(f.home_team);
    const away = resolveTeam(f.away_team);
    if (!home.nickname || !away.nickname) continue; // missing teams → reject
    // Date parse safety
    const dateStr = `${f.date ?? ""}T${f.time ?? "00:00"}:00Z`;
    const ko = Date.parse(dateStr);
    if (!Number.isFinite(ko)) continue; // unparsable date → reject
    const homeScore = f.home_score != null ? num(f.home_score) : undefined;
    const awayScore = f.away_score != null ? num(f.away_score) : undefined;
    // Reject impossible scores (negative or >120).
    if (homeScore != null && (homeScore < 0 || homeScore > 120)) continue;
    if (awayScore != null && (awayScore < 0 || awayScore > 120)) continue;
    out.push({
      matchId: String(f.match_id),
      season,
      round,
      kickoffUtc: new Date(ko).toISOString(),
      venue: f.venue ?? "",
      homeTeamId: home.teamId,
      homeNickname: home.nickname,
      homeThemeKey: home.themeKey,
      awayTeamId: away.teamId,
      awayNickname: away.nickname,
      awayThemeKey: away.themeKey,
      status: homeScore != null ? "completed" : "scheduled",
      homeScore,
      awayScore,
      coverage: makeCoverage({ primary: "zyla" }),
    });
  }
  return out;
}

// ---------- Match details (raw passthrough — used as enrichment fallback) ----------
export async function getZylaMatchDetails(matchId: string, finished = false): Promise<unknown | null> {
  return fetchZylaMatchDetails(matchId, finished);
}

// ---------- All players (TODO_VERIFY) ----------
type ZylaPlayer = {
  player_id?: string | number;
  first_name?: string;
  last_name?: string;
  position?: string;
  jersey_number?: string | number;
  team?: string;
  headshot?: string;
};

export async function getZylaAllPlayers(params?: { season?: number; team?: string }): Promise<NormalisedPlayer[] | null> {
  return cached(`zyla:players:${params?.season ?? "all"}:${params?.team ?? "all"}`, TTL_PLAYERS, async () => {
    const qs = new URLSearchParams();
    if (params?.season) qs.set("season", String(params.season));
    if (params?.team) qs.set("team", params.team);
    const data = await safeGet<ZylaPlayer[]>(`${ENDPOINTS.allPlayers}${qs.toString() ? `?${qs.toString()}` : ""}`, `players`);
    if (!data || !Array.isArray(data)) return null;
    const out: NormalisedPlayer[] = [];
    for (const p of data) {
      if (!p || (!p.first_name && !p.last_name)) continue;
      const team = resolveTeam(p.team);
      out.push({
        playerId: num(p.player_id, 0),
        firstName: p.first_name ?? "",
        lastName: p.last_name ?? "",
        position: p.position ?? "",
        jerseyNumber: p.jersey_number != null ? num(p.jersey_number) : undefined,
        teamNickname: team.nickname || (p.team ?? ""),
        headshotUrl: p.headshot,
      });
    }
    return out;
  }).catch(() => null);
}

// ---------- Player statistics (TODO_VERIFY — career totals only) ----------
type ZylaPlayerStat = {
  player_id?: string | number;
  name?: string;
  team?: string;
  position?: string;
  appearances?: string | number;
  tries?: string | number;
  try_assists?: string | number;
  line_breaks?: string | number;
  tackle_breaks?: string | number;
  run_metres?: string | number;
};

export async function getZylaPlayerStatistics(playerId: string | number): Promise<NormalisedPlayerStats | null> {
  return cached(`zyla:playerstats:${playerId}`, TTL_PLAYERS, async () => {
    const data = await safeGet<ZylaPlayerStat>(`${ENDPOINTS.playerStatistics}?player_id=${encodeURIComponent(String(playerId))}`, `playerstats ${playerId}`);
    if (!data || typeof data !== "object") return null;
    const team = resolveTeam(data.team);
    const apps = Math.max(1, num(data.appearances));
    const tries = num(data.tries);
    return {
      playerId: num(data.player_id, num(playerId)),
      name: data.name ?? "",
      teamNickname: team.nickname || (data.team ?? ""),
      position: data.position ?? "",
      appearances: num(data.appearances),
      tries,
      tryAssists: num(data.try_assists),
      lineBreaks: num(data.line_breaks),
      lineBreakAssists: 0,
      tackleBreaks: num(data.tackle_breaks),
      offloads: 0,
      runMetres: num(data.run_metres),
      postContactMetres: 0,
      triesPerGame: tries / apps,
      lineBreaksPerGame: num(data.line_breaks) / apps,
      runMetresPerGame: num(data.run_metres) / apps,
    };
  }).catch(() => null);
}
