// All server functions exposed to the client. Server-only secrets stay here.
//
// FAILSAFE ARCHITECTURE: External services are split by tier.
//   Tier 1 (REQUIRED): NRL.com fixtures, ladder, match details. If these fail,
//     the page can't render and we surface the error.
//   Tier 2 (OPTIONAL): Odds, tryscorer markets, AI insights, weather. Each is
//     wrapped so a failure NEVER throws — we return null + a per-service error
//     string the UI can render as a soft warning. Last-good snapshots are kept
//     in memory so we degrade to cached data instead of empty state.

import { createServerFn } from "@tanstack/react-start";
import { cached, TTL, insightsTtlMs } from "./cache";
import { fetchDraw, fetchLadder, fetchMatchDetails, fetchMatchRecap, type NrlFixture, type NrlMatchRecap } from "./nrl";
import { buildEstimatedOdds, fetchNrlOdds, fetchEventOdds, fetchTryscorerOdds, type OddsEvent, type TryscorerMarkets } from "./odds";
import { generateInsights, type RealOdds, type Insights } from "./ai-insights";
import { fetchVenueWeather, type WeatherSnapshot } from "./weather";
import { findTeam } from "@/lib/teams";
import { readSharedInsights, readAnySharedInsights, writeSharedInsights } from "./insights-store";
import { getSeasonSnapshot } from "./season-stats";
import { generateDeterministicInsights, type DeterministicInsights } from "./insights-engine";

// In-flight generation lock — if multiple visitors hit the same uncached match
// simultaneously within a single worker, only one actually invokes the AI;
// the rest await the same promise and read the freshly persisted DB row.
const inFlight = new Map<string, Promise<Insights | null>>();

// ---------- Last-good snapshots (graceful degradation) ----------
// Survive across requests within a worker; replaced only on success.
let lastGoodOdds: { at: number; data: OddsEvent[] } | null = null;
const lastGoodTryscorers = new Map<string, { at: number; data: TryscorerMarkets }>();

async function safeOdds(refresh?: boolean): Promise<{ data: OddsEvent[]; error: string | null; stale: boolean }> {
  try {
    const data = await cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds(), { bypass: refresh });
    lastGoodOdds = { at: Date.now(), data };
    return { data, error: null, stale: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Odds unavailable";
    if (lastGoodOdds) return { data: lastGoodOdds.data, error: msg, stale: true };
    return { data: [], error: msg, stale: false };
  }
}

