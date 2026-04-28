// NRL news aggregator — pulls from public RSS feeds, deduplicates, sorts.
// No API keys required.

export type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedUtc: string;
  image?: string;
  summary?: string;
};

const FEEDS: { source: string; url: string }[] = [
  { source: "NRL.com", url: "https://www.nrl.com/news/rss/" },
  { source: "NRL.com", url: "https://www.nrl.com/news/feed/" },
  { source: "Zero Tackle", url: "https://www.zerotackle.com/feed/" },
  { source: "Zero Tackle", url: "https://www.zerotackle.com/nrl/feed/" },
  { source: "ABC Sport", url: "https://www.abc.net.au/news/feed/45924/rss.xml" },
  { source: "The Roar", url: "https://www.theroar.com.au/nrl/feed/" },
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

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
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

async function parseFeed(source: string, url: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
    for (const block of itemBlocks) {
      const title = pick(block, "title");
      const link = pick(block, "link") || pickAttr(block, "link", "href");
      const pubDate = pick(block, "pubDate") || pick(block, "published") || pick(block, "dc:date");
      if (!title || !link) continue;
      const dateIso = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
      items.push({
        id: link,
        title: stripHtml(title),
        link: link.trim(),
        source,
        publishedUtc: dateIso,
        image: findImage(block),
        summary: stripHtml(pick(block, "description") ?? "").slice(0, 220) || undefined,
      });
    }
    return items;
  } catch {
    return [];
  }
}

export async function fetchNews(): Promise<NewsItem[]> {
  const all = (await Promise.all(FEEDS.map((f) => parseFeed(f.source, f.url)))).flat();

  // Filter ABC to NRL/rugby league only (it's a general sport feed)
  const filtered = all.filter((n) => {
    if (n.source !== "ABC Sport") return true;
    const t = n.title.toLowerCase();
    return t.includes("nrl") || t.includes("rugby league") || t.includes("origin");
  });

  // Dedupe by normalized title
  const seen = new Set<string>();
  const deduped: NewsItem[] = [];
  for (const n of filtered) {
    const key = n.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(n);
  }

  deduped.sort((a, b) => new Date(b.publishedUtc).getTime() - new Date(a.publishedUtc).getTime());
  return deduped.slice(0, 60);
}
