// Phase 5 — staking, correlation, calibration markets, model health, schedule, persistence.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Staking ----------
import { recommendStake } from "../staking-model";

describe("staking-model", () => {
  it("returns 0 stake when there is no market price", () => {
    const r = recommendStake({ modelProb: 0.6, marketOdds: null, confidence: "high" });
    expect(r.recommendedStake).toBe(0);
    expect(r.reason).toMatch(/no market/i);
  });

  it("returns 0 stake on negative EV", () => {
    // model 0.4 vs odds 2.0 -> EV negative
    const r = recommendStake({ modelProb: 0.4, marketOdds: 2.0, confidence: "high" });
    expect(r.recommendedStake).toBe(0);
  });

  it("low confidence is capped harshly", () => {
    const r = recommendStake({ modelProb: 0.7, marketOdds: 2.5, confidence: "low", bankroll: 1000 });
    expect(r.recommendedStake).toBeGreaterThanOrEqual(0);
    expect(r.fractionOfBankroll).toBeLessThanOrEqual(0.005 + 1e-9);
  });

  it("high confidence + positive EV returns a small bounded stake", () => {
    const r = recommendStake({ modelProb: 0.65, marketOdds: 2.2, confidence: "high", bankroll: 1000 });
    expect(r.recommendedStake).toBeGreaterThan(0);
    expect(r.fractionOfBankroll).toBeLessThanOrEqual(0.03 + 1e-9);
  });

  it("invalid odds → no stake", () => {
    const r = recommendStake({ modelProb: 0.6, marketOdds: 1.0, confidence: "high" });
    expect(r.recommendedStake).toBe(0);
  });
});

// ---------- Correlation guard ----------
import { applyCorrelationGuard, type GuardLeg } from "../correlation-guard";

describe("correlation-guard", () => {
  it("removes duplicate legs", () => {
    const legs: GuardLeg[] = [
      { id: "1", market: "match_winner", selection: "Storm to win", modelProb: 0.65, decimalOdds: 1.6 },
      { id: "2", market: "match_winner", selection: "storm to win", modelProb: 0.7, decimalOdds: 1.6 },
    ];
    const r = applyCorrelationGuard(legs);
    expect(r.kept.length).toBe(1);
    expect(r.removed.length).toBe(1);
  });

  it("drops margin when winner+margin are same side and weaker", () => {
    const legs: GuardLeg[] = [
      { id: "w", market: "match_winner", team: "Storm", selection: "Storm to win", modelProb: 0.7, decimalOdds: 1.5 },
      { id: "m", market: "margin", team: "Storm", selection: "Storm 1-12", modelProb: 0.4, decimalOdds: 1.9 },
    ];
    const r = applyCorrelationGuard(legs);
    const titles = r.removed.map((x) => x.leg.id);
    expect(titles).toContain("m");
  });

  it("trims tryscorer overstacking from same team to 2", () => {
    const t = (id: string, name: string): GuardLeg => ({
      id, market: "anytime_tryscorer", team: "Storm", selection: name, modelProb: 0.3, decimalOdds: 3,
    });
    const legs: GuardLeg[] = [t("a", "A"), t("b", "B"), t("c", "C"), t("d", "D")];
    const r = applyCorrelationGuard(legs, {});
    const tryKept = r.kept.filter((l) => l.market === "anytime_tryscorer");
    expect(tryKept.length).toBe(2);
  });

  it("allows 3 tryscorer legs in high-tempo over context", () => {
    const t = (id: string, name: string): GuardLeg => ({
      id, market: "anytime_tryscorer", team: "Storm", selection: name, modelProb: 0.3, decimalOdds: 3,
    });
    const legs: GuardLeg[] = [t("a", "A"), t("b", "B"), t("c", "C"), t("d", "D")];
    const r = applyCorrelationGuard(legs, { highTempoSupported: true, totalLeansOver: true });
    const tryKept = r.kept.filter((l) => l.market === "anytime_tryscorer");
    expect(tryKept.length).toBe(3);
  });
});

// ---------- Calibration market helpers ----------
import {
  calibrateMarginMarket,
  calibrateTotalsMarket,
  calibrateTryscorerMarket,
} from "../probability-calibration";

describe("probability-calibration markets", () => {
  it("ignores invalid odds", () => {
    const r = calibrateMarginMarket({ modelProb: 0.4, price: 1.0, confidence: "high" });
    expect(r.marketProb).toBeNull();
    expect(r.calibratedProb).toBe(0.4);
  });

  it("totals market blends toward market on low confidence", () => {
    const r = calibrateTotalsMarket({ modelProb: 0.7, price: 2.0, confidence: "low" });
    // implied = 0.5; blend toward 0.5
    expect(r.calibratedProb).toBeLessThan(0.7);
    expect(r.calibratedProb).toBeGreaterThan(0.5);
  });

  it("tryscorer market suppresses value claims at low confidence", () => {
    const r = calibrateTryscorerMarket({ modelProb: 0.3, price: 6.0, confidence: "low" });
    expect(r.hasValue).toBe(false);
  });

  it("tryscorer market surfaces value at high confidence with edge", () => {
    const r = calibrateTryscorerMarket({ modelProb: 0.3, price: 6.0, confidence: "high" });
    expect(r.hasValue).toBe(true);
  });
});

