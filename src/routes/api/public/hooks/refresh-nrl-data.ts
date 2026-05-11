// Public refresh hook for the normalised NRL data layer.
// Server-side only. Returns safe summary, no secrets, no raw payloads.

import { createFileRoute } from "@tanstack/react-router";
import * as R from "@/server/nrl-data-refresh";

const VALID_MODES = new Set([
  "fixtures", "ladder", "match", "teamlists", "injuries", "officials",
  "historical", "teamstats", "playerstats", "all",
]);

const MATCH_REQUIRED = new Set(["match", "teamlists", "injuries", "officials"]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/refresh-nrl-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = (url.searchParams.get("mode") ?? "all").toLowerCase();
        if (!VALID_MODES.has(mode)) {
          return jsonResponse({
            mode,
            refreshed: 0,
            failed: 1,
            keys: [],
            coverageSummary: {},
            error: "invalid mode",
          }, 400);
        }
        const seasonRaw = Number(url.searchParams.get("season"));
        const season = Number.isFinite(seasonRaw) && seasonRaw > 2000 ? seasonRaw : new Date().getUTCFullYear();
        const roundRaw = url.searchParams.get("round");
        const round = roundRaw && Number.isFinite(Number(roundRaw)) ? Number(roundRaw) : undefined;
        const matchId = url.searchParams.get("matchId") ?? undefined;

        if (MATCH_REQUIRED.has(mode) && !matchId) {
          return jsonResponse({
            mode,
            refreshed: 0,
            failed: 1,
            keys: [],
            coverageSummary: {},
            error: "matchId required",
          }, 400);
        }

        try {
          let summary;
          switch (mode) {
            case "fixtures": summary = await R.refreshFixtures(season, round); break;
            case "ladder": summary = await R.refreshLadder(season); break;
            case "match": summary = await R.refreshMatch(matchId!); break;
            case "teamlists": summary = await R.refreshTeamLists(matchId!); break;
            case "injuries": summary = await R.refreshInjuries(matchId!); break;
            case "officials": summary = await R.refreshOfficials(matchId!); break;
            case "historical": summary = await R.refreshHistorical(season); break;
            case "teamstats": summary = await R.refreshTeamStats(season); break;
            case "playerstats": summary = await R.refreshPlayerStats(season); break;
            case "all":
            default:
              summary = await R.refreshAll({ season, round, matchId });
          }
          return jsonResponse(summary);
        } catch (e) {
          // Never leak secrets / stack traces.
          return jsonResponse({
            mode,
            refreshed: 0,
            failed: 1,
            keys: [],
            coverageSummary: {},
            error: e instanceof Error ? e.message.slice(0, 200) : "refresh failed",
          }, 500);
        }
      },
    },
  },
});
