// Per-player aggregator. For each named player in the upcoming squad, pull
// their per-match stats from the team's recent played matches and produce
// form indicators (peak / cold / steady) and key output metrics.

import { cached, TTL } from "./cache";

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0)";

export type PlayerForm = {
  playerId: number | null;
  firstName: string;
  lastName: string;
  position: string;
  jerseyNumber?: number;
  isCaptain?: boolean;
  appearances: number;
  // Aggregates across appearances (last 5)
  avgRunMetres: number;
  avgTackles: number;
  avgTries: number;
  avgTryAssists: number;
  avgLineBreaks: number;
  avgTackleBreaks: number;
  avgMinutes: number;
  // Trend last-2 vs prior — purely for highlighting
  trend: "peak" | "cold" | "steady";
  // Concise role/impact label
  roleNote: string;
};

type RawPlayerStat = {
  playerId: number;
  allRunMetres?: number;
  tacklesMade?: number;
  tries?: number;
  tryAssists?: number;
  lineBreaks?: number;
  tackleBreaks?: number;
  minutesPlayed?: number;
  fantasyPointsTotal?: number;
};

async function fetchPlayersForMatch(url: string): Promise<{
  homeNickName: string; awayNickName: string;
  homePlayers: RawPlayerStat[];
  awayPlayers: RawPlayerStat[];
} | null> {
  const dataUrl = url.endsWith("/") ? `${url}data` : `${url}/data`;
  try {
    const res = await fetch(dataUrl, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json() as any;
    return {
      homeNickName: j.homeTeam?.nickName ?? "",
      awayNickName: j.awayTeam?.nickName ?? "",
      homePlayers: (j.stats?.players?.homeTeam ?? []) as RawPlayerStat[],
      awayPlayers: (j.stats?.players?.awayTeam ?? []) as RawPlayerStat[],
    };
  } catch { return null; }
}

function inferRoleNote(p: PlayerForm): string {
  const bits: string[] = [];
  if (p.avgTryAssists >= 0.7) bits.push("playmaker");
  if (p.avgRunMetres >= 130) bits.push("forward weapon");
  else if (p.avgRunMetres >= 100) bits.push("workhorse");
  if (p.avgTries >= 0.4) bits.push("finisher");
  if (p.avgTackles >= 35) bits.push("defensive engine");
  if (p.avgLineBreaks >= 0.5) bits.push("line-break threat");
  return bits.slice(0, 2).join(" · ") || "Rotational";
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function buildPlayerForms(
  teamNickname: string,
  squad: { firstName: string; lastName: string; position: string; jerseyNumber?: number; isCaptain?: boolean }[],
  recentFormUrls: string[],
): Promise<PlayerForm[]> {
  const cacheKey = `playerforms:${teamNickname}:${recentFormUrls[0] ?? ""}:${squad.length}`;
  return cached(cacheKey, TTL.match, async () => {
    const urls = recentFormUrls.slice(0, 5);
    const matches = await Promise.all(urls.map((u) => fetchPlayersForMatch(u)));

    // Build per-player stat history. NRL stats use playerId; squad doesn't carry it
    // reliably for all rows, so we also build a name-based index from the matches.
    const idIndex = new Map<number, RawPlayerStat[]>();
    const nameIndex = new Map<string, { id: number; rows: RawPlayerStat[] }>();

    // We can't link squad rows to playerIds without a directory, so we
    // approximate: name match comes from the latest played match's `players` list
    // when available. Fall back to "no data" for rookies/late additions.
    const latestPlayersMap = new Map<number, { firstName: string; lastName: string }>();

    for (const m of matches) {
      if (!m) continue;
      const wasHome = m.homeNickName === teamNickname;
      const rows = wasHome ? m.homePlayers : m.awayPlayers;
      for (const r of rows) {
        if (!idIndex.has(r.playerId)) idIndex.set(r.playerId, []);
        idIndex.get(r.playerId)!.push(r);
      }
    }

    // We need to associate squad players (by name) to playerIds. We'll fetch the
    // most recent match's full team payload for the name->id mapping.
    const latestUrl = urls[0];
    if (latestUrl) {
      try {
        const dataUrl = latestUrl.endsWith("/") ? `${latestUrl}data` : `${latestUrl}/data`;
        const res = await fetch(dataUrl, { headers: { "User-Agent": UA, "Accept": "application/json" } });
        if (res.ok) {
          const j = await res.json() as any;
          const wasHome = j.homeTeam?.nickName === teamNickname;
          const team = wasHome ? j.homeTeam : j.awayTeam;
          for (const p of (team?.players ?? [])) {
            if (typeof p.playerId === "number") {
              latestPlayersMap.set(p.playerId, { firstName: p.firstName, lastName: p.lastName });
            }
          }
        }
      } catch { /* fall through */ }
    }

    // name -> playerId
    const nameToId = new Map<string, number>();
    latestPlayersMap.forEach((nm, id) => {
      nameToId.set(`${nm.firstName.trim().toLowerCase()} ${nm.lastName.trim().toLowerCase()}`, id);
    });

    return squad.map((sq) => {
      const key = `${sq.firstName.trim().toLowerCase()} ${sq.lastName.trim().toLowerCase()}`;
      const playerId = nameToId.get(key) ?? null;
      const rows = playerId != null ? (idIndex.get(playerId) ?? []) : [];
      const last5 = rows.slice(0, 5);

      const avgRunMetres = Math.round(avg(last5.map((r) => r.allRunMetres ?? 0)));
      const avgTackles = Math.round(avg(last5.map((r) => r.tacklesMade ?? 0)));
      const avgTries = Number(avg(last5.map((r) => r.tries ?? 0)).toFixed(2));
      const avgTryAssists = Number(avg(last5.map((r) => r.tryAssists ?? 0)).toFixed(2));
      const avgLineBreaks = Number(avg(last5.map((r) => r.lineBreaks ?? 0)).toFixed(2));
      const avgTackleBreaks = Number(avg(last5.map((r) => r.tackleBreaks ?? 0)).toFixed(2));
      const avgMinutes = Math.round(avg(last5.map((r) => r.minutesPlayed ?? 0)));

      // Form = fantasy pts last-2 vs prior-3
      const fp = last5.map((r) => r.fantasyPointsTotal ?? 0);
      const last2 = avg(fp.slice(0, 2));
      const prior3 = avg(fp.slice(2, 5));
      let trend: "peak" | "cold" | "steady" = "steady";
      if (fp.length >= 3) {
        if (last2 >= prior3 * 1.20) trend = "peak";
        else if (last2 <= prior3 * 0.80) trend = "cold";
      }

      const out: PlayerForm = {
        playerId, firstName: sq.firstName, lastName: sq.lastName, position: sq.position,
        jerseyNumber: sq.jerseyNumber, isCaptain: sq.isCaptain,
        appearances: last5.length,
        avgRunMetres, avgTackles, avgTries, avgTryAssists,
        avgLineBreaks, avgTackleBreaks, avgMinutes,
        trend, roleNote: "",
      };
      out.roleNote = inferRoleNote(out);
      return out;
    });
  });
}
