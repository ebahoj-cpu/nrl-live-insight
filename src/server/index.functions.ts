// All server functions exposed to the client. Server-only secrets stay here.

import { createServerFn } from "@tanstack/react-start";
import { cached, TTL } from "./cache";
import { fetchDraw, fetchLadder, fetchMatchDetails } from "./nrl";
import { fetchNrlOdds, fetchEventOdds, type OddsEvent } from "./odds";
import { generateInsights } from "./ai-insights";
import { fetchVenueWeather, type WeatherSnapshot } from "./weather";
import { findTeam } from "@/lib/teams";

// ---------- Fixtures + current round ----------
export const getCurrentRoundFixtures = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const season = currentSeason();
    return cached(
      `fixtures:current:${season}`,
      TTL.fixtures,
      async () => {
        const all = await fetchDraw(season);
        const currentRound = all.find((f) => f.isCurrentRound)?.roundNumber ?? all[0]?.roundNumber ?? 1;
        const fixtures = all.filter((f) => f.roundNumber === currentRound);
        return { season, round: currentRound, fixtures };
      },
      { bypass: data.refresh },
    );
  });

// ---------- Ladder ----------
export const getLadder = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const season = currentSeason();
    return cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season), { bypass: data.refresh });
  });

// ---------- Live odds ----------
export const getOdds = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    return cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds(), { bypass: data.refresh });
  });

// ---------- Match details + odds + ladder + AI ----------
export const getMatchPage = createServerFn({ method: "GET" })
  .inputValidator((i: { matchId: string; refresh?: boolean }) => {
    if (!i?.matchId) throw new Error("matchId required");
    return i;
  })
  .handler(async ({ data }) => {
    const season = currentSeason();

    const [details, ladder, allOdds] = await Promise.all([
      cached(`match:${data.matchId}`, TTL.match, () => fetchMatchDetails(data.matchId), { bypass: data.refresh }),
      cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season), { bypass: data.refresh }),
      cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds(), { bypass: data.refresh }),
    ]);

    // Match this fixture to an OddsEvent by team nicknames + kickoff date
    const homeNick = findTeam(details.homeTeam.nickName)?.nickname ?? details.homeTeam.nickName;
    const awayNick = findTeam(details.awayTeam.nickName)?.nickname ?? details.awayTeam.nickName;
    const odds: OddsEvent | null = allOdds.find((e) => {
      const eh = e.homeNickname; const ea = e.awayNickname;
      return (eh === homeNick && ea === awayNick) || (eh === awayNick && ea === homeNick);
    }) ?? null;

    // AI insights (cached per match for an hour)
    let insights: any = null; let insightsError: string | null = null;
    try {
      insights = await cached(
        `insights:${data.matchId}`,
        TTL.insights,
        () => generateInsights({
          homeName: details.homeTeam.nickName,
          awayName: details.awayTeam.nickName,
          venue: details.venue,
          homeRecentForm: details.homeTeam.recentForm,
          awayRecentForm: details.awayTeam.recentForm,
          homePosition: details.homeTeam.position,
          awayPosition: details.awayTeam.position,
          homeSquad: details.homeTeam.players,
          awaySquad: details.awayTeam.players,
          ladder: ladder.map((r) => ({
            nickname: r.nickname, played: r.played, wins: r.wins, losses: r.losses,
            for: r.for, against: r.against, diff: r.diff, points: r.points,
          })),
          oddsSummary: odds ? summariseOdds(odds, homeNick, awayNick) : "No live odds available",
        }),
        { bypass: data.refresh },
      );
    } catch (e) {
      insightsError = e instanceof Error ? e.message : "AI insights unavailable";
    }

    return { details, odds, ladder, insights, insightsError, generatedAt: new Date().toISOString() };
  });

function currentSeason(): number {
  // NRL season runs Mar–Oct. Use current calendar year.
  return new Date().getUTCFullYear();
}

function summariseOdds(ev: OddsEvent, home: string, away: string): string {
  const lines: string[] = [];
  for (const b of ev.bookmakers.slice(0, 5)) {
    const h2h = b.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    const h = h2h.outcomes.find((o) => findTeam(o.name)?.nickname === home);
    const a = h2h.outcomes.find((o) => findTeam(o.name)?.nickname === away);
    if (h && a) lines.push(`${b.title}: ${home} ${h.price} / ${away} ${a.price}`);
  }
  return lines.join(" | ") || "Odds present but unparseable";
}
