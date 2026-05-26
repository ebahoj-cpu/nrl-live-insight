// =============================================================================
// NRL.com player profile scraper.
//
// NRL.com does NOT expose a JSON endpoint for player bio + season stats, but
// each public player profile page renders the data in a deterministic
// <dt>/<dd> table that's stable across the site. We fetch the HTML, regex
// out the bio fields (Height / Weight / DOB / Age / Birthplace / Nickname /
// Debut), then walk the stats table for the most recent season totals.
//
// URL pattern: https://www.nrl.com/players/nrl-premiership/{teamKey}/{slug}/
//   where {teamKey} matches the team theme key (e.g. "broncos", "sea-eagles",
//   "wests-tigers") and {slug} is the player's full name lowercased with
//   spaces -> "-" and apostrophes / accents stripped.
//
// Fall back gracefully: any field that can't be parsed becomes null/undefined
// and the UI renders an em-dash.
// =============================================================================

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0; +player-profile)";

export type PlayerSeasonStats = {
  appearances: number;
  tries: number;
  tryAssists: number;
  lineBreaks: number;
  lineBreakAssists: number;
  tackleBreaks: number;
  offloads: number;
  tacklesMade: number;
  tacklesMissed: number;
  totalRunMetres: number;
  averageRunMetres: number;
  postContactMetres: number;
  averageKickingMetres: number;
  goals: number;
  fieldGoals: number;
  forcedDropOuts: number;
  errors: number;
  totalPoints: number;
  averagePoints: number;
  // Best-effort minutes played per game — NRL.com doesn't always publish this,
  // so we leave it null when missing and the Energy modifier defaults to 0%.
  minutesPerGame: number | null;
};

export type PlayerProfile = {
  // Identity
  firstName: string;
  lastName: string;
  position: string | null;
  jerseyNumber: number | null;
  teamNickname: string;
  teamThemeKey: string;
  // Bio
  heightCm: number | null;
  weightKg: number | null;
  dateOfBirth: string | null;       // ISO yyyy-mm-dd if parseable
  age: number | null;
  birthplace: string | null;
  nickname: string | null;
  debutClub: string | null;
  debutDate: string | null;
  // Headshot / body shot — large image preferred
  headshotUrl: string | null;
  bodyImageUrl: string | null;
  // Season stats (current season displayed on the profile)
  seasonStats: PlayerSeasonStats;
  // Career totals (for tenure / Experience bar)
  careerAppearances: number;
  careerTries: number;
  // Provenance
  sourceUrl: string;
  fetchedAt: string;
};

const EMPTY_STATS: PlayerSeasonStats = {
  appearances: 0, tries: 0, tryAssists: 0, lineBreaks: 0, lineBreakAssists: 0,
  tackleBreaks: 0, offloads: 0, tacklesMade: 0, tacklesMissed: 0,
  totalRunMetres: 0, averageRunMetres: 0, postContactMetres: 0,
  averageKickingMetres: 0, goals: 0, fieldGoals: 0, forcedDropOuts: 0,
  errors: 0, totalPoints: 0, averagePoints: 0, minutesPerGame: null,
};

