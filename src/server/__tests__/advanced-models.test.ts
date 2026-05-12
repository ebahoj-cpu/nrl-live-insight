// Phase 4 — advanced model unit tests.
import { describe, it, expect } from "vitest";
import { buildHeadToHead, neutralHeadToHead } from "../head-to-head-model";
import { buildRefereeProfile, neutralReferee } from "../referee-model";
import { buildFatigueProfile, neutralFatigue } from "../fatigue-model";
import { buildRuckTempoProfile, neutralRuckTempo } from "../ruck-tempo-model";
import { buildEdgeAttackProfile, neutralEdgeAttack } from "../edge-attack-model";
import { buildMomentumProfile, neutralMomentum } from "../momentum-wave-model";
import { calibrateProbabilities, impliedFromOdds } from "../probability-calibration";
import { buildModelDrivers } from "../model-driver-explainer";
import type { NormalisedHistoricalMatch, NormalisedMatchOfficial } from "../nrl-data-types";
import type { PlayerFeature } from "../simulation-types";
import { makeCoverage } from "../source-coverage";

const cov = () => makeCoverage({ primary: "nrl.com" });

const histMatch = (over: Partial<NormalisedHistoricalMatch> = {}): NormalisedHistoricalMatch => ({
  matchId: "m", season: 2025, round: 1, kickoffUtc: new Date().toISOString(),
  homeNickname: "Storm", awayNickname: "Broncos",
  homeScore: 24, awayScore: 18, winner: "home", margin: 6, totalPoints: 42,
  coverage: cov(), ...over,
});

describe("head-to-head model", () => {
  it("no data = neutral low confidence", () => {
    const r = buildHeadToHead({ homeNickname: "Storm", awayNickname: "Broncos" });
    expect(r.confidence).toBe("low");
    expect(r.marginModifier).toBe(0);
  });
  it("small sample = low confidence; modifiers bounded", () => {
    const r = buildHeadToHead({ homeNickname: "Storm", awayNickname: "Broncos", history: [histMatch({ margin: 30, totalPoints: 60 })] });
    expect(r.confidence).toBe("low");
    expect(Math.abs(r.marginModifier)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.totalModifier)).toBeLessThanOrEqual(3);
  });
  it("recent games weighted heavier than old games", () => {
    const now = Date.now();
    const recent = histMatch({ kickoffUtc: new Date(now).toISOString(), margin: 20, totalPoints: 50 });
    const old1 = histMatch({ kickoffUtc: new Date(now - 1e10).toISOString(), margin: -20, totalPoints: 30 });
    const r = buildHeadToHead({ homeNickname: "Storm", awayNickname: "Broncos", history: [recent, old1, old1, old1] });
    // Recent positive margin should dominate due to weighting.
    expect(r.avgMargin).toBeGreaterThan(0);
  });
});

describe("referee model", () => {
  it("no officials = neutral", () => {
    const r = buildRefereeProfile(null);
    expect(r.confidence).toBe("low");
    expect(r.totalPointsModifier).toBe(0);
  });
  it("high-total ref slightly raises total modifier; bounded", () => {
    const officials: NormalisedMatchOfficial[] = [{ role: "referee", name: "X", averageTotal: 50, penaltiesPerGame: 9 }];
    const r = buildRefereeProfile(officials);
    expect(r.totalPointsModifier).toBeGreaterThan(0);
    expect(r.totalPointsModifier).toBeLessThanOrEqual(2);
    expect(r.confidence).toBe("medium");
  });
  it("neutralReferee returns name when supplied", () => {
    expect(neutralReferee("Y").name).toBe("Y");
  });
});

describe("fatigue model", () => {
  it("no data = neutral", () => {
    const r = neutralFatigue();
    expect(r.fatigueEdge).toBe(0);
  });
  it("short turnaround raises fatigue index", () => {
    const kickoff = new Date().toISOString();
    const last = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const r = buildFatigueProfile({
      home: { nickname: "Storm", lastMatchUtc: last, errorsPerGame: 11 },
      away: { nickname: "Broncos", lastMatchUtc: new Date(Date.now() - 7 * 86_400_000).toISOString(), errorsPerGame: 9 },
      kickoffUtc: kickoff,
    });
    expect(r.homeFatigueIndex).toBeGreaterThan(r.awayFatigueIndex);
    expect(r.fatigueEdge).toBeLessThan(0);
  });
});

