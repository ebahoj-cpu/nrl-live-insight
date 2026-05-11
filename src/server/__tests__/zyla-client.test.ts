// Phase 3 — Zyla adapter tests. Mocks the underlying zyla.ts fetchers.

import { describe, it, expect, vi, beforeEach } from "vitest";

const zylaMock = vi.hoisted(() => ({
  fetchZylaLadder: vi.fn(),
  fetchZylaFixtures: vi.fn(),
  fetchZylaMatchDetails: vi.fn(),
  ZYLA_NAME_MAP: {
    storm: { nickname: "Storm", themeKey: "storm", teamId: 1 },
    broncos: { nickname: "Broncos", themeKey: "broncos", teamId: 2 },
  } as Record<string, { nickname: string; themeKey: string; teamId: number }>,
}));

vi.mock("../zyla", () => zylaMock);

import * as client from "../zyla-client";

beforeEach(() => {
  zylaMock.fetchZylaLadder.mockReset();
  zylaMock.fetchZylaFixtures.mockReset();
  zylaMock.fetchZylaMatchDetails.mockReset();
});

describe("zyla-client missing token", () => {
  const ORIG_T = process.env.ZYLA_NRL_TOKEN;
  const ORIG_K = process.env.ZYLA_API_KEY;
  beforeEach(() => {
    delete process.env.ZYLA_NRL_TOKEN;
    delete process.env.ZYLA_API_KEY;
  });
  // restore happens in real env after suite
  it("getZylaAllPlayers returns null safely when token missing", async () => {
    const out = await client.getZylaAllPlayers();
    expect(out).toBeNull();
  });
  it("getZylaPlayerStatistics returns null safely when token missing", async () => {
    const out = await client.getZylaPlayerStatistics(123);
    expect(out).toBeNull();
  });
  // restore env after
  it("env restored after suite", () => {
    if (ORIG_T) process.env.ZYLA_NRL_TOKEN = ORIG_T;
    if (ORIG_K) process.env.ZYLA_API_KEY = ORIG_K;
    expect(true).toBe(true);
  });
});

describe("zyla-client.getZylaLadder", () => {
  it("normalises ladder rows", async () => {
    zylaMock.fetchZylaLadder.mockResolvedValue([
      { position: 1, teamId: 1, nickname: "Storm", themeKey: "storm", played: 10, wins: 8, losses: 2, drawn: 0, byes: 1, points: 18, for: 250, against: 100, diff: 150, movement: "" },
    ]);
    const out = await client.getZylaLadder(2026);
    expect(out!.coverage.primary).toBe("zyla");
    expect(out!.rows[0].pointsFor).toBe(250);
  });
  it("returns null when fetchZylaLadder returns empty/null", async () => {
    zylaMock.fetchZylaLadder.mockResolvedValue(null);
    expect(await client.getZylaLadder(2026)).toBeNull();
    zylaMock.fetchZylaLadder.mockResolvedValue([]);
    expect(await client.getZylaLadder(2026)).toBeNull();
  });
});

describe("zyla-client.getZylaFixtures", () => {
  it("rejects malformed (missing matchId/teams) and impossible scores", async () => {
    zylaMock.fetchZylaFixtures.mockResolvedValue([
      { match_id: null, home_team: "storm", away_team: "broncos", date: "2026-05-01", time: "19:00" },
      { match_id: "x1", home_team: "unknown_team_xyz", away_team: "broncos", date: "2026-05-01", time: "19:00" },
      { match_id: "x2", home_team: "storm", away_team: "broncos", date: "not-a-date", time: "19:00" },
      { match_id: "x3", home_team: "storm", away_team: "broncos", date: "2026-05-01", time: "19:00", home_score: -5 },
      { match_id: "x4", home_team: "storm", away_team: "broncos", date: "2026-05-01", time: "19:00", home_score: 999 },
      { match_id: "ok", home_team: "storm", away_team: "broncos", date: "2026-05-01", time: "19:00", home_score: "20", away_score: "10" },
    ]);
    const out = await client.getZylaFixtures(2026, 8);
    expect(out!.length).toBe(1);
    expect(out![0].matchId).toBe("ok");
    expect(out![0].homeScore).toBe(20);
    expect(out![0].coverage.primary).toBe("zyla");
  });
});
