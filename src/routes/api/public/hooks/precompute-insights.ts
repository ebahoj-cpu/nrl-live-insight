// Precompute deterministic insights for every fixture in a round (or current
// round + next 2). Safe to call from a weekly cron job. Always public — no
// secrets touched, just generates and persists deterministic stat-driven cards.

import { createFileRoute } from "@tanstack/react-router";
import { fetchDraw, fetchMatchDetails, fetchLadder } from "@/server/nrl";
import { fetchNrlOdds, fetchTryscorerOdds } from "@/server/odds";
import { findTeam } from "@/lib/teams";
import { getSeasonSnapshot } from "@/server/season-stats";
import { generateDeterministicInsights } from "@/server/insights-engine";
import { resolveModelMode, squadIsNamed } from "@/server/model-mode";
import { writeSharedInsights } from "@/server/insights-store";
import { fetchVenueWeather } from "@/server/weather";
import { insightsTtlMs } from "@/server/cache";
import type { Insights } from "@/server/ai-insights";

export const Route = createFileRoute("/api/public/hooks/precompute-insights")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const season = Number(url.searchParams.get("season")) || new Date().getUTCFullYear();
        const roundParam = url.searchParams.get("round");
        const targetRounds: (number | undefined)[] = roundParam
          ? [Number(roundParam)]
          : [undefined]; // undefined = NRL default round

        const allFixtures: Array<{ matchId: string; round: number }> = [];
        for (const r of targetRounds) {
          try {
            const draw = await fetchDraw(season, r);
            for (const m of draw) allFixtures.push({ matchId: m.matchId, round: m.roundNumber });
          } catch (e) {
            console.warn("fetchDraw failed:", r, e);
          }
        }

        const ladder = await fetchLadder(season).catch(() => []);
        const snap = await getSeasonSnapshot(season).catch(() => null);
        const odds = await fetchNrlOdds().catch(() => []);

        const results: Array<{ matchId: string; ok: boolean; reason?: string }> = [];
        for (const f of allFixtures) {
          try {
            const details = await fetchMatchDetails(f.matchId);
            const homeNick = findTeam(details.homeTeam.nickName)?.nickname ?? details.homeTeam.nickName;
            const awayNick = findTeam(details.awayTeam.nickName)?.nickname ?? details.awayTeam.nickName;
            const event = odds.find((e) => {
              const eh = e.homeNickname; const ea = e.awayNickname;
              return (eh === homeNick && ea === awayNick) || (eh === awayNick && ea === homeNick);
            }) ?? null;
            const tryscorers = event ? await fetchTryscorerOdds(event.id).catch(() => null) : null;
            const weather = await fetchVenueWeather(details.venue, details.venueCity, details.kickoffUtc).catch(() => null);

            if (!snap) {
              results.push({ matchId: f.matchId, ok: false, reason: "no snapshot" });
              continue;
            }

            const deterministic = generateDeterministicInsights({
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

            const payload = { deterministic } as unknown as Insights;
            await writeSharedInsights(f.matchId, payload, insightsTtlMs(details.kickoffUtc));
            results.push({ matchId: f.matchId, ok: true });
          } catch (e) {
            results.push({
              matchId: f.matchId,
              ok: false,
              reason: e instanceof Error ? e.message : "unknown",
            });
          }
        }

        return new Response(
          JSON.stringify({
            season,
            attempted: results.length,
            succeeded: results.filter((r) => r.ok).length,
            results,
          }, null, 2),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
