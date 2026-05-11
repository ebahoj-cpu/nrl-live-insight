// Public refresh hook for the normalised NRL data layer.
// Server-side only. Returns safe summary, no secrets.

import { createFileRoute } from "@tanstack/react-router";
import * as R from "@/server/nrl-data-refresh";

export const Route = createFileRoute("/api/public/hooks/refresh-nrl-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = (url.searchParams.get("mode") ?? "all").toLowerCase();
        const season = Number(url.searchParams.get("season")) || new Date().getUTCFullYear();
        const round = url.searchParams.get("round") ? Number(url.searchParams.get("round")) : undefined;
        const matchId = url.searchParams.get("matchId") ?? undefined;
        try {
          let summary;
          switch (mode) {
            case "fixtures": summary = await R.refreshFixtures(season, round); break;
            case "ladder": summary = await R.refreshLadder(season); break;
            case "match": summary = matchId ? await R.refreshMatch(matchId) : { mode, refreshed: 0, failed: 1, keys: [], coverageSummary: {} }; break;
            case "teamlists": summary = matchId ? await R.refreshTeamLists(matchId) : { mode, refreshed: 0, failed: 1, keys: [], coverageSummary: {} }; break;
            case "injuries": summary = matchId ? await R.refreshInjuries(matchId) : { mode, refreshed: 0, failed: 1, keys: [], coverageSummary: {} }; break;
            case "officials": summary = matchId ? await R.refreshOfficials(matchId) : { mode, refreshed: 0, failed: 1, keys: [], coverageSummary: {} }; break;
            case "historical": summary = await R.refreshHistorical(season); break;
            case "teamstats": summary = await R.refreshTeamStats(season); break;
            case "playerstats": summary = await R.refreshPlayerStats(season); break;
            case "all":
            default:
              summary = await R.refreshAll({ season, round, matchId });
          }
          return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
        } catch (e) {
          return new Response(
            JSON.stringify({ mode, refreshed: 0, failed: 1, error: e instanceof Error ? e.message : "refresh failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
