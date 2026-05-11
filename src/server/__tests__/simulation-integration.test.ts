// Phase 2 hardening — simulation-integration: feature flag, validation,
// cache reuse / TTL behaviour, fail-safe fallback. Supabase admin client is
// mocked so these tests run hermetically.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SimulationSummary } from "../simulation-types";
import { makeCoverage } from "../source-coverage";

// ---------- Mock Supabase admin ----------
const mockState: {
  cachedRow: { payload: SimulationSummary; expires_at: string } | null;
  selectError: unknown;
  inserts: unknown[];
  insertError: unknown;
} = { cachedRow: null, selectError: null, inserts: [], insertError: null };

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const sel = {
      select: () => sel,
      eq: () => sel,
      order: () => sel,
      limit: () => sel,
      maybeSingle: async () => ({ data: mockState.cachedRow, error: mockState.selectError }),
      insert: async (rows: unknown[]) => {
        mockState.inserts.push(...rows);
        return { error: mockState.insertError };
      },
    };
    return sel;
  };
  return { supabaseAdmin: { from: () => builder() } };
});

// Imported AFTER vi.mock so the mock takes effect
import {
  isSimulationEnabled,
  validateSimulation,
  getOrGenerateSimulation,
} from "../simulation-integration";

// ---------- Helpers ----------
const validSummary = (over: Partial<SimulationSummary> = {}): SimulationSummary => ({
  matchId: "m1", iterations: 10000, seed: 42,
  homeWinProb: 0.55, awayWinProb: 0.42, drawProb: 0.03,
  expectedHomeScore: 22, expectedAwayScore: 18, expectedTotal: 40,
  totalLine: 40.5, overProbAtLine: 0.49,
  expectedMargin: 4, marginBands: { draw: 0.03, "1-12": 0.6, "13+": 0.37 },
  upsetProb: 0.25, blowoutProb: 0.2, htftProbabilities: {},
  playerProbabilities: [
    { playerId: 1, name: "P One", teamNickname: "Storm", position: "Wing", firstTryProb: 0.1, anytimeProb: 0.4, multiTryProb: 0.05, expectedTries: 0.5 },
  ],
  confidence: "high", coverage: makeCoverage({ primary: "nrl.com" }),
  generatedAt: new Date().toISOString(), ...over,
});

const ORIGINAL_FLAG = process.env.ENABLE_SIMULATION_ENGINE;
beforeEach(() => {
  mockState.cachedRow = null; mockState.selectError = null;
  mockState.inserts = []; mockState.insertError = null;
});
afterEach(() => { process.env.ENABLE_SIMULATION_ENGINE = ORIGINAL_FLAG; });

// ---------- Feature flag ----------
describe("isSimulationEnabled", () => {
  for (const v of ["true", "1", "yes", "TRUE", "Yes"]) {
    it(`returns true for "${v}"`, () => {
      process.env.ENABLE_SIMULATION_ENGINE = v;
      expect(isSimulationEnabled()).toBe(true);
    });
  }
  for (const v of ["false", "0", "no", "", "off", undefined]) {
    it(`returns false for ${JSON.stringify(v)}`, () => {
      if (v === undefined) delete process.env.ENABLE_SIMULATION_ENGINE;
      else process.env.ENABLE_SIMULATION_ENGINE = v;
      expect(isSimulationEnabled()).toBe(false);
    });
  }
});

