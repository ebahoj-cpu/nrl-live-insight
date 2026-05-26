// ============================================================================
// NRL news aggregator
// ----------------------------------------------------------------------------
// Architecture (rebuilt for reliability — Google News only is too flaky):
//
//   1. DIRECT RSS feeds (preferred — real publisher XML, stable):
//        - Zero Tackle (zerotackle.com/feed/)            ← native WP feed
//        - Serious About Rugby League (seriousaboutrl.com/feed/)
//        - ABC Sport NRL (abc.net.au/news/feed/45924/rss.xml)
//
//   2. GOOGLE NEWS fallback (used ONLY where no direct feed exists):
//        - NRL.com         (no public RSS — site:nrl.com)
//        - Fox Sports      (their /content-feeds/ returns 204 — site:foxsports.com.au)
//        - Code Sports     (paywalled XML returns 204 — site:codesports.com.au)
//        - Daily Telegraph (RSS returns 204 — site:dailytelegraph.com.au)
//        - All 17 NRL clubs (clubs do not publish RSS at all)
//
//   3. Per-feed timeout (6s) + one retry on transient failure.
//   4. Concurrency capped at 4 (Cloudflare Workers ~6-subrequest limit).
//   5. Skip HTML payloads (some feeds 301 to a homepage).
//   6. Aggressive dedup across feeds: same story surfaced from Google News +
//      a team feed + a direct publisher feed collapses to one item.
//   7. High-signal scoring — injury / late mail / team list / weather /
//      coach quote / form streak articles float to the top.
// ============================================================================

export type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;       // attributable publisher (e.g. "Fox Sports") or team label
  team?: string;        // NRL club label when sourced from a per-team feed
  publishedUtc: string;
  image?: string;
  summary?: string;
  signalScore?: number; // 0-100, used for high-signal prioritization
};

// All 17 NRL clubs — clubs do not expose RSS, so each is pulled via Google News
// with a precise quoted-name query so we don't catch unrelated mentions.
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

type Feed = { source: string; url: string; team?: string; direct?: boolean };

const FEEDS: Feed[] = [
  // ── Tier 1: DIRECT publisher feeds (the reliable backbone) ──
  { source: "Zero Tackle",                  url: "https://www.zerotackle.com/feed/",                 direct: true },
  { source: "Serious About Rugby League",   url: "https://www.seriousaboutrl.com/feed/",             direct: true },
  { source: "ABC Sport",                    url: "https://www.abc.net.au/news/feed/45924/rss.xml",   direct: true },

  // ── Tier 2: Google News fallbacks (no native feed available) ──
  { source: "NRL.com",          url: googleNewsUrl("site:nrl.com news") },
  { source: "Fox Sports",       url: googleNewsUrl("site:foxsports.com.au NRL") },
  { source: "Code Sports",      url: googleNewsUrl("site:codesports.com.au NRL") },
  { source: "Daily Telegraph",  url: googleNewsUrl("site:dailytelegraph.com.au NRL") },

  // ── Tier 3: Per-club coverage (Google News — no club exposes RSS) ──
  ...TEAM_QUERIES.map((t) => ({ source: t.team, team: t.team, url: googleNewsUrl(t.query) })),
];

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0)";

// ─── XML helpers ────────────────────────────────────────────────────────────

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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ""; } })
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&rsquo;/gi, "\u2019").replace(/&lsquo;/gi, "\u2018")
    .replace(/&rdquo;/gi, "\u201D").replace(/&ldquo;/gi, "\u201C")
    .replace(/&hellip;/gi, "\u2026").replace(/&mdash;/gi, "\u2014").replace(/&ndash;/gi, "\u2013");
}

