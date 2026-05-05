// Cron-driven odds warmer. Three modes via ?mode= query param:
//   round    — Sunday midnight NZT: refresh bookmaker H2H/spread/totals for the week
//   players  — Tuesday 6pm NZT: refresh tryscorer markets after team lists drop
//   pregame  — every 5 min: refresh odds + tryscorers for fixtures within 90min of kickoff
//
// Writes results into public.odds_cache so worker cold starts read from DB
// instead of hitting the Odds API. Each call is rate-conscious — quota is the
// constraint, not latency.

import { createFileRoute } from "@tanstack/react-router";
import { fetchNrlOdds, fetchTryscorerOdds } from "@/server/odds";
import { fetchDraw } from "@/server/nrl";
import { findTeam } from "@/lib/teams";
import { writeOddsCache } from "@/server/odds-store";
import { TTL } from "@/server/cache";

function currentSeason(): number {
  return new Date().getUTCFullYear();
}

export const Route = createFileRoute("/api/public/hooks/refresh-odds")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") ?? "round") as "round" | "players" | "pregame";

  const result: Record<string, unknown> = { mode, ranAt: new Date().toISOString() };

  // Step 1: always refresh bookmaker odds (1 API call). Used by all modes.
  let oddsEvents: Awaited<ReturnType<typeof fetchNrlOdds>> = [];
  try {
    oddsEvents = await fetchNrlOdds();
    await writeOddsCache("odds:nrl", oddsEvents, TTL.odds);
    result.oddsCount = oddsEvents.length;
  } catch (e) {
    result.oddsError = e instanceof Error ? e.message : "odds fetch failed";
    return new Response(JSON.stringify(result, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (mode === "round") {
    // Sunday warmer — bookmaker odds only. Player markets aren't released yet.
    return ok(result);
  }

  // Players + pregame modes need tryscorer markets per fixture. Match each
  // upcoming fixture to its odds event and fetch tryscorers selectively.
  const draw = await fetchDraw(currentSeason()).catch(() => []);
  const now = Date.now();

  // Mode determines which fixtures are "in window" for tryscorer fetches.
  //   players: from now through 5 days out (covers the whole upcoming round)
  //   pregame: only fixtures kicking off within the next 90 minutes
  const windowMs = mode === "pregame" ? 90 * 60_000 : 5 * 24 * 60 * 60_000;
  const minLeadMs = mode === "pregame" ? -10 * 60_000 : -4 * 60 * 60_000;

  const targets = draw.filter((f) => {
    const ko = Date.parse(f.kickoffUtc);
    if (!Number.isFinite(ko)) return false;
    const delta = ko - now;
    return delta <= windowMs && delta >= minLeadMs;
  });

  let tryscorerHits = 0;
  let tryscorerMisses = 0;
  for (const f of targets) {
    const homeNick = findTeam(f.homeTeam.nickName)?.nickname ?? f.homeTeam.nickName;
    const awayNick = findTeam(f.awayTeam.nickName)?.nickname ?? f.awayTeam.nickName;
    const event = oddsEvents.find((e) => {
      const eh = e.homeNickname; const ea = e.awayNickname;
      return (eh === homeNick && ea === awayNick) || (eh === awayNick && ea === homeNick);
    });
    if (!event) { tryscorerMisses += 1; continue; }
    try {
      const data = await fetchTryscorerOdds(event.id);
      await writeOddsCache(`tryscorers:${event.id}`, data, TTL.oddsTryscorer);
      tryscorerHits += 1;
    } catch {
      tryscorerMisses += 1;
    }
  }

  result.tryscorerHits = tryscorerHits;
  result.tryscorerMisses = tryscorerMisses;
  result.fixturesInWindow = targets.length;
  return ok(result);
}

function ok(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
