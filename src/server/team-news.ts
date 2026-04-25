// Scrapes the official NRL.com weekly "Team Lists Round X" article to extract
// per-team Ins, Outs and the brief late-mail blurb. The article is the same
// source the match-centre header references and is the most authoritative
// public surface for ins/outs short of the per-club press releases.
//
// URL pattern: https://www.nrl.com/news/{yyyy}/{mm}/{dd}/nrl-team-lists-round-{N}/
// We don't know the publish date in advance, so we discover the article via
// the news listing for the round and cache the resolved URL alongside the
// parsed payload.

const UA = "Mozilla/5.0 (compatible; NRLLiveInsight/1.0)";

export type TeamNews = {
  ins: string[];           // player names
  outs: string[];          // player names
  blurb: string;           // 1–3 sentence late-mail summary (NRL.com)
  sourceUrl: string;       // article URL we parsed
};

export type MatchTeamNews = {
  home: TeamNews | null;
  away: TeamNews | null;
};

// Cache the article body per (season, round) — the article is updated multiple
// times during the week so the in-memory TTL is short. The match-page caller
// already memoises the whole match details object on top.
const articleCache = new Map<string, { ts: number; body: string; url: string }>();
const ARTICLE_TTL_MS = 30 * 60_000; // 30 minutes

async function resolveArticleUrl(season: number, round: number): Promise<string | null> {
  // The slug is stable: nrl-team-lists-round-{N}
  // The URL has the publish date which we don't know, so use Google-style search
  // via the NRL site search redirect (or try the most recent few weeks of dates).
  // Easiest robust path: fetch the news listing, which lists recent articles.
  try {
    const listUrl = `https://www.nrl.com/news/?tagNames=Round%20${round}&competitionId=111&seasonId=${season}`;
    const res = await fetch(listUrl, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const html = await res.text();
    // Look for the canonical team-lists slug inside any link href.
    const re = new RegExp(`/news/${season}/\\d{2}/\\d{2}/nrl-team-lists-round-${round}/`, "i");
    const m = html.match(re);
    return m ? `https://www.nrl.com${m[0]}` : null;
  } catch {
    return null;
  }
}

async function fetchArticle(season: number, round: number): Promise<{ body: string; url: string } | null> {
  const key = `${season}::${round}`;
  const hit = articleCache.get(key);
  if (hit && Date.now() - hit.ts < ARTICLE_TTL_MS) return { body: hit.body, url: hit.url };

  const url = await resolveArticleUrl(season, round);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const body = await res.text();
    articleCache.set(key, { ts: Date.now(), body, url });
    return { body, url };
  } catch {
    return null;
  }
}

// Strip HTML tags but preserve newline boundaries between block elements so
// our heading/list parsing has something to work with.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(h[1-6]|p|li|ul|ol|div|section|article|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>(?=)/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

// Find the slice of text for a given match (e.g. "Knights v Panthers"). The
// article uses headings like "### Knights v Panthers, Sunday 2.00pm at ...".
function sliceMatchSection(text: string, homeNick: string, awayNick: string): string | null {
  const lines = text.split("\n");
  const startRe = new RegExp(`^#?#? ?${escape(homeNick)}\\s+v\\s+${escape(awayNick)}\\b`, "i");
  const altRe = new RegExp(`^#?#? ?${escape(awayNick)}\\s+v\\s+${escape(homeNick)}\\b`, "i");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i].trim()) || altRe.test(lines[i].trim())) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;
  // End at the next "Xxx v Yyy," heading — that's the next match in the article.
  const nextRe = /^#?#? ?[A-Z][A-Za-z' ]+\s+v\s+[A-Z][A-Za-z' ]+,/;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (nextRe.test(lines[i].trim())) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Parse "### {Team} Ins" / "### {Team} Outs" sections. Each section is a list
// of bullet items where the player name is split across two lines (first / last).
function parseInsOuts(section: string, teamNick: string): { ins: string[]; outs: string[] } {
  const ins = parseSection(section, `### ${teamNick} Ins`, "ins");
  const outs = parseSection(section, `### ${teamNick} Outs`, "outs");
  return { ins, outs };
}