describe("ruck/tempo model", () => {
  it("high post-contact + breaks raises RPR", () => {
    const r = buildRuckTempoProfile({
      home: { nickname: "Storm", postContactMetresPerGame: 800, tackleBreaksPerGame: 45, completionRate: 0.82, runMetresPerGame: 1700, errorsPerGame: 8, lineBreaksPerGame: 9 },
    });
    expect(r.homeRuckPressureRating).toBeGreaterThan(50);
  });
  it("wet weather lowers tempo", () => {
    const r = buildRuckTempoProfile({ home: { nickname: "Storm" }, weatherTempoModifier: -0.8 });
    expect(r.weatherSlowdown).toBeLessThan(0);
  });
  it("neutral when no inputs", () => {
    expect(neutralRuckTempo().tempoLean).toBe("average");
  });
});

const player = (name: string, channel: "left" | "right" | "middle", pos = "Wing"): PlayerFeature => ({
  playerId: 0, name, position: pos, teamNickname: "T",
  triesPerGame: 0.4, lineBreaksPerGame: 0.5, tryAssistsPerGame: 0.2,
  tackleBreaksPerGame: 1.5, edgeChannel: channel, availabilityProb: 1,
});

describe("edge attack model", () => {
  it("missing team lists = low confidence", () => {
    const r = buildEdgeAttackProfile({ homePlayers: [], awayPlayers: [], hasNamedTeamLists: false });
    expect(r.confidence).toBe("low");
    expect(r.bestAttackChannel).toBeNull();
  });
  it("only named squad players appear", () => {
    const home = Array.from({ length: 13 }, (_, i) => player(`H${i}`, i < 4 ? "left" : i < 8 ? "right" : "middle"));
    const away = Array.from({ length: 13 }, (_, i) => player(`A${i}`, "middle"));
    const r = buildEdgeAttackProfile({ homePlayers: home, awayPlayers: away, hasNamedTeamLists: true });
    expect(r.confidence).toBe("medium");
    for (const e of r.likelyEdgeTryScorers) {
      expect([...home, ...away].some((p) => p.name === e.name)).toBe(true);
    }
  });
});

describe("momentum wave model", () => {
  it("neutral when no inputs", () => {
    expect(neutralMomentum().first20Lean).toBe("neutral");
  });
  it("phases sum and confidence reasonable with full data", () => {
    const r = buildMomentumProfile({
      homeHtLeadRate: 0.6, awayHtLeadRate: 0.4,
      homeHtConversionRate: 0.75, awayHtConversionRate: 0.55,
      homeRecentForm: 0.5, awayRecentForm: -0.2,
    });
    expect(r.confidence).toBe("medium");
    for (const k of ["0-20", "20-40", "40-60", "60-80"] as const) {
      expect(r.phaseScores[k].home + r.phaseScores[k].away).toBeGreaterThan(0);
    }
  });
});

describe("probability calibration", () => {
  it("removes overround", () => {
    const m = impliedFromOdds({ home: 1.5, away: 3.0, draw: 30 });
    expect(m).not.toBeNull();
    expect(Math.abs((m!.home + m!.away + m!.draw) - 1)).toBeLessThan(1e-9);
  });
  it("ignores invalid odds", () => {
    expect(impliedFromOdds({ home: 0.5, away: 1.0, draw: null })).toBeNull();
  });
  it("low confidence moves toward market", () => {
    const r = calibrateProbabilities({
      simulationProb: { home: 0.7, away: 0.28, draw: 0.02 },
      marketOdds: { home: 2.5, away: 1.5, draw: 30 },
      modelConfidence: "low",
    });
    // Sim says home strong; market says away strong → calibrated should pull home down.
    expect(r.calibratedHomeWinProb).toBeLessThan(0.7);
  });
  it("high confidence preserves model + surfaces value", () => {
    const r = calibrateProbabilities({
      simulationProb: { home: 0.65, away: 0.33, draw: 0.02 },
      marketOdds: { home: 2.4, away: 1.6, draw: 30 },
      modelConfidence: "high",
    });
    expect(r.valueSignal).toBe("home");
  });
});

describe("model driver explainer", () => {
  it("emits short structured drivers", () => {
    const drivers = buildModelDrivers({
      homeNickname: "Storm", awayNickname: "Broncos",
      h2h: neutralHeadToHead(),
      referee: neutralReferee(),
      fatigue: neutralFatigue(),
      ruckTempo: neutralRuckTempo(),
      edgeAttack: neutralEdgeAttack(),
      teamStrengthDelta: 0.2,
    });
    expect(drivers.length).toBeGreaterThan(0);
    for (const d of drivers) {
      expect(d.label.length).toBeLessThan(40);
      expect(["small", "medium", "strong"]).toContain(d.strength);
    }
  });
});
