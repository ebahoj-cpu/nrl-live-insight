import { createServerFn } from "@tanstack/react-start";
import { fetchNews, type NewsItem } from "./news";

type Entry = { ts: number; items: NewsItem[] };
const TTL_MS = 10 * 60_000;
let cache: Entry | null = null;
let lastGood: NewsItem[] = []; // never expires — fallback when feeds blip

export const getNews = createServerFn({ method: "GET" })
  .inputValidator((i: { refresh?: boolean } | undefined) => i ?? {})
  .handler(async ({ data }) => {
    const now = Date.now();
    if (!data.refresh && cache && now - cache.ts < TTL_MS && cache.items.length > 0) {
      return cache.items;
    }
    try {
      const items = await fetchNews();
      if (items.length > 0) {
        cache = { ts: now, items };
        lastGood = items;
        return items;
      }
      // Empty result — don't poison the cache. Serve last known good.
      return lastGood;
    } catch (err) {
      console.error("[news] fetch failed", err);
      return lastGood;
    }
  });