// ---------- Refresh schedule ----------
import { getRefreshSchedule } from "../refresh-schedule";

describe("refresh-schedule", () => {
  it("includes the expected jobs", () => {
    const jobs = getRefreshSchedule();
    const names = jobs.map((j) => j.name);
    for (const expected of [
      "fixtures-current-round",
      "ladder",
      "team-lists",
      "injuries",
      "officials",
      "team-stats",
      "player-stats",
      "historical-matches",
      "precompute-insights",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("hook URLs encode the correct mode parameter", () => {
    const jobs = getRefreshSchedule();
    const fixtures = jobs.find((j) => j.name === "fixtures-current-round")!;
    expect(fixtures.hookPath).toContain("mode=fixtures");
    const injuries = jobs.find((j) => j.name === "injuries")!;
    expect(injuries.hookPath).toContain("mode=injuries");
  });

  it("never exposes secret-like tokens", () => {
    const json = JSON.stringify(getRefreshSchedule());
    expect(json).not.toMatch(/SUPABASE|SERVICE_ROLE|API_KEY|TOKEN|secret/i);
  });
});

// ---------- Driver surfacing ----------
import { appendDriverHint, topDrivers } from "../driver-surfacing";

describe("driver-surfacing", () => {
  it("returns base reasoning when no drivers", () => {
    expect(appendDriverHint("Base.", null)).toBe("Base.");
    expect(appendDriverHint("Base.", [])).toBe("Base.");
  });

  it("appends the strongest driver phrase", () => {
    const out = appendDriverHint("Base.", [
      { label: "Fatigue", direction: "home", strength: "strong", marketImpact: "margin", note: "Five-day turnaround." },
      { label: "Weather", direction: "neutral", strength: "small", marketImpact: "total", note: "Wet." },
    ]);
    expect(out.toLowerCase()).toContain("fatigue");
    expect(out).not.toContain("Weather");
  });

  it("topDrivers ranks strong above small", () => {
    const t = topDrivers([
      { label: "A", direction: "home", strength: "small", marketImpact: "x", note: "" },
      { label: "B", direction: "home", strength: "strong", marketImpact: "x", note: "" },
    ], 1);
    expect(t[0].label).toBe("B");
  });
});

// ---------- Model health (mocked supabase) ----------
type FakeRow = {
  confidence: string;
  generated_at: string;
  advanced_model_version: string | null;
  calibration: unknown;
  model_drivers: unknown;
  source_coverage: Record<string, unknown> | null;
};
const healthState: { rows: FakeRow[] } = { rows: [] };

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const sel = {
      select: () => sel,
      eq: () => sel,
      gte: () => sel,
      order: () => sel,
      limit: async () => ({ data: healthState.rows, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      insert: async () => ({ error: null }),
    };
    return sel;
  };
  return { supabaseAdmin: { from: () => builder() } };
});

import { buildModelHealthSummary } from "../model-health";

describe("model-health", () => {
  beforeEach(() => {
    healthState.rows = [];
  });

  it("returns empty shape when no rows", async () => {
    const r = await buildModelHealthSummary(24);
    expect(r.simulationsGenerated).toBe(0);
    expect(r.confidenceDistribution).toEqual({ low: 0, medium: 0, high: 0 });
  });

  it("aggregates counts safely without leaking payloads", async () => {
    healthState.rows = [
      { confidence: "high", generated_at: new Date().toISOString(), advanced_model_version: "v1", calibration: {}, model_drivers: [{ label: "x" }], source_coverage: { fixture: true, ladder: true, teamLists: true, injuries: true, officials: true, teamStats: true } },
      { confidence: "low", generated_at: new Date().toISOString(), advanced_model_version: null, calibration: null, model_drivers: null, source_coverage: { fixture: false, ladder: false } },
    ];
    const r = await buildModelHealthSummary(24);
    expect(r.simulationsGenerated).toBe(2);
    expect(r.confidenceDistribution.high).toBe(1);
    expect(r.confidenceDistribution.low).toBe(1);
    expect(r.simulationsFallback).toBe(1);
    expect(r.withCalibration).toBe(1);
    expect(r.withModelDrivers).toBe(1);
    expect(r.advancedModelVersions.v1).toBe(1);
    expect(r.advancedModelVersions.unversioned).toBe(1);
    // Safe summary — no raw payload keys
    const json = JSON.stringify(r);
    expect(json).not.toContain("payload");
    expect(json).not.toMatch(/secret|service_role/i);
  });
});
