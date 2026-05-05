// Season-wide stats aggregator. Sweeps every completed 2026 fixture once,
// builds player try logs + team scoring/halftime/fulltime profiles, then
// caches the whole snapshot for 12 hours. The deterministic insights engine
// reads from this snapshot — never hits the network on hot path.
//
// All data is sourced from the same NRL.com match-detail JSON we already use
// (timeline + score + homeTeam/awayTeam blocks) so there is no extra API key.

import { cached } from "./cache";
import { fetchDraw, fetchMatchDetails, type NrlFixture } from "./nrl";

const SNAPSHOT_TTL = 12 * 60 * 60_000; // 12h
const SEASON_ROUNDS = 27;
const HALF_SECS = 2400; // 40 minutes — anything before is first half

export type PlayerTryEvent = {
  playerId: number;
  name: string;
  position: string;
  jerseyNumber?: number;
  teamId: number;
  teamNickname: string;
  matchId: string;
  round: number;
  gameSeconds: number;       // 0..4800
  isFirstTeamTry: boolean;   // first try scored by this player's team in this match
  isFirstMatchTry: boolean;  // first try of the match (any team)
  isFirstHalf: boolean;      // gameSeconds < 2400
};

export type TeamSeasonStats = {
  nickname: string;
  themeKey: string;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  triesFor: number;
  triesAgainst: number;
  // Halftime profile
  htLeads: number;       // matches led at halftime
  htDraws: number;
  htTrails: number;
  // Halftime → fulltime conversion (only counts matches where they led at HT)
  htLeadAndWon: number;
  // Fulltime
  wins: number;
  losses: number;
  draws: number;
  // Derived rates (computed once at snapshot build)
  ppgFor: number;
  ppgAgainst: number;
  scoringEfficiency: number;     // tries per match
  htConversionRate: number;      // htLeadAndWon / max(1, htLeads)
  htLeadRate: number;            // htLeads / played
  // Recent form (last 5 matches, oldest→newest of those 5)
  last5: { result: "W" | "L" | "D"; pf: number; pa: number; round: number }[];
  // Per-match Hard Earned input stats — populated from NRL.com stat groups for
  // every completed match. Oldest→newest. Used by hard-earned-history.ts to
  // derive work-rate ratings, trend, fatigue, bounce-back, false-positive.
  matchStats?: TeamMatchStats[];
};

// Per-match team stat snapshot. All fields are optional because NRL.com's
// stat group set varies by match. Estimated fields are not flagged here —
// they are derived in hard-earned-history.ts when raw values are missing.
export type TeamMatchStats = {
  matchId: string;
  round: number;
  kickoffUtc: string;
  result: "W" | "L" | "D";
  pf: number;
  pa: number;
  opponentNickname: string;
  // Raw inputs (when available from NRL stat groups)
  runs?: number;
  runMetres?: number;
  postContactMetres?: number;
  tackles?: number;
  tackleBreaks?: number;
  missedTackles?: number;
  offloads?: number;
  errors?: number;
  penaltiesConceded?: number;
  sinBins?: number;
  // Less common — present when NRL.com surfaces them in a given group
  supports?: number;
  decoys?: number;
  chargeDowns?: number;
  lineEngagements?: number;
};

export type SeasonSnapshot = {
  season: number;
  generatedAt: string;
  // Player aggregates by playerId (cross-match)
  players: PlayerSeasonStats[];
  // Team aggregates by nickname (lowercased)
  teams: Record<string, TeamSeasonStats>;
};

export type PlayerSeasonStats = {
  playerId: number;
  name: string;
  position: string;
  jerseyNumber?: number;
  teamNickname: string;
  matches: number;            // matches in which player appeared on the timeline (try) — proxy
  tries: number;
  firstTries: number;         // times scored opening try of the match
  firstTeamTries: number;     // times scored their team's first try
  firstHalfTries: number;
  triesPerMatch: number;      // tries / max(1, teamGames) — uses team played for context
  // ---- Optional advanced attacking-involvement metrics ----
  // Not populated by the current snapshot builder (NRL.com match-detail JSON
  // only exposes per-team aggregates). Left optional so the engine can use
  // them the moment a per-player feed is wired in, without a schema change.
  lineBreaks?: number;
  lineBreakAssists?: number;
  tryAssists?: number;
  tackleBusts?: number;
  offloads?: number;
  runMetresPerGame?: number;
  postContactMetres?: number;
  kickReturnMetres?: number;
  recentTries?: number;          // last 3-5 game tries
  recentInvolvements?: number;   // last 3-5 game line breaks + assists + tackle busts
};

