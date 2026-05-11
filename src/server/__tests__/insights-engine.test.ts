// Phase 2 hardening — verify the deterministic insights payload always carries
// every required field (no simulation, high-confidence sim, low-confidence sim)
// AND that simulation only influences match-level outputs when confidence is
// not "low".

import { describe, it, expect } from "vitest";
import { generateDeterministicInsights, type EngineInputs } from "../insights-engine";
import type { SeasonSnapshot, TeamSeasonStats, PlayerSeasonStats } from "../season-stats";
import type { NrlPlayer } from "../nrl";
import type { SimulationSummary } from "../simulation-types";
import { makeCoverage } from "../source-coverage";

const team = (nick: string, ppgFor: number, ppgAgainst: number): TeamSeasonStats => ({
  nickname: nick, themeKey: nick.toLowerCase(),
  played: 10, pointsFor: ppgFor * 10, pointsAgainst: ppgAgainst * 10,
  triesFor: 40, triesAgainst: 40,
  htLeads: 6, htDraws: 1, htTrails: 3, htLeadAndWon: 5,
  wins: 6, losses: 4, draws: 0,
  ppgFor, ppgAgainst, scoringEfficiency: 4,
  htConversionRate: 0.7, htLeadRate: 0.6,
  last5: [{ result: "W", pf: 24, pa: 18, round: 6 }],
});

let nextPid = 1;
const seasonPlayer = (name: string, teamNick: string, position: string, jersey: number): PlayerSeasonStats => ({
  playerId: nextPid++, name, position, jerseyNumber: jersey, teamNickname: teamNick,
  matches: 10, tries: 6, firstTries: 1, firstTeamTries: 2, firstHalfTries: 3, triesPerMatch: 0.6,
  lineBreaks: 5, tryAssists: 3, tackleBusts: 30, runMetresPerGame: 120, recentTries: 3, recentInvolvements: 4,
});
const squadPlayer = (name: string, position: string, jersey: number): NrlPlayer => {
  const [firstName, ...rest] = name.split(" ");
  return { firstName, lastName: rest.join(" "), position, jerseyNumber: jersey };
};

function buildSnapshot(): SeasonSnapshot {
  const stormPlayers = [
    seasonPlayer("Will Warbrick", "Storm", "Wing", 2),
    seasonPlayer("Jack Howarth", "Storm", "Centre", 3),
    seasonPlayer("Stefano Utoikamanu", "Storm", "Prop", 8),
    seasonPlayer("Ryan Papenhuyzen", "Storm", "Fullback", 1),
    seasonPlayer("Jahrome Hughes", "Storm", "Halfback", 7),
    seasonPlayer("Cameron Munster", "Storm", "Five-Eighth", 6),
    seasonPlayer("Xavier Coates", "Storm", "Wing", 5),
  ];
  const eelsPlayers = [
    seasonPlayer("Maika Sivo", "Eels", "Wing", 5),
    seasonPlayer("Will Penisini", "Eels", "Centre", 4),
    seasonPlayer("Mitchell Moses", "Eels", "Halfback", 7),
    seasonPlayer("Clinton Gutherson", "Eels", "Fullback", 1),
    seasonPlayer("Bailey Simonsson", "Eels", "Wing", 2),
    seasonPlayer("Dylan Brown", "Eels", "Five-Eighth", 6),
    seasonPlayer("Reagan Campbell-Gillard", "Eels", "Prop", 8),
  ];
  return {
    season: 2026, generatedAt: new Date().toISOString(),
    players: [...stormPlayers, ...eelsPlayers],
    teams: { storm: team("Storm", 24, 18), eels: team("Eels", 18, 22) },
  };
}

