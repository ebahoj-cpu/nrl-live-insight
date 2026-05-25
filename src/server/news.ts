// NRL news aggregator — pulls from public RSS feeds, deduplicates, sorts.
// No API keys required.

export type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;       // attributable publisher (e.g. "Fox Sports") or aggregator label
  team?: string;        // NRL club label when sourced from a per-team feed
  publishedUtc: string;
  image?: string;
  summary?: string;
};

// Per-club Google News RSS queries. The NRL clubs do not publish RSS feeds, so
// Google News is the most reliable per-team aggregator: each item carries the
// real publisher in <source>, which we extract for proper attribution.
const TEAM_QUERIES: { team: string; query: string }[] = [
  { team: "Broncos",        query: '"Brisbane Broncos" NRL' },
  { team: "Raiders",        query: '"Canberra Raiders" NRL' },
  { team: "Bulldogs",       query: '"Canterbury Bulldogs" NRL' },
  { team: "Sharks",         query: '"Cronulla Sharks" NRL' },
  { team: "Dolphins",       query: '"Dolphins" NRL rugby league' },
  { team: "Titans",         query: '"Gold Coast Titans" NRL' },
  { team: "Sea Eagles",     query: '"Manly Sea Eagles" NRL' },
  { team: "Storm",          query: '"Melbourne Storm" NRL' },
  { team: "Knights",        query: '"Newcastle Knights" NRL' },
  { team: "Cowboys",        query: '"North Queensland Cowboys" NRL' },
  { team: "Eels",           query: '"Parramatta Eels" NRL' },
  { team: "Panthers",       query: '"Penrith Panthers" NRL' },
  { team: "Rabbitohs",      query: '"South Sydney Rabbitohs" NRL' },
  { team: "Dragons",        query: '"St George Illawarra Dragons" NRL' },
  { team: "Roosters",       query: '"Sydney Roosters" NRL' },
  { team: "Warriors",       query: '"New Zealand Warriors" NRL' },
  { team: "Wests Tigers",   query: '"Wests Tigers" NRL' },
];

function googleNewsUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-AU&gl=AU&ceid=AU:en`;
}

const FEEDS: { source: string; url: string; team?: string }[] = [
  // Approved league-wide publishers only.
  { source: "Zero Tackle",            url: "https://www.zerotackle.com/nrl/feed/" },
  { source: "NRL.com",                url: googleNewsUrl("site:nrl.com news") },
  { source: "Fox Sports",             url: googleNewsUrl("site:foxsports.com.au NRL") },
  { source: "Sporting News Australia", url: googleNewsUrl("site:sportingnews.com/au rugby league") },
  { source: "Yahoo Sport Australia",  url: googleNewsUrl("site:au.sports.yahoo.com NRL") },
  // Per-club feeds (Google News, attributed to the underlying publisher per item)
  ...TEAM_QUERIES.map((t) => ({ source: t.team, team: t.team, url: googleNewsUrl(t.query) })),
];

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0)";

function pick(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return undefined;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function pickAttr(xml: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, "i");
  return xml.match(re)?.[1];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ""; }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rdquo;/gi, "\u201D")
    .replace(/&ldquo;/gi, "\u201C")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013");
}

function stripHtml(s: string): string {
  // Decode entities first so encoded tags (&lt;a&gt;) become real tags and get stripped.
  const decoded = decodeEntities(s);
  return decodeEntities(decoded.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function findImage(itemXml: string): string | undefined {
  // Try common locations
  const enclosure = pickAttr(itemXml, "enclosure", "url");
  if (enclosure) return enclosure;
  const media = pickAttr(itemXml, "media:content", "url") || pickAttr(itemXml, "media:thumbnail", "url");
  if (media) return media;
  const desc = pick(itemXml, "description") || pick(itemXml, "content:encoded") || "";
  const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch?.[1];
}

async function parseFeed(source: string, url: string, team?: string): Promise<NewsItem[]> {
  try {
    // Per-feed timeout — without it a single slow feed can hang the whole
    // batch and the Worker eventually rejects with a generic HTTPError.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" },
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") ?? "";
    // Some feeds 301 to an HTML homepage (e.g. Zero Tackle). Skip HTML payloads
    // so we don't waste CPU regex-matching megabytes of unrelated markup.
    if (ct.includes("text/html")) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
    for (const block of itemBlocks) {
      const rawTitle = pick(block, "title");
      const link = pick(block, "link") || pickAttr(block, "link", "href");
      const pubDate = pick(block, "pubDate") || pick(block, "published") || pick(block, "dc:date");
      if (!rawTitle || !link) continue;
      if (!pubDate) continue;
      const parsed = new Date(pubDate);
      if (Number.isNaN(parsed.getTime())) continue;
      const dateIso = parsed.toISOString();

      const publisher = pick(block, "source");
      const cleanTitle = stripHtml(rawTitle).replace(/\s+-\s+[^-]+$/, "").trim();
      const effectiveSource = publisher ? stripHtml(publisher) : source;

      const rawDescription = pick(block, "description") ?? "";
      const cleanedDesc = stripHtml(rawDescription);
      const looksLikeUrl = /^https?:\/\//i.test(cleanedDesc) || /^<?a\s+href=/i.test(cleanedDesc);
      const usableDesc = looksLikeUrl ? "" : cleanedDesc;
      const summary = team
        ? (publisher ? `via ${stripHtml(publisher)}` : undefined)
        : (usableDesc.slice(0, 220) || (publisher ? `via ${stripHtml(publisher)}` : undefined));

      items.push({
        id: link,
        title: cleanTitle || stripHtml(rawTitle),
        link: link.trim(),
        source: team ?? effectiveSource,
        team,
        publishedUtc: dateIso,
        image: findImage(block),
        summary,
      });
    }
    return items;
  } catch {
    return [];
  }
}

// Cloudflare Workers cap concurrent in-flight fetches (~6). Firing all
// ~22 feeds in parallel triggers "stalled HTTP response was canceled"
// and the whole news call fails. Process feeds in small batches.
async function fetchAllFeeds(): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  const BATCH = 4;
  for (let i = 0; i < FEEDS.length; i += BATCH) {
    const slice = FEEDS.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map((f) => parseFeed(f.source, f.url, f.team)));
    for (const r of results) {
      if (r.status === "fulfilled") out.push(...r.value);
    }
  }
  return out;
}

export async function fetchNews(): Promise<NewsItem[]> {
  const all = await fetchAllFeeds();

  // Filter ABC to NRL/rugby league only (it's a general sport feed)
  const filtered = all.filter((n) => {
    if (n.source !== "ABC Sport") return true;
    const t = n.title.toLowerCase();
    return t.includes("nrl") || t.includes("rugby league") || t.includes("origin");
  });

  // Keep only this week's news (last 7 days)
  const weekAgo = Date.now() - 7 * 24 * 60 * 60_000;
  const recent = filtered.filter((n) => new Date(n.publishedUtc).getTime() >= weekAgo);

  // Dedupe by normalized title (cross-feed: same story surfaced from team feed
  // + general feed should collapse, preferring the team-tagged version).
  const seen = new Map<string, NewsItem>();
  for (const n of recent) {
    const key = n.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, n);
    } else if (!existing.team && n.team) {
      // Prefer the team-tagged variant for richer attribution.
      seen.set(key, n);
    }
  }
  const deduped = Array.from(seen.values());

  deduped.sort((a, b) => new Date(b.publishedUtc).getTime() - new Date(a.publishedUtc).getTime());
  return deduped.slice(0, 200);
}
