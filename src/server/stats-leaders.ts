// Scrape NRL.com /stats/ leaderboards (top 5 per category) from the embedded
// Vue q-data JSON, then resolve a single player's ranking in each category.
//
// Cached for 1h per (competition, season).

import { cached } from "./cache";
import { playerSlug } from "./player-profile";

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0; +stats-leaders)";

export type Leader = {
  firstName: string;
  lastName: string;
  teamNickName: string;
  url: string;
  playerId: number;
  teamId: number;
  value: string | number;
};

export type LeaderboardGroup = {
  section: string;       // e.g. "Scoring"
  title: string;         // e.g. "Tries"
  statId: number;
  leaders: Leader[];
};

export type PlayerRanking = {
  section: string;
  title: string;
  statId: number;
  rank: number;          // 1-based
  value: string;         // raw value shown on NRL.com
};

export type Leaderboards = {
  fetchedAt: string;
  groups: LeaderboardGroup[];
};

const EMPTY: Leaderboards = { fetchedAt: new Date(0).toISOString(), groups: [] };

function htmlUnescape(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Extract the JSON payload from `q-data="..."` on the <div id="vue-stats">
// element. The attribute is HTML-escaped and can be ~280KB, so we locate it
// by string scan and then run JSON.parse — which stops at the first balanced
// closing brace and ignores any trailing `"></div>` content.
function extractQData(html: string): unknown | null {
  const anchor = html.indexOf('id="vue-stats"');
  if (anchor < 0) return null;
  const qd = html.indexOf('q-data="', anchor);
  if (qd < 0) return null;
  const tail = html.slice(qd + 'q-data="'.length);
  try {
    return JSON.parse(htmlUnescape(tail));
  } catch {
    // JSON.parse is tolerant of trailing garbage after a complete value — but
    // some V8 builds throw. Fall back to a manual brace walker.
  }
  // Manual scan: find matching '}' for the leading '{', respecting strings.
  let depth = 0;
  let inStr = false;
  let esc = false;
  let i = 0;
  for (; i < tail.length; i++) {
    const c = tail[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"' || c === "&" /* &quot; */) {
      // approximate: treat &quot; (decoded to ") as string delimiter
      if (c === "&" && tail.startsWith("&quot;", i)) {
        inStr = !inStr;
        i += 5;
        continue;
      }
      if (c === '"') inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  try {
    return JSON.parse(htmlUnescape(tail.slice(0, i)));
  } catch {
    return null;
  }
}

export async function fetchLeaderboards(
  competition = 111,
  season = 2026,
): Promise<Leaderboards> {
  const url = `https://www.nrl.com/stats/?competition=${competition}&season=${season}`;
  let res: Response;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: controller.signal,
    });
    clearTimeout(t);
  } catch (err) {
    console.warn("stats leaderboards fetch failed:", err);
    return EMPTY;
  }
  if (!res.ok) {
    console.warn("stats leaderboards HTTP", res.status);
    return EMPTY;
  }
  const html = await res.text();
  const data = extractQData(html) as
    | { playerStats?: { title: string; groups: { title: string; statId: number; leaders: Leader[] }[] }[] }
    | null;
  if (!data?.playerStats) return EMPTY;

  const groups: LeaderboardGroup[] = [];
  for (const sec of data.playerStats) {
    for (const g of sec.groups ?? []) {
      groups.push({
        section: sec.title,
        title: g.title,
        statId: g.statId,
        leaders: (g.leaders ?? []).map((l) => ({
          firstName: l.firstName,
          lastName: l.lastName,
          teamNickName: l.teamNickName,
          url: l.url,
          playerId: l.playerId,
          teamId: l.teamId,
          value: l.value,
        })),
      });
    }
  }
  return { fetchedAt: new Date().toISOString(), groups };
}

export async function getLeaderboards(
  competition = 111,
  season = 2026,
  bypass = false,
): Promise<Leaderboards> {
  return cached(
    `statsLeaders:${competition}:${season}`,
    60 * 60_000,
    () => fetchLeaderboards(competition, season),
    { bypass },
  );
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`.]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

// Find every category in which this player appears (top 5 leaderboard),
// and return their 1-based rank + raw value.
export function rankingsForPlayer(
  boards: Leaderboards,
  firstName: string,
  lastName: string,
  teamThemeKey?: string,
): PlayerRanking[] {
  const slug = playerSlug(firstName, lastName);
  const fn = normalize(firstName);
  const ln = normalize(lastName);
  const team = teamThemeKey ? teamThemeKey.toLowerCase() : null;

  const out: PlayerRanking[] = [];
  for (const g of boards.groups) {
    const idx = g.leaders.findIndex((l) => {
      // Primary: match by URL slug (most robust)
      if (l.url && l.url.toLowerCase().includes(`/${slug}/`)) return true;
      // Fallback: first+last name match, optional team filter
      const lfn = normalize(l.firstName || "");
      const lln = normalize(l.lastName || "");
      if (lfn === fn && lln === ln) {
        if (!team) return true;
        return l.url ? l.url.toLowerCase().includes(`/${team}/`) : true;
      }
      return false;
    });
    if (idx >= 0) {
      const lead = g.leaders[idx];
      out.push({
        section: g.section,
        title: g.title,
        statId: g.statId,
        rank: idx + 1,
        value: String(lead.value),
      });
    }
  }
  return out;
}

// Build a player-keyed map of top-5 leaderboard finishes. Keyed by URL slug
// (primary) and a normalised "firstname lastname" key (fallback) so insights
// callers can look up either way. Used by the insights engine to apply a
// scoring boost to players ranked in attack-oriented categories.
export type PlayerLeaderboardMap = Map<string, { title: string; rank: number; value: string }[]>;

export function buildPlayerLeaderboardMap(boards: Leaderboards): PlayerLeaderboardMap {
  const map: PlayerLeaderboardMap = new Map();
  const push = (key: string, entry: { title: string; rank: number; value: string }) => {
    const arr = map.get(key) ?? [];
    arr.push(entry);
    map.set(key, arr);
  };
  for (const g of boards.groups) {
    g.leaders.forEach((l, idx) => {
      const entry = { title: g.title, rank: idx + 1, value: String(l.value) };
      if (l.url) {
        // URL form: /players/{team}/{slug}/ — pull the slug segment.
        const parts = l.url.split("/").filter(Boolean);
        const slug = parts[parts.length - 1];
        if (slug) push(slug.toLowerCase(), entry);
      }
      const nameKey = `${normalize(l.firstName || "")} ${normalize(l.lastName || "")}`.trim();
      if (nameKey) push(nameKey, entry);
    });
  }
  return map;
}
