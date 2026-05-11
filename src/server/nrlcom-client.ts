// ============================================================================
// NRL.com normalised adapter (PRIMARY source).
//
// Wraps the existing nrl.ts / season-stats.ts / team-news.ts fetchers and
// re-emits their data in the normalised shapes consumed by the simulation
// engine + downstream insights. NEVER throws — every function returns either
// a normalised object or null, with errors swallowed and a warning logged.
//
// Note: this module deliberately reuses the fetch + parse work already done
// by nrl.ts so we don't double-fetch. Higher-level callers (nrl-data-store)
// add the cache layer.
// ============================================================================

import {
  fetchDraw,
  fetchLadder,
  fetchMatchDetails,
  fetchMatchRecap,
  matchIdToPath,
  type NrlFixture,
  type NrlMatchDetails,
  type NrlOfficial,
} from "./nrl";
import { getSeasonSnapshot, type SeasonSnapshot } from "./season-stats";
import type {
  NormalisedFixture,
  NormalisedLadder,
  NormalisedTeamList,
  NormalisedTeamStats,
  NormalisedPlayerStats,
  NormalisedMatchOfficial,
  NormalisedInjury,
  NormalisedHistoricalMatch,
  NormalisedMatchResult,
} from "./nrl-data-types";
import { makeCoverage } from "./source-coverage";

// ---------- Helpers ----------
function fixtureStatus(state: string): NormalisedFixture["status"] {
  if (/^(FullTime|Final|Completed)$/i.test(state)) return "completed";
  if (/InProgress|Live|HalfTime|Post/i.test(state)) return "live";
  if (/Upcoming|Scheduled/i.test(state)) return "scheduled";
  if (/Postpon/i.test(state)) return "postponed";
  return "unknown";
}

function fixtureFromNrl(season: number, f: NrlFixture): NormalisedFixture {
  return {
    matchId: f.matchId,
    season,
    round: f.roundNumber,
    kickoffUtc: f.kickoffUtc,
    venue: f.venue ?? "",
    homeTeamId: f.homeTeam.teamId,
    homeNickname: f.homeTeam.nickName,
    homeThemeKey: f.homeTeam.themeKey ?? "",
    awayTeamId: f.awayTeam.teamId,
    awayNickname: f.awayTeam.nickName,
    awayThemeKey: f.awayTeam.themeKey ?? "",
    status: fixtureStatus(f.matchState),
    homeScore: f.homeTeam.score ?? undefined,
    awayScore: f.awayTeam.score ?? undefined,
    coverage: makeCoverage({ primary: "nrl.com" }),
  };
}

// ---------- Public API ----------
export async function getNrlDraw(season: number, round?: number): Promise<NormalisedFixture[] | null> {
  try {
    const draw = await fetchDraw(season, round);
    return draw.map((f) => fixtureFromNrl(season, f));
  } catch (e) {
    console.warn("[nrlcom-client] getNrlDraw failed:", e);
    return null;
  }
}

export async function getNrlLadder(season: number): Promise<NormalisedLadder | null> {
  try {
    const rows = await fetchLadder(season);
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
      coverage: makeCoverage({ primary: "nrl.com" }),
    };
  } catch (e) {
    console.warn("[nrlcom-client] getNrlLadder failed:", e);
    return null;
  }
}

export async function getNrlMatchDetails(matchId: string): Promise<NrlMatchDetails | null> {
  try {
    return await fetchMatchDetails(matchId);
  } catch (e) {
    console.warn("[nrlcom-client] getNrlMatchDetails failed:", e);
    return null;
  }
}

