import { describe, it, expect } from "vitest";
import {
  predictMatchOutcome,
  predictTotalPoints,
  recentFormFromResults,
  type TeamModelInputs,
} from "../predictor";

const avg: TeamModelInputs = {
  pointsForPerGame: 22,
  pointsAgainstPerGame: 22,
  metresPerGame: 1500,
  completionRate: 0.78,
  recentForm: 0,
};

const strong: TeamModelInputs = {
  pointsForPerGame: 30,
  pointsAgainstPerGame: 14,
  metresPerGame: 1700,
  completionRate: 0.82,
  recentForm: 0.8,
};

const weak: TeamModelInputs = {
  pointsForPerGame: 14,
  pointsAgainstPerGame: 30,
  metresPerGame: 1300,
  completionRate: 0.72,
  recentForm: -0.6,
};

describe("predictMatchOutcome", () => {
  it("home advantage tilts probability above 0.5 for evenly matched teams", () => {
    const p = predictMatchOutcome(avg, avg);
    expect(p.homeWinProb).toBeGreaterThan(0.5);
    expect(p.homeWinProb + p.awayWinProb).toBeCloseTo(1, 5);
  });

  it("strong home team is heavily favoured against a weak away team", () => {
    const p = predictMatchOutcome(strong, weak);
    expect(p.homeWinProb).toBeGreaterThan(0.8);
    expect(p.marginBand).toBe("13+");
    expect(p.confidence).toBeGreaterThan(0.5);
  });

  it("weak home team is the underdog vs a strong away team", () => {
    const p = predictMatchOutcome(weak, strong);
    expect(p.homeWinProb).toBeLessThan(0.3);
    expect(p.expectedMargin).toBeLessThan(0);
  });

  it("changing inputs changes outputs (sensitivity)", () => {
    const base = predictMatchOutcome(avg, avg).homeWinProb;
    const better = predictMatchOutcome({ ...avg, pointsForPerGame: 28 }, avg).homeWinProb;
    const worseForm = predictMatchOutcome({ ...avg, recentForm: -0.8 }, avg).homeWinProb;
    expect(better).toBeGreaterThan(base);
    expect(worseForm).toBeLessThan(base);
  });
});

describe("predictTotalPoints", () => {
  it("two strong attacks produce a higher line than two weak attacks", () => {
    const high = predictTotalPoints(strong, strong);
    const low = predictTotalPoints(weak, weak);
    expect(high.expectedTotal).toBeGreaterThan(low.expectedTotal);
    expect(high.line % 0.5).toBe(0);
  });

  it("lean is consistent with line rounding", () => {
    const r = predictTotalPoints(avg, avg);
    expect(["over", "under"]).toContain(r.lean);
  });
});

describe("recentFormFromResults", () => {
  it("all wins → +1, all losses → -1, mixed → 0", () => {
    expect(recentFormFromResults(["W", "W", "W"])).toBeCloseTo(1, 5);
    expect(recentFormFromResults(["L", "L"])).toBeCloseTo(-1, 5);
    expect(recentFormFromResults(["W", "L"])).toBeCloseTo(0, 5);
  });
});