async function safeTryscorers(eventId: string, refresh?: boolean): Promise<{ data: TryscorerMarkets | null; error: string | null }> {
  try {
    const data = await cached(`tryscorers:${eventId}`, TTL.odds, () => fetchTryscorerOdds(eventId), { bypass: refresh });
    lastGoodTryscorers.set(eventId, { at: Date.now(), data });
    return { data, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Tryscorer odds unavailable";
    const prev = lastGoodTryscorers.get(eventId);
    if (prev) return { data: prev.data, error: msg };
    return { data: null, error: msg };
  }
}

async function safeWeather(matchId: string, venue: string, city: string, kickoffUtc: string, refresh?: boolean): Promise<WeatherSnapshot | null> {
  try {
    return await cached(`weather:${matchId}`, TTL.weather, () => fetchVenueWeather(venue, city, kickoffUtc), { bypass: refresh });
  } catch {
    return null;
  }
}

async function safeRecaps(recentForm: { url?: string }[], refresh?: boolean): Promise<NrlMatchRecap[]> {
  const urls = recentForm.map((r) => r.url).filter((u): u is string => !!u).slice(0, 2);
  const results = await Promise.all(urls.map(async (u) => {
    try {
      return await cached(`recap:${u}`, TTL.match, () => fetchMatchRecap(u), { bypass: refresh });
    } catch {
      return null;
    }
  }));
  return results.filter((r): r is NrlMatchRecap => !!r);
}

// ---------- Fixtures + current round ----------
// NRL.com's draw endpoint only returns ONE round at a time. To support the
// round selector (past + upcoming), we:
//   1. Hit the default endpoint to learn `currentRound`.
//   2. If the user asked for a different round, fetch that round directly.
//   3. Build the rounds list by sweeping 1..currentRound+8 (cached 6h, so the
//      sweep only runs once per worker every 6 hours).
const ROUNDS_TTL = 6 * 60 * 60_000;
const SEASON_ROUNDS = 27; // NRL regular season caps at 27 rounds

export const getCurrentRoundFixtures = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean; round?: number } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const season = currentSeason();

    // Step 1 — default fetch: reveals current round + its fixtures.
    const defaultDraw = await cached(
      `fixtures:${season}:current`,
      TTL.fixtures,
      () => fetchDraw(season),
      { bypass: data.refresh },
    );
    const currentRound = defaultDraw.find((f) => f.isCurrentRound)?.roundNumber ?? defaultDraw[0]?.roundNumber ?? 1;
    const selectedRound = data.round ?? currentRound;

    // Step 2 — fetch the requested round (skip the call if it matches default).
    const fixtures = selectedRound === currentRound
      ? defaultDraw.filter((f) => f.roundNumber === currentRound)
      : await cached(
          `fixtures:${season}:r${selectedRound}`,
          TTL.fixtures,
          () => fetchDraw(season, selectedRound),
          { bypass: data.refresh },
        );

    // Step 3 — build the rounds index. Sweep 1..currentRound+8, capped at 27.
    // Long-cached: only re-runs every 6h per worker.
    const rounds = await cached(
      `fixtures:${season}:rounds-index`,
      ROUNDS_TTL,
      async () => {
        const upper = Math.min(SEASON_ROUNDS, currentRound + 8);
        const probes = await Promise.all(
          Array.from({ length: upper }, (_, i) => i + 1).map(async (r) => {
            try {
              const list = await cached(
                `fixtures:${season}:r${r}`,
                ROUNDS_TTL,
                () => fetchDraw(season, r),
              );
              return list.length > 0 ? r : null;
            } catch {
              return null;
            }
          }),
        );
        return probes.filter((r): r is number => r != null);
      },
      { bypass: data.refresh },
    );

    // Always include the current + selected round even if the index missed them.
    const roundSet = new Set(rounds);
    roundSet.add(currentRound);
    if (selectedRound) roundSet.add(selectedRound);
    const rounds2 = Array.from(roundSet).sort((a, b) => a - b);

    // Per-fixture weather (cheap & cached). Squad / team-list data is NOT
    // touched here — that's only fetched on the match-detail page when a
    // user clicks in, so upcoming rounds appear with matchups + venues +
    // kickoffs only (no rosters until NRL.com publishes team lists).
    const enriched = await Promise.all(fixtures.map(async (f) => {
      const weather = await safeWeather(f.matchId, f.venue, f.venueCity, f.kickoffUtc, data.refresh);
      return { ...f, weather };
    }));

    return { season, round: selectedRound, currentRound, rounds: rounds2, fixtures: enriched };
  });

// ---------- Ladder ----------
export const getLadder = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const season = currentSeason();
    return cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season), { bypass: data.refresh });
  });

// ---------- Live odds (NEVER throws — Tier 2) ----------
export const getOdds = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const result = await safeOdds(data.refresh);
    if (result.error) console.warn(`[getOdds] ${result.error}${result.stale ? " (serving stale)" : ""}`);
    if (result.data.length > 0) return result.data;
    const season = currentSeason();
    const [fixtures, ladder] = await Promise.all([
      cached(`fixtures:${season}:current`, TTL.fixtures, () => fetchDraw(season), { bypass: data.refresh }).catch(() => []),
      cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season), { bypass: data.refresh }).catch(() => []),
    ]);
    return buildEstimatedOdds(fixtures, ladder);
  });

