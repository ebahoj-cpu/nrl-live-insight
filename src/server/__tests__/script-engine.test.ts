// Phase 2 hardening — script-engine output:
//   * always emits required fields whether or not simulation is present
//   * propagates simulation influence (via the deterministic engine) into the
//     winner / margin / total / tryscorer leans when sim confidence is high
//   * never references model provenance language (forbidden phrases below)
//   * falls back gracefully when simulation is null

import { describe, it, expect } from "vitest";
import { generateScript } from "../script-engine";
import { generateDeterministicInsights, type EngineInputs } from "../insights-engine";
import type { SeasonSnapshot, TeamSeasonStats, PlayerSeasonStats } from "../season-stats";
import type { NrlPlayer } from "../nrl";
import type { SimulationSummary } from "../simulation-types";
import { makeCoverage } from "../source-coverage";

const FORBIDDEN_PHRASES = [
  "simulation says",
  "api says",
  "zyla says",
  "scout says",
  "article says",
];

function collectStrings(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === "string") out.push(obj);
  else if (Array.isArray(obj)) obj.forEach((v) => collectStrings(v, out));
  else if (obj && typeof obj === "object") Object.values(obj).forEach((v) => collectStrings(v, out));
  return out;
}

const team = (n: string, pf: number, pa: number): TeamSeasonStats => ({
  nickname: n, themeKey: n.toLowerCase(), played: 10, pointsFor: pf * 10, pointsAgainst: pa * 10,
  triesFor: 40, triesAgainst: 40, htLeads: 6, htDraws: 1, htTrails: 3, htLeadAndWon: 5,
  wins: 6, losses: 4, draws: 0, ppgFor: pf, ppgAgainst: pa, scoringEfficiency: 4,
  htConversionRate: 0.7, htLeadRate: 0.6, last5: [],
});
let pid = 1;
const sp = (name: string, t: string, pos: string, j: number): PlayerSeasonStats => ({
  playerId: pid++, name, position: pos, jerseyNumber: j, teamNickname: t,
  matches: 10, tries: 5, firstTries: 1, firstTeamTries: 2, firstHalfTries: 2, triesPerMatch: 0.5,
  lineBreaks: 4, tryAssists: 2, tackleBusts: 25, runMetresPerGame: 110, recentTries: 2, recentInvolvements: 3,
});
const np = (name: string, pos: string, j: number): NrlPlayer => {
  const [f, ...r] = name.split(" "); return { firstName: f, lastName: r.join(" "), position: pos, jerseyNumber: j };
};

function makeInputs(simulation: SimulationSummary | null = null): EngineInputs {
  const snap: SeasonSnapshot = {
    season: 2026, generatedAt: new Date().toISOString(),
    players: [
      sp("Will Warbrick", "Storm", "Wing", 2), sp("Jack Howarth", "Storm", "Centre", 3),
      sp("Ryan Papenhuyzen", "Storm", "Fullback", 1), sp("Jahrome Hughes", "Storm", "Halfback", 7),
      sp("Cameron Munster", "Storm", "Five-Eighth", 6), sp("Xavier Coates", "Storm", "Wing", 5),
      sp("Maika Sivo", "Eels", "Wing", 5), sp("Mitchell Moses", "Eels", "Halfback", 7),
      sp("Clinton Gutherson", "Eels", "Fullback", 1), sp("Bailey Simonsson", "Eels", "Wing", 2),
      sp("Will Penisini", "Eels", "Centre", 4), sp("Dylan Brown", "Eels", "Five-Eighth", 6),
    ],
    teams: { storm: team("Storm", 24, 18), eels: team("Eels", 18, 22) },
  };
  return {
    homeNickname: "Storm", awayNickname: "Eels", homeThemeKey: "storm", awayThemeKey: "eels",
    homeSquad: [
      np("Ryan Papenhuyzen", "Fullback", 1), np("Will Warbrick", "Wing", 2), np("Jack Howarth", "Centre", 3),
      np("Justin Olam", "Centre", 4), np("Xavier Coates", "Wing", 5), np("Cameron Munster", "Five-Eighth", 6),
      np("Jahrome Hughes", "Halfback", 7), np("Stefano Utoikamanu", "Prop", 8),
    ],
    awaySquad: [
      np("Clinton Gutherson", "Fullback", 1), np("Bailey Simonsson", "Wing", 2), np("Sean Russell", "Centre", 3),
      np("Will Penisini", "Centre", 4), np("Maika Sivo", "Wing", 5), np("Dylan Brown", "Five-Eighth", 6),
      np("Mitchell Moses", "Halfback", 7), np("Reagan Campbell-Gillard", "Prop", 8),
    ],
    ladder: [], snapshot: snap, mode: "final", confidence: "high", simulation,
  };
}

