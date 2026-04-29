// NRL.com public JSON fetchers. No auth, no key. Official data.
// Sources:
//   https://www.nrl.com/draw/data?competition=111&season=YYYY[&round=N]
//   https://www.nrl.com/ladder/data?competition=111&season=YYYY
//   https://www.nrl.com{matchCentreUrl}data

import { fetchMatchTeamNews, type TeamNews } from "./team-news";

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0)";
const COMP = 111; // Telstra Premiership

export type NrlFixture = {
  matchId: string;            // derived from matchCentreUrl
  matchCentrePath: string;    // e.g. /draw/nrl-premiership/2026/round-8/wests-tigers-v-raiders/
  roundNumber: number;
  roundTitle: string;
  isCurrentRound: boolean;
  matchState: string;         // "Upcoming" | "FullTime" | "InProgress" | etc.
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
  score?: number | null;
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
        score: f.homeTeam.score ?? null,
      },
      awayTeam: {
        teamId: f.awayTeam.teamId,
        nickName: f.awayTeam.nickName,
        themeKey: f.awayTeam.theme?.key,
        teamPosition: f.awayTeam.teamPosition,
        score: f.awayTeam.score ?? null,
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
      teamId: p.teamId ?? p.team?.teamId ?? p.next?.teamId ?? 0,
      // NRL ladder JSON exposes the row's own team via `teamNickname` / `theme`.
      // (`p.next` is the team's NEXT opponent — do NOT use it for identity.)
      nickname: p.teamNickname ?? p.team?.nickname ?? p.nickname ?? "",
      themeKey: p.theme?.key ?? p.team?.theme?.key ?? "",
      played: Number(stats.played ?? 0),
      wins: Number(stats.wins ?? 0),
      // NRL uses `lost` (singular) — keep `losses` as a fallback.
      losses: Number(stats.lost ?? stats.losses ?? 0),
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

export type NrlOfficial = {
  position: string;
  firstName: string;
  lastName: string;
  headImage?: string;
};

export type NrlStatValue = {
  value: number;
  isLeader: boolean;
  numerator?: number;
  denominator?: number;
};

export type NrlStat = {
  title: string;
  type: string;        // "Number" | "Percentage" | "Range" | "PercentageAndFraction"
  units?: string;
  homeValue: NrlStatValue;
  awayValue: NrlStatValue;
  maxValue?: number;
};

export type NrlStatGroup = {
  title: string;
  stats: NrlStat[];
};

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
  statGroups: NrlStatGroup[];
  officials: NrlOfficial[];
  teamNews: { home: TeamNews | null; away: TeamNews | null };
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
  score?: number | null;
  recentForm: { result: string; summary: string; score: string; url?: string }[];
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
      jerseyNumber: p.number ?? p.jerseyNumber,
      headImage: extractHeadshotUrl(p.headImage),
      isCaptain: p.isCaptain === true || (captainId != null && p.playerId === captainId),
    }));
    return {
      teamId: t.teamId,
      name: t.name,
      nickName: t.nickName,
      themeKey: t.theme?.key,
      odds: t.odds,
      position: t.teamPosition,
      score: t.score ?? null,
      recentForm: (t.recentForm ?? []).map((r: any) => ({
        result: r.result, summary: r.summary, score: r.score, url: r.url,
      })),
      nextOpponent: t.nextOpponent?.fullName,
      players,
      captainPlayerId: captainId,
    };
  };
  const officials: NrlOfficial[] = (d.officials ?? []).map((o: any) => ({
    position: o.position ?? "",
    firstName: o.firstName ?? "",
    lastName: o.lastName ?? "",
    headImage: o.headImage,
  }));
  const statGroups: NrlStatGroup[] = (d.stats?.groups ?? []).map((g: any) => ({
    title: g.title ?? "",
    stats: (g.stats ?? []).map((s: any) => ({
      title: s.title ?? "",
      type: s.type ?? "Number",
      units: s.units,
      homeValue: {
        value: Number(s.homeValue?.value ?? 0),
        isLeader: !!s.homeValue?.isLeader,
        numerator: s.homeValue?.numerator,
        denominator: s.homeValue?.denominator,
      },
      awayValue: {
        value: Number(s.awayValue?.value ?? 0),
        isLeader: !!s.awayValue?.isLeader,
        numerator: s.awayValue?.numerator,
        denominator: s.awayValue?.denominator,
      },
      maxValue: s.maxValue,
    })),
  }));
  const home = mapTeam(d.homeTeam);
  const away = mapTeam(d.awayTeam);
  // Best-effort ins/outs from the official weekly Team Lists article.
  // Never blocks: failure -> nulls and the UI shows "Not yet announced".
  const season = Number(String(matchId).slice(0, 4));
  const round = Number(d.roundNumber) || 0;
  const teamNews = await fetchMatchTeamNews(season, round, home.nickName, away.nickName)
    .catch(() => ({ home: null, away: null }));
  return {
    matchId,
    matchState: d.matchState,
    venue: d.venue,
    venueCity: d.venueCity,
    kickoffUtc: d.startTime,
    roundNumber: d.roundNumber,
    homeTeam: home,
    awayTeam: away,
    history: d.stats?.history ?? null,
    statGroups,
    officials,
    teamNews,
  };
}

// ---------- Past match recap (score + tryscorers) ----------
export type NrlMatchRecap = {
  url: string;
  homeNick: string;
  awayNick: string;
  homeThemeKey: string;
  awayThemeKey: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTryscorers: { name: string; count: number }[];
  awayTryscorers: { name: string; count: number }[];
};

export async function fetchMatchRecap(matchUrl: string): Promise<NrlMatchRecap | null> {
  // Accepts the public match URL ending with `/`. The JSON feed is `${url}data`.
  const u = matchUrl.endsWith("/") ? matchUrl : `${matchUrl}/`;
  const res = await fetch(`${u}data`, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) return null;
  const d = await res.json() as any;
  const ht = d.homeTeam ?? {};
  const at = d.awayTeam ?? {};
  // Build playerId -> name map across both squads
  const idToName = new Map<number, string>();
  for (const t of [ht, at]) {
    for (const p of (t.players ?? [])) {
      const id = p.playerId;
      if (id != null) idToName.set(id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim());
    }
  }
  // playerId -> teamId from timeline tries
  const tries: { playerId: number; teamId: number }[] = [];
  for (const ev of (d.timeline ?? [])) {
    if ((ev?.type ?? ev?.title) === "Try" && ev.playerId != null && ev.teamId != null) {
      tries.push({ playerId: ev.playerId, teamId: ev.teamId });
    }
  }
  const tally = (teamId: number) => {
    const counts = new Map<number, number>();
    for (const t of tries) if (t.teamId === teamId) counts.set(t.playerId, (counts.get(t.playerId) ?? 0) + 1);
    return [...counts.entries()]
      .map(([pid, count]) => ({ name: idToName.get(pid) ?? `#${pid}`, count }))
      .sort((a, b) => b.count - a.count);
  };
  return {
    url: matchUrl,
    homeNick: ht.nickName ?? "",
    awayNick: at.nickName ?? "",
    homeThemeKey: ht.theme?.key ?? "",
    awayThemeKey: at.theme?.key ?? "",
    homeScore: ht.score ?? null,
    awayScore: at.score ?? null,
    homeTryscorers: tally(ht.teamId),
    awayTryscorers: tally(at.teamId),
  };
}