// ---------- Match details + odds + ladder + AI ----------
// Tier 1 (must succeed): match details, ladder.
// Tier 2 (optional, never throws): odds, tryscorers, weather, AI insights.
export const getMatchPage = createServerFn({ method: "GET" })
  .inputValidator((i: { matchId: string; refresh?: boolean }) => {
    if (!i?.matchId) throw new Error("matchId required");
    return i;
  })
  .handler(async ({ data }) => {
    const season = currentSeason();

    // ----- Tier 1 (parallel, throws if either fails) -----
    const [details, ladder] = await Promise.all([
      cached(`match:${data.matchId}`, TTL.match, () => fetchMatchDetails(data.matchId), { bypass: data.refresh }),
      cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season), { bypass: data.refresh }),
    ]);

    // ----- Tier 2 (parallel, each isolated — never blocks the page) -----
    const homeNick = findTeam(details.homeTeam.nickName)?.nickname ?? details.homeTeam.nickName;
    const awayNick = findTeam(details.awayTeam.nickName)?.nickname ?? details.awayTeam.nickName;

    const [oddsResult, weather, homeRecaps, awayRecaps] = await Promise.all([
      safeOdds(data.refresh),
      safeWeather(data.matchId, details.venue, details.venueCity, details.kickoffUtc, data.refresh),
      safeRecaps(details.homeTeam.recentForm, data.refresh),
      safeRecaps(details.awayTeam.recentForm, data.refresh),
    ]);

    let odds: OddsEvent | null = oddsResult.data.find((e) => {
      const eh = e.homeNickname; const ea = e.awayNickname;
      return (eh === homeNick && ea === awayNick) || (eh === awayNick && ea === homeNick);
    }) ?? null;
    if (!odds && oddsResult.data.length === 0) {
      odds = buildEstimatedOdds([fixtureFromDetails(details)], ladder)[0] ?? null;
    }
    const oddsError = oddsResult.error;
    const oddsStale = oddsResult.stale;

    // Tryscorer markets — only attempt if we have an odds event matched.
    let tryscorers: TryscorerMarkets | null = null;
    let tryscorersError: string | null = null;
    if (odds) {
      const r = await safeTryscorers(odds.id, data.refresh);
      tryscorers = r.data;
      tryscorersError = r.error;
    }

    // AI insights — DO NOT generate inline (would exceed Worker request timeout
    // and abort the whole page). Read the shared DB cache so every visitor sees
    // the same payload; if no fresh row exists, the client lazily calls
    // getMatchInsights() to generate (single-flight) and persist it.
    const stored = await readSharedInsights(data.matchId);

    return {
      details: { ...details, weather },
      odds,
      oddsError,
      oddsStale,
      tryscorers,
      tryscorersError,
      ladder,
      insights: stored?.payload ?? null,
      insightsError: null,
      recentRecaps: { home: homeRecaps, away: awayRecaps },
      generatedAt: new Date().toISOString(),
    };
  });

