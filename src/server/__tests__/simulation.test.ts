import { describe, it, expect } from "vitest";
import { runSimulation } from "../simulation-engine";
import type { SimulationInput, TeamFeatures, PlayerFeature } from "../simulation-types";
import { makeCoverage } from "../source-coverage";
import { probabilityToFairOdds, expectedValuePct, summariseEdge } from "../fair-odds";
import { computeConfidence } from "../confidence";

const team = (over: Partial<TeamFeatures> = {}): TeamFeatures => ({
  nickname: "Test", pointsForPerGame: 22, pointsAgainstPerGame: 22, triesPerGame: 4,
  triesAgainstPerGame: 4, metresPerGame: 1500, postContactMetresPerGame: 500,
  completionRate: 0.78, errorsPerGame: 10, penaltiesPerGame: 6, tackleBreaksPerGame: 28,
  lineBreaksPerGame: 6, recentForm: 0, ruckPressureRating: 50, fatigueIndex: 50,
  conversionRate: 0.7, ...over,
});
const player = (i: number, pos = "Wing"): PlayerFeature => ({
  playerId: i, name: `P${i}`, position: pos, teamNickname: "Test",
  triesPerGame: 0.4, lineBreaksPerGame: 0.5, tryAssistsPerGame: 0.2,
  tackleBreaksPerGame: 1.5, edgeChannel: "left", availabilityProb: 1,
});

const baseInput = (seed: number): SimulationInput => ({
  matchId: "m1", homeFeatures: team({ nickname: "Home", pointsForPerGame: 28, recentForm: 0.6 }),
  awayFeatures: team({ nickname: "Away", pointsForPerGame: 18, recentForm: -0.4 }),
  homePlayers: Array.from({ length: 13 }, (_, i) => ({ ...player(i + 1), teamNickname: "Home" })),
  awayPlayers: Array.from({ length: 13 }, (_, i) => ({ ...player(i + 100), teamNickname: "Away" })),
  homeAdvantage: 3, seed, iterations: 2000, modelMode: "final",
  coverage: makeCoverage({ primary: "nrl.com" }),
});

describe("simulation engine", () => {
  it("is reproducible with same seed", () => {
    const a = runSimulation(baseInput(42));
    const b = runSimulation(baseInput(42));
    expect(a.homeWinProb).toBeCloseTo(b.homeWinProb, 5);
    expect(a.expectedTotal).toBeCloseTo(b.expectedTotal, 5);
  });
  it("produces valid probabilities summing to 1", () => {
    const r = runSimulation(baseInput(1));
    expect(r.homeWinProb + r.awayWinProb + r.drawProb).toBeCloseTo(1, 2);
    for (const p of r.playerProbabilities) {
      expect(p.anytimeProb).toBeGreaterThanOrEqual(0);
      expect(p.anytimeProb).toBeLessThanOrEqual(1);
    }
  });
  it("favours the stronger home team", () => {
    const r = runSimulation(baseInput(7));
    expect(r.homeWinProb).toBeGreaterThan(r.awayWinProb);
  });
});

describe("fair odds", () => {
  it("converts probability to fair odds", () => {
    expect(probabilityToFairOdds(0.5)).toBeCloseTo(2.0, 2);
    expect(probabilityToFairOdds(0.25)).toBeCloseTo(4.0, 2);
  });
  it("calculates EV correctly", () => {
    expect(expectedValuePct(0.5, 2.5)).toBeCloseTo(25, 0);
    expect(expectedValuePct(0.5, 1.5)).toBeCloseTo(-25, 0);
  });
  it("suppresses low-confidence thin edges", () => {
    const e = summariseEdge(0.55, 1.85, { confidence: "low" });
    expect(e.suppressed).toBe(true);
  });
  it("surfaces strong edges", () => {
    const e = summariseEdge(0.6, 2.5, { confidence: "high" });
    expect(e.suppressed).toBe(false);
    expect(e.evPct).toBeGreaterThan(10);
  });
});

describe("confidence", () => {
  it("downgrades to low when squads not named", () => {
    const c = computeConfidence({
      coverage: makeCoverage({ primary: "nrl.com" }),
      modelProbability: 0.8, iterations: 10000,
      squadsNamed: false, marketAvailable: false,
    });
    expect(c.tier === "low" || c.tier === "medium").toBe(true);
  });
  it("downgrades when fallback used", () => {
    const c = computeConfidence({
      coverage: makeCoverage({ primary: "fallback", missingFields: ["a", "b", "c"] }),
      modelProbability: 0.6, iterations: 10000,
      squadsNamed: true, marketAvailable: false,
    });
    expect(c.tier).not.toBe("high");
  });
});
