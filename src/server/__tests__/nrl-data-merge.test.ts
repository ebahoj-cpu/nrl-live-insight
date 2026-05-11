// Phase 3 — merge engine tests.

import { describe, it, expect } from "vitest";
import * as M from "../nrl-data-merge";
import { makeCoverage } from "../source-coverage";
import type {
  NormalisedFixture,
  NormalisedTeamList,
  NormalisedPlayerStats,
  NormalisedMatchOfficial,
  NormalisedInjury,
  NormalisedHistoricalMatch,
} from "../nrl-data-types";

const fix = (over: Partial<NormalisedFixture> = {}): NormalisedFixture => ({
  matchId: "m1", season: 2026, round: 8, kickoffUtc: "2026-05-01T09:00:00Z",
  venue: "v", homeTeamId: 1, homeNickname: "Storm", homeThemeKey: "storm",
  awayTeamId: 2, awayNickname: "Broncos", awayThemeKey: "broncos",
  status: "completed", homeScore: 20, awayScore: 10,
  coverage: makeCoverage({ primary: "nrl.com" }),
  ...over,
});

describe("mergeFixture", () => {
  it("primary wins on conflict and notes are added", () => {
    const p = fix({ homeScore: 20 });
    const z = fix({ homeScore: 22, coverage: makeCoverage({ primary: "zyla" }) });
    const out = M.mergeFixture(p, z)!;
    expect(out.homeScore).toBe(20);
    expect(out.coverage.notes?.some((n) => n.includes("conflict:homeScore"))).toBe(true);
  });
  it("zyla fills missing field only when primary value absent", () => {
    const p = fix({ venue: "" });
    const z = fix({ venue: "Suncorp", coverage: makeCoverage({ primary: "zyla" }) });
    const out = M.mergeFixture(p, z)!;
    expect(out.venue).toBe("Suncorp");
  });
});

describe("mergePlayerStats", () => {
  it("rejects entries with no name", () => {
    const a: NormalisedPlayerStats[] = [{ playerId: 1, name: "", teamNickname: "Storm", position: "FB", appearances: 1, tries: 0, tryAssists: 0, lineBreaks: 0, lineBreakAssists: 0, tackleBreaks: 0, offloads: 0, runMetres: 0, postContactMetres: 0, triesPerGame: 0, lineBreaksPerGame: 0, runMetresPerGame: 0 }];
    expect(M.mergePlayerStats(a, null)).toHaveLength(0);
  });
});

describe("mergeTeamList", () => {
  const tl = (over: Partial<NormalisedTeamList> = {}): NormalisedTeamList => ({
    matchId: "m1", teamNickname: "Storm",
    players: [{ playerId: 1, firstName: "A", lastName: "B", position: "FB", teamNickname: "Storm" }],
    isNamed: true, coverage: makeCoverage({ primary: "nrl.com" }), ...over,
  });
  it("preserves primary squad and only fills missing player metadata", () => {
    const p = tl({ players: [{ playerId: 1, firstName: "A", lastName: "B", position: "", teamNickname: "Storm" }] });
    const e = tl({ players: [{ playerId: 1, firstName: "A", lastName: "B", position: "FB", teamNickname: "Storm", headshotUrl: "u", jerseyNumber: 1 }], coverage: makeCoverage({ primary: "zyla" }) });
    const out = M.mergeTeamList(p, e)!;
    expect(out.players[0].position).toBe("FB");
    expect(out.players[0].headshotUrl).toBe("u");
  });
});

describe("mergeMatchOfficials / mergeInjuries / mergeHistoricalMatches", () => {
  it("officials prefer primary when present", () => {
    const p: NormalisedMatchOfficial[] = [{ role: "referee", name: "A" }];
    const e: NormalisedMatchOfficial[] = [{ role: "referee", name: "B" }];
    expect(M.mergeMatchOfficials(p, e)).toEqual(p);
    expect(M.mergeMatchOfficials([], e)).toEqual(e);
  });
  it("injuries merge without duplicates", () => {
    const p: NormalisedInjury[] = [{ name: "X", teamNickname: "Storm", status: "out" }];
    const e: NormalisedInjury[] = [{ name: "x", teamNickname: "Storm", status: "doubtful" }];
    const out = M.mergeInjuries(p, e);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("out"); // primary wins
  });
  it("historical matches prefer primary", () => {
    const p: NormalisedHistoricalMatch[] = [{ matchId: "h1", season: 2026, round: 1, kickoffUtc: "", homeNickname: "A", awayNickname: "B", homeScore: 20, awayScore: 10, winner: "home", margin: 10, totalPoints: 30, coverage: makeCoverage({ primary: "nrl.com" }) }];
    const e: NormalisedHistoricalMatch[] = [{ ...p[0], homeScore: 99 }];
    expect(M.mergeHistoricalMatches(p, e)[0].homeScore).toBe(20);
  });
});