function stripHtml(s: string): string {
  const decoded = decodeEntities(s);
  return decodeEntities(decoded.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function findImage(itemXml: string): string | undefined {
  const enclosure = pickAttr(itemXml, "enclosure", "url");
  if (enclosure) return enclosure;
  const media = pickAttr(itemXml, "media:content", "url") || pickAttr(itemXml, "media:thumbnail", "url");
  if (media) return media;
  const desc = pick(itemXml, "description") || pick(itemXml, "content:encoded") || "";
  const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch?.[1];
}

// ─── High-signal scoring ─────────────────────────────────────────────────────
// Articles about injuries, late mail, team lists, weather, coach quotes, form
// streaks and fixture analysis get a boost so they surface above filler.

const SIGNAL_PATTERNS: { re: RegExp; weight: number }[] = [
  { re: /\b(injur(?:y|ed|ies)|hamstring|acl|concuss|hia|knee|shoulder|ankle)\b/i,        weight: 35 },
  { re: /\b(late mail|team list|squad named|named to (?:start|play|return)|line[- ]?up)\b/i, weight: 30 },
  { re: /\b(ruled out|return(?:s|ed)|comeback|recalled|axed|dropped|benched|suspended|ban|judiciary)\b/i, weight: 22 },
  { re: /\b(weather|wet weather|rain|storm forecast|wind|conditions)\b/i,                 weight: 15 },
  { re: /\b(coach (?:says|admits|reveals|backs|slams|defends)|presser|press conference)\b/i, weight: 18 },
  { re: /\b(form (?:slump|streak|guide)|won \d+ (?:straight|in a row)|lost \d+ (?:straight|in a row))\b/i, weight: 14 },
  { re: /\b(preview|tips|prediction|head[- ]to[- ]head|h2h|key matchup|fixture analysis)\b/i, weight: 12 },
  { re: /\b(state of origin|origin (?:I|II|III|1|2|3)|grand final|finals)\b/i,            weight: 10 },
];

function scoreSignal(title: string, summary: string): number {
  const hay = `${title} ${summary}`;
  let score = 0;
  for (const { re, weight } of SIGNAL_PATTERNS) if (re.test(hay)) score += weight;
  return Math.min(100, score);
}

// ─── Feed fetcher (with retry + timeout) ─────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function parseFeed(feed: Feed): Promise<NewsItem[]> {
  try {
    // One retry on timeout/5xx — Google News in particular sometimes blips.
    let res = await fetchWithTimeout(feed.url, 6000);
    if (!res || !res.ok || res.status >= 500) {
      res = await fetchWithTimeout(feed.url, 8000);
    }
    if (!res || !res.ok) return [];
    const ct = res.headers.get("content-type") ?? "";
    // Some feeds 301 to an HTML homepage (e.g. legacy Zero Tackle taxonomy
    // feeds). Skip HTML — never waste CPU regex-matching megabytes of markup.
    if (ct.includes("text/html") && !ct.includes("xml")) return [];
    const xml = await res.text();
    if (!xml.includes("<item") && !xml.includes("<entry")) return [];

    const items: NewsItem[] = [];
    const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
    for (const block of itemBlocks) {
      const rawTitle = pick(block, "title");
      const link = pick(block, "link") || pickAttr(block, "link", "href");
      const pubDate = pick(block, "pubDate") || pick(block, "published") || pick(block, "updated") || pick(block, "dc:date");
      if (!rawTitle || !link || !pubDate) continue;
      const parsed = new Date(pubDate);
      if (Number.isNaN(parsed.getTime())) continue;

      const publisher = pick(block, "source");
      // Google News titles include " - Publisher" suffix; strip it.
      const cleanTitle = stripHtml(rawTitle).replace(/\s+-\s+[^-]+$/, "").trim();
      const effectiveSource = publisher ? stripHtml(publisher) : feed.source;

      const rawDescription = pick(block, "description") ?? pick(block, "summary") ?? "";
      const cleanedDesc = stripHtml(rawDescription);
      const looksLikeUrl = /^https?:\/\//i.test(cleanedDesc) || /^<?a\s+href=/i.test(cleanedDesc);
      const usableDesc = looksLikeUrl ? "" : cleanedDesc;
      const summary = feed.team
        ? (publisher ? `via ${stripHtml(publisher)}` : undefined)
        : (usableDesc.slice(0, 220) || (publisher ? `via ${stripHtml(publisher)}` : undefined));

      const finalTitle = cleanTitle || stripHtml(rawTitle);
      items.push({
        id: link,
        title: finalTitle,
        link: link.trim(),
        source: feed.team ?? effectiveSource,
        team: feed.team,
        publishedUtc: parsed.toISOString(),
        image: findImage(block),
        summary,
        signalScore: scoreSignal(finalTitle, usableDesc),
      });
    }
    return items;
  } catch {
    return [];
  }
}

// Cloudflare Workers cap concurrent in-flight fetches (~6). Process feeds in
// small batches so one slow source can't poison the whole call.
async function fetchAllFeeds(): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  const BATCH = 4;
  for (let i = 0; i < FEEDS.length; i += BATCH) {
    const slice = FEEDS.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map(parseFeed));
    for (const r of results) {
      if (r.status === "fulfilled") out.push(...r.value);
    }
  }
  return out;
}

