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
import { fetchDraw, fetchLadder, fetchMatchDetails, fetchMatchRecap, fetchRecentH2H, matchIdToPath, type NrlFixture, type NrlMatchRecap, type RecentH2HMatch } from "./nrl";
import { buildEstimatedOdds, fetchNrlOdds, fetchEventOdds, fetchTryscorerOdds, type OddsEvent, type TryscorerMarkets } from "./odds";
import { generateInsights, type RealOdds, type Insights } from "./ai-insights";
import { fetchVenueWeather, type WeatherSnapshot } from "./weather";
import { findTeam } from "@/lib/teams";
import { readSharedInsights, readAnySharedInsights, readLockedSharedInsights, writeSharedInsights } from "./insights-store";
import { getSeasonSnapshot } from "./season-stats";
import { generateDeterministicInsights, type DeterministicInsights } from "./insights-engine";
import { getLeaderboards, buildPlayerLeaderboardMap } from "./stats-leaders";
import { resolveModelMode, squadIsNamed, squadSignature, modeAdvanced, type ModelMode } from "./model-mode";
import { buildDeterministicBets } from "./bets-engine";
import { indexSquads, isInSquad } from "./validate-picks";
import { ensureAftermatch, readAftermatch, type AftermatchPayload } from "./aftermatch";
import { fetchZylaLadder, getZylaRequestCount } from "./zyla";
import { generateScript, type ScriptPayload } from "./script-engine";
import { readOddsCache, readOddsCacheEntry, readOddsCacheStale, readOddsCacheStaleEntry, writeOddsCache } from "./odds-store";
import { snapshotPrediction, buildSnapshotRow, sealPredictionSnapshot } from "./prediction-tracking";
import { listActiveImpacts, impactsForFixture, applyImpacts } from "./news-impacts";
import { getOrGenerateSimulation, isSimulationEnabled } from "./simulation-integration";
import { normaliseInsights } from "./normalise-insights";

// Source tracking — surfaced in server logs and (where harmless) on payloads.
export type DataSource = "nrl_com" | "zyla" | "mixed" | "proxy";

// In-flight generation lock — if multiple visitors hit the same uncached match
// simultaneously within a single worker, only one actually invokes the AI;
// the rest await the same promise and read the freshly persisted DB row.
const inFlight = new Map<string, Promise<Insights | null>>();

function normaliseStoredInsights(payload: Insights | null | undefined, homeName: string, awayName: string): Insights | null {
  if (!payload || typeof payload !== "object") return null;
  try {
    return normaliseInsights(payload, homeName, awayName);
  } catch (error) {
    console.warn("normaliseStoredInsights failed:", error);
    return payload;
  }
}

// Cache freshness gate. A stored insights row is only valid when:
//   1. The squad signature on disk matches the current NRL.com squads, AND
//   2. The model mode hasn't advanced (early → squad → market → final) since
//      the row was generated.
// This is the fix for "insights didn't update when team lists dropped" —
// previously the row sat for hours until its TTL expired.
async function readFreshInsights(
  matchId: string,
  details: Awaited<ReturnType<typeof fetchMatchDetails>>,
  tryscorers: TryscorerMarkets | null,
): Promise<Awaited<ReturnType<typeof readSharedInsights>>> {
  const kickoffMs = details.kickoffUtc ? Date.parse(details.kickoffUtc) : NaN;
  const kickoffPassed = Number.isFinite(kickoffMs) && kickoffMs <= Date.now();
  const stateStarted = details.matchState ? !/^(Upcoming|Pre[\s_-]?Game|Scheduled)$/i.test(details.matchState) : false;
  if (kickoffPassed || stateStarted) {
    return readLockedSharedInsights(matchId, details.kickoffUtc);
  }
  const stored = await readSharedInsights(matchId);
  if (!stored) return null;
  const payload = stored.payload as unknown as {
    modelMode?: ModelMode;
    squadSig?: { home?: string; away?: string };
    deterministic?: unknown;
    script?: unknown;
  };
  if (!payload.deterministic || !payload.script) {
    return null; // old cache row missing the stats engine or script payload
  }
  const homeSig = squadSignature(details.homeTeam.players);
  const awaySig = squadSignature(details.awayTeam.players);
  if (payload.squadSig?.home !== homeSig || payload.squadSig?.away !== awaySig) {
    return null; // squads changed since payload was written
  }
  const hasSquads = squadIsNamed(details.homeTeam.players) && squadIsNamed(details.awayTeam.players);
  const hasPlayerOdds = !!tryscorers?.hasAny;
  const current = resolveModelMode({ kickoffUtc: details.kickoffUtc, hasSquads, hasPlayerOdds }).mode;
  if (modeAdvanced(payload.modelMode, current)) {
    return null; // mode advanced (e.g. early → squad once team lists dropped)
  }
  return stored;
}