// Team list (squads) — derived from the same match-details payload.
export async function getNrlTeamLists(matchId: string): Promise<{ home: NormalisedTeamList; away: NormalisedTeamList } | null> {
  const d = await getNrlMatchDetails(matchId);
  if (!d) return null;
  const namedHome = d.homeTeam.players.length >= 13 && d.homeTeam.players.every((p) => p.position);
  const namedAway = d.awayTeam.players.length >= 13 && d.awayTeam.players.every((p) => p.position);
  const cov = makeCoverage({
    primary: "nrl.com",
    missingFields: [
      ...(namedHome ? [] : ["home_team_list_named"]),
      ...(namedAway ? [] : ["away_team_list_named"]),
    ],
  });
  return {
    home: {
      matchId,
      teamNickname: d.homeTeam.nickName,
      players: d.homeTeam.players.map((p, i) => ({
        playerId: (p as { playerId?: number }).playerId ?? -i,
        firstName: p.firstName,
        lastName: p.lastName,
        position: p.position,
        jerseyNumber: p.jerseyNumber,
        teamNickname: d.homeTeam.nickName,
        headshotUrl: p.headImage,
      })),
      isNamed: namedHome,
      coverage: cov,
    },
    away: {
      matchId,
      teamNickname: d.awayTeam.nickName,
      players: d.awayTeam.players.map((p, i) => ({
        playerId: (p as { playerId?: number }).playerId ?? -i,
        firstName: p.firstName,
        lastName: p.lastName,
        position: p.position,
        jerseyNumber: p.jerseyNumber,
        teamNickname: d.awayTeam.nickName,
        headshotUrl: p.headImage,
      })),
      isNamed: namedAway,
      coverage: cov,
    },
  };
}

export async function getNrlMatchOfficials(matchId: string): Promise<NormalisedMatchOfficial[] | null> {
  const d = await getNrlMatchDetails(matchId);
  if (!d) return null;
  return mapOfficials(d.officials);
}

function mapOfficials(officials: NrlOfficial[]): NormalisedMatchOfficial[] {
  return officials.map((o): NormalisedMatchOfficial => {
    const role: NormalisedMatchOfficial["role"] =
      /referee/i.test(o.position) ? "referee"
      : /touch/i.test(o.position) ? "touchJudge"
      : /video/i.test(o.position) ? "videoRef"
      : "other";
    return { role, name: `${o.firstName} ${o.lastName}`.trim() };
  });
}

// Injuries — best-effort from the team-news block already attached to match details.
// "out" if listed in official Outs, "doubtful" if in newsOuts (breaking-news rulings).
export async function getNrlInjuries(matchId: string): Promise<NormalisedInjury[] | null> {
  const d = await getNrlMatchDetails(matchId);
  if (!d) return null;
  const out: NormalisedInjury[] = [];
  for (const side of ["home", "away"] as const) {
    const tn = d.teamNews[side];
    if (!tn) continue;
    const team = side === "home" ? d.homeTeam.nickName : d.awayTeam.nickName;
    for (const name of tn.outs ?? []) {
      out.push({ name, teamNickname: team, status: "out" });
    }
    for (const r of tn.newsOuts ?? []) {
      out.push({ name: r.playerName, teamNickname: team, status: "doubtful", detail: r.reason });
    }
  }
  return out;
}

// Historical matches for a season — opportunistic, limited concurrency.
export async function getNrlHistoricalMatches(season: number, rounds?: number[]): Promise<NormalisedHistoricalMatch[] | null> {
  try {
    const rs = rounds && rounds.length ? rounds : Array.from({ length: 27 }, (_, i) => i + 1);
    const fixtures: NormalisedFixture[] = [];
    // Light concurrency to avoid hammering NRL.com.
    const chunkSize = 4;
    for (let i = 0; i < rs.length; i += chunkSize) {
      const slice = rs.slice(i, i + chunkSize);
      const drawn = await Promise.all(slice.map((r) => getNrlDraw(season, r).catch(() => null)));
      for (const d of drawn) if (d) fixtures.push(...d);
    }
    return fixtures
      .filter((f) => f.status === "completed" && typeof f.homeScore === "number" && typeof f.awayScore === "number")
      .map((f): NormalisedHistoricalMatch => {
        const margin = (f.homeScore ?? 0) - (f.awayScore ?? 0);
        return {
          matchId: f.matchId,
          season,
          round: f.round,
          kickoffUtc: f.kickoffUtc,
          homeNickname: f.homeNickname,
          awayNickname: f.awayNickname,
          homeScore: f.homeScore ?? 0,
          awayScore: f.awayScore ?? 0,
          winner: margin > 0 ? "home" : margin < 0 ? "away" : "draw",
          margin,
          totalPoints: (f.homeScore ?? 0) + (f.awayScore ?? 0),
          coverage: makeCoverage({ primary: "nrl.com" }),
        };
      });
  } catch (e) {
    console.warn("[nrlcom-client] getNrlHistoricalMatches failed:", e);
    return null;
  }
}