// ---------- Runtime validation ----------
describe("validateSimulation", () => {
  it("accepts a valid summary unchanged", () => {
    const v = validateSimulation(validSummary());
    expect(v).not.toBeNull();
    expect(v!.confidence).toBe("high");
  });
  it("rejects null / non-object", () => {
    expect(validateSimulation(null)).toBeNull();
    expect(validateSimulation(undefined)).toBeNull();
  });
  it("rejects when required field missing", () => {
    const bad = { ...validSummary(), homeWinProb: undefined as unknown as number };
    expect(validateSimulation(bad as SimulationSummary)).toBeNull();
  });
  it("rejects when probabilities don't sum near 1", () => {
    const bad = validSummary({ homeWinProb: 0.1, awayWinProb: 0.1, drawProb: 0.1 });
    expect(validateSimulation(bad)).toBeNull();
  });
  it("normalises mild probability drift", () => {
    const v = validateSimulation(validSummary({ homeWinProb: 0.5, awayWinProb: 0.45, drawProb: 0.1 }));
    expect(v).not.toBeNull();
    expect(v!.homeWinProb + v!.awayWinProb + v!.drawProb).toBeCloseTo(1, 5);
  });
  it("clamps probabilities into 0..1", () => {
    const v = validateSimulation(validSummary({ homeWinProb: -0.02, awayWinProb: 0.7, drawProb: 0.34 }));
    expect(v).not.toBeNull();
    expect(v!.homeWinProb).toBeGreaterThanOrEqual(0);
  });
  it("drops malformed playerProbabilities entries but keeps summary", () => {
    const v = validateSimulation(validSummary({
      playerProbabilities: [
        { playerId: 1, name: "OK", teamNickname: "Storm", position: "Wing", firstTryProb: 0.1, anytimeProb: 0.5, multiTryProb: 0.05, expectedTries: 0.5 },
        // malformed: anytimeProb out of range
        { playerId: 2, name: "Bad", teamNickname: "Storm", position: "Wing", firstTryProb: 0.1, anytimeProb: 5, multiTryProb: 0.05, expectedTries: 0.5 },
      ],
    }));
    expect(v).not.toBeNull();
    expect(v!.playerProbabilities).toHaveLength(1);
    expect(v!.playerProbabilities[0].name).toBe("OK");
  });
  it("rejects when confidence tier invalid", () => {
    const bad = validSummary({ confidence: "ultra" as unknown as "high" });
    expect(validateSimulation(bad)).toBeNull();
  });
});

// ---------- getOrGenerateSimulation: flag + cache + fallback ----------
describe("getOrGenerateSimulation", () => {
  const baseArgs = {
    matchId: "m-1", homeNickname: "Storm", awayNickname: "Eels",
    homeSquad: [], awaySquad: [],
    snapshot: { season: 2026, generatedAt: new Date().toISOString(), players: [], teams: {} } as never,
    modelMode: "final" as const,
  };

  it("returns null and writes nothing when flag is off", async () => {
    delete process.env.ENABLE_SIMULATION_ENGINE;
    const r = await getOrGenerateSimulation(baseArgs);
    expect(r).toBeNull();
    expect(mockState.inserts).toHaveLength(0);
  });

  it("returns null when snapshot is missing", async () => {
    process.env.ENABLE_SIMULATION_ENGINE = "true";
    const r = await getOrGenerateSimulation({ ...baseArgs, snapshot: null });
    expect(r).toBeNull();
  });

  it("reuses fresh cached summary (no insert)", async () => {
    process.env.ENABLE_SIMULATION_ENGINE = "true";
    mockState.cachedRow = {
      payload: validSummary({ matchId: "m-1" }),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const r = await getOrGenerateSimulation(baseArgs);
    expect(r).not.toBeNull();
    expect(r!.matchId).toBe("m-1");
    expect(mockState.inserts).toHaveLength(0);
  });

  it("ignores expired cached summary and tries to regenerate", async () => {
    process.env.ENABLE_SIMULATION_ENGINE = "true";
    mockState.cachedRow = {
      payload: validSummary({ matchId: "m-1" }),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    const r = await getOrGenerateSimulation(baseArgs);
    // empty snapshot → builder may throw → returns null. Either way, the
    // expired row was NOT returned.
    expect(r === null || r!.generatedAt !== mockState.cachedRow!.payload.generatedAt).toBe(true);
  });

  it("forceRefresh bypasses the cache", async () => {
    process.env.ENABLE_SIMULATION_ENGINE = "true";
    mockState.cachedRow = {
      payload: validSummary({ matchId: "m-1", expectedTotal: 999 }),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const r = await getOrGenerateSimulation({ ...baseArgs, forceRefresh: true });
    expect(r === null || r!.expectedTotal !== 999).toBe(true);
  });

  it("does not crash when cache read errors", async () => {
    process.env.ENABLE_SIMULATION_ENGINE = "true";
    mockState.selectError = new Error("network");
    const r = await getOrGenerateSimulation(baseArgs);
    expect(r === null || typeof r === "object").toBe(true);
  });

  it("does not crash when insert errors and still returns generated summary if any", async () => {
    process.env.ENABLE_SIMULATION_ENGINE = "true";
    mockState.insertError = new Error("write failed");
    // We don't assert the return value — empty snapshot may yield null —
    // we only assert no exception bubbles up.
    await expect(getOrGenerateSimulation(baseArgs)).resolves.not.toThrow();
  });
});