function hasStartedOrFinished(details: { matchState?: string; kickoffUtc?: string }): { started: boolean; finished: boolean } {
  const finished = /^(FullTime|Final|Completed)$/i.test(details.matchState ?? "");
  const kickoffMs = details.kickoffUtc ? Date.parse(details.kickoffUtc) : NaN;
  const kickoffPassed = Number.isFinite(kickoffMs) && kickoffMs <= Date.now();
  const stateStarted = details.matchState ? !/^(Upcoming|Pre[\s_-]?Game|Scheduled)$/i.test(details.matchState) : false;
  return { started: finished || kickoffPassed || stateStarted, finished };
}

async function sealFromLockedInsights(matchId: string, details: Awaited<ReturnType<typeof fetchMatchDetails>>) {
  const locked = await readLockedSharedInsights(matchId, details.kickoffUtc);
  await sealPredictionSnapshot({
    matchId,
    kickoffUtc: details.kickoffUtc,
    insightsPayload: locked?.payload ?? null,
    sourceMatchInsightsKey: locked?.sourceKey ?? null,
  });
  return locked;
}

// ---------- Last-good snapshots (graceful degradation) ----------
// Two layers: in-memory (per worker, instant) and DB-backed (survives cold
// starts, written by cron warmers). The DB layer is the key quota saver —
// without it, every new worker re-hits the Odds API on first use.
let lastGoodOdds: { at: number; data: OddsEvent[] } | null = null;
const lastGoodTryscorers = new Map<string, { at: number; data: TryscorerMarkets }>();
const EMPTY_TRYSCORER_RETRY_MS = 30 * 60_000;

async function safeOdds(refresh?: boolean): Promise<{ data: OddsEvent[]; error: string | null; stale: boolean }> {
  // 1) Memory cache first (fastest)
  // 2) DB cache (cron-warmed; survives cold starts)
  // 3) Live API fetch (last resort)
  if (!refresh) {
    const dbHit = await readOddsCache<OddsEvent[]>("odds:nrl");
    if (dbHit) {
      lastGoodOdds = { at: Date.now(), data: dbHit };
      return { data: dbHit, error: null, stale: false };
    }
  }
  try {
    const data = await cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds(), { bypass: refresh });
    lastGoodOdds = { at: Date.now(), data };
    await writeOddsCache("odds:nrl", data, TTL.odds);
    return { data, error: null, stale: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Odds unavailable";
    if (lastGoodOdds) return { data: lastGoodOdds.data, error: msg, stale: true };
    const stale = await readOddsCacheStale<OddsEvent[]>("odds:nrl");
    if (stale) return { data: stale, error: msg, stale: true };
    return { data: [], error: msg, stale: false };
  }
}