const sim = (over: Partial<SimulationSummary> = {}): SimulationSummary => ({
  matchId: "m1", iterations: 10000, seed: 1,
  homeWinProb: 0.7, awayWinProb: 0.28, drawProb: 0.02,
  expectedHomeScore: 30, expectedAwayScore: 14, expectedTotal: 44, totalLine: 44.5, overProbAtLine: 0.6,
  expectedMargin: 16, marginBands: { draw: 0.02, "1-12": 0.3, "13+": 0.68 },
  upsetProb: 0.1, blowoutProb: 0.5, htftProbabilities: {}, playerProbabilities: [],
  confidence: "high", coverage: makeCoverage({ primary: "nrl.com" }),
  generatedAt: new Date().toISOString(), ...over,
});

const REQUIRED = ["mode", "confidence", "summary", "phases", "edges", "betting"] as const;

describe("script-engine", () => {
  it("emits all required fields without simulation", () => {
    const inp = makeInputs(null);
    const eng = generateDeterministicInsights(inp);
    const s = generateScript(inp, eng);
    for (const f of REQUIRED) expect(s[f as keyof typeof s]).toBeDefined();
    expect(s.betting.winnerLean).toMatch(/Storm|Eels/);
  });

  it("emits all required fields with simulation", () => {
    const inp = makeInputs(sim());
    const eng = generateDeterministicInsights(inp);
    const s = generateScript(inp, eng);
    for (const f of REQUIRED) expect(s[f as keyof typeof s]).toBeDefined();
  });

  it("high-confidence simulation flows into winner / margin / total leans", () => {
    // Sim says Eels win 32-12 → script should reflect Eels as winner lean and 13+ margin.
    const inp = makeInputs(sim({
      homeWinProb: 0.15, awayWinProb: 0.83, drawProb: 0.02,
      expectedHomeScore: 12, expectedAwayScore: 32,
      marginBands: { draw: 0.02, "1-12": 0.25, "13+": 0.73 },
    }));
    const eng = generateDeterministicInsights(inp);
    const s = generateScript(inp, eng);
    expect(s.betting.winnerLean).toBe("Eels");
    expect(s.betting.marginLean).toContain("13+");
  });

  it("low-confidence simulation never produces overconfident model-provenance language", () => {
    const inp = makeInputs(sim({ confidence: "low" }));
    const eng = generateDeterministicInsights(inp);
    const s = generateScript(inp, eng);
    const haystack = collectStrings(s).join(" \n ").toLowerCase();
    for (const p of FORBIDDEN_PHRASES) expect(haystack).not.toContain(p);
  });

  it("never mentions simulation/api/zyla/scout/article in any string", () => {
    const inp = makeInputs(sim());
    const eng = generateDeterministicInsights(inp);
    const s = generateScript(inp, eng);
    const haystack = collectStrings(s).join(" \n ").toLowerCase();
    for (const p of FORBIDDEN_PHRASES) expect(haystack).not.toContain(p);
  });

  it("falls back to deterministic output when simulation is null", () => {
    const a = generateScript(makeInputs(null), generateDeterministicInsights(makeInputs(null)));
    expect(a.betting.winnerLean.length).toBeGreaterThan(0);
    expect(a.summary.length).toBeGreaterThan(0);
  });
});
