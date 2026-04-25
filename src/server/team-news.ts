// Scrapes the official NRL.com weekly "Team Lists Round X" article to extract
// per-team Ins, Outs and the brief late-mail blurb. The article is the same
// source the match-centre header references and is the most authoritative
// public surface for ins/outs short of the per-club press releases.
//
// URL pattern: https://www.nrl.com/news/{yyyy}/{mm}/{dd}/nrl-team-lists-round-{N}/
// Discovery: we read https://www.nrl.com/news/topic/team-lists/ and grab the
// first href that matches the canonical slug for the given round + season.

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

const articleCache = new Map<string, { ts: number; body: string; url: string }>();
const ARTICLE_TTL_MS = 30 * 60_000; // 30 minutes

async function resolveArticleUrl(season: number, round: number): Promise<string | null> {
  // The team-lists topic listing has a stable slot for the most recent rounds
  // and is updated immediately when a new article is published.
  try {
    const res = await fetch("https://www.nrl.com/news/topic/team-lists/", {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) return null;
    const html = await res.text();
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

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Find the slice of text for a given match (e.g. "Knights v Panthers, Sunday 2.00pm at ...").
function sliceMatchSection(text: string, homeNick: string, awayNick: string): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const startRe = new RegExp(`^${escape(homeNick)}\\s+v\\s+${escape(awayNick)}\\b`, "i");
  const altRe = new RegExp(`^${escape(awayNick)}\\s+v\\s+${escape(homeNick)}\\b`, "i");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i]) || altRe.test(lines[i])) { startIdx = i; break; }
  }
  if (startIdx === -1) return null;
  // End at the next "Xxx v Yyy" heading line.
  const nextRe = /^[A-Z][A-Za-z' ]+\s+v\s+[A-Z][A-Za-z' ]+,/;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (nextRe.test(lines[i])) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

// The article structure (post-mid-2025 markup) is:
//   {Team} Ins
//   FirstName
//   LastName
//   FirstName
//   LastName
//   Ins  <-- spurious "Ins" label sometimes appears
//   {Team} Outs
//   FirstName
//   LastName
//   ...
//   Match Officials  <-- end marker
//
// Recurring markup glitch: the second team's Outs heading is sometimes
// mislabelled as "{otherTeam} Ins" again. We defend by splitting on every
// known section heading and assigning by order of appearance.

type Section = { heading: string; lines: string[] };

function splitSections(section: string, homeNick: string, awayNick: string): Section[] {
  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
  const headingRe = new RegExp(
    `^(?:${escape(homeNick)}|${escape(awayNick)})\\s+(Ins|Outs)$`,
    "i",
  );
  const out: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    if (headingRe.test(line)) {
      if (current) out.push(current);
      current = { heading: line, lines: [] };
    } else if (/^Match Officials$/i.test(line)) {
      break;
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) out.push(current);
  return out;
}

// Parse the alternating first-name/last-name lines into full player names.
// Stops when a stray heading-like token is encountered ("Ins", "Outs", etc.).
function parsePlayerList(lines: string[]): string[] {
  const cleaned = lines.filter((l) => !/^(Ins|Outs)$/i.test(l));
  const names: string[] = [];
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    const first = cleaned[i];
    const last = cleaned[i + 1];
    if (!isLikelyNamePart(first) || !isLikelyNamePart(last)) {
      // Skip past one token and try again on the next pair.
      i -= 1;
      continue;
    }
    names.push(`${first} ${last}`.replace(/\s+/g, " ").trim());
  }
  // Dedupe preserving order.
  return Array.from(new Set(names));
}

function isLikelyNamePart(s: string): boolean {
  if (!s) return false;
  if (s.length < 2 || s.length > 30) return false;
  // Allow letters, hyphen, apostrophe (e.g. To'o, Papali'i), accents.
  return /^[A-Za-zÀ-ÖØ-öø-ÿ'’\-\.]+$/.test(s);
}

function parseBlurb(section: string, teamNick: string): string {
  // Pattern: "{Team}: ..." paragraph after the Match Officials block.
  const re = new RegExp(
    `(?:^|\\n)${escape(teamNick)}\\s*:\\s*([^\\n]+(?:\\n(?!(?:${escape(teamNick)}|Match Officials|[A-Z][A-Za-z' ]+\\s+v\\s+))[^\\n]+){0,5})`,
    "i",
  );
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

  // Pull all "{Team} (Ins|Outs)" sections in order of appearance. The expected
  // sequence is [home Ins, away Ins, home Outs, away Outs] but the markup
  // glitch can produce [home Ins, away Ins, home Outs, away Ins(=Outs)] —
  // we treat the 4th positional slot as the away-team Outs regardless of
  // its declared heading text.
  const sections = splitSections(section, homeNick, awayNick);

  const homeNews: TeamNews = { ins: [], outs: [], blurb: parseBlurb(section, homeNick), sourceUrl: article.url };
  const awayNews: TeamNews = { ins: [], outs: [], blurb: parseBlurb(section, awayNick), sourceUrl: article.url };

  // Try heading-driven assignment first.
  for (const s of sections) {
    const isHome = new RegExp(`^${escape(homeNick)}\\s`, "i").test(s.heading);
    const isOuts = /Outs$/i.test(s.heading);
    const players = parsePlayerList(s.lines);
    const target = isHome ? homeNews : awayNews;
    if (isOuts) target.outs.push(...players);
    else target.ins.push(...players);
  }

  // Glitch repair: if away.outs is empty AND we see two "{away} Ins" headings,
  // treat the second as away.outs.
  if (awayNews.outs.length === 0) {
    const awayInsHeadings = sections.filter((s) =>
      new RegExp(`^${escape(awayNick)}\\s+Ins$`, "i").test(s.heading),
    );
    if (awayInsHeadings.length >= 2) {
      const second = awayInsHeadings[awayInsHeadings.length - 1];
      const players = parsePlayerList(second.lines);
      // The "ins" we already pushed was the duplicate — keep only the first occurrence.
      // We can't easily reverse, so dedupe ins against outs to keep things sensible.
      awayNews.outs = players;
      awayNews.ins = awayNews.ins.filter((p) => !players.includes(p));
    }
  }

  // Dedupe each list once more.
  homeNews.ins = Array.from(new Set(homeNews.ins));
  homeNews.outs = Array.from(new Set(homeNews.outs));
  awayNews.ins = Array.from(new Set(awayNews.ins));
  awayNews.outs = Array.from(new Set(awayNews.outs));

  return { home: homeNews, away: awayNews };
}
