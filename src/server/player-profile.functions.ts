// Server function: fetch a player's NRL.com profile + compute Performance Edge.
//
// Caching strategy mirrors the team-list / odds caches:
//   - In-memory per worker (60 min TTL)
//   - forceRefresh bypasses the cache and re-scrapes immediately
// Failures NEVER throw — they return a `profile = null` payload that the UI
// renders as a sparse card with em-dashes.

import { createServerFn } from "@tanstack/react-start";
import { cached } from "./cache";
import { fetchPlayerProfile, type PlayerProfile } from "./player-profile";
import { computePerformanceEdge, type PerformanceEdge } from "@/lib/performance-edge";
import { getLeaderboards, rankingsForPlayer, type PlayerRanking } from "./stats-leaders";

const TTL_MS = 60 * 60_000;

export type PlayerProfilePayload = {
  profile: PlayerProfile | null;
  edge: PerformanceEdge | null;
  rankings: PlayerRanking[];
  error: string | null;
};

export const getPlayerProfile = createServerFn({ method: "POST" })
  .inputValidator((input: {
    teamThemeKey: string;
    teamNickname: string;
    firstName: string;
    lastName: string;
    position?: string;
    jerseyNumber?: number;
    forceRefresh?: boolean;
  }) => input)
  .handler(async ({ data }): Promise<PlayerProfilePayload> => {
    const key = `playerProfile:${data.teamThemeKey}:${data.firstName}:${data.lastName}`;
    try {
      const [profile, boards] = await Promise.all([
        cached(
          key,
          TTL_MS,
          () => fetchPlayerProfile(data),
          { bypass: data.forceRefresh },
        ),
        getLeaderboards(111, 2026, data.forceRefresh).catch(() => ({
          fetchedAt: new Date(0).toISOString(),
          groups: [],
        })),
      ]);
      const rankings = rankingsForPlayer(
        boards,
        data.firstName,
        data.lastName,
        data.teamThemeKey,
      );
      const edge = computePerformanceEdge({
        position: profile.position ?? data.position,
        seasonStats: profile.seasonStats,
        careerAppearances: profile.careerAppearances,
        rankings: rankings.map((r) => ({ title: r.title, rank: r.rank })),
      });
      return { profile, edge, rankings, error: null };
    } catch (err) {
      console.error("getPlayerProfile failed:", err);
      return { profile: null, edge: null, rankings: [], error: "Couldn't load player profile" };
    }
  });
