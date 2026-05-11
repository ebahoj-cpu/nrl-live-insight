// Phase 3 — NRL.com adapter tests. Mocks the underlying nrl.ts fetchers so
// tests run hermetically (no network).

import { describe, it, expect, vi, beforeEach } from "vitest";

const nrlMock = vi.hoisted(() => ({
  fetchDraw: vi.fn(),
  fetchLadder: vi.fn(),
  fetchMatchDetails: vi.fn(),
  fetchMatchRecap: vi.fn(),
  matchIdToPath: (id: string) => `/draw/nrl-premiership/${id}/`,
}));

vi.mock("../nrl", () => nrlMock);
vi.mock("../season-stats", () => ({
  getSeasonSnapshot: vi.fn(async () => ({
    teams: {},
    players: [],
  })),
  // Re-export types as runtime no-ops; not used in adapter logic.
  getTeam: () => null,
  getTeamPlayers: () => [],
}));

import * as client from "../nrlcom-client";

beforeEach(() => {
  Object.values(nrlMock).forEach((v) => typeof v === "function" && "mockReset" in v && (v as { mockReset: () => void }).mockReset?.());
  nrlMock.fetchDraw.mockReset();
  nrlMock.fetchLadder.mockReset();
  nrlMock.fetchMatchDetails.mockReset();
  nrlMock.fetchMatchRecap.mockReset();
});

const fixture = (over: Record<string, unknown> = {}) => ({
  matchId: "2026/round-8/storm-v-broncos",
  matchCentrePath: "",
  roundNumber: 8,
  roundTitle: "Round 8",
  isCurrentRound: true,
  matchState: "Upcoming",
  venue: "AAMI",
  venueCity: "Melbourne",
  kickoffUtc: "2026-05-01T09:00:00Z",
  homeTeam: { teamId: 1, nickName: "Storm", themeKey: "storm", score: null },
  awayTeam: { teamId: 2, nickName: "Broncos", themeKey: "broncos", score: null },
  ...over,
});

describe("nrlcom-client.getNrlDraw", () => {
  it("emits NormalisedFixture[] with status mapped", async () => {
    nrlMock.fetchDraw.mockResolvedValue([
      fixture(),
      fixture({ matchId: "2026/round-8/eels-v-tigers", matchState: "FullTime", homeTeam: { teamId: 3, nickName: "Eels", themeKey: "eels", score: 24 }, awayTeam: { teamId: 4, nickName: "Tigers", themeKey: "tigers", score: 12 } }),
    ]);
    const out = await client.getNrlDraw(2026, 8);
    expect(out).toHaveLength(2);
    expect(out![0].status).toBe("scheduled");
    expect(out![1].status).toBe("completed");
    expect(out![0].coverage.primary).toBe("nrl.com");
  });

  it("returns null safely when fetchDraw throws", async () => {
    nrlMock.fetchDraw.mockRejectedValue(new Error("boom"));
    expect(await client.getNrlDraw(2026, 8)).toBeNull();
  });
});

describe("nrlcom-client.getNrlLadder", () => {
  it("normalises ladder rows", async () => {
    nrlMock.fetchLadder.mockResolvedValue([
      { position: 1, teamId: 1, nickname: "Storm", themeKey: "storm", played: 10, wins: 8, losses: 2, drawn: 0, byes: 1, points: 18, for: 250, against: 100, diff: 150, movement: "up" },
    ]);
    const out = await client.getNrlLadder(2026);
    expect(out!.rows[0].pointsFor).toBe(250);
    expect(out!.rows[0].pointsDiff).toBe(150);
  });

  it("returns null on fetch error", async () => {
    nrlMock.fetchLadder.mockRejectedValue(new Error("nope"));
    expect(await client.getNrlLadder(2026)).toBeNull();
  });
});

describe("nrlcom-client.getNrlTeamLists / officials / injuries", () => {
  const detailsBase = () => ({
    matchId: "m1",
    matchState: "Upcoming",
    venue: "v",
    venueCity: "c",
    kickoffUtc: "2026-05-01T09:00:00Z",
    roundNumber: 8,
    homeTeam: { teamId: 1, name: "Storm", nickName: "Storm", themeKey: "storm", players: Array.from({ length: 13 }, (_, i) => ({ firstName: `H${i}`, lastName: "Player", position: i === 0 ? "FB" : "Pos" })), recentForm: [] },
    awayTeam: { teamId: 2, name: "Broncos", nickName: "Broncos", themeKey: "broncos", players: Array.from({ length: 13 }, (_, i) => ({ firstName: `A${i}`, lastName: "Player", position: "Pos" })), recentForm: [] },
    history: null,
    statGroups: [],
    officials: [
      { position: "Referee", firstName: "Ash", lastName: "Klein" },
      { position: "Touch Judge", firstName: "T", lastName: "One" },
      { position: "Video Referee", firstName: "Vid", lastName: "Ref" },
      { position: "Bunker", firstName: "B", lastName: "Other" },
    ],
    teamNews: {
      home: { outs: ["Hurt Player"], newsOuts: [{ playerName: "Doubt One", reason: "knee" }] },
      away: { outs: [], newsOuts: [] },
    },
  });

  it("maps team lists with isNamed flag", async () => {
    nrlMock.fetchMatchDetails.mockResolvedValue(detailsBase());
    const out = await client.getNrlTeamLists("m1");
    expect(out!.home.isNamed).toBe(true);
    expect(out!.home.players).toHaveLength(13);
    expect(out!.away.teamNickname).toBe("Broncos");
  });

  it("maps officials roles correctly", async () => {
    nrlMock.fetchMatchDetails.mockResolvedValue(detailsBase());
    const out = await client.getNrlMatchOfficials("m1");
    const roles = out!.map((o) => o.role).sort();
    expect(roles).toEqual(["other", "referee", "touchJudge", "videoRef"]);
  });

  it("extracts outs and doubtful from teamNews", async () => {
    nrlMock.fetchMatchDetails.mockResolvedValue(detailsBase());
    const out = await client.getNrlInjuries("m1");
    expect(out).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Hurt Player", status: "out" }),
      expect.objectContaining({ name: "Doubt One", status: "doubtful" }),
    ]));
  });

  it("returns null safely when match details throws", async () => {
    nrlMock.fetchMatchDetails.mockRejectedValue(new Error("x"));
    expect(await client.getNrlTeamLists("m1")).toBeNull();
    expect(await client.getNrlInjuries("m1")).toBeNull();
    expect(await client.getNrlMatchOfficials("m1")).toBeNull();
  });
});

describe("nrlcom-client.getNrlHistoricalMatches", () => {
  it("rejects incomplete matches (no scores)", async () => {
    nrlMock.fetchDraw.mockResolvedValue([
      fixture({ matchState: "Upcoming" }), // no scores
      fixture({ matchId: "2026/round-9/x-v-y", matchState: "FullTime", homeTeam: { teamId: 1, nickName: "X", themeKey: "x", score: 20 }, awayTeam: { teamId: 2, nickName: "Y", themeKey: "y", score: 10 } }),
    ]);
    const out = await client.getNrlHistoricalMatches(2026, [1]);
    expect(out!.length).toBe(1);
    expect(out![0].winner).toBe("home");
  });
});
