// Zyla NRL Data API client — server-only fallback source.
//
// Used ONLY when NRL.com is unavailable. NRL.com remains the primary source
// because it provides richer, current-form data (lineups, stat groups, recent
// form, headshots, per-match player stats) which Zyla does not.
//
// Zyla coverage we actually trust:
//   - ladder (clean, well-structured)
//   - fixtures (basic schema, columns can be malformed — best-effort only)
//   - match details (career/test totals, NOT current form — DO NOT use for predictions)
//
// Hard rules:
//   - Token (ZYLA_NRL_TOKEN) NEVER leaves the server.
//   - All calls are cached aggressively to stay well under quota.
//   - Errors and rate-limits NEVER throw to callers — return null.
//   - Every request + cache hit/miss + error is logged with [zyla] prefix.

import { cached } from "./cache";
import type { NrlLadderRow } from "./nrl";

const BASE = "https://zylalabs.com/api/4535/nrl+data+api";
const ENDPOINTS = {
  ladder: "5576/ladder",
  fixture: "5577/fixture",
  matchDetails: "5578/match+details",
} as const;

// TTLs per requirements
const TTL_LADDER = 12 * 60 * 60_000;          // 12h
const TTL_FIXTURES = 12 * 60 * 60_000;        // 12h
const TTL_MATCH_COMPLETED = 7 * 24 * 60 * 60_000; // 7d
const TTL_MATCH_LIVE = 90 * 60_000;           // 90 min

// Lightweight request counter for diagnostics. Resets per worker instance.
let zylaRequestCount = 0;
export function getZylaRequestCount(): number { return zylaRequestCount; }
export function resetZylaRequestCount(): void { zylaRequestCount = 0; }

function token(): string | null {
  const t = process.env.ZYLA_NRL_TOKEN;
  return t && t.length > 0 ? t : null;
}

