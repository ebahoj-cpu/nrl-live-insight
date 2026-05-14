import { describe, it, expect, beforeEach } from "vitest";
import {
  deriveSessionId,
  pushModifier,
  getActiveModifiers,
  clearSession,
  __resetScoutMemoryForTests,
} from "../scout/scout-memory";
import type { NewsModifier } from "../scout/scout-contracts";

const mod = (id: string, matchId?: string): NewsModifier => ({
  id,
  kind: "weather",
  description: "rain",
  matchId,
  impact: { tempo: -0.1 },
  createdAt: Date.now(),
});

describe("scout-memory", () => {
  beforeEach(() => __resetScoutMemoryForTests());

  it("derives stable session id from messages", () => {
    const a = deriveSessionId([{ role: "user", content: "hello scout" }]);
    const b = deriveSessionId([{ role: "user", content: "hello scout" }]);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("pushes and retrieves modifiers, scoped by matchId", () => {
    const sid = "sess1";
    pushModifier(sid, mod("m1", "match-A"));
    pushModifier(sid, mod("m2", "match-B"));
    pushModifier(sid, mod("m3"));
    expect(getActiveModifiers(sid).length).toBe(3);
    const a = getActiveModifiers(sid, "match-A");
    expect(a.map((m) => m.id).sort()).toEqual(["m1", "m3"]);
  });

  it("dedupes by id, keeps newest", () => {
    const sid = "sess2";
    pushModifier(sid, { ...mod("dup"), description: "first" });
    pushModifier(sid, { ...mod("dup"), description: "second" });
    const all = getActiveModifiers(sid);
    expect(all.length).toBe(1);
    expect(all[0].description).toBe("second");
  });

  it("clearSession wipes modifiers", () => {
    const sid = "sess3";
    pushModifier(sid, mod("x"));
    clearSession(sid);
    expect(getActiveModifiers(sid)).toEqual([]);
  });
});
