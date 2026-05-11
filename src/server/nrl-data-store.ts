// ============================================================================
// Supabase-backed cache for normalised NRL data.
//
// Two-layer cache:
//   1. In-memory (existing src/server/cache.ts) — ~15min, per-worker
//   2. Supabase nrl_source_cache table — survives across worker instances
//
// Stale-while-revalidate by default: returns stale data immediately and kicks
// off a background refresh. Used for fixtures / ladder / stats / team lists.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SourceCoverage } from "./nrl-data-types";
import { cached } from "./cache";

export type CacheKind =
  | "fixtures"
  | "ladder"
  | "team_stats"
  | "player_stats"
  | "team_list"
  | "match_result"
  | "historical"
  | "officials";

export type StoredEntry<T> = {
  payload: T;
  coverage: SourceCoverage;
  generatedAt: string;
  expiresAt: string;
  source: string;
};

const MEMORY_TTL_MS = 5 * 60_000;

export async function readCache<T>(kind: CacheKind, key: string): Promise<StoredEntry<T> | null> {
  return cached(`nrl-store:${kind}:${key}`, MEMORY_TTL_MS, async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("nrl_source_cache")
        .select("payload, source, source_coverage, generated_at, expires_at")
        .eq("kind", kind)
        .eq("cache_key", key)
        .maybeSingle();
      if (error || !data) return null;
      return {
        payload: data.payload as T,
        coverage: (data.source_coverage as SourceCoverage) ?? {
          primary: "cache",
          sourcesUsed: ["cache"],
          missingFields: [],
          lastUpdated: data.generated_at,
        },
        generatedAt: data.generated_at,
        expiresAt: data.expires_at,
        source: data.source,
      } as StoredEntry<T>;
    } catch (e) {
      console.warn(`[nrl-data-store] readCache failed kind=${kind} key=${key}:`, e);
      return null;
    }
  });
}

export async function writeCache<T>(args: {
  kind: CacheKind;
  key: string;
  payload: T;
  coverage: SourceCoverage;
  ttlMs: number;
  source: string;
}): Promise<void> {
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + args.ttlMs).toISOString();
  try {
    const { error } = await supabaseAdmin
      .from("nrl_source_cache")
      .upsert(
        {
          kind: args.kind,
          cache_key: args.key,
          payload: args.payload as unknown as object,
          source: args.source,
          source_coverage: args.coverage as unknown as object,
          generated_at: generatedAt,
          expires_at: expiresAt,
        },
        { onConflict: "kind,cache_key" },
      );
    if (error) {
      console.warn(`[nrl-data-store] writeCache failed kind=${args.kind} key=${args.key}:`, error.message);
    }
  } catch (e) {
    console.warn(`[nrl-data-store] writeCache exception kind=${args.kind}:`, e);
  }
}

// Stale-while-revalidate read. Returns whatever is in the cache (even expired)
// and triggers a background refresh if expired. If nothing is cached at all,
// awaits the fetcher.
const inflight = new Map<string, Promise<unknown>>();

export async function readWithRefresh<T>(args: {
  kind: CacheKind;
  key: string;
  ttlMs: number;
  source: string;
  fetcher: () => Promise<{ payload: T; coverage: SourceCoverage } | null>;
  forceRefresh?: boolean;
}): Promise<StoredEntry<T> | null> {
  const inflightKey = `${args.kind}:${args.key}`;
  const refresh = async (): Promise<StoredEntry<T> | null> => {
    if (inflight.has(inflightKey)) return inflight.get(inflightKey) as Promise<StoredEntry<T> | null>;
    const p = (async () => {
      try {
        const fetched = await args.fetcher();
        if (!fetched) return null;
        await writeCache({
          kind: args.kind,
          key: args.key,
          payload: fetched.payload,
          coverage: fetched.coverage,
          ttlMs: args.ttlMs,
          source: args.source,
        });
        return {
          payload: fetched.payload,
          coverage: fetched.coverage,
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + args.ttlMs).toISOString(),
          source: args.source,
        } as StoredEntry<T>;
      } finally {
        inflight.delete(inflightKey);
      }
    })();
    inflight.set(inflightKey, p);
    return p;
  };

  if (args.forceRefresh) return refresh();

  const existing = await readCache<T>(args.kind, args.key);
  if (existing) {
    const expired = Date.parse(existing.expiresAt) <= Date.now();
    if (expired) refresh().catch(() => {});
    return existing;
  }
  return refresh();
}