// ---------- Helpers ----------

function nickKey(n: string): string {
  return (n || "").toLowerCase().trim();
}

// ---------- Snapshot builder ----------

export async function getSeasonSnapshot(season: number, opts?: { refresh?: boolean }): Promise<SeasonSnapshot> {
  return cached(`season-snapshot:${season}`, SNAPSHOT_TTL, () => buildSeasonSnapshot(season), { bypass: opts?.refresh });
}

async function buildSeasonSnapshot(season: number): Promise<SeasonSnapshot> {
  // 1. Discover all completed fixtures in the season by sweeping rounds 1..27
  const fixtures: NrlFixture[] = [];
  const sweepResults = await Promise.all(
    Array.from({ length: SEASON_ROUNDS }, (_, i) => i + 1).map(async (r) => {
      try {
        return await fetchDraw(season, r);
      } catch {
        return [] as NrlFixture[];
      }
    }),
  );
  for (const list of sweepResults) {
    for (const f of list) if (/full\s*time|fulltime/i.test(f.matchState)) fixtures.push(f);
  }

  // 2. Fetch match details (limited concurrency to be polite to NRL.com)
  type MatchPayload = { matchId: string; round: number; kickoffUtc: string; data: any };
  const payloads: MatchPayload[] = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < fixtures.length; i += CONCURRENCY) {
    const batch = fixtures.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (f) => {
      try {
        const url = `https://www.nrl.com${f.matchCentrePath}data`;
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
        if (!res.ok) return null;
        const d = await res.json();
        return { matchId: f.matchId, round: f.roundNumber, kickoffUtc: f.kickoffUtc, data: d } as MatchPayload;
      } catch {
        return null;
      }
    }));
    for (const r of results) if (r) payloads.push(r);
  }

  // 3. Aggregate per-team and per-player
  const teams: Record<string, TeamSeasonStats> = {};
  const playerMap = new Map<number, PlayerSeasonStats>();

  for (const { matchId, round, kickoffUtc, data: d } of payloads) {
    const home = d.homeTeam ?? {};
    const away = d.awayTeam ?? {};
    const homeNick = home.nickName ?? "";
    const awayNick = away.nickName ?? "";
    if (!homeNick || !awayNick) continue;

    const hKey = nickKey(homeNick);
    const aKey = nickKey(awayNick);
    const h = (teams[hKey] ||= blankTeam(homeNick, home.theme?.key ?? ""));
    const a = (teams[aKey] ||= blankTeam(awayNick, away.theme?.key ?? ""));

    const hScore = Number(home.score ?? 0);
    const aScore = Number(away.score ?? 0);
    h.played++; a.played++;
    h.pointsFor += hScore; h.pointsAgainst += aScore;
    a.pointsFor += aScore; a.pointsAgainst += hScore;
    if (hScore > aScore) { h.wins++; a.losses++; }
    else if (aScore > hScore) { a.wins++; h.losses++; }
    else { h.draws++; a.draws++; }

    // Build playerId -> {name, position, teamNick, jersey} map across both squads
    const idMeta = new Map<number, { name: string; position: string; jerseyNumber?: number; teamNickname: string; teamId: number }>();
    for (const t of [home, away]) {
      for (const p of (t.players ?? [])) {
        if (p.playerId == null) continue;
        idMeta.set(p.playerId, {
          name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
          position: p.position ?? "",
          jerseyNumber: p.number ?? p.jerseyNumber,
          teamNickname: t.nickName,
          teamId: t.teamId,
        });
      }
    }

    // Walk the timeline: tries + halftime score
    const tryEvents = (d.timeline ?? []).filter((e: any) => (e.type ?? e.title) === "Try");
    let htHome = 0, htAway = 0;
    let htHomeTries = 0, htAwayTries = 0;
    let firstTeamTryByTeamId: Map<number, number> = new Map();
    let firstMatchTryPid: number | null = null;

    for (const ev of tryEvents) {
      const sec = Number(ev.gameSeconds ?? 0);
      const teamId = Number(ev.teamId ?? 0);
      const pid = Number(ev.playerId ?? 0);
      if (!teamId || !pid) continue;

      // First-try-of-team and first-try-of-match flags
      const isFirstTeamTry = !firstTeamTryByTeamId.has(teamId);
      if (isFirstTeamTry) firstTeamTryByTeamId.set(teamId, pid);
      if (firstMatchTryPid == null) firstMatchTryPid = pid;
      const isFirstMatchTry = firstMatchTryPid === pid && tryEvents[0] === ev;

      // Halftime score derived from running scores in event payload
      if (sec < HALF_SECS) {
        if (teamId === home.teamId) { htHome += 4; htHomeTries++; }
        else if (teamId === away.teamId) { htAway += 4; htAwayTries++; }
      }

      const meta = idMeta.get(pid);
      if (!meta) continue;
      const teamNick = meta.teamNickname;

      // Tries For/Against on team rows (count as 4 — close enough; the team
      // PF/PA is anchored on the actual final score above so this is a
      // secondary signal for try volume only)
      const teamRow = teams[nickKey(teamNick)];
      if (teamRow) teamRow.triesFor++;
      const opponentNick = teamId === home.teamId ? awayNick : homeNick;
      const oppRow = teams[nickKey(opponentNick)];
      if (oppRow) oppRow.triesAgainst++;

      // Player aggregate
      const ps = playerMap.get(pid) ?? blankPlayer(pid, meta);
      ps.tries++;
      if (isFirstMatchTry) ps.firstTries++;
      if (isFirstTeamTry) ps.firstTeamTries++;
      if (sec < HALF_SECS) ps.firstHalfTries++;
      playerMap.set(pid, ps);
    }

    // Halftime leader
    if (htHome > htAway) { h.htLeads++; if (hScore > aScore) h.htLeadAndWon++; }
    else if (htAway > htHome) { a.htLeads++; if (aScore > hScore) a.htLeadAndWon++; }
    else { h.htDraws++; a.htDraws++; }
    if (htHome < htAway) h.htTrails++;
    if (htAway < htHome) a.htTrails++;

    // Recent form rolling list
    h.last5.push({ result: hScore > aScore ? "W" : hScore < aScore ? "L" : "D", pf: hScore, pa: aScore, round });
    a.last5.push({ result: aScore > hScore ? "W" : aScore < hScore ? "L" : "D", pf: aScore, pa: hScore, round });
  }

  // Final derived rates + trim last5
  for (const t of Object.values(teams)) {
    t.ppgFor = t.played > 0 ? t.pointsFor / t.played : 0;
    t.ppgAgainst = t.played > 0 ? t.pointsAgainst / t.played : 0;
    t.scoringEfficiency = t.played > 0 ? t.triesFor / t.played : 0;
    t.htConversionRate = t.htLeads > 0 ? t.htLeadAndWon / t.htLeads : 0;
    t.htLeadRate = t.played > 0 ? t.htLeads / t.played : 0;
    t.last5.sort((x, y) => x.round - y.round);
    t.last5 = t.last5.slice(-5);
  }

  // Compute per-player triesPerMatch using their team's games played as denominator
  const players: PlayerSeasonStats[] = [];
  for (const ps of playerMap.values()) {
    const teamGames = teams[nickKey(ps.teamNickname)]?.played ?? 1;
    ps.triesPerMatch = teamGames > 0 ? ps.tries / teamGames : 0;
    ps.matches = teamGames; // proxy — we don't track individual selections
    players.push(ps);
  }

  return {
    season,
    generatedAt: new Date().toISOString(),
    players,
    teams,
  };
}

