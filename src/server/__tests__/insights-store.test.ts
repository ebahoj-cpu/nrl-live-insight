import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { match_id: string; payload: unknown; generated_at: string; expires_at: string };
const state: { rows: Row[]; upserts: Row[] } = { rows: [], upserts: [] };

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const q = {
      select: () => q,
      like: () => q,
      eq: () => q,
      order: (_column: string, opts?: { ascending?: boolean }) => {
        state.rows.sort((a, b) => {
          const diff = Date.parse(a.generated_at) - Date.parse(b.generated_at);
          return opts?.ascending === false ? -diff : diff;
        });
        return q;
      },
      limit: () => q,
      maybeSingle: async () => ({ data: state.rows[0] ?? null, error: null }),
      upsert: async (row: Row) => { state.upserts.push(row); return { error: null }; },
      then: (resolve: (value: { data: Row[]; error: null }) => void) => resolve({ data: state.rows, error: null }),
    };
    return q;
  };
  return { supabaseAdmin: { from: () => builder() } };
});

import { readLockedSharedInsights, writeSharedInsights } from "../insights-store";

describe("insights-store kickoff lock", () => {
  beforeEach(() => {
    state.rows = [];
    state.upserts = [];
  });

  it("returns the latest pre-kickoff snapshot across prompt versions", async () => {
    state.rows = [
      { match_id: "m1::old", payload: { pick: "early" }, generated_at: "2026-05-16T01:00:00Z", expires_at: "2026-05-23T01:00:00Z" },
      { match_id: "m1::current", payload: { pick: "locked" }, generated_at: "2026-05-16T08:55:00Z", expires_at: "2026-05-23T08:55:00Z" },
      { match_id: "m1::future", payload: { pick: "post" }, generated_at: "2026-05-16T11:00:00Z", expires_at: "2026-05-23T11:00:00Z" },
    ];
    const row = await readLockedSharedInsights("m1", "2026-05-16T09:00:00Z");
    expect((row?.payload as { pick?: string }).pick).toBe("locked");
  });

  it("does not create or overwrite insights after kickoff", async () => {
    await writeSharedInsights("m2", { pick: "post" } as never, 60_000, {
      matchState: "FullTime",
      kickoffUtc: "2026-05-16T09:00:00Z",
    });
    expect(state.upserts).toHaveLength(0);
  });
});