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

export const TTL = {
  fixtures: 15 * 60_000,
  ladder: 30 * 60_000,
  match: 10 * 60_000,
  odds: 5 * 60_000,
  insights: 60 * 60_000,
  weather: 30 * 60_000,
};
