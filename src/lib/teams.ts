// Canonical NRL team list (2026 season, 17 clubs).
// Maps various name spellings -> canonical nickname + NRL.com theme key (used for logo URL).

export type CanonicalTeam = {
  name: string;        // full name
  nickname: string;    // short
  themeKey: string;    // NRL.com /.theme/{themeKey}/badge.svg
};

const TEAMS: CanonicalTeam[] = [
  { name: "Brisbane Broncos",        nickname: "Broncos",       themeKey: "broncos" },
  { name: "Canberra Raiders",        nickname: "Raiders",       themeKey: "raiders" },
  { name: "Canterbury Bulldogs",     nickname: "Bulldogs",      themeKey: "bulldogs" },
  { name: "Cronulla Sharks",         nickname: "Sharks",        themeKey: "sharks" },
  { name: "Dolphins",                nickname: "Dolphins",      themeKey: "dolphins" },
  { name: "Gold Coast Titans",       nickname: "Titans",        themeKey: "titans" },
  { name: "Manly Sea Eagles",        nickname: "Sea Eagles",    themeKey: "sea-eagles" },
  { name: "Melbourne Storm",         nickname: "Storm",         themeKey: "storm" },
  { name: "Newcastle Knights",       nickname: "Knights",       themeKey: "knights" },
  { name: "New Zealand Warriors",    nickname: "Warriors",      themeKey: "warriors" },
  { name: "North Queensland Cowboys",nickname: "Cowboys",       themeKey: "cowboys" },
  { name: "Parramatta Eels",         nickname: "Eels",          themeKey: "eels" },
  { name: "Penrith Panthers",        nickname: "Panthers",      themeKey: "panthers" },
  { name: "South Sydney Rabbitohs",  nickname: "Rabbitohs",     themeKey: "rabbitohs" },
  { name: "St George Illawarra Dragons", nickname: "Dragons",   themeKey: "dragons" },
  { name: "Sydney Roosters",         nickname: "Roosters",      themeKey: "roosters" },
  { name: "Wests Tigers",            nickname: "Wests Tigers",  themeKey: "wests-tigers" },
];

// Aliases used by The Odds API / other sources -> canonical nickname
const ALIASES: Record<string, string> = {
  "brisbane broncos": "Broncos",
  "canberra raiders": "Raiders",
  "canterbury-bankstown bulldogs": "Bulldogs",
  "canterbury bulldogs": "Bulldogs",
  "cronulla-sutherland sharks": "Sharks",
  "cronulla sharks": "Sharks",
  "the dolphins": "Dolphins",
  "redcliffe dolphins": "Dolphins",
  "gold coast titans": "Titans",
  "manly-warringah sea eagles": "Sea Eagles",
  "manly sea eagles": "Sea Eagles",
  "melbourne storm": "Storm",
  "newcastle knights": "Knights",
  "new zealand warriors": "Warriors",
  "nz warriors": "Warriors",
  "north queensland cowboys": "Cowboys",
  "parramatta eels": "Eels",
  "penrith panthers": "Panthers",
  "south sydney rabbitohs": "Rabbitohs",
  "st george illawarra dragons": "Dragons",
  "st. george illawarra dragons": "Dragons",
  "sydney roosters": "Roosters",
  "wests tigers": "Wests Tigers",
};

export function findTeam(input: string): CanonicalTeam | null {
  const k = input.trim().toLowerCase();
  // Direct alias
  const alias = ALIASES[k];
  if (alias) {
    const t = TEAMS.find((x) => x.nickname === alias);
    if (t) return t;
  }
  // Match by nickname
  let t = TEAMS.find((x) => x.nickname.toLowerCase() === k);
  if (t) return t;
  // Match by name
  t = TEAMS.find((x) => x.name.toLowerCase() === k);
  if (t) return t;
  // Substring on nickname
  t = TEAMS.find((x) => k.includes(x.nickname.toLowerCase()));
  if (t) return t;
  return null;
}

// Clubs whose NRL.com theme does NOT publish a `badge-light.svg` variant.
// For these we always fall back to the standard `badge.svg`.
const NO_LIGHT_BADGE = new Set(["roosters", "eels"]);

export function logoUrl(themeKey: string, light = false): string {
  const useLight = light && !NO_LIGHT_BADGE.has(themeKey);
  return `https://www.nrl.com/.theme/${themeKey}/badge${useLight ? "-light" : ""}.svg`;
}

export const ALL_TEAMS = TEAMS;