// Lazily generate insights — called by the client AFTER the match page renders.
// PRIMARY path: deterministic stats engine (fast, no AI). It always runs and is
// persisted immediately so the Insights tab renders within ~1-2 seconds. AI
// enrichment for the Script tab is best-effort and runs after — its failure
// never blocks the deterministic insights from being shown.
export const getMatchInsights = createServerFn({ method: "GET" })
  .inputValidator((i: { matchId: string; refresh?: boolean }) => {
    if (!i?.matchId) throw new Error("matchId required");
    return i;
  })
  .handler(async ({ data }) => {
    const season = currentSeason();
    try {
      // 1) Fast-path: shared DB cache hit with deterministic payload present.
      if (!data.refresh) {
        const stored = await readSharedInsights(data.matchId);
        if (stored && (stored.payload as unknown as { deterministic?: unknown }).deterministic) {
          return { insights: stored.payload, insightsError: null as string | null };
        }
      }

      // 2) Single-flight: if another request for the same match is already
      //    generating, await it instead of firing a duplicate AI call.
      const lockKey = data.matchId;
      const existing = inFlight.get(lockKey);
      if (existing && !data.refresh) {
        const insights = await existing;
        if (insights) return { insights, insightsError: null as string | null };
      }

      const job = (async (): Promise<Insights | null> => {
        const [details, ladder] = await Promise.all([
          cached(`match:${data.matchId}`, TTL.match, () => fetchMatchDetails(data.matchId)),
          cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)),
        ]);
        const homeNick = findTeam(details.homeTeam.nickName)?.nickname ?? details.homeTeam.nickName;
        const awayNick = findTeam(details.awayTeam.nickName)?.nickname ?? details.awayTeam.nickName;
        const oddsResult = await safeOdds();
        const odds = oddsResult.data.find((e) => {
          const eh = e.homeNickname; const ea = e.awayNickname;
          return (eh === homeNick && ea === awayNick) || (eh === awayNick && ea === homeNick);
        }) ?? null;
        const weather = await safeWeather(data.matchId, details.venue, details.venueCity, details.kickoffUtc);
        let tryscorers: TryscorerMarkets | null = null;
        if (odds) {
          const r = await safeTryscorers(odds.id);
          tryscorers = r.data;
        }

        // ---- PRIMARY: deterministic stats engine. Runs always, no AI. ----
        let deterministic: DeterministicInsights | null = null;
        try {
          const snap = await getSeasonSnapshot(season);
          deterministic = generateDeterministicInsights({
            homeNickname: details.homeTeam.nickName,
            awayNickname: details.awayTeam.nickName,
            homeThemeKey: details.homeTeam.themeKey,
            awayThemeKey: details.awayTeam.themeKey,
            homeSquad: details.homeTeam.players,
            awaySquad: details.awayTeam.players,
            ladder,
            snapshot: snap,
            weather,
            tryscorers,
            venue: details.venue,
          });
        } catch (err) {
          console.warn("deterministic engine failed:", err);
        }

        // Persist deterministic-only payload IMMEDIATELY so the Insights tab
        // becomes available even if AI enrichment below fails or times out.
        const minimalPayload = { deterministic } as unknown as Insights;
        if (deterministic) {
          await writeSharedInsights(data.matchId, minimalPayload, insightsTtlMs(details.kickoffUtc));
        }

        // ---- SECONDARY: AI enrichment for Script tab. Best-effort. ----
        const realOdds = odds ? buildRealOdds(odds, homeNick, awayNick, tryscorers) : undefined;
        try {
          const generated = await generateInsights({
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
            realOdds,
            weatherSummary: weather ? `${weather.tempC}°C, ${weather.condition}, ${weather.windKph} km/h wind, ${weather.precipMm}mm rain (${weather.groundCondition} ground)` : "Weather unavailable",
            homeTeamNews: details.teamNews?.home ?? null,
            awayTeamNews: details.teamNews?.away ?? null,
            statGroups: details.statGroups,
          });
          if (deterministic) {
            (generated as unknown as { deterministic: DeterministicInsights }).deterministic = deterministic;
          }
          await writeSharedInsights(data.matchId, generated, insightsTtlMs(details.kickoffUtc));
          return generated;
        } catch (err) {
          console.warn("AI insight enrichment failed (deterministic still served):", err);
          return deterministic ? minimalPayload : null;
        }
      })();

      inFlight.set(lockKey, job);
      try {
        const insights = await job;
        if (insights) return { insights, insightsError: null as string | null };
        return { insights: null, insightsError: "Insights engine produced no output" };
      } finally {
        inFlight.delete(lockKey);
      }
    } catch (e) {
      const stale = await readAnySharedInsights(data.matchId);
      if (stale) return { insights: stale.payload, insightsError: null as string | null };
      return { insights: null, insightsError: e instanceof Error ? e.message : "Insights unavailable" };
    }
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

