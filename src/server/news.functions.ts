// News server function with layered caching:
//   1. In-memory cache (per-worker, 60min TTL) — fast hot path
//   2. Supabase nrl_source_cache (kind="news") — survives cold starts and
//      shared across worker instances; same 60min TTL
//   3. lastGood fallback in memory — never let UI show "No news available"
//
// On every successful fetch we write to BOTH layers so a fresh worker can
// hydrate from Supabase instantly without re-hitting every feed.

import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchNews, type NewsItem } from "./news";

type Entry = { ts: number; items: NewsItem[] };
const TTL_MS = 60 * 60_000; // hourly refresh per spec
const CACHE_KEY = "news:all";
const CACHE_KIND = "news";

let cache: Entry | null = null;
let lastGood: NewsItem[] = []; // never expires — last-resort fallback

async function readSupabaseCache(): Promise<NewsItem[] | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("nrl_source_cache")
      .select("payload, expires_at")
      .eq("kind", CACHE_KIND)
      .eq("cache_key", CACHE_KEY)
      .maybeSingle();
    if (error || !data) return null;
    const expired = Date.parse(data.expires_at as string) <= Date.now();
    const items = Array.isArray(data.payload) ? (data.payload as NewsItem[]) : null;
    if (!items || items.length === 0) return null;
    // Stash even expired entries into lastGood so we always have a fallback.
    lastGood = items;
    return expired ? null : items;
  } catch {
    return null;
  }
}

async function writeSupabaseCache(items: NewsItem[]): Promise<void> {
  try {
    await supabaseAdmin.from("nrl_source_cache").upsert(
      [{
        kind: CACHE_KIND,
        cache_key: CACHE_KEY,
        payload: items as never,
        source: "rss-aggregator",
        source_coverage: { primary: "rss", sourcesUsed: ["rss"], missingFields: [], lastUpdated: new Date().toISOString() } as never,
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      }],
      { onConflict: "kind,cache_key" },
    );
  } catch (e) {
    console.warn("[news] supabase cache write failed", e);
  }
}

export const getNews = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const now = Date.now();

    // 1) Hot in-memory cache
    if (!data.refresh && cache && now - cache.ts < TTL_MS && cache.items.length > 0) {
      return cache.items;
    }

    // 2) Warm Supabase cache (cold-start hydration)
    if (!data.refresh) {
      const fromDb = await readSupabaseCache();
      if (fromDb && fromDb.length > 0) {
        cache = { ts: now, items: fromDb };
        lastGood = fromDb;
        return fromDb;
      }
    }

    // 3) Live fetch with full fallback chain
    try {
      const items = await fetchNews();
      if (items.length > 0) {
        cache = { ts: now, items };
        lastGood = items;
        // Persist asynchronously — don't block the response on Supabase.
        void writeSupabaseCache(items);
        return items;
      }
      // Empty result — try Supabase (any age) then lastGood.
      if (lastGood.length > 0) return lastGood;
      const fallback = await readSupabaseCache();
      return fallback ?? lastGood;
    } catch (err) {
      console.error("[news] fetch failed", err);
      if (lastGood.length > 0) return lastGood;
      const fallback = await readSupabaseCache();
      return fallback ?? [];
    }
  });