async function zylaGet<T>(pathAndQuery: string, label: string): Promise<T | null> {
  const tok = token();
  if (!tok) {
    console.warn(`[zyla] ${label} skipped — ZYLA_NRL_TOKEN not configured`);
    return null;
  }
  const url = `${BASE}/${pathAndQuery}`;
  const t0 = Date.now();
  zylaRequestCount++;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      console.warn(`[zyla] ${label} HTTP ${res.status} (${ms}ms) count=${zylaRequestCount}`);
      return null;
    }
    const json = (await res.json()) as { status?: string; data?: unknown; message?: string };
    if (json.status && json.status !== "success") {
      console.warn(`[zyla] ${label} non-success: ${json.message ?? json.status}`);
      return null;
    }
    console.info(`[zyla] ${label} ok (${ms}ms) count=${zylaRequestCount}`);
    return json.data as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[zyla] ${label} error: ${msg} count=${zylaRequestCount}`);
    return null;
  }
}

// ---------- Team-name reconciliation (Zyla short names → NRL.com nicknames) ----------
const NAME_MAP: Record<string, { nickname: string; themeKey: string; teamId: number }> = {
  penrith:        { nickname: "Panthers",       themeKey: "panthers",      teamId: 500723 },
  warriors:       { nickname: "Warriors",       themeKey: "warriors",      teamId: 500013 },
  "wests tigers": { nickname: "Wests Tigers",   themeKey: "wests-tigers",  teamId: 500012 },
  souths:         { nickname: "Rabbitohs",      themeKey: "rabbitohs",     teamId: 500010 },
  sydney:         { nickname: "Roosters",       themeKey: "roosters",      teamId: 500011 },
  brisbane:       { nickname: "Broncos",        themeKey: "broncos",       teamId: 500001 },
  melbourne:      { nickname: "Storm",          themeKey: "storm",         teamId: 500009 },
  cronulla:       { nickname: "Sharks",         themeKey: "sharks",        teamId: 500004 },
  canberra:       { nickname: "Raiders",        themeKey: "raiders",       teamId: 500002 },
  canterbury:     { nickname: "Bulldogs",       themeKey: "bulldogs",      teamId: 500003 },
  manly:          { nickname: "Sea Eagles",     themeKey: "sea-eagles",    teamId: 500008 },
  parramatta:     { nickname: "Eels",           themeKey: "eels",          teamId: 500005 },
  "north qld":    { nickname: "Cowboys",        themeKey: "cowboys",       teamId: 500015 },
  cowboys:        { nickname: "Cowboys",        themeKey: "cowboys",       teamId: 500015 },
  dolphins:       { nickname: "Dolphins",       themeKey: "dolphins",      teamId: 507324 },
  "st george":    { nickname: "Dragons",        themeKey: "dragons",       teamId: 500006 },
  dragons:        { nickname: "Dragons",        themeKey: "dragons",       teamId: 500006 },
  newcastle:      { nickname: "Knights",        themeKey: "knights",       teamId: 500007 },
};

function resolveTeam(zylaName: string): { nickname: string; themeKey: string; teamId: number } {
  const k = (zylaName || "").trim().toLowerCase();
  return NAME_MAP[k] ?? { nickname: zylaName, themeKey: "", teamId: 0 };
}

// ---------- Ladder ----------
type ZylaLadderRow = { season: string; ladder: { position: string; team: string; played: string; wins: string; losses: string; draws: string; bye: string; for: string; against: string; ladder_points: string } };

export async function fetchZylaLadder(season: number): Promise<NrlLadderRow[] | null> {
  return cached(`zyla:ladder:${season}`, TTL_LADDER, async () => {
    console.info(`[zyla] cache miss ladder season=${season}`);
    const data = await zylaGet<ZylaLadderRow[]>(`${ENDPOINTS.ladder}?season=${season}`, `ladder ${season}`);
    if (!data || !Array.isArray(data)) return null;
    const rows: NrlLadderRow[] = data.map((d) => {
      const r = d.ladder ?? ({} as ZylaLadderRow["ladder"]);
      const team = resolveTeam(r.team ?? "");
      const num = (v: string | undefined) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const f = num(r.for), a = num(r.against);
      return {
        position: num(r.position),
        teamId: team.teamId,
        nickname: team.nickname,
        themeKey: team.themeKey,
        played: num(r.played),
        wins: num(r.wins),
        losses: num(r.losses),
        drawn: num(r.draws),
        byes: num(r.bye),
        points: num(r.ladder_points),
        for: f,
        against: a,
        diff: f - a,
        movement: "none",
      };
    });
    return rows;
  }).then((v) => v ?? null).catch(() => null);
}

// ---------- Fixtures (best-effort — Zyla sometimes returns shifted columns) ----------
type ZylaFixtureRow = { match_id: string; date?: string; time?: string; home_team?: string; away_team?: string; venue?: string; home_score?: string; away_score?: string };

export async function fetchZylaFixtures(season: number, round: number): Promise<ZylaFixtureRow[] | null> {
  return cached(`zyla:fixtures:${season}:${round}`, TTL_FIXTURES, async () => {
    console.info(`[zyla] cache miss fixtures season=${season} round=${round}`);
    const data = await zylaGet<{ season: string; round: string; fixtures: ZylaFixtureRow[] }>(
      `${ENDPOINTS.fixture}?season=${season}&round=${round}`,
      `fixtures ${season} R${round}`,
    );
    if (!data || !Array.isArray(data.fixtures)) return null;
    return data.fixtures;
  }).then((v) => v ?? null).catch(() => null);
}

// ---------- Match details (career totals — DO NOT use for current-form predictions) ----------
export async function fetchZylaMatchDetails(matchId: string, finished: boolean): Promise<unknown | null> {
  const ttl = finished ? TTL_MATCH_COMPLETED : TTL_MATCH_LIVE;
  return cached(`zyla:match:${matchId}`, ttl, async () => {
    console.info(`[zyla] cache miss match=${matchId} finished=${finished}`);
    return zylaGet<unknown>(`${ENDPOINTS.matchDetails}?match_id=${encodeURIComponent(matchId)}`, `match ${matchId}`);
  }).catch(() => null);
}

export const ZYLA_NAME_MAP = NAME_MAP;