// Build a structured "real odds" object the AI uses to quote EXACT bookie
// prices for h2h, totals, and tryscorer markets — fixes the "way off" issue.
function buildRealOdds(ev: OddsEvent, home: string, away: string, tryscorers: TryscorerMarkets | null): RealOdds {
  // Best h2h price across bookmakers
  let bestHome: { price: number; book: string } | null = null;
  let bestAway: { price: number; book: string } | null = null;
  // Best totals: pick most-common line, take best over/under across bookies
  const totalsByLine = new Map<number, { over: number; under: number; book: string }>();
  // Best spreads (line betting) per line
  const spreadsByLine = new Map<number, { homePrice: number; awayPrice: number; book: string }>();

  for (const b of ev.bookmakers) {
    const h2h = b.markets.find((m) => m.key === "h2h");
    if (h2h) {
      for (const o of h2h.outcomes) {
        const isHome = findTeam(o.name)?.nickname === home;
        if (isHome && (!bestHome || o.price > bestHome.price)) bestHome = { price: o.price, book: b.title };
        else if (!isHome && (!bestAway || o.price > bestAway.price)) bestAway = { price: o.price, book: b.title };
      }
    }
    const totals = b.markets.find((m) => m.key === "totals");
    if (totals) {
      // Group outcomes by line
      const byLine = new Map<number, { over?: number; under?: number }>();
      for (const o of totals.outcomes) {
        if (typeof o.point !== "number") continue;
        const slot = byLine.get(o.point) ?? {};
        if (o.name?.toLowerCase() === "over") slot.over = o.price;
        else if (o.name?.toLowerCase() === "under") slot.under = o.price;
        byLine.set(o.point, slot);
      }
      for (const [line, prices] of byLine) {
        if (prices.over == null || prices.under == null) continue;
        const existing = totalsByLine.get(line);
        if (!existing || prices.over + prices.under > existing.over + existing.under) {
          totalsByLine.set(line, { over: prices.over, under: prices.under, book: b.title });
        }
      }
    }
    const spreads = b.markets.find((m) => m.key === "spreads");
    if (spreads) {
      const byLine = new Map<number, { homePrice?: number; awayPrice?: number }>();
      for (const o of spreads.outcomes) {
        if (typeof o.point !== "number") continue;
        const isHome = findTeam(o.name)?.nickname === home;
        const key = Math.abs(o.point);
        const slot = byLine.get(key) ?? {};
        if (isHome) slot.homePrice = o.price; else slot.awayPrice = o.price;
        byLine.set(key, slot);
      }
      for (const [line, prices] of byLine) {
        if (prices.homePrice == null || prices.awayPrice == null) continue;
        if (!spreadsByLine.has(line)) spreadsByLine.set(line, { homePrice: prices.homePrice, awayPrice: prices.awayPrice, book: b.title });
      }
    }
  }

  return {
    h2h: { home: bestHome, away: bestAway },
    totals: Array.from(totalsByLine.entries())
      .map(([line, v]) => ({ line, over: v.over, under: v.under, book: v.book }))
      .sort((a, b) => Math.abs(a.line - 40) - Math.abs(b.line - 40)) // closest to typical NRL total first
      .slice(0, 3),
    spreads: Array.from(spreadsByLine.entries())
      .map(([line, v]) => ({ line, homePrice: v.homePrice, awayPrice: v.awayPrice, book: v.book }))
      .slice(0, 3),
    tryscorers: {
      first: (tryscorers?.first ?? []).map((t) => ({ player: t.player, price: t.price })),
      anytime: (tryscorers?.anytime ?? []).map((t) => ({ player: t.player, price: t.price })),
      multi: (tryscorers?.multi ?? []).map((t) => ({ player: t.player, price: t.price })),
    },
  };
}
