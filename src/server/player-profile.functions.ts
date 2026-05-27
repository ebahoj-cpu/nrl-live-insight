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

const TTL_MS = 60 * 60_000;

export type PlayerProfilePayload = {
  profile: PlayerProfile | null;
  edge: PerformanceEdge | null;
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
      const profile = await cached(
        key,
        TTL_MS,
        () => fetchPlayerProfile(data),
        { bypass: data.forceRefresh },
      );
      const edge = computePerformanceEdge({
        position: profile.position ?? data.position,
        seasonStats: profile.seasonStats,
        careerAppearances: profile.careerAppearances,
      });
      return { profile, edge, error: null };
    } catch (err) {
      console.error("getPlayerProfile failed:", err);
      return { profile: null, edge: null, error: "Couldn't load player profile" };
    }
  });
