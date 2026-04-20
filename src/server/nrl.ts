// NRL.com public JSON fetchers. No auth, no key. Official data.
// Sources:
//   https://www.nrl.com/draw/data?competition=111&season=YYYY[&round=N]
//   https://www.nrl.com/ladder/data?competition=111&season=YYYY
//   https://www.nrl.com{matchCentreUrl}data

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0)";
const COMP = 111; // Telstra Premiership

export type NrlFixture = {
  matchId: string;            // derived from matchCentreUrl
  matchCentrePath: string;    // e.g. /draw/nrl-premiership/2026/round-8/wests-tigers-v-raiders/
  roundNumber: number;
  roundTitle: string;
  isCurrentRound: boolean;
  matchState: string;
  venue: string;
  venueCity: string;
  kickoffUtc: string;
  homeTeam: NrlTeamRef;
  awayTeam: NrlTeamRef;
};

export type NrlTeamRef = {
  teamId: number;
  nickName: string;
  themeKey: string;
  teamPosition?: string;
  odds?: string;
};

export type NrlLadderRow = {
  position: number;
  teamId: number;
  nickname: string;
  themeKey: string;
  played: number;
  wins: number;
  losses: number;
  drawn: number;
  byes: number;
  points: number;
  for: number;
  against: number;
  diff: number;
  movement: string;
};

function pathToMatchId(path: string): string {
  // /draw/nrl-premiership/2026/round-8/wests-tigers-v-raiders/
  return path.replace(/^\/+|\/+$/g, "").split("/").slice(-3).join("/"); // 2026/round-8/wests-tigers-v-raiders
}

export function matchIdToPath(id: string): string {
  return `/draw/nrl-premiership/${id}/`;
}

export async function fetchDraw(season: number, round?: number): Promise<NrlFixture[]> {
  const url = new URL("https://www.nrl.com/draw/data");
  url.searchParams.set("competition", String(COMP));
  url.searchParams.set("season", String(season));
  if (round != null) url.searchParams.set("round", String(round));
  const res = await fetch(url.toString(), { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`NRL draw HTTP ${res.status}`);
  const json = await res.json() as { fixtures: any[] };
  const fixtures: NrlFixture[] = (json.fixtures || [])
    .filter((f) => f.type === "Match")
    .map((f) => ({
      matchId: pathToMatchId(f.matchCentreUrl),
      matchCentrePath: f.matchCentreUrl,
      roundNumber: parseInt(String(f.roundTitle).replace(/\D/g, ""), 10) || 0,
      roundTitle: f.roundTitle,
      isCurrentRound: !!f.isCurrentRound,
      matchState: f.matchState,
      venue: f.venue,
      venueCity: f.venueCity,
      kickoffUtc: f.clock?.kickOffTimeLong,
      homeTeam: {
        teamId: f.homeTeam.teamId,
        nickName: f.homeTeam.nickName,
        themeKey: f.homeTeam.theme?.key,
        teamPosition: f.homeTeam.teamPosition,
      },
      awayTeam: {
        teamId: f.awayTeam.teamId,
        nickName: f.awayTeam.nickName,
        themeKey: f.awayTeam.theme?.key,
        teamPosition: f.awayTeam.teamPosition,
      },
    }));
  return fixtures;
}

export async function fetchLadder(season: number): Promise<NrlLadderRow[]> {
  const url = `https://www.nrl.com/ladder/data?competition=${COMP}&season=${season}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`NRL ladder HTTP ${res.status}`);
  const json = await res.json() as { positions: any[] };
  return (json.positions || []).map((p, i) => {
    const stats = p.stats || {};
    return {
      position: p.position ?? i + 1,
      teamId: p.teamId ?? p.team?.teamId,
      nickname: p.team?.nickname ?? p.nickname ?? "",
      themeKey: p.team?.theme?.key ?? p.theme?.key ?? "",
      played: Number(stats.played ?? 0),
      wins: Number(stats.wins ?? 0),
      losses: Number(stats.losses ?? 0),
      drawn: Number(stats.drawn ?? 0),
      byes: Number(stats.byes ?? 0),
      points: Number(stats.points ?? p.points ?? 0),
      for: Number(stats["points for"] ?? stats.pointsFor ?? 0),
      against: Number(stats["points against"] ?? stats.pointsAgainst ?? 0),
      diff: Number(stats["points difference"] ?? stats.pointsDifference ?? 0),
      movement: p.movement ?? "none",
    };
  });
}

export type NrlMatchDetails = {
  matchId: string;
  matchState: string;
  venue: string;
  venueCity: string;
  kickoffUtc: string;
  roundNumber: number;
  homeTeam: NrlMatchTeam;
  awayTeam: NrlMatchTeam;
  history: any;
  statGroups: any[];
};

export type NrlPlayer = {
  firstName: string;
  lastName: string;
  position: string;
  jerseyNumber?: number;
  headImage?: string;
  isCaptain?: boolean;
};

export type NrlMatchTeam = {
  teamId: number;
  name: string;
  nickName: string;
  themeKey: string;
  odds?: string;
  position?: string;
  recentForm: { result: string; summary: string; score: string }[];
  nextOpponent?: string;
  players: NrlPlayer[];
  captainPlayerId?: number;
};

export async function fetchMatchDetails(matchId: string): Promise<NrlMatchDetails> {
  const url = `https://www.nrl.com${matchIdToPath(matchId)}data`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`NRL match HTTP ${res.status}`);
  const d = await res.json() as any;
  const mapTeam = (t: any): NrlMatchTeam => {
    const captainId = t.captainPlayerId;
    const players: NrlPlayer[] = (t.players ?? []).map((p: any) => ({
      firstName: p.firstName ?? "",
      lastName: p.lastName ?? "",
      position: p.position ?? "",
      jerseyNumber: p.jerseyNumber ?? p.shirtNumber,
      headImage: p.headImage ? (p.headImage.startsWith("http") ? p.headImage : `https://www.nrl.com${p.headImage}`) : undefined,
      isCaptain: captainId != null && p.playerId === captainId,
    }));
    return {
      teamId: t.teamId,
      name: t.name,
      nickName: t.nickName,
      themeKey: t.theme?.key,
      odds: t.odds,
      position: t.teamPosition,
      recentForm: (t.recentForm ?? []).map((r: any) => ({
        result: r.result, summary: r.summary, score: r.score,
      })),
      nextOpponent: t.nextOpponent?.fullName,
      players,
      captainPlayerId: captainId,
    };
  };
  return {
    matchId,
    matchState: d.matchState,
    venue: d.venue,
    venueCity: d.venueCity,
    kickoffUtc: d.startTime,
    roundNumber: d.roundNumber,
    homeTeam: mapTeam(d.homeTeam),
    awayTeam: mapTeam(d.awayTeam),
    history: d.stats?.history ?? null,
    statGroups: d.stats?.groups ?? [],
  };
}