// Team & player season stats — derived from SeasonSnapshot which sweeps NRL.com
// per-match JSON. Returned as normalised shapes for downstream simulation.
export async function getNrlTeamStats(season: number): Promise<NormalisedTeamStats[] | null> {
  try {
    const snap = await getSeasonSnapshot(season);
    return teamStatsFromSnapshot(snap);
  } catch (e) {
    console.warn("[nrlcom-client] getNrlTeamStats failed:", e);
    return null;
  }
}

export async function getNrlPlayerStats(season: number): Promise<NormalisedPlayerStats[] | null> {
  try {
    const snap = await getSeasonSnapshot(season);
    return snap.players.map((p): NormalisedPlayerStats => {
      const apps = Math.max(1, p.matches);
      return {
        playerId: p.playerId,
        name: p.name,
        teamNickname: p.teamNickname,
        position: p.position,
        appearances: p.matches,
        tries: p.tries,
        tryAssists: p.tryAssists ?? 0,
        lineBreaks: p.lineBreaks ?? 0,
        lineBreakAssists: p.lineBreakAssists ?? 0,
        tackleBreaks: p.tackleBusts ?? 0,
        offloads: p.offloads ?? 0,
        runMetres: 0,
        postContactMetres: p.postContactMetres ?? 0,
        triesPerGame: p.tries / apps,
        lineBreaksPerGame: (p.lineBreaks ?? 0) / apps,
        runMetresPerGame: p.runMetresPerGame ?? 0,
      };
    });
  } catch (e) {
    console.warn("[nrlcom-client] getNrlPlayerStats failed:", e);
    return null;
  }
}

function teamStatsFromSnapshot(snap: SeasonSnapshot): NormalisedTeamStats[] {
  const out: NormalisedTeamStats[] = [];
  for (const t of Object.values(snap.teams)) {
    const ms = t.matchStats ?? [];
    const avg = (k: keyof typeof ms[number], def = 0) => {
      const vs = ms.map((m) => (m[k] as number | undefined) ?? def).filter((v) => Number.isFinite(v));
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : def;
    };
    const errs = avg("errors", 10);
    out.push({
      nickname: t.nickname,
      themeKey: t.themeKey,
      played: t.played,
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      triesFor: t.triesFor,
      triesAgainst: t.triesAgainst,
      ppgFor: t.ppgFor,
      ppgAgainst: t.ppgAgainst,
      triesPerGame: t.scoringEfficiency,
      triesAgainstPerGame: t.triesAgainst / Math.max(1, t.played),
      completionRate: Math.max(0.6, Math.min(0.95, 1 - errs / 36)),
      errorsPerGame: errs,
      penaltiesPerGame: avg("penaltiesConceded", 6),
      runMetresPerGame: avg("runMetres", 1500),
      postContactMetresPerGame: avg("postContactMetres", 500),
      tackleBreaksPerGame: avg("tackleBreaks", 28),
      lineBreaksPerGame: 0,
      recentForm: t.last5.length
        ? t.last5.reduce((s, r) => s + (r.result === "W" ? 1 : r.result === "L" ? -1 : 0), 0) / t.last5.length
        : 0,
      last5: t.last5.map((r) => r.result),
    });
  }
  return out;
}

// Result of a completed match (lightweight wrapper around fetchMatchRecap).
export async function getNrlMatchResult(matchId: string): Promise<NormalisedMatchResult | null> {
  try {
    const url = `https://www.nrl.com${matchIdToPath(matchId)}`;
    const r = await fetchMatchRecap(url);
    if (!r || r.homeScore == null || r.awayScore == null) return null;
    const margin = r.homeScore - r.awayScore;
    const winner: NormalisedMatchResult["winner"] = margin > 0 ? "home" : margin < 0 ? "away" : "draw";
    return {
      matchId,
      homeScore: r.homeScore,
      awayScore: r.awayScore,
      winner,
      margin,
      totalPoints: r.homeScore + r.awayScore,
      htHomeScore: 0,
      htAwayScore: 0,
      htft: "",
      firstTryScorer: r.firstTry ? { playerId: 0, name: r.firstTry.name, teamNickname: r.firstTry.team === "home" ? r.homeNick : r.awayNick } : undefined,
      tryScorers: r.tryOrder.map((t) => ({
        playerId: 0,
        name: t.name,
        teamNickname: t.team === "home" ? r.homeNick : r.awayNick,
        minute: t.minute ?? 0,
      })),
    };
  } catch (e) {
    console.warn("[nrlcom-client] getNrlMatchResult failed:", e);
    return null;
  }
}
