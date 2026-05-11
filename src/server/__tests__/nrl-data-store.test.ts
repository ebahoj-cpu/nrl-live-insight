// Phase 3 — data store tests. Mocks Supabase and the source clients.

import { describe, it, expect, vi, beforeEach } from "vitest";

const supaState: { row: Record<string, unknown> | null; error: unknown } = { row: null, error: null };
vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const sel = {
      select: () => sel,
      eq: () => sel,
      maybeSingle: async () => ({ data: supaState.row, error: supaState.error }),
      upsert: async () => ({ error: null }),
    };
    return sel;
  };
  return { supabaseAdmin: { from: () => builder() } };
});

// In-memory only cache (no TTL flushing across tests)
vi.mock("../cache", () => ({
  cached: <T,>(_k: string, _ttl: number, fn: () => Promise<T>) => fn(),
}));

const nrlcomMock = vi.hoisted(() => ({
  getNrlDraw: vi.fn(),
  getNrlLadder: vi.fn(),
  getNrlMatchDetails: vi.fn(),
  getNrlTeamLists: vi.fn(),
  getNrlMatchOfficials: vi.fn(),
  getNrlInjuries: vi.fn(),
  getNrlHistoricalMatches: vi.fn(),
  getNrlTeamStats: vi.fn(),
  getNrlPlayerStats: vi.fn(),
  getNrlMatchResult: vi.fn(),
}));
vi.mock("../nrlcom-client", () => nrlcomMock);

const zylaMock = vi.hoisted(() => ({
  getZylaLadder: vi.fn(async () => null),
  getZylaFixtures: vi.fn(async () => null),
  getZylaMatchDetails: vi.fn(async () => null),
  getZylaAllPlayers: vi.fn(async () => null),
  getZylaPlayerStatistics: vi.fn(async () => null),
}));
vi.mock("../zyla-client", () => zylaMock);

import * as store from "../nrl-data-store";
import { makeCoverage } from "../source-coverage";

beforeEach(() => {
  supaState.row = null; supaState.error = null;
  Object.values(nrlcomMock).forEach((m) => m.mockReset?.());
});

const teamStat = (nick: string) => ({
  nickname: nick, themeKey: nick.toLowerCase(), played: 10, pointsFor: 220, pointsAgainst: 180,
  triesFor: 30, triesAgainst: 20, ppgFor: 22, ppgAgainst: 18, triesPerGame: 3, triesAgainstPerGame: 2,
  completionRate: 0.8, errorsPerGame: 9, penaltiesPerGame: 6, runMetresPerGame: 1500,
  postContactMetresPerGame: 500, tackleBreaksPerGame: 28, lineBreaksPerGame: 6,
  recentForm: 0.4, last5: ["W", "L", "W", "W", "L"] as ("W"|"L"|"D")[],
});

describe("nrl-data-store getEnrichedMatchBundle", () => {
  it("returns fixture/teamLists/teamStats/playerStats/injuries/officials", async () => {
    nrlcomMock.getNrlDraw.mockResolvedValue([{
      matchId: "2026/round-8/storm-v-broncos", season: 2026, round: 8,
      kickoffUtc: "2026-05-01T09:00:00Z", venue: "v",
      homeTeamId: 1, homeNickname: "Storm", homeThemeKey: "storm",
      awayTeamId: 2, awayNickname: "Broncos", awayThemeKey: "broncos",
      status: "scheduled", coverage: makeCoverage({ primary: "nrl.com" }),
    }]);
    nrlcomMock.getNrlTeamLists.mockResolvedValue({
      home: { matchId: "x", teamNickname: "Storm", players: [], isNamed: true, coverage: makeCoverage({ primary: "nrl.com" }) },
      away: { matchId: "x", teamNickname: "Broncos", players: [], isNamed: true, coverage: makeCoverage({ primary: "nrl.com" }) },
    });
    nrlcomMock.getNrlTeamStats.mockResolvedValue([teamStat("Storm"), teamStat("Broncos")]);
    nrlcomMock.getNrlPlayerStats.mockResolvedValue([]);
    nrlcomMock.getNrlInjuries.mockResolvedValue([{ name: "X", teamNickname: "Storm", status: "out" }]);
    nrlcomMock.getNrlMatchOfficials.mockResolvedValue([{ role: "referee", name: "A Klein" }]);

    const out = await store.getEnrichedMatchBundle({
      matchId: "2026/round-8/storm-v-broncos",
      season: 2026,
      homeNickname: "Storm",
      awayNickname: "Broncos",
    });
    expect(out.fixture).not.toBeNull();
    expect(out.teamLists).not.toBeNull();
    expect(out.homeTeamStats?.nickname).toBe("Storm");
    expect(out.awayTeamStats?.nickname).toBe("Broncos");
    expect(out.injuries).toHaveLength(1);
    expect(out.officials).toHaveLength(1);
  });

  it("tolerates individual failures", async () => {
    nrlcomMock.getNrlDraw.mockRejectedValue(new Error("a"));
    nrlcomMock.getNrlTeamLists.mockRejectedValue(new Error("b"));
    nrlcomMock.getNrlTeamStats.mockResolvedValue(null);
    nrlcomMock.getNrlPlayerStats.mockResolvedValue(null);
    nrlcomMock.getNrlInjuries.mockResolvedValue(null);
    nrlcomMock.getNrlMatchOfficials.mockResolvedValue(null);

    const out = await store.getEnrichedMatchBundle({
      matchId: "2026/round-8/storm-v-broncos",
      season: 2026,
      homeNickname: "Storm",
      awayNickname: "Broncos",
    });
    expect(out.fixture).toBeNull();
    expect(out.teamLists).toBeNull();
    expect(out.injuries).toEqual([]);
    expect(out.officials).toEqual([]);
  });
});
