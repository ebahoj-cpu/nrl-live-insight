// Cron-driven odds warmer.
//
// CREDIT-SAVING REDESIGN — see src/server/odds.ts header for the full strategy.
// We now make exactly ONE bulk Odds API call per cron run, which returns h2h
// + player_try_scorer_anytime for every NRL event in a single request. The
// previous per-event tryscorer fetches (which multiplied credit cost by the
// number of fixtures in a round) are gone — `fetchTryscorerOdds(eventId)`
// derives its result from the same bulk payload at zero extra cost.
//
// Modes (kept for compatibility — all do the same single bulk refresh now):
//   round    — early-week warm: refresh bookmaker markets for the upcoming round
//   players  — after team lists drop: same bulk call (anytime tryscorers included)
//   pregame  — close to kickoff: same bulk call (60s TTL handles staleness)

import { createFileRoute } from "@tanstack/react-router";
import { fetchNrlOdds, oddsTtl } from "@/server/odds";
import { writeOddsCache } from "@/server/odds-store";

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

  try {
    const events = await fetchNrlOdds();
    const ttl = oddsTtl(events.map((e) => e.commenceUtc));
    await writeOddsCache("odds:nrl", events, ttl);
    result.oddsCount = events.length;
    result.ttlMs = ttl;
    // Tryscorers are fetched lazily per-event on demand (bulk /odds doesn't
    // support player_* markets). Cron only warms the h2h bulk payload.
    result.tryscorersMode = "lazy-per-event";
  } catch (e) {
    result.oddsError = e instanceof Error ? e.message : "odds fetch failed";
    return new Response(JSON.stringify(result, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return ok(result);
}

function ok(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
