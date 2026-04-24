// All server functions exposed to the client. Server-only secrets stay here.

import { createServerFn } from "@tanstack/react-start";
import { cached, TTL } from "./cache";
import { fetchDraw, fetchLadder, fetchMatchDetails } from "./nrl";
import { fetchNrlOdds, fetchTryscorerOdds, type OddsEvent, type TryscorerMarkets } from "./odds";
import { generateInsights } from "./ai-insights";
import { fetchVenueWeather, type WeatherSnapshot } from "./weather";
import { buildStatsBundle, compareStats, type StatsBundle, type StatEdge } from "./stats";
import { buildPlayerForms, type PlayerForm } from "./players";
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
        const enriched = await Promise.all(fixtures.map(async (f) => {
          const weather = await cached(
            `weather:${f.matchId}`,
            TTL.weather,
            () => fetchVenueWeather(f.venue, f.venueCity, f.kickoffUtc),
            { bypass: data.refresh },
          );
          return { ...f, weather };
        }));
        return { season, round: currentRound, fixtures: enriched };
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

// ---------- Match page (everything) ----------
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

    const weather: WeatherSnapshot | null = await cached(
      `weather:${data.matchId}`,
      TTL.weather,
      () => fetchVenueWeather(details.venue, details.venueCity, details.kickoffUtc),
      { bypass: data.refresh },
    );

    const homeNick = findTeam(details.homeTeam.nickName)?.nickname ?? details.homeTeam.nickName;
    const awayNick = findTeam(details.awayTeam.nickName)?.nickname ?? details.awayTeam.nickName;
    const odds: OddsEvent | null = allOdds.find((e) => {
      const eh = e.homeNickname; const ea = e.awayNickname;
      return (eh === homeNick && ea === awayNick) || (eh === awayNick && ea === homeNick);
    }) ?? null;

    // Tryscorer markets (~24h before kickoff)
    const tryscorers: TryscorerMarkets | null = odds
      ? await cached(`tryscorers:${odds.id}`, TTL.odds, () => fetchTryscorerOdds(odds.id), { bypass: data.refresh }).catch(() => null)
      : null;

    // Per-game stats bundle from each team's recent played matches
    const homeRecentUrls = (details.homeTeam.recentForm ?? []).map((f: any) => f.url).filter(Boolean);
    const awayRecentUrls = (details.awayTeam.recentForm ?? []).map((f: any) => f.url).filter(Boolean);

    let statsBundle: StatsBundle | null = null;
    let statEdges: StatEdge[] = [];
    let homePlayerForms: PlayerForm[] = [];
    let awayPlayerForms: PlayerForm[] = [];

    try {
      statsBundle = await cached(
        `statsbundle:${data.matchId}`,
        TTL.match,
        () => buildStatsBundle(details.homeTeam.nickName, homeRecentUrls, details.awayTeam.nickName, awayRecentUrls),
        { bypass: data.refresh },
      );
      statEdges = compareStats(statsBundle.home, statsBundle.away);
    } catch { /* stats optional */ }

    try {
      [homePlayerForms, awayPlayerForms] = await Promise.all([
        buildPlayerForms(details.homeTeam.nickName, details.homeTeam.players, homeRecentUrls),
        buildPlayerForms(details.awayTeam.nickName, details.awayTeam.players, awayRecentUrls),
      ]);
    } catch { /* player forms optional */ }

    // Distill top 6 players per team for AI prompt
    const topFor = (forms: PlayerForm[]) => forms
      .filter((p) => p.appearances > 0)
      .sort((a, b) => (b.avgRunMetres + b.avgTackles * 3 + b.avgTries * 50 + b.avgTryAssists * 30) -
                      (a.avgRunMetres + a.avgTackles * 3 + a.avgTries * 50 + a.avgTryAssists * 30))
      .slice(0, 6)
      .map((p) => ({
        name: `${p.firstName} ${p.lastName}`, position: p.position, trend: p.trend,
        avgRunMetres: p.avgRunMetres, avgTackles: p.avgTackles, avgTries: p.avgTries,
        avgTryAssists: p.avgTryAssists, roleNote: p.roleNote,
      }));

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
          weatherSummary: weather ? `${weather.tempC}°C, ${weather.condition}, ${weather.windKph} km/h wind, ${weather.precipMm}mm rain (${weather.groundCondition} ground)` : "Weather unavailable",
          statEdges: statEdges.map((e) => ({ field: e.field, homeAvg: e.homeAvg, awayAvg: e.awayAvg, edge: e.edge, framing: e.framing })),
          homeTopPlayers: topFor(homePlayerForms),
          awayTopPlayers: topFor(awayPlayerForms),
        }),
        { bypass: data.refresh },
      );
    } catch (e) {
      insightsError = e instanceof Error ? e.message : "AI insights unavailable";
    }

    return {
      details: { ...details, weather },
      odds, tryscorers, ladder,
      statsBundle, statEdges,
      homePlayerForms, awayPlayerForms,
      insights, insightsError,
      generatedAt: new Date().toISOString(),
    };
  });

function currentSeason(): number {
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
  // Add spreads + totals for richer market signal
  const first = ev.bookmakers[0];
  if (first) {
    const sp = first.markets.find((m) => m.key === "spreads");
    const tot = first.markets.find((m) => m.key === "totals");
    if (sp) lines.push(`spread: ${sp.outcomes.map((o) => `${o.name} ${o.point}`).join(" / ")}`);
    if (tot) lines.push(`total: ${tot.outcomes[0]?.point ?? "?"}`);
  }
  return lines.join(" | ") || "Odds present but unparseable";
}