// ─── Dedup (aggressive: normalized title + token shingle) ────────────────────

function normaliseTitle(t: string): string {
  return t.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(nrl|rugby league|news|update|reports?|breaking)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// First 6 significant words — catches near-duplicates with different tails
// (e.g. "Broncos confirm Walsh return for Origin" vs "Broncos confirm Walsh
// return for Origin selection").
function titleShingle(t: string): string {
  return normaliseTitle(t).split(" ").slice(0, 6).join(" ");
}

export async function fetchNews(): Promise<NewsItem[]> {
  const all = await fetchAllFeeds();

  // ABC Sport feed is general — filter to NRL/rugby league only.
  const filtered = all.filter((n) => {
    if (n.source !== "ABC Sport") return true;
    const t = n.title.toLowerCase();
    return t.includes("nrl") || t.includes("rugby league") || t.includes("origin") || /\b(broncos|raiders|bulldogs|sharks|dolphins|titans|sea eagles|storm|knights|cowboys|eels|panthers|rabbitohs|dragons|roosters|warriors|tigers)\b/.test(t);
  });

  // Keep only this week's news (last 7 days)
  const weekAgo = Date.now() - 7 * 24 * 60 * 60_000;
  const recent = filtered.filter((n) => new Date(n.publishedUtc).getTime() >= weekAgo);

  // Aggressive cross-feed dedup. Prefer:
  //   1. Direct publisher feeds over Google News aggregations.
  //   2. Team-tagged items over generic ones (richer attribution).
  //   3. Higher signal score otherwise.
  const seen = new Map<string, NewsItem>();
  const directSources = new Set(["Zero Tackle", "Serious About Rugby League", "ABC Sport"]);
  for (const n of recent) {
    const key = titleShingle(n.title);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) { seen.set(key, n); continue; }

    const nDirect = directSources.has(n.source);
    const eDirect = directSources.has(existing.source);
    if (nDirect && !eDirect) { seen.set(key, n); continue; }
    if (eDirect && !nDirect) continue;
    if (!existing.team && n.team) { seen.set(key, n); continue; }
    if ((n.signalScore ?? 0) > (existing.signalScore ?? 0)) { seen.set(key, n); continue; }
  }
  const deduped = Array.from(seen.values());

  // Composite ranking: signal-weighted recency.
  //   score = signalScore + freshnessBonus
  // where freshnessBonus decays from 60 (just now) to 0 (a week old).
  const now = Date.now();
  deduped.sort((a, b) => {
    const ageA = (now - new Date(a.publishedUtc).getTime()) / 3_600_000; // hours
    const ageB = (now - new Date(b.publishedUtc).getTime()) / 3_600_000;
    const freshA = Math.max(0, 60 - ageA);
    const freshB = Math.max(0, 60 - ageB);
    const scoreA = (a.signalScore ?? 0) + freshA;
    const scoreB = (b.signalScore ?? 0) + freshB;
    return scoreB - scoreA;
  });

  return deduped.slice(0, 200);
}
