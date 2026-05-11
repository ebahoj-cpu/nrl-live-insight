// ============================================================================
// Normalised NRL data types.
//
// Every consumer of NRL data (insights engine, simulation engine, fair-odds,
// Bets tab, Script tab) MUST go through these shapes. Raw NRL.com or Zyla
// payloads never leak past the data layer.
//
// Each normalised object carries a `coverage` block describing which sources
// contributed and which fields are missing. This is what powers the
// confidence system downstream — a prediction with cache-only coverage and
// 4 missing fields will be downgraded to "low" confidence regardless of how
// strong the model output looks on paper.
// ============================================================================

export type DataSource = "nrl.com" | "zyla" | "merged" | "cache" | "fallback";

export type SourceCoverage = {
  primary: DataSource;
  sourcesUsed: DataSource[];
  missingFields: string[];
  // ISO timestamp of when the underlying source was last fetched fresh.
  lastUpdated: string;
  // Optional discrepancy / informational notes captured during merge.
  notes?: string[];
};

// ---------- Fixtures ----------
export type NormalisedFixture = {
  matchId: string;
  season: number;
  round: number;
  kickoffUtc: string;
  venue: string;
  homeTeamId: number;
  homeNickname: string;
  homeThemeKey: string;
  awayTeamId: number;
  awayNickname: string;
  awayThemeKey: string;
  status: "scheduled" | "live" | "completed" | "postponed" | "unknown";
  homeScore?: number;
  awayScore?: number;
  coverage: SourceCoverage;
};

// ---------- Ladder ----------
export type NormalisedLadderRow = {
  position: number;
  teamId: number;
  nickname: string;
  themeKey: string;
  played: number;
  wins: number;
  losses: number;
  drawn: number;
  byes: number;
  points: number;
  pointsFor: number;
  pointsAgainst: number;
  pointsDiff: number;
};

export type NormalisedLadder = {
  season: number;
  rows: NormalisedLadderRow[];
  coverage: SourceCoverage;
};

// ---------- Players & squads ----------
export type NormalisedPlayer = {
  playerId: number;
  firstName: string;
  lastName: string;
  position: string;
  jerseyNumber?: number;
  teamNickname: string;
  headshotUrl?: string;
};

export type NormalisedTeamList = {
  matchId: string;
  teamNickname: string;
  players: NormalisedPlayer[];
  // True when ≥13 players have a position assigned (i.e. team list released).
  isNamed: boolean;
  // Optional late mail / changes detected vs the original named squad.
  changes?: { in: NormalisedPlayer[]; out: NormalisedPlayer[] };
  coverage: SourceCoverage;
};

// ---------- Player & team stats ----------
export type NormalisedPlayerStats = {
  playerId: number;
  name: string;
  teamNickname: string;
  position: string;
  appearances: number;
  tries: number;
  tryAssists: number;
  lineBreaks: number;
  lineBreakAssists: number;
  tackleBreaks: number;
  offloads: number;
  runMetres: number;
  postContactMetres: number;
  // Per-game derived rates (computed once)
  triesPerGame: number;
  lineBreaksPerGame: number;
  runMetresPerGame: number;
};

export type NormalisedTeamStats = {
  nickname: string;
  themeKey: string;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  triesFor: number;
  triesAgainst: number;
  // Per-game rates
  ppgFor: number;
  ppgAgainst: number;
  triesPerGame: number;
  triesAgainstPerGame: number;
  // Possession / territory
  completionRate: number;       // 0..1
  errorsPerGame: number;
  penaltiesPerGame: number;
  runMetresPerGame: number;
  postContactMetresPerGame: number;
  tackleBreaksPerGame: number;
  lineBreaksPerGame: number;
  // Recent form: -1 (5 losses) .. +1 (5 wins)
  recentForm: number;
  // Last 5 W/L/D
  last5: ("W" | "L" | "D")[];
};

// ---------- Match-level enrichment ----------
export type NormalisedMatchOfficial = {
  role: "referee" | "touchJudge" | "videoRef" | "other";
  name: string;
  // When known: per-game tendencies. Optional — neutral weighting otherwise.
  penaltiesPerGame?: number;
  sixAgainsPerGame?: number;
  sinBinsPerGame?: number;
  averageTotal?: number;
  homeBias?: number;            // -1..+1; positive = leans toward home
};

export type NormalisedInjury = {
  playerId?: number;
  name: string;
  teamNickname: string;
  status: "out" | "doubtful" | "test" | "available";
  detail?: string;
};

export type NormalisedMatchResult = {
  matchId: string;
  homeScore: number;
  awayScore: number;
  winner: "home" | "away" | "draw";
  margin: number;               // signed: positive = home win
  totalPoints: number;
  htHomeScore: number;
  htAwayScore: number;
  htft: string;                 // e.g. "home/home", "away/home" (HT/FT)
  firstTryScorer?: { playerId: number; name: string; teamNickname: string };
  tryScorers: { playerId: number; name: string; teamNickname: string; minute: number }[];
};

// ---------- Odds ----------
export type NormalisedOddsLine = {
  selection: string;
  price: number;                // decimal odds
  point?: number;               // for spreads / totals
};

export type NormalisedOdds = {
  matchId: string;
  bookmaker: string;
  lastUpdated: string;
  h2h?: { home?: NormalisedOddsLine; away?: NormalisedOddsLine; draw?: NormalisedOddsLine };
  totals?: NormalisedOddsLine[];
  spreads?: NormalisedOddsLine[];
  anytimeTryscorer?: NormalisedOddsLine[];
  firstTryscorer?: NormalisedOddsLine[];
};