async function safeTryscorers(eventId: string, refresh?: boolean): Promise<{ data: TryscorerMarkets | null; error: string | null }> {
  if (!refresh) {
    const dbHit = await readOddsCacheEntry<TryscorerMarkets>(`tryscorers:${eventId}`);
    if (dbHit && (dbHit.payload.hasAny || Date.now() - Date.parse(dbHit.generatedAt) < EMPTY_TRYSCORER_RETRY_MS)) {
      lastGoodTryscorers.set(eventId, { at: Date.now(), data: dbHit.payload });
      return { data: dbHit.payload, error: null };
    }
  }
  try {
    const data = await cached(`tryscorers:${eventId}`, TTL.oddsTryscorer, () => fetchTryscorerOdds(eventId), { bypass: refresh });
    lastGoodTryscorers.set(eventId, { at: Date.now(), data });
    await writeOddsCache(`tryscorers:${eventId}`, data, TTL.oddsTryscorer);
    return { data, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Tryscorer odds unavailable";
    const prev = lastGoodTryscorers.get(eventId);
    if (prev) return { data: prev.data, error: msg };
    const stale = await readOddsCacheStaleEntry<TryscorerMarkets>(`tryscorers:${eventId}`);
    if (stale && (stale.payload.hasAny || Date.now() - Date.parse(stale.generatedAt) < EMPTY_TRYSCORER_RETRY_MS)) return { data: stale.payload, error: msg };
    return { data: null, error: msg };
  }
}

// Tryscorer markets get released by bookies once team lists drop (Tuesday 6pm
// NZT). Round games run Thu-Sun, so allow fetches up to 6 days out to cover
// every fixture in the current round; the persistent DB cache + scheduled
// refresh hooks keep API usage low.
function tryscorerFetchAllowed(kickoffUtc: string): boolean {
  const ko = Date.parse(kickoffUtc);
  if (!Number.isFinite(ko)) return false;
  const msUntil = ko - Date.now();
  // Allow from 6 days before kickoff through 4h after (covers in-play / just-finished).
  return msUntil <= 6 * 24 * 60 * 60_000 && msUntil >= -4 * 60 * 60_000;
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
// PERF: Heavy round-index sweeps were causing slow first paints. We now:
//   1. Only probe a tiny window of upcoming rounds (current..current+3) instead
//      of sweeping 1..currentRound+8. Past rounds always exist by definition
//      and are added directly to the index without a network probe.
//   2. Cache the rounds-index for 30 min (was 6h, but the previous code still
//      ran a wide parallel sweep when cold — the new narrow probe is cheap).
//   3. Skip per-fixture weather enrichment entirely on the list page. Weather
//      now loads lazily on the match-detail page (where users actually look at
//      it). This removes N parallel weather API calls from every list render.
const ROUNDS_TTL = 30 * 60_000; // 30 minutes, per perf brief
const SEASON_ROUNDS = 27; // NRL regular season caps at 27 rounds
const UPCOMING_PROBE_WINDOW = 3; // only probe currentRound + 1..3 ahead

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
    // Other rounds are fetched lazily here when the user changes the selector.
    const fixtures = selectedRound === currentRound
      ? defaultDraw.filter((f) => f.roundNumber === currentRound)
      : await cached(
          `fixtures:${season}:r${selectedRound}`,
          TTL.fixtures,
          () => fetchDraw(season, selectedRound),
          { bypass: data.refresh },
        );

    // Step 3 — rounds index. Past rounds are assumed to exist (1..currentRound)
    // and added without a probe. Only the next few upcoming rounds are probed,
    // and the whole result is cached for 30 min per worker.
    const rounds = await cached(
      `fixtures:${season}:rounds-index`,
      ROUNDS_TTL,
      async () => {
        const past = Array.from({ length: currentRound }, (_, i) => i + 1);
        const upper = Math.min(SEASON_ROUNDS, currentRound + UPCOMING_PROBE_WINDOW);
        const upcoming = Array.from({ length: upper - currentRound }, (_, i) => currentRound + 1 + i);
        const probed = await Promise.all(
          upcoming.map(async (r) => {
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
        return [...past, ...probed.filter((r): r is number => r != null)];
      },
      { bypass: data.refresh },
    );

    // Always include the current + selected round even if the index missed them.
    const roundSet = new Set(rounds);
    roundSet.add(currentRound);
    if (selectedRound) roundSet.add(selectedRound);
    const rounds2 = Array.from(roundSet).sort((a, b) => a - b);

    // PERF: Weather intentionally NOT fetched here — it's loaded on the match
    // detail page on demand. Returning fixtures verbatim (weather will be
    // undefined in the MatchCard, which already renders "Forecast pending").
    return { season, round: selectedRound, currentRound, rounds: rounds2, fixtures };
  });


// ---------- Ladder ----------
// Primary: NRL.com. Fallback: Zyla (12h cached).
export const getLadder = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const season = currentSeason();
    try {
      const rows = await cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season), { bypass: data.refresh });
      console.info(`[ladder] source=nrl_com rows=${rows.length}`);
      return rows;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[ladder] NRL.com failed (${msg}) — trying Zyla fallback`);
      const zyla = await fetchZylaLadder(season);
      if (zyla && zyla.length > 0) {
        console.info(`[ladder] source=zyla rows=${zyla.length} zylaCount=${getZylaRequestCount()}`);
        return zyla;
      }
      console.error(`[ladder] BOTH sources failed (NRL.com + Zyla)`);
      throw e;
    }
  });

// ---------- Projected end-of-season ladder ----------
// Combines live ladder + remaining fixtures + locked prediction snapshots.
// Cached 30min in-memory; bypass with refresh.
export const getProjectedLadder = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const season = currentSeason();
    return cached(`projected-ladder:${season}`, 30 * 60_000, async () => {
      const { projectLadder } = await import("./projected-ladder");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const live = await cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season));
      // Sweep all rounds for remaining (non-finished) fixtures.
      const rounds = Array.from({ length: SEASON_ROUNDS }, (_, i) => i + 1);
      const allFixtures: NrlFixture[] = [];
      const draws = await Promise.all(rounds.map((r) =>
        cached(`fixtures:${season}:r${r}`, ROUNDS_TTL, () => fetchDraw(season, r)).catch(() => [] as NrlFixture[])
      ));
      for (const d of draws) allFixtures.push(...d);
      const remaining = allFixtures.filter((f) => !/^(FullTime|Final|Completed)$/i.test(f.matchState));
      const matchIds = remaining.map((f) => f.matchId);
      const snapMap = new Map<string, {
        match_id: string; predicted_winner: string | null; predicted_margin_band: string | null;
        predicted_score_home: number | null; predicted_score_away: number | null;
        home_team: string; away_team: string;
      }>();
      if (matchIds.length > 0) {
        try {
          const { data: rows } = await supabaseAdmin
            .from("prediction_snapshots" as never)
            .select("match_id, predicted_winner, predicted_margin_band, predicted_score_home, predicted_score_away, home_team, away_team")
            .in("match_id" as never, matchIds as never);
          for (const r of (rows ?? []) as unknown as Array<{ match_id: string; predicted_winner: string | null; predicted_margin_band: string | null; predicted_score_home: number | null; predicted_score_away: number | null; home_team: string; away_team: string }>) {
            snapMap.set(r.match_id, r);
          }
        } catch (e) { console.warn("projected ladder snapshot fetch failed:", e); }
      }
      const projected = projectLadder(live, remaining, snapMap);
      return { projected, remainingFixtures: remaining.length, snapshotCoverage: snapMap.size };
    }, { bypass: data.refresh });
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
    // For FINISHED matches the details payload is immutable, so we cache it for
    // 7 days under a separate key. This avoids re-hitting NRL.com on every cold
    // worker for a played game — the #1 cause of slow past-match loads.
    const liveDetailsP = cached(`match:${data.matchId}`, TTL.match, () => fetchMatchDetails(data.matchId), { bypass: data.refresh })
      .catch((err) => {
        console.error(`[getMatchPage] match ${data.matchId} unavailable:`, err);
        throw new Response(`Match not found: ${data.matchId}`, { status: 404 });
      });
    const [details, ladder] = await Promise.all([
      // Try the long-lived finished cache first (no network); fall back to live fetch.
      cached(`match:finished:${data.matchId}`, 7 * 24 * 60 * 60_000, () => liveDetailsP, { bypass: data.refresh }),
      cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season), { bypass: data.refresh }),
    ]);

    // Last 5 head-to-head fixtures between these two teams (cached 24h — past
    // results don't change). Isolated so failure never blocks the page.
    const recentH2HP = cached(
      `h2h:${details.homeTeam.nickName}:${details.awayTeam.nickName}:${season}`,
      24 * 60 * 60_000,
      () => fetchRecentH2H(details.homeTeam.nickName, details.awayTeam.nickName, season, 5),
      { bypass: data.refresh },
    ).catch((err) => { console.warn("[getMatchPage] recentH2H failed:", err); return [] as RecentH2HMatch[]; });

    const { started, finished } = hasStartedOrFinished(details);

    // ===== FAST PATH for finished matches =====
    // Odds, weather, tryscorers, recent-form recaps and live insight regeneration
    // are all irrelevant once the game is over — every tab (Lineup/Stats/Insights/
    // Script/Aftermatch) reads from stored snapshots. Skip all Tier-2 network calls
    // and return the locked prediction + cached aftermatch immediately.
    if (finished) {
      const [locked, aftermatch, recentH2H] = await Promise.all([
        sealFromLockedInsights(data.matchId, details),
        readAftermatch(data.matchId),
        recentH2HP,
      ]);
      return {
        details: { ...details, weather: null },
        odds: null,
        oddsError: null,
        oddsStale: false,
        tryscorers: null,
        tryscorersError: null,
        ladder,
        insights: locked?.payload ?? null,
        insightsError: null,
        recentRecaps: { home: [], away: [] },
        recentH2H,
        aftermatch: aftermatch ?? null,
        generatedAt: new Date().toISOString(),
        // NB: if aftermatch is null here, the client can lazily request it.
        // We deliberately do NOT generate inline — that fetches the NRL recap
        // page + runs AI, which would re-introduce the slow load.
      };
    }

    // ----- Tier 2 (parallel, each isolated — never blocks the page) -----
    const homeNick = findTeam(details.homeTeam.nickName)?.nickname ?? details.homeTeam.nickName;
    const awayNick = findTeam(details.awayTeam.nickName)?.nickname ?? details.awayTeam.nickName;

    const [oddsResult, weather, homeRecaps, awayRecaps, recentH2H] = await Promise.all([
      safeOdds(data.refresh),
      safeWeather(data.matchId, details.venue, details.venueCity, details.kickoffUtc, data.refresh),
      safeRecaps(details.homeTeam.recentForm, data.refresh),
      safeRecaps(details.awayTeam.recentForm, data.refresh),
      recentH2HP,
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

    // Tryscorer markets — only attempt if we have an odds event matched AND
    // kickoff is within 48h (markets aren't released earlier; saves API quota).
    let tryscorers: TryscorerMarkets | null = null;
    let tryscorersError: string | null = null;
    if (odds && tryscorerFetchAllowed(details.kickoffUtc)) {
      const r = await safeTryscorers(odds.id, data.refresh);
      tryscorers = r.data;
      tryscorersError = r.error;
    }

    // AI insights — DO NOT generate inline (would exceed Worker request timeout
    // and abort the whole page). Read the shared DB cache so every visitor sees
    // the same payload; if no fresh row exists, the client lazily calls
    // getMatchInsights() to generate (single-flight) and persist it.
    // Invalidate the cache when squads or mode have advanced since storage.
    const stored = await readFreshInsights(data.matchId, details, tryscorers);

    let insightsForResponse = normaliseStoredInsights(stored?.payload ?? null, details.homeTeam.nickName, details.awayTeam.nickName);
    if (started) {
      const locked = await sealFromLockedInsights(data.matchId, details);
      if (locked) insightsForResponse = normaliseStoredInsights(locked.payload, details.homeTeam.nickName, details.awayTeam.nickName);
    }

    return {
      details: { ...details, weather },
      odds,
      oddsError,
      oddsStale,
      tryscorers,
      tryscorersError,
      ladder,
      insights: insightsForResponse,
      insightsError: null,
      recentRecaps: { home: homeRecaps, away: awayRecaps },
      recentH2H,
      aftermatch: null as AftermatchPayload | null,
      generatedAt: new Date().toISOString(),
    };
  });

// Lazy aftermatch — called by the client after the page renders when a finished
// match has no stored aftermatch yet. Fetches NRL recap + runs the writeup, then
// persists forever. Returns the existing row if already stored.
export const getMatchAftermatch = createServerFn({ method: "GET" })
  .inputValidator((i: { matchId: string }) => {
    if (!i?.matchId) throw new Error("matchId required");
    return i;
  })
  .handler(async ({ data }) => {
    const existing = await readAftermatch(data.matchId);
    if (existing) return { aftermatch: existing };
    const details = await cached(`match:${data.matchId}`, TTL.match, () => fetchMatchDetails(data.matchId));
    const { finished } = hasStartedOrFinished(details);
    if (!finished) return { aftermatch: null };
    try {
      const ownRecap = await fetchMatchRecap(`https://www.nrl.com${matchIdToPath(data.matchId)}`);
      const locked = await readLockedSharedInsights(data.matchId, details.kickoffUtc);
      const aftermatch = await ensureAftermatch({
        matchId: data.matchId,
        details,
        recap: ownRecap,
        insights: locked?.payload ?? null,
      });
      return { aftermatch };
    } catch (e) {
      console.warn("lazy aftermatch generation failed:", e);
      return { aftermatch: null };
    }
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
    let detailsForCheck: Awaited<ReturnType<typeof fetchMatchDetails>> | null = null;
    try {
      // Resolve current mode + squad signature up front so we can
      // validate any cached payload against today's reality.
      detailsForCheck = await cached(`match:${data.matchId}`, TTL.match, () => fetchMatchDetails(data.matchId), { bypass: data.refresh });

      // LOCK: once a match has STARTED (kickoff passed OR matchState past
      // Upcoming/PreGame), insights become an immutable historical snapshot.
      // NEVER regenerate, NEVER overwrite, NEVER rerun AI — even on explicit
      // refresh. This prevents hindsight bias (e.g. live/post-match stats
      // flipping a "1-12 home win" prediction to match the actual result).
      const isFinished = /^(FullTime|Final|Completed)$/i.test(detailsForCheck.matchState);
      const kickoffMs = detailsForCheck.kickoffUtc ? Date.parse(detailsForCheck.kickoffUtc) : NaN;
      const kickoffPassed = Number.isFinite(kickoffMs) && kickoffMs <= Date.now();
      const stateStarted = !/^(Upcoming|Pre[\s_-]?Game|Scheduled)$/i.test(detailsForCheck.matchState);
      const isStarted = isFinished || kickoffPassed || stateStarted;
      if (isStarted) {
        const locked = await readLockedSharedInsights(data.matchId, detailsForCheck.kickoffUtc);
        return {
          insights: normaliseStoredInsights(locked?.payload ?? null, detailsForCheck.homeTeam.nickName, detailsForCheck.awayTeam.nickName),
          insightsError: locked ? null : "No pre-match insights were stored before kickoff for this fixture.",
        };
      }

      // 1) Fast-path: shared DB cache hit, but ONLY if the squad signature and
      //    mode match what's stored. Stale rows (e.g. generated before squads
      //    were named, or before late team-list changes) are ignored.
      if (!data.refresh) {
        // Pull tryscorers up-front so cache invalidation accounts for the
        // mode jump (squad → market) once player odds drop.
        const oddsForCheck = await safeOdds();
        const homeNickC = findTeam(detailsForCheck.homeTeam.nickName)?.nickname ?? detailsForCheck.homeTeam.nickName;
        const awayNickC = findTeam(detailsForCheck.awayTeam.nickName)?.nickname ?? detailsForCheck.awayTeam.nickName;
        const oddsC = oddsForCheck.data.find((e) => {
          const eh = e.homeNickname; const ea = e.awayNickname;
          return (eh === homeNickC && ea === awayNickC) || (eh === awayNickC && ea === homeNickC);
        }) ?? null;
        const tryscorersC = (oddsC && tryscorerFetchAllowed(detailsForCheck.kickoffUtc)) ? (await safeTryscorers(oddsC.id)).data : null;
        const stored = await readFreshInsights(data.matchId, detailsForCheck, tryscorersC);
        if (
          stored &&
          (stored.payload as unknown as { deterministic?: unknown }).deterministic &&
          (stored.payload as unknown as { script?: unknown }).script
        ) {
          return {
            insights: normaliseStoredInsights(stored.payload, detailsForCheck.homeTeam.nickName, detailsForCheck.awayTeam.nickName),
            insightsError: null as string | null,
          };
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
        const timing = hasStartedOrFinished(details);
        if (timing.started) {
          const locked = await sealFromLockedInsights(data.matchId, details);
          return locked?.payload ?? null;
        }
        const homeNick = findTeam(details.homeTeam.nickName)?.nickname ?? details.homeTeam.nickName;
        const awayNick = findTeam(details.awayTeam.nickName)?.nickname ?? details.awayTeam.nickName;
        const oddsResult = await safeOdds();
        const odds = oddsResult.data.find((e) => {
          const eh = e.homeNickname; const ea = e.awayNickname;
          return (eh === homeNick && ea === awayNick) || (eh === awayNick && ea === homeNick);
        }) ?? null;
        const weather = await safeWeather(data.matchId, details.venue, details.venueCity, details.kickoffUtc);
        let tryscorers: TryscorerMarkets | null = null;
        if (odds && tryscorerFetchAllowed(details.kickoffUtc)) {
          const r = await safeTryscorers(odds.id);
          tryscorers = r.data;
        }

        // ---- Resolve timing-aware mode ----
        const hasSquads = squadIsNamed(details.homeTeam.players) && squadIsNamed(details.awayTeam.players);
        const hasPlayerOdds = !!tryscorers?.hasAny;
        const resolved = resolveModelMode({ kickoffUtc: details.kickoffUtc, hasSquads, hasPlayerOdds });

        // ---- PRIMARY: deterministic stats engine. Runs always, no AI. ----
        let deterministic: DeterministicInsights | null = null;
        let scriptPayload: ScriptPayload | null = null;
        const snap = await getSeasonSnapshot(season).catch(() => null);

        // ---- Phase 2 simulation (feature-flagged, fail-safe) ----
        // Built BEFORE the deterministic engine so the override block in the
        // engine can pick it up. Returns null when the flag is off, snapshot
        // is missing, the cache+gen path errors, etc — engine then falls back
        // entirely to its legacy ladder-driven heuristic.
        let simulation: import("./simulation-types").SimulationSummary | null = null;
        if (isSimulationEnabled() && snap) {
          // Phase 3: opportunistically warm enriched normalised data so the
          // simulation can use real injuries / officials / team-stats. Never
          // required — failures fall back to Phase 2 behaviour.
          let enriched: Awaited<ReturnType<typeof import("./nrl-data-store").getEnrichedMatchBundle>> | null = null;
          try {
            const store = await import("./nrl-data-store");
            enriched = await store.getEnrichedMatchBundle({
              matchId: data.matchId,
              season,
              homeNickname: details.homeTeam.nickName,
              awayNickname: details.awayTeam.nickName,
              kickoffUtc: details.kickoffUtc,
              forceRefresh: data.refresh,
            });
          } catch (e) {
            if (process.env.NODE_ENV !== "production") {
              console.warn("[insights] enriched bundle fetch failed (continuing):", e);
            }
          }
          const hasNamedTeamLists = enriched?.teamLists
            ? !!(enriched.teamLists.home.isNamed && enriched.teamLists.away.isNamed)
            : hasSquads;
          simulation = await getOrGenerateSimulation({
            matchId: data.matchId,
            homeNickname: details.homeTeam.nickName,
            awayNickname: details.awayTeam.nickName,
            homeSquad: details.homeTeam.players,
            awaySquad: details.awayTeam.players,
            snapshot: snap,
            modelMode: resolved.mode,
            matchState: details.matchState,
            hasOdds: !!odds,
            weather,
            round: details.roundNumber,
            season,
            forceRefresh: data.refresh,
            normalisedHomeStats: enriched?.homeTeamStats ?? null,
            normalisedAwayStats: enriched?.awayTeamStats ?? null,
            injuries: enriched?.injuries ?? null,
            officials: enriched?.officials ?? null,
            hasOfficials: !!(enriched?.officials && enriched.officials.length > 0),
            hasNamedTeamLists,
            venue: details.venue,
          });
        }

        // NRL.com leaderboard map (top-5 per category) — feeds the deterministic
        // engine so Dally-M-tier players are surfaced in tryscorer ranking.
        let leaderboardMap = null;
        try {
          const boards = await getLeaderboards(111, season ?? 2026);
          leaderboardMap = buildPlayerLeaderboardMap(boards);
        } catch (err) {
          console.warn("leaderboards fetch failed (non-fatal):", err);
        }

        const engineInputs = snap ? {
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
          mode: resolved.mode,
          confidence: resolved.confidence,
          simulation,
          leaderboards: leaderboardMap,
        } : null;
        if (engineInputs) {
          try {
            deterministic = generateDeterministicInsights(engineInputs);
            try { scriptPayload = generateScript(engineInputs, deterministic); }
            catch (e) { console.warn("script-engine failed:", e); }
          } catch (err) {
            console.warn("deterministic engine failed:", err);
          }
        }

        // Persist deterministic-only payload IMMEDIATELY so the Insights tab
        // becomes available even if AI enrichment below fails or times out.
        const homeSig = squadSignature(details.homeTeam.players);
        const awaySig = squadSignature(details.awayTeam.players);
        const minimalPayload = {
          deterministic,
          script: scriptPayload,
          modelMode: resolved.mode,
          modelConfidence: resolved.confidence,
          squadSig: { home: homeSig, away: awaySig },
        } as unknown as Insights;
        if (deterministic) {
          // Apply approved news impacts (confidence nudges + appended notes).
          try {
            const allImpacts = await listActiveImpacts();
            const relevant = impactsForFixture({
              impacts: allImpacts,
              matchId: data.matchId,
              homeNickname: details.homeTeam.nickName,
              awayNickname: details.awayTeam.nickName,
            });
            applyImpacts(minimalPayload as unknown as Record<string, unknown>, relevant);
          } catch (e) { console.warn("applyImpacts (minimal) failed:", e); }

          await writeSharedInsights(data.matchId, minimalPayload, insightsTtlMs(details.kickoffUtc), { matchState: details.matchState, kickoffUtc: details.kickoffUtc });
          // Lock the prediction snapshot before kickoff (insert-only — never
          // overwrites an existing locked row).
          try {
            await snapshotPrediction(buildSnapshotRow({
              matchId: data.matchId,
              details,
              insights: deterministic,
              script: scriptPayload,
              odds,
              tryscorers,
              insightsPayload: minimalPayload,
              simulationPayload: simulation,
            }));
          } catch (e) { console.warn("snapshotPrediction failed:", e); }
        }

        // ---- Skip AI entirely in EARLY mode (no squads → no narrative value) ----
        if (resolved.mode === "early") {
          return deterministic ? minimalPayload : null;
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
            // Always attach a script — retry generation if the first pass failed
            // so the Script tab never ends up missing the field on disk.
            if (!scriptPayload && engineInputs) {
              try { scriptPayload = generateScript(engineInputs, deterministic); }
              catch (e) { console.warn("script-engine retry failed:", e); }
            }
            if (scriptPayload) {
              (generated as unknown as { script: ScriptPayload }).script = scriptPayload;
            }
            // Replace AI-built bets with the deterministic, mode-gated bets.
            generated.bets = buildDeterministicBets({
              engine: deterministic,
              realOdds,
              homeNickname: details.homeTeam.nickName,
              awayNickname: details.awayTeam.nickName,
              mode: resolved.mode,
              simulation,
            });
            // Scrub any AI-named tryscorer not in the named squads.
            const idx = indexSquads(details.homeTeam.players, details.awayTeam.players);
            if (Array.isArray(generated.anytimeTryscorers)) {
              generated.anytimeTryscorers = generated.anytimeTryscorers.filter((p) => isInSquad(p.pick, idx));
            }
          }
          generated.modelMode = resolved.mode;
          generated.modelConfidence = resolved.confidence;
          (generated as unknown as { squadSig: { home: string; away: string } }).squadSig = { home: homeSig, away: awaySig };
          try {
            const allImpacts = await listActiveImpacts();
            const relevant = impactsForFixture({
              impacts: allImpacts,
              matchId: data.matchId,
              homeNickname: details.homeTeam.nickName,
              awayNickname: details.awayTeam.nickName,
            });
            applyImpacts(generated as unknown as Record<string, unknown>, relevant);
          } catch (e) { console.warn("applyImpacts (enriched) failed:", e); }
          await writeSharedInsights(data.matchId, generated, insightsTtlMs(details.kickoffUtc), { matchState: details.matchState, kickoffUtc: details.kickoffUtc });
          if (deterministic) {
            try {
              await snapshotPrediction(buildSnapshotRow({
                matchId: data.matchId,
                details,
                insights: deterministic,
                script: scriptPayload,
                odds,
                tryscorers,
                insightsPayload: generated,
                simulationPayload: simulation,
                generatedBets: generated.bets ?? null,
              }));
            } catch (e) { console.warn("snapshotPrediction enriched failed:", e); }
          }
          return generated;
        } catch (err) {
          console.warn("AI insight enrichment failed (deterministic still served):", err);
          return deterministic ? minimalPayload : null;
        }
      })();

      inFlight.set(lockKey, job);
      try {
        const insights = await job;
        if (insights) {
          return {
            insights: normaliseStoredInsights(insights, detailsForCheck.homeTeam.nickName, detailsForCheck.awayTeam.nickName),
            insightsError: null as string | null,
          };
        }
        return { insights: null, insightsError: "Insights engine produced no output" };
      } finally {
        inFlight.delete(lockKey);
      }
    } catch (e) {
      const kickoffUtc = detailsForCheck?.kickoffUtc;
      const kickoffMs = kickoffUtc ? Date.parse(kickoffUtc) : NaN;
      const kickoffPassed = Number.isFinite(kickoffMs) && kickoffMs <= Date.now();
      const stateStarted = detailsForCheck?.matchState ? !/^(Upcoming|Pre[\s_-]?Game|Scheduled)$/i.test(detailsForCheck.matchState) : false;
      if (kickoffPassed || stateStarted) {
        const locked = await readLockedSharedInsights(data.matchId, kickoffUtc);
        if (locked && detailsForCheck) {
          return {
            insights: normaliseStoredInsights(locked.payload, detailsForCheck.homeTeam.nickName, detailsForCheck.awayTeam.nickName),
            insightsError: null as string | null,
          };
        }
      }
      const stale = await readAnySharedInsights(data.matchId);
      if (stale && detailsForCheck) {
        return {
          insights: normaliseStoredInsights(stale.payload, detailsForCheck.homeTeam.nickName, detailsForCheck.awayTeam.nickName),
          insightsError: null as string | null,
        };
      }
      return { insights: null, insightsError: e instanceof Error ? e.message : "Insights unavailable" };
    }
  });

function currentSeason(): number {
  // NRL season runs Mar–Oct. Use current calendar year.
  return new Date().getUTCFullYear();
}

function fixtureFromDetails(details: Awaited<ReturnType<typeof fetchMatchDetails>>): NrlFixture {
  return {
    matchId: details.matchId,
    matchCentrePath: "",
    roundNumber: details.roundNumber,
    roundTitle: `Round ${details.roundNumber}`,
    isCurrentRound: false,
    matchState: details.matchState,
    venue: details.venue,
    venueCity: details.venueCity,
    kickoffUtc: details.kickoffUtc,
    homeTeam: {
      teamId: details.homeTeam.teamId,
      nickName: details.homeTeam.nickName,
      themeKey: details.homeTeam.themeKey,
      teamPosition: details.homeTeam.position,
      score: details.homeTeam.score,
    },
    awayTeam: {
      teamId: details.awayTeam.teamId,
      nickName: details.awayTeam.nickName,
      themeKey: details.awayTeam.themeKey,
      teamPosition: details.awayTeam.position,
      score: details.awayTeam.score,
    },
  };
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