function blankTeam(nickname: string, themeKey: string): TeamSeasonStats {
  return {
    nickname, themeKey,
    played: 0, pointsFor: 0, pointsAgainst: 0, triesFor: 0, triesAgainst: 0,
    htLeads: 0, htDraws: 0, htTrails: 0, htLeadAndWon: 0,
    wins: 0, losses: 0, draws: 0,
    ppgFor: 0, ppgAgainst: 0, scoringEfficiency: 0,
    htConversionRate: 0, htLeadRate: 0,
    last5: [],
  };
}

function blankPlayer(playerId: number, meta: { name: string; position: string; jerseyNumber?: number; teamNickname: string }): PlayerSeasonStats {
  return {
    playerId,
    name: meta.name,
    position: meta.position,
    jerseyNumber: meta.jerseyNumber,
    teamNickname: meta.teamNickname,
    matches: 0,
    tries: 0,
    firstTries: 0,
    firstTeamTries: 0,
    firstHalfTries: 0,
    triesPerMatch: 0,
  };
}

// Fast lookup helpers used by the engine
export function getTeam(snap: SeasonSnapshot, nickname: string): TeamSeasonStats | null {
  return snap.teams[nickKey(nickname)] ?? null;
}

export function getTeamPlayers(snap: SeasonSnapshot, nickname: string): PlayerSeasonStats[] {
  const k = nickKey(nickname);
  return snap.players.filter((p) => nickKey(p.teamNickname) === k);
}
