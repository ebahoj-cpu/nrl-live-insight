// Tiny in-memory TTL cache. Lives for the lifetime of a worker instance.
// Use 15 min default; refresh button bypasses by passing { bypass: true }.

type Entry<T> = { v: T; exp: number };
const store = new Map<string, Entry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts?: { bypass?: boolean }
): Promise<T> {
  const now = Date.now();
  if (!opts?.bypass) {
    const hit = store.get(key) as Entry<T> | undefined;
    if (hit && hit.exp > now) return hit.v;
  }
  const v = await fn();
  store.set(key, { v, exp: now + ttlMs });
  return v;
}

// Non-async cache lookup — returns value if fresh, else undefined. Never triggers fn.
export function peekCache<T>(key: string): T | undefined {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.exp > Date.now()) return hit.v;
  return undefined;
}

// Stale-while-revalidate: returns whatever is in the cache (even expired), and
// kicks off a background refresh if expired. If nothing is cached at all,
// awaits the fetch. Used for snappy UX where slightly stale > waiting.
const inflight = new Map<string, Promise<unknown>>();
export async function staleWhileRevalidate<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  fallback?: T,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  const refresh = () => {
    if (inflight.has(key)) return inflight.get(key) as Promise<T>;
    const p = fn()
      .then((v) => { store.set(key, { v, exp: Date.now() + ttlMs }); return v; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
  if (hit) {
    if (hit.exp <= now) { refresh().catch(() => {}); }
    return hit.v;
  }
  if (fallback !== undefined) {
    refresh().catch(() => {});
    return fallback;
  }
  return refresh();
}

// Insights-specific TTL: long-lived once generated, short refresh window inside
// the final hour before kickoff so late team / odds / weather changes can land.
//   - >24h to kickoff:  cache 24h (rare — most viewers hit closer to game day)
//   - 1h–24h:           cache until T-60min so the final-hour refresh fires
//   - 0–60min pre-game: cache 20min so very-late changes (lineup outs) reflect
//   - kickoff or later: cache 7 days — match is locked, never regenerate
export function insightsTtlMs(kickoffUtc: string): number {
  const ko = Date.parse(kickoffUtc);
  if (!Number.isFinite(ko)) return 60 * 60_000;
  const now = Date.now();
  const msToKickoff = ko - now;
  const ONE_HOUR = 60 * 60_000;
  const ONE_DAY = 24 * ONE_HOUR;
  const SEVEN_DAYS = 7 * ONE_DAY;
  if (msToKickoff <= 0) return SEVEN_DAYS;     // post-kickoff lock
  if (msToKickoff <= ONE_HOUR) return 20 * 60_000;
  if (msToKickoff <= ONE_DAY) return msToKickoff - ONE_HOUR; // expire at T-60min
  return ONE_DAY;
}

export const TTL = {
  fixtures: 15 * 60_000,
  ladder: 30 * 60_000,
  match: 10 * 60_000,
  odds: 5 * 60_000,
  insights: 60 * 60_000, // legacy default; prefer insightsTtlMs(kickoffUtc)
  weather: 30 * 60_000,
};