function buildEngineInputs(simulation: SimulationSummary | null = null): EngineInputs {
  const snap = buildSnapshot();
  const homeSquad: NrlPlayer[] = [
    squadPlayer("Ryan Papenhuyzen", "Fullback", 1),
    squadPlayer("Will Warbrick", "Wing", 2),
    squadPlayer("Jack Howarth", "Centre", 3),
    squadPlayer("Justin Olam", "Centre", 4),
    squadPlayer("Xavier Coates", "Wing", 5),
    squadPlayer("Cameron Munster", "Five-Eighth", 6),
    squadPlayer("Jahrome Hughes", "Halfback", 7),
    squadPlayer("Stefano Utoikamanu", "Prop", 8),
  ];
  const awaySquad: NrlPlayer[] = [
    squadPlayer("Clinton Gutherson", "Fullback", 1),
    squadPlayer("Bailey Simonsson", "Wing", 2),
    squadPlayer("Sean Russell", "Centre", 3),
    squadPlayer("Will Penisini", "Centre", 4),
    squadPlayer("Maika Sivo", "Wing", 5),
    squadPlayer("Dylan Brown", "Five-Eighth", 6),
    squadPlayer("Mitchell Moses", "Halfback", 7),
    squadPlayer("Reagan Campbell-Gillard", "Prop", 8),
  ];
  return {
    homeNickname: "Storm", awayNickname: "Eels",
    homeThemeKey: "storm", awayThemeKey: "eels",
    homeSquad, awaySquad, ladder: [],
    snapshot: snap, mode: "final", confidence: "high",
    simulation,
  };
}

const REQUIRED_FIELDS = [
  "matchWinner", "margin", "predictedScore", "totalPoints", "htft",
  "firstTryscorer", "rankedTryscorers",
  "topAnytime", "topAnytimeHome", "topAnytimeAway", "topAnytimeOverall",
  "forwardPicks", "tryAssistsHome", "tryAssistsAway",
  "playerDouble", "predictedOutcome",
  "mode", "confidence", "generatedAt",
] as const;

function assertAllFields(payload: Record<string, unknown>) {
  for (const f of REQUIRED_FIELDS) expect(payload[f], `missing field ${f}`).toBeDefined();
}

const sim = (over: Partial<SimulationSummary> = {}): SimulationSummary => ({
  matchId: "m1", iterations: 10000, seed: 1,
  homeWinProb: 0.7, awayWinProb: 0.28, drawProb: 0.02,
  expectedHomeScore: 30, expectedAwayScore: 14, expectedTotal: 44, totalLine: 44.5, overProbAtLine: 0.6,
  expectedMargin: 16, marginBands: { draw: 0.02, "1-12": 0.3, "13+": 0.68 },
  upsetProb: 0.1, blowoutProb: 0.5, htftProbabilities: {},
  playerProbabilities: [],
  confidence: "high", coverage: makeCoverage({ primary: "nrl.com" }),
  generatedAt: new Date().toISOString(), ...over,
});

describe("insights-engine field invariants", () => {
  it("A — emits all required fields without simulation", () => {
    const out = generateDeterministicInsights(buildEngineInputs(null));
    assertAllFields(out as unknown as Record<string, unknown>);
    expect(out.matchWinner.nickname).toMatch(/Storm|Eels/);
  });

  it("B — high-confidence simulation can flip / influence match winner & margin", () => {
    // Sim says Eels win big despite Storm being statistically stronger.
    const out = generateDeterministicInsights(buildEngineInputs(sim({
      homeWinProb: 0.15, awayWinProb: 0.83, drawProb: 0.02,
      expectedHomeScore: 12, expectedAwayScore: 32,
      marginBands: { draw: 0.02, "1-12": 0.25, "13+": 0.73 },
    })));
    assertAllFields(out as unknown as Record<string, unknown>);
    expect(out.matchWinner.nickname).toBe("Eels");
    expect(out.margin.bucket).toBe("13+");
  });

  it("C — low-confidence simulation does not invent players outside named squads", () => {
    const out = generateDeterministicInsights(buildEngineInputs(sim({ confidence: "low" })));
    assertAllFields(out as unknown as Record<string, unknown>);
    const allowed = new Set([
      ...buildEngineInputs().homeSquad.map((p) => `${p.firstName} ${p.lastName}`),
      ...buildEngineInputs().awaySquad.map((p) => `${p.firstName} ${p.lastName}`),
      "Awaiting team list",
    ].map((n) => n.toLowerCase()));
    for (const p of out.topAnytime) {
      if (!p.name) continue;
      expect(allowed.has(p.name.toLowerCase())).toBe(true);
    }
  });

  it("rejects malformed simulation defensively (treats as null)", () => {
    const malformed = { homeWinProb: 5, awayWinProb: 5, drawProb: 5 } as unknown as SimulationSummary;
    const out = generateDeterministicInsights(buildEngineInputs(malformed));
    assertAllFields(out as unknown as Record<string, unknown>);
  });
});
