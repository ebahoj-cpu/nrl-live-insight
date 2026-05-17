// DB-backed cache for odds + tryscorer markets. Survives worker cold starts
// so cron-warmed payloads don't expire when a new worker spins up.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TABLE = "odds_cache";

export async function readOddsCache<T>(key: string): Promise<T | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload, expires_at")
      .eq("cache_key" as never, key as never)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { payload: unknown; expires_at: string };
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    return row.payload as T;
  } catch (e) {
    console.warn("readOddsCache failed:", e);
    return null;
  }
}

export async function readOddsCacheEntry<T>(key: string): Promise<{ payload: T; generatedAt: string; expiresAt: string } | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload, generated_at, expires_at")
      .eq("cache_key" as never, key as never)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { payload: unknown; generated_at: string; expires_at: string };
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    return { payload: row.payload as T, generatedAt: row.generated_at, expiresAt: row.expires_at };
  } catch (e) {
    console.warn("readOddsCacheEntry failed:", e);
    return null;
  }
}

// Stale-allowed read — used as a graceful-degradation fallback when the
// upstream feed fails. Returns the payload regardless of expiry.
export async function readOddsCacheStale<T>(key: string): Promise<T | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload")
      .eq("cache_key" as never, key as never)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { payload: unknown }).payload as T;
  } catch {
    return null;
  }
}

export async function writeOddsCache(key: string, payload: unknown, ttlMs: number): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const { error } = await supabaseAdmin
      .from(TABLE as never)
      .upsert(
        {
          cache_key: key,
          payload: payload as Record<string, unknown>,
          generated_at: new Date().toISOString(),
          expires_at: expiresAt,
        } as never,
        { onConflict: "cache_key" },
      );
    if (error) console.warn("writeOddsCache failed:", error.message);
  } catch (e) {
    console.warn("writeOddsCache threw:", e);
  }
}
