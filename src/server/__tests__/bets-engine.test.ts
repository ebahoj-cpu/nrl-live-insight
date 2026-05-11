import { describe, it, expect } from "vitest";
import { buildDeterministicBets } from "../bets-engine";
import type { DeterministicInsights } from "../insights-engine";
import type { SimulationSummary } from "../simulation-types";
import { makeCoverage } from "../source-coverage";

const baseEngine = (): DeterministicInsights => ({
  generatedAt: new Date().toISOString(),
  mode: "final", confidence: "high",
  matchWinner: { team: "home", nickname: "Storm", reasoning: "" },
  margin: { bucket: "1-12", reasoning: "" },
  predictedScore: { home: 22, away: 16, reasoning: "" },
  totalPoints: { line: 38.5, lean: "over", reasoning: "" },
  htft: { pick: "Storm/Storm", reasoning: "" },
  firstTryscorer: { name: "Ryan Papenhuyzen", team: "Storm", position: "Fullback", reasoning: "", price: 9 },
  rankedTryscorers: {
    first: { name: "A", team: "Storm", position: "Wing", reasoning: "", price: null },
    second: { name: "B", team: "Storm", position: "Wing", reasoning: "", price: null },
    third: { name: "C", team: "Storm", position: "Wing", reasoning: "", price: null },
  },
  topAnytime: [
    { name: "Xavier Coates", team: "Storm", position: "Wing", reasoning: "", price: 2.5 },
    { name: "Will Warbrick", team: "Storm", position: "Wing", reasoning: "", price: 3.0 },
  ],
  topAnytimeHome: [], topAnytimeAway: [], topAnytimeOverall: [], forwardPicks: [],
  tryAssistsHome: [], tryAssistsAway: [],
  playerDouble: { name: "Coates", team: "Storm", position: "Wing", reasoning: "", price: null },
  predictedOutcome: { summary: "", picks: [] },
});

const sim = (over: Partial<SimulationSummary> = {}): SimulationSummary => ({
  matchId: "m1", iterations: 10000, seed: 1,
  homeWinProb: 0.6, awayWinProb: 0.38, drawProb: 0.02,
  expectedHomeScore: 22, expectedAwayScore: 16, expectedTotal: 38, totalLine: 38.5, overProbAtLine: 0.51,
  expectedMargin: 6, marginBands: { draw: 0.02, "1-12": 0.55, "13+": 0.43 },
  upsetProb: 0.2, blowoutProb: 0.3, htftProbabilities: {},
  playerProbabilities: [
    { playerId: 1, name: "Will Warbrick", teamNickname: "Storm", position: "Wing", firstTryProb: 0.1, anytimeProb: 0.55, multiTryProb: 0.1, expectedTries: 0.6 },
    { playerId: 2, name: "Xavier Coates", teamNickname: "Storm", position: "Wing", firstTryProb: 0.1, anytimeProb: 0.45, multiTryProb: 0.1, expectedTries: 0.5 },
  ],
  confidence: "high", coverage: makeCoverage({ primary: "nrl.com" }),
  generatedAt: new Date().toISOString(), ...over,
});

describe("bets-engine simulation integration", () => {
  it("suppresses first-tryscorer when simulation confidence is low", () => {
    const bets = buildDeterministicBets({
      engine: baseEngine(), homeNickname: "Storm", awayNickname: "Eels", mode: "final",
      simulation: sim({ confidence: "low" }),
    });
    expect(bets.find((b) => b.scriptAlignment === "first-tryscorer")).toBeUndefined();
  });
  it("re-orders anytime picks by simulation probability when high confidence", () => {
    const bets = buildDeterministicBets({
      engine: baseEngine(), homeNickname: "Storm", awayNickname: "Eels", mode: "final",
      simulation: sim(),
    });
    const anytime = bets.filter((b) => b.scriptAlignment === "anytime-tryscorer");
    expect(anytime[0].title).toContain("Warbrick");
  });
  it("falls back to engine ordering when no simulation provided", () => {
    const bets = buildDeterministicBets({
      engine: baseEngine(), homeNickname: "Storm", awayNickname: "Eels", mode: "final",
    });
    const anytime = bets.filter((b) => b.scriptAlignment === "anytime-tryscorer");
    expect(anytime[0].title).toContain("Coates");
  });
  it("still emits low + medium tier bets without simulation", () => {
    const bets = buildDeterministicBets({
      engine: baseEngine(), homeNickname: "Storm", awayNickname: "Eels", mode: "final",
    });
    expect(bets.find((b) => b.category === "low")).toBeDefined();
    expect(bets.find((b) => b.category === "medium")).toBeDefined();
  });
  it("never invents players outside the engine's named anytime list", () => {
    const eng = baseEngine();
    const allowed = new Set(eng.topAnytime.map((p) => p.name.toLowerCase()));
    const sneaky = sim({
      playerProbabilities: [
        { playerId: 99, name: "Some Random Player", teamNickname: "Storm", position: "Wing", firstTryProb: 0.9, anytimeProb: 0.99, multiTryProb: 0.5, expectedTries: 2 },
      ],
    });
    const bets = buildDeterministicBets({ engine: eng, homeNickname: "Storm", awayNickname: "Eels", mode: "final", simulation: sneaky });
    for (const b of bets.filter((x) => x.scriptAlignment === "anytime-tryscorer")) {
      const ok = [...allowed].some((n) => b.title.toLowerCase().includes(n.split(" ").pop()!));
      expect(ok).toBe(true);
    }
  });
  it("ignores malformed playerProbabilities without crashing", () => {
    const malformed = sim({
      playerProbabilities: [{ name: "" } as never, { anytimeProb: 99 } as never],
    });
    expect(() => buildDeterministicBets({
      engine: baseEngine(), homeNickname: "Storm", awayNickname: "Eels", mode: "final", simulation: malformed,
    })).not.toThrow();
  });
  it("does not emit redundant duplicate winner-only legs in the multi", () => {
    const bets = buildDeterministicBets({
      engine: baseEngine(), homeNickname: "Storm", awayNickname: "Eels", mode: "final",
    });
    const ultra = bets.find((b) => b.category === "ultra");
    if (ultra) {
      const seen = new Set(ultra.legs.map((l) => l.pick));
      expect(seen.size).toBe(ultra.legs.length);
    }
  });
  it("handles missing realOdds gracefully (uses fallback prices)", () => {
    expect(() => buildDeterministicBets({
      engine: baseEngine(), homeNickname: "Storm", awayNickname: "Eels", mode: "final",
    })).not.toThrow();
  });
});
