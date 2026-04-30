// Cross-references the recent news feed with a match squad to surface
// player out-of-game signals BEFORE the official Team Lists article updates.
//
// Pure heuristic, title-driven. We deliberately avoid sending news bodies
// through AI here to keep it cheap and synchronous with the match-detail
// loader. The match page already does deeper AI work elsewhere.

import { fetchNews, type NewsItem } from "./news";
import { cached } from "./cache";

export type NewsRuling = {
  playerName: string;       // canonical "First Last" from the squad
  reason: string;           // short snippet from the headline
  sourceUrl: string;
  sourceTitle: string;
  source: string;
  publishedUtc: string;
};

// Phrases that indicate a player will NOT take the field. Order matters
// only for which snippet wins when two patterns hit the same headline.
const OUT_PATTERNS: RegExp[] = [
  /\bruled out\b/i,
  /\brules?\s+(?:himself\s+)?out\b/i,
  /\bwithdrawn\b/i,
  /\bwithdraws?\b/i,
  /\bout for (?:the )?(?:season|year|finals|round|game|match|week)\b/i,
  /\bout of (?:the )?(?:game|match|round|fixture|finals?)\b/i,
  /\bsidelined\b/i,
  /\bmiss(?:es|ing)?\s+(?:the\s+)?(?:game|match|round|fixture|clash|grand final|finals?|season)\b/i,
  /\bwon't (?:play|feature|take the field)\b/i,
  /\bwill miss\b/i,
  /\bsuspended\b/i,
  /\bbanned\b/i,
  /\bfacing (?:a\s+)?ban\b/i,
  /\bseason[- ]ending\b/i,
  /\b(?:done|finished) for the (?:season|year)\b/i,
];

// Patterns that look like ruling out but actually mean the OPPOSITE
// (player available / cleared / returning). Used to suppress false positives.
const NEGATION_PATTERNS: RegExp[] = [
  /\b(?:cleared|free) to play\b/i,
  /\bavoids?\s+(?:a\s+)?ban\b/i,
  /\bnot ruled out\b/i,
  /\breturn(?:s|ing)?\b/i,
  /\bnamed to play\b/i,
  /\bback (?:to play|in)\b/i,
];

function findOutSnippet(title: string): string | null {
  if (NEGATION_PATTERNS.some((re) => re.test(title))) return null;
  for (const re of OUT_PATTERNS) {
    const m = title.match(re);
    if (m) return m[0];
  }
  return null;
}

// Build matchers for each squad player. We accept:
//   • full "First Last"
//   • "F. Last" (initial form)
//   • bare surname (only if it's not a common English word and is unique
//     across both teams' squads, to avoid false positives like "Cook" or "Young").
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMMON_SURNAMES_TO_SKIP = new Set([
  "young", "cook", "may", "fish", "bird", "wood", "hunt", "best", "white", "black",
  "brown", "green", "king", "knight", "rose", "lord", "long", "hill", "ball", "wright",
  "sharp", "small", "smart", "swift", "bright",
]);

type Matcher = {
  player: string; // "First Last"
  re: RegExp;
};

export type SquadInput = {
  team: "home" | "away";
  players: { firstName: string; lastName: string }[];
};

function buildMatchers(squads: SquadInput[]): Matcher[] {
  const matchers: Matcher[] = [];
  // Tally surname occurrences across both squads.
  const surnameCount = new Map<string, number>();
  for (const sq of squads) {
    for (const p of sq.players) {
      const key = (p.lastName ?? "").toLowerCase();
      if (!key) continue;
      surnameCount.set(key, (surnameCount.get(key) ?? 0) + 1);
    }
  }
  for (const sq of squads) {
    for (const p of sq.players) {
      const first = (p.firstName ?? "").trim();
      const last = (p.lastName ?? "").trim();
      if (!first || !last) continue;
      const full = `${first} ${last}`;
      const lastLc = last.toLowerCase();
      const surnameUnique = (surnameCount.get(lastLc) ?? 0) === 1;
      const surnameSafe = surnameUnique && !COMMON_SURNAMES_TO_SKIP.has(lastLc) && last.length >= 5;
      const initial = first[0];
      // Combined regex: full name | "F. Last" | (optional) bare Last
      const parts: string[] = [
        `${escapeRe(first)}\\s+${escapeRe(last)}`,
        `${escapeRe(initial)}\\.?\\s*${escapeRe(last)}`,
      ];
      if (surnameSafe) parts.push(`(?<![A-Za-z])${escapeRe(last)}(?![A-Za-z])`);
      const re = new RegExp(`(?:${parts.join("|")})`, "i");
      matchers.push({ player: full, re });
    }
  }
  return matchers;
}

// Public: returns one ruling per (player, source URL) pair, deduped per player
// (keeping the most recent article).
export async function findNewsRulingsForSquads(squads: SquadInput[]): Promise<NewsRuling[]> {
  if (squads.every((s) => s.players.length === 0)) return [];
  // Cache the news fetch separately from the per-match cross-reference;
  // news.functions.ts already has its own short-lived cache, so we go direct.
  const news = await cached("news-rulings:feed", 5 * 60_000, () => fetchNews());

  const matchers = buildMatchers(squads);
  const byPlayer = new Map<string, NewsRuling>();
  const cutoff = Date.now() - 5 * 24 * 60 * 60_000; // last 5 days only

  for (const item of news) {
    const ts = new Date(item.publishedUtc).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const snippet = findOutSnippet(item.title);
    if (!snippet) continue;
    for (const m of matchers) {
      if (!m.re.test(item.title)) continue;
      const existing = byPlayer.get(m.player);
      if (existing && new Date(existing.publishedUtc).getTime() >= ts) continue;
      byPlayer.set(m.player, {
        playerName: m.player,
        reason: snippet,
        sourceUrl: item.link,
        sourceTitle: item.title,
        source: item.source,
        publishedUtc: item.publishedUtc,
      });
    }
  }
  return Array.from(byPlayer.values());
}
