// Shared, app-wide AI insights cache backed by the database.
// In-memory caches are per-worker-instance, so different visitors hitting
// different workers would each trigger a fresh AI call. This module persists
// the generated payload in Postgres so EVERY user of the app sees the same
// insights for a given match, and the AI model is only invoked once until
// the cache expires.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Insights } from "./ai-insights";

const TABLE = "match_insights";

// Bump when the AI prompt / schema changes so stale repetitive payloads
// generated under the old prompt are bypassed automatically. Old rows simply
// expire normally; new rows are written under the new key.
const PROMPT_VERSION = "v20-r10-refresh";

function key(matchId: string): string {
  return `${matchId}::${PROMPT_VERSION}`;
}

export type StoredInsights = {
  payload: Insights;
  generatedAt: string;
  expiresAt: string;
};

export async function readSharedInsights(matchId: string): Promise<StoredInsights | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload, generated_at, expires_at")
      .eq("match_id" as never, key(matchId) as never)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { payload: unknown; generated_at: string; expires_at: string };
    if (Date.parse(row.expires_at) <= Date.now()) return null; // expired
    return {
      payload: row.payload as Insights,
      generatedAt: row.generated_at,
      expiresAt: row.expires_at,
    };
  } catch (e) {
    console.warn("readSharedInsights failed:", e);
    return null;
  }
}

// Returns the fresh stored row regardless of expiry — used as a soft fallback
// when generation fails so we can still serve last-good content.
export async function readAnySharedInsights(matchId: string): Promise<StoredInsights | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload, generated_at, expires_at")
      .eq("match_id" as never, key(matchId) as never)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { payload: unknown; generated_at: string; expires_at: string };
    return {
      payload: row.payload as Insights,
      generatedAt: row.generated_at,
      expiresAt: row.expires_at,
    };
  } catch {
    return null;
  }
}

// Historical lock read: once kickoff has passed, prompt-version bumps must NOT
// make the app ignore the original prediction and write a new post-match row.
// Prefer the latest row generated before kickoff across every prompt version;
// if a legacy fixture has no pre-kickoff row, freeze the earliest row we have.
export async function readLockedSharedInsights(matchId: string, kickoffUtc?: string): Promise<StoredInsights | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload, generated_at, expires_at, match_id")
      .like("match_id" as never, `${matchId}::%` as never)
      .order("generated_at" as never, { ascending: true } as never)
      .limit(50);
    if (error || !data) return null;
    const rows = data as { payload: unknown; generated_at: string; expires_at: string; match_id: string }[];
    const kickoffMs = kickoffUtc ? Date.parse(kickoffUtc) : NaN;
    const preKickoff = Number.isFinite(kickoffMs)
      ? rows.filter((row) => Date.parse(row.generated_at) <= kickoffMs)
      : [];
    const row = preKickoff[preKickoff.length - 1] ?? rows[0];
    if (!row) return null;
    return {
      payload: row.payload as Insights,
      generatedAt: row.generated_at,
      expiresAt: row.expires_at,
    };
  } catch {
    return null;
  }
}

export async function writeSharedInsights(
  matchId: string,
  payload: Insights,
  ttlMs: number,
  opts?: { matchState?: string; kickoffUtc?: string },
): Promise<void> {
  try {
    // Defence-in-depth: once a match has STARTED (in-progress, half-time,
    // full-time, final, completed), the stored row is the historical pre-match
    // snapshot and must NEVER be overwritten — even by a racing late request
    // or a background refresh. Only "Upcoming"/"PreGame"/"Scheduled" states
    // may overwrite an existing row.
    const state = opts?.matchState ?? "";
    const kickoffMs = opts?.kickoffUtc ? Date.parse(opts.kickoffUtc) : NaN;
    const kickoffPassed = Number.isFinite(kickoffMs) && kickoffMs <= Date.now();
    const started = kickoffPassed || (state ? !/^(Upcoming|Pre[\s_-]?Game|Scheduled)$/i.test(state) : false);
    if (started) {
      const existing = await readLockedSharedInsights(matchId, opts?.kickoffUtc);
      if (existing) return; // preserve original pre-match prediction forever
      return; // never create a new prediction after kickoff
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const { error } = await supabaseAdmin
      .from(TABLE as never)
      .upsert(
        {
          match_id: key(matchId),
          payload: payload as unknown as Record<string, unknown>,
          generated_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        } as never,
        { onConflict: "match_id" },
      );
    if (error) console.warn("writeSharedInsights failed:", error.message);
  } catch (e) {
    console.warn("writeSharedInsights threw:", e);
  }
}

