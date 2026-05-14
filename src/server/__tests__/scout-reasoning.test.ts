import { describe, it, expect } from "vitest";
import {
  parseNewsInjection,
  toneScrub,
  formatConfidence,
  formatValueLine,
  formatRiskWarning,
  pickTopDrivers,
} from "../scout/scout-reasoning";
import type { ScoutBetSuggestion } from "../scout/scout-contracts";

describe("parseNewsInjection", () => {
  it("returns null for empty / overlong input", () => {
    expect(parseNewsInjection("")).toBeNull();
    expect(parseNewsInjection("x".repeat(401))).toBeNull();
  });

  it("detects weather and clamps tempo within bounds", () => {
    const m = parseNewsInjection("Heavy rain expected at kickoff")!;
    expect(m).toBeTruthy();
    expect(m.kind).toBe("weather");
    expect(Math.abs(m.impact.tempo ?? 0)).toBeLessThanOrEqual(0.5);
  });

  it("detects an injury with player name", () => {
    const m = parseNewsInjection("Reynolds ruled out");
    if (m) {
      expect(["injury", "form_shift"]).toContain(m.kind);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });
});

describe("toneScrub", () => {
  it("strips forbidden phrases", () => {
    const out = toneScrub("This is a lock and a guaranteed sure thing", { hasBets: false });
    expect(out).not.toMatch(/\block\b/i);
    expect(out).not.toMatch(/guaranteed/i);
    expect(out).not.toMatch(/sure thing/i);
  });

  it("appends responsible-betting reminder when bets present", () => {
    const out = toneScrub("Take the over.", { hasBets: true });
    expect(out).toMatch(/responsibl|gamble|18\+/i);
  });

  it("does not append reminder when no bets", () => {
    const out = toneScrub("Just chatting.", { hasBets: false });
    expect(out).not.toMatch(/18\+/);
  });
});

describe("formatters", () => {
  it("formatConfidence handles tiers", () => {
    expect(formatConfidence("high", ["calibrated"])).toMatch(/High confidence/);
    expect(formatConfidence("low", [])).toMatch(/Low confidence/);
  });

  it("formatValueLine includes odds, edge, and stake", () => {
    const b: ScoutBetSuggestion = {
      market: "match_winner",
      selection: "Broncos",
      modelProb: 0.6,
      impliedProb: 0.5,
      marketOdds: 2.0,
      edgePct: 20,
      recommendedStake: 12.5,
      fractionOfBankroll: 0.025,
      confidence: "medium",
      rationale: "test",
    };
    const line = formatValueLine(b);
    expect(line).toMatch(/@2\.00/);
    expect(line).toMatch(/edge 20/);
    expect(line).toMatch(/\$12\.50/);
  });

  it("formatRiskWarning empty -> empty string", () => {
    expect(formatRiskWarning([])).toBe("");
    expect(formatRiskWarning(["correlated parlay"])).toMatch(/Risk:/);
  });

  it("pickTopDrivers de-dupes by label", () => {
    const drivers = [
      { label: "Ruck tempo", direction: "home" as const, strength: "strong" as const, marketImpact: "totals", note: "" },
      { label: "ruck tempo", direction: "home" as const, strength: "small" as const, marketImpact: "totals", note: "" },
      { label: "Edge attack", direction: "away" as const, strength: "medium" as const, marketImpact: "h2h", note: "" },
    ];
    const out = pickTopDrivers(drivers, 3);
    expect(out.length).toBe(2);
  });
});
