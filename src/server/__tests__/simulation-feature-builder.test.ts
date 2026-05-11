// Phase 3 — simulation feature builder enrichment tests.

import { describe, it, expect } from "vitest";
import { buildSimulationInput } from "../simulation-feature-builder";
import type { SeasonSnapshot, TeamSeasonStats } from "../season-stats";
import type { NormalisedTeamStats, NormalisedInjury } from "../nrl-data-types";

const team = (nick: string, over: Partial<TeamSeasonStats> = {}): TeamSeasonStats => ({
  nickname: nick, themeKey: nick.toLowerCase(), played: 10,
  pointsFor: 220, pointsAgainst: 180, triesFor: 30, triesAgainst: 20,
  htLeads: 5, htDraws: 1, htTrails: 4, htLeadAndWon: 4,
  wins: 6, losses: 4, draws: 0,
  ppgFor: 22, ppgAgainst: 18, scoringEfficiency: 3,
  htConversionRate: 0.8, htLeadRate: 0.5,
  last5: [{ result: "W", pf: 30, pa: 20, round: 1 }],
  matchStats: [],
  ...over,
});

const snapshot = (): SeasonSnapshot => ({
  season: 2026, generatedAt: new Date().toISOString(),
  players: [],
  teams: {
    storm: team("Storm"),
    broncos: team("Broncos"),
  },
});

const homeSquad = Array.from({ length: 13 }, (_, i) => ({
  firstName: `H${i}`, lastName: "Player", position: i === 0 ? "Fullback" : "Forward",
}));
const awaySquad = Array.from({ length: 13 }, (_, i) => ({
  firstName: `A${i}`, lastName: "Player", position: "Forward",
}));

const baseArgs = () => ({
  matchId: "m1", snapshot: snapshot(), homeNickname: "Storm", awayNickname: "Broncos",
  homeSquad, awaySquad, modelMode: "final" as const,
});

describe("buildSimulationInput enrichment (Phase 3)", () => {
  it("normalisedHomeStats overrides SeasonSnapshot home stats", () => {
    const norm: NormalisedTeamStats = {
      nickname: "Storm", themeKey: "storm", played: 10, pointsFor: 0, pointsAgainst: 0,
      triesFor: 0, triesAgainst: 0, ppgFor: 0, ppgAgainst: 0,
      triesPerGame: 5, triesAgainstPerGame: 1.5,
      completionRate: 0.92, errorsPerGame: 4, penaltiesPerGame: 5,
      runMetresPerGame: 1800, postContactMetresPerGame: 700,
      tackleBreaksPerGame: 40, lineBreaksPerGame: 8,
      recentForm: 1, last5: ["W", "W", "W", "W", "W"],
    };
    const out = buildSimulationInput({ ...baseArgs(), normalisedHomeStats: norm });
    expect(out.homeFeatures.completionRate).toBeCloseTo(0.92);
    expect(out.homeFeatures.metresPerGame).toBe(1800);
    expect(out.homeFeatures.triesPerGame).toBe(5);
  });

  it("injury status out → availabilityProb 0; doubtful → 0.4", () => {
    const injuries: NormalisedInjury[] = [
      { name: "H0 Player", teamNickname: "Storm", status: "out" },
      { name: "H1 Player", teamNickname: "Storm", status: "doubtful" },
    ];
    const out = buildSimulationInput({ ...baseArgs(), injuries });
    const p0 = out.homePlayers.find((p) => p.name === "H0 Player");
    const p1 = out.homePlayers.find((p) => p.name === "H1 Player");
    expect(p0?.availabilityProb).toBe(0);
    expect(p1?.availabilityProb).toBe(0.4);
  });

  it("missing officials and team lists adds missingFields", () => {
    const out = buildSimulationInput({ ...baseArgs(), hasOfficials: false, hasNamedTeamLists: false });
    expect(out.coverage.missingFields).toEqual(expect.arrayContaining(["officials", "named_team_lists"]));
  });

  it("SeasonSnapshot fallback still works without enriched data", () => {
    const out = buildSimulationInput(baseArgs());
    expect(out.homeFeatures.nickname).toBe("Storm");
    expect(out.homePlayers.length).toBe(13);
  });
});