function parseSection(section: string, heading: string, kind: "ins" | "outs"): string[] {
  const lines = section.split("\n");
  const idx = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
  if (idx === -1) return [];
  // Read forward until the next "###" heading or "#### Match Officials".
  const out: string[] = [];
  let buffer: string[] = [];
  const flushBuffer = () => {
    const name = buffer.map((b) => b.trim()).filter(Boolean).join(" ").trim();
    if (name && /^[A-Z][A-Za-z'’\-\.]+(?:\s+[A-Z][A-Za-z'’\-\.]+)+/.test(name)) {
      out.push(name);
    }
    buffer = [];
  };
  for (let i = idx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (/^#{2,4}\s/.test(t)) break;
    if (/^Match Officials/i.test(t)) break;
    if (t.startsWith("- ")) {
      flushBuffer();
      buffer.push(t.slice(2));
    } else if (t === "" ) {
      // blank line — possible item boundary inside a multiline bullet
      if (buffer.length) {
        // Heuristic: if buffer already looks like a full name, flush; otherwise keep collecting.
        const joined = buffer.join(" ").trim();
        if (/\s/.test(joined)) flushBuffer();
      }
    } else if (/^Ins$|^Outs$/i.test(t)) {
      // Stray label – ignore.
      continue;
    } else {
      // Continuation of current bullet (last name on its own line).
      if (buffer.length) buffer.push(t);
    }
    // Safety: don't accumulate forever
    if (out.length > 25) break;
  }
  flushBuffer();
  // Dedupe while preserving order.
  return Array.from(new Set(out));
}

// Late-mail blurb at the end of each match block: "**{Team}:** ..."
function parseBlurb(section: string, teamNick: string): string {
  const re = new RegExp(`\\*\\*${escape(teamNick)}:\\*\\*\\s*([^\\n]+(?:\\n(?!\\*\\*|###|####)[^\\n]+){0,3})`, "i");
  const m = section.match(re);
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
}

export async function fetchMatchTeamNews(
  season: number,
  round: number,
  homeNick: string,
  awayNick: string,
): Promise<MatchTeamNews> {
  const article = await fetchArticle(season, round);
  if (!article) return { home: null, away: null };
  const text = htmlToText(article.body);
  const section = sliceMatchSection(text, homeNick, awayNick);
  if (!section) return { home: null, away: null };

  // The article uses the "{Team} Ins/Outs" heading style most of the time, but
  // a recurring markup glitch causes the second team's "Outs" heading to be
  // mislabelled "{Team} Ins" again. We defend against that by parsing both
  // headings and, when a duplicate "Ins" is found, treating the second one as
  // the missing "Outs".
  const homeIO = parseInsOuts(section, homeNick);
  const awayIO = parseInsOuts(section, awayNick);

  // Patch the markup glitch: if away.outs is empty AND there are TWO "{away} Ins"
  // headings in the section, treat the second occurrence as the away outs.
  if (awayIO.outs.length === 0) {
    const dupHeading = `### ${awayNick} Ins`;
    const occurrences = section.split(dupHeading).length - 1;
    if (occurrences >= 2) {
      const secondStart = section.indexOf(dupHeading, section.indexOf(dupHeading) + dupHeading.length);
      const tail = section.slice(secondStart).replace(dupHeading, `### ${awayNick} Outs`);
      const fixed = parseSection(tail, `### ${awayNick} Outs`, "outs");
      if (fixed.length) awayIO.outs = fixed;
    }
  }

  return {
    home: {
      ins: homeIO.ins,
      outs: homeIO.outs,
      blurb: parseBlurb(section, homeNick),
      sourceUrl: article.url,
    },
    away: {
      ins: awayIO.ins,
      outs: awayIO.outs,
      blurb: parseBlurb(section, awayNick),
      sourceUrl: article.url,
    },
  };
}