export function playerSlug(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")     // strip accents
    .replace(/['’`.]/g, "")               // strip apostrophes / dots
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function playerProfileUrl(teamThemeKey: string, firstName: string, lastName: string): string {
  return `https://www.nrl.com/players/nrl-premiership/${teamThemeKey}/${playerSlug(firstName, lastName)}/`;
}

function num(s: string | undefined | null): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseBioTable(html: string): Record<string, string> {
  // <dt>Height:</dt> <dd>173 cm</dd>  (whitespace/newlines between)
  const out: Record<string, string> = {};
  const re = /<dt[^>]*>([^<]+)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) != null) {
    const label = m[1].replace(/[:\s]+$/, "").trim();
    const value = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (label && value) out[label] = value;
  }
  return out;
}

function parseStatsTable(html: string): PlayerSeasonStats {
  // The stats list on the profile page uses the same dt/dd pattern but
  // grouped under <section> blocks. We extract every label/value pair and
  // map by label name (case-insensitive, ignoring trailing colons).
  const pairs = parseBioTable(html);
  const get = (label: string): number => num(pairs[label]);
  const stats: PlayerSeasonStats = {
    appearances: get("Appearances"),
    tries: get("Tries"),
    tryAssists: get("Try Assists"),
    lineBreaks: get("Line Breaks"),
    lineBreakAssists: get("Line Break Assists"),
    tackleBreaks: get("Tackle Breaks"),
    offloads: get("Offloads"),
    tacklesMade: get("Tackles Made"),
    tacklesMissed: get("Missed Tackles") || get("Tackles Missed"),
    totalRunMetres: get("Total Running Metres") || get("All Run Metres"),
    averageRunMetres: get("Average Running Metres"),
    postContactMetres: get("Post Contact Metres") || get("Total Post Contact Metres"),
    averageKickingMetres: get("Average Kicking Metres"),
    goals: get("Goals"),
    fieldGoals: get("Field Goals") || get("One Point Field Goals"),
    forcedDropOuts: get("Forced Drop Outs"),
    errors: get("Errors"),
    totalPoints: get("Total Points") || get("Points"),
    averagePoints: get("Average Points"),
    minutesPerGame: pairs["Average Mins Played"] ? num(pairs["Average Mins Played"]) :
                    pairs["Minutes Played"] && get("Appearances") > 0
                      ? get("Minutes Played") / get("Appearances")
                      : null,
  };
  return stats;
}

function extractBodyImage(html: string, teamThemeKey: string): string | null {
  // The hero image lives in a <picture><img src="..."> near the top.
  // NRL.com wraps statsperform URLs via /remote.axd? — unwrap so the browser
  // can load them directly.
  const m = html.match(/<img[^>]+src="([^"]+(?:player-profile|bodyshot|Bodyshot|player-body)[^"]*)"/i);
  if (!m) return null;
  let url = m[1].replace(/&amp;/g, "&");
  const proxy = url.match(/^\/remote\.axd\?(https?:\/\/.+)$/i);
  if (proxy) url = proxy[1];
  url = url.replace(/^http:\/\//i, "https://");
  if (url.startsWith("/")) url = `https://www.nrl.com${url}`;
  // Make sure we get the LARGE preset for the modal
  url = url.replace(/preset=player-profile-small/i, "preset=player-profile-large");
  void teamThemeKey;
  return url;
}

export async function fetchPlayerProfile(args: {
  teamThemeKey: string;
  teamNickname: string;
  firstName: string;
  lastName: string;
  position?: string;
  jerseyNumber?: number;
}): Promise<PlayerProfile> {
  const { teamThemeKey, teamNickname, firstName, lastName, position, jerseyNumber } = args;
  const url = playerProfileUrl(teamThemeKey, firstName, lastName);
  const fallback: PlayerProfile = {
    firstName, lastName, position: position ?? null, jerseyNumber: jerseyNumber ?? null,
    teamNickname, teamThemeKey,
    heightCm: null, weightKg: null, dateOfBirth: null, age: null,
    birthplace: null, nickname: null, debutClub: null, debutDate: null,
    headshotUrl: null, bodyImageUrl: null,
    seasonStats: { ...EMPTY_STATS },
    careerAppearances: 0, careerTries: 0,
    sourceUrl: url, fetchedAt: new Date().toISOString(),
  };

  let res: Response;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 7000);
    res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: controller.signal,
    });
    clearTimeout(t);
  } catch (err) {
    console.warn("player profile fetch failed:", url, err);
    return fallback;
  }
  if (!res.ok) {
    console.warn("player profile HTTP", res.status, url);
    return fallback;
  }
  const html = await res.text();

  const bio = parseBioTable(html);
  // The page contains TWO appearance blocks: the first under "NRL Career"
  // and the second the current season. We use the second occurrence for
  // season stats and the first for career.
  const seasonStats = parseStatsTable(html);
  // Crude career split: re-scan and pick the first "Appearances" / "Tries"
  // occurrence (which is the career block).
  const careerMatch = html.match(/Appearances[^0-9]{0,40}([0-9,]+)[\s\S]{0,200}?Tries[^0-9]{0,40}([0-9,]+)/i);
  const careerAppearances = careerMatch ? num(careerMatch[1]) : 0;
  const careerTries = careerMatch ? num(careerMatch[2]) : 0;

  const heightCm = bio["Height"] ? num(bio["Height"]) : null;
  const weightKg = bio["Weight"] ? num(bio["Weight"]) : null;
  const age = bio["Age"] && /^\d+$/.test(bio["Age"]) ? Number(bio["Age"]) : null;
  // DOB like "10 July 1990" -> ISO
  let dateOfBirth: string | null = null;
  if (bio["Date of Birth"]) {
    const parsed = Date.parse(bio["Date of Birth"]);
    if (Number.isFinite(parsed)) dateOfBirth = new Date(parsed).toISOString().slice(0, 10);
  }

  const bodyImageUrl = extractBodyImage(html, teamThemeKey);

  return {
    firstName, lastName,
    position: bio["Position"] ?? position ?? null,
    jerseyNumber: jerseyNumber ?? null,
    teamNickname, teamThemeKey,
    heightCm, weightKg, dateOfBirth, age,
    birthplace: bio["Birthplace"] ?? null,
    nickname: bio["Nickname"] ?? null,
    debutClub: bio["Debut Club"] ?? null,
    debutDate: bio["Date"] ?? null,
    headshotUrl: bodyImageUrl,    // re-use body image as primary
    bodyImageUrl,
    seasonStats,
    careerAppearances: careerAppearances || seasonStats.appearances,
    careerTries: careerTries || seasonStats.tries,
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
  };
}
