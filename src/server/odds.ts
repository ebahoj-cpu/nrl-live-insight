// ============================================================================
// The Odds API — live AU bookmaker odds for NRL.
// Docs: https://the-odds-api.com/liveapi/guides/v4/
//
// CREDIT-SAVING STRATEGY (free tier = 500 credits / month must last the season)
// ---------------------------------------------------------------------------
// The Odds API charges 1 credit per (region × market) per /odds call. We
// restrict ourselves to ONE region ("au") and only the markets we actually use:
//
//   • h2h                         — head-to-head winner (BULK endpoint)
//   • player_try_scorer_anytime   — anytime tryscorer Yes/No (PER-EVENT only;
//                                   bulk /odds rejects player_* markets with
//                                   422 INVALID_MARKET)
//
// Call pattern:
//   - fetchNrlOdds(): one bulk GET /sports/.../odds with markets=h2h.
//     Cost = 1 credit. Returns every NRL event for the round.
//   - fetchTryscorerOdds(eventId): per-event GET /events/:id/odds with
//     markets=player_try_scorer_anytime. Cost = 1 credit per event, cached
//     per-event with the same kickoff-aware TTL ladder.
//
// TTL ladder (mirrors `teamListTtl` in nrl-data-store):
//   >48h until any kickoff → 15 min
//   ≤48h                   → 5 min
//   ≤12h                   → 2 min
//   ≤3h  (live window)     → 60 s
// A typical 8-match round refresh = 1 (bulk h2h) + 8 (tryscorers) = 9 credits.
// ============================================================================

import { findTeam } from "@/lib/teams";
import type { NrlFixture, NrlLadderRow } from "./nrl";
import { fetchDraw } from "./nrl";
import { readOddsCacheEntry, readOddsCacheStaleEntry, writeOddsCache } from "./odds-store";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "rugbyleague_nrl";
const REGION = "au";
// The bulk /odds endpoint only supports "featured" markets (h2h/spreads/totals).
// Player-prop markets like player_try_scorer_anytime MUST be fetched per-event
// from /events/:id/odds. We request ONLY h2h in bulk (1 credit) and lazily
// fetch tryscorers per event with aggressive caching.
const BULK_MARKETS = "h2h";
const TRYSCORER_MARKET = "player_try_scorer_anytime";
const BULK_CACHE_KEY = "odds:nrl";
const tryscorerCacheKey = (eventId: string) => `odds:nrl:tryscorers:${eventId}`;

export type Outcome = { name: string; price: number; point?: number; description?: string };
export type Market = { key: string; outcomes: Outcome[] };
export type BookmakerOdds = {
  key: string;
  title: string;
  lastUpdate: string;
  markets: Market[];
};

export type OddsEvent = {
  id: string;
  commenceUtc: string;
  homeTeam: string;
  awayTeam: string;
  homeNickname: string | null;
  awayNickname: string | null;
  bookmakers: BookmakerOdds[];
};

function ensureKey(): string {
  // Accept both names — `ODDS_API_KEY` is the existing secret; we also accept
  // `THE_ODDS_API_KEY` for parity with the public env example.
  const k = process.env.ODDS_API_KEY ?? process.env.THE_ODDS_API_KEY;
  if (!k) throw new Error("ODDS_API_KEY (or THE_ODDS_API_KEY) not configured");
  return k;
}

// ---------------------------------------------------------------------------
// Aggressive TTL — identical ladder to teamListTtl in nrl-data-store.ts.
// Takes the *minimum* TTL across all upcoming kickoffs in the next 48h so the
// closest match drives our refresh cadence. The bulk endpoint covers every
// fixture in one request, so a single short TTL doesn't multiply credit cost.
// ---------------------------------------------------------------------------
const MIN = 60_000;
const HOUR = 60 * MIN;

export function oddsTtl(kickoffsUtc?: string[] | string): number {
  const list = Array.isArray(kickoffsUtc) ? kickoffsUtc : kickoffsUtc ? [kickoffsUtc] : [];
  if (list.length === 0) return 15 * MIN;
  const now = Date.now();
  let minHours = Infinity;
  for (const ko of list) {
    const t = Date.parse(ko);
    if (!Number.isFinite(t)) continue;
    const hours = (t - now) / HOUR;
    // Ignore matches that already finished long ago (>4h past kickoff).
    if (hours < -4) continue;
    if (hours < minHours) minHours = hours;
  }
  if (!Number.isFinite(minHours)) return 15 * MIN;
  if (minHours <= 3) return 60_000;       // 60s — late mail / live window
  if (minHours <= 12) return 2 * MIN;     // match-day
  if (minHours <= 48) return 5 * MIN;     // Tue/Wed/Thu — team lists dropping
  return 15 * MIN;                        // early week
}

// ---------------------------------------------------------------------------
// Bulk fetch — ONE network call, TWO markets, ONE region.
// All downstream helpers (getNrlOdds, fetchTryscorerOdds) read from the cache
// this writes, so we never pay credits per-match.
// ---------------------------------------------------------------------------
export async function fetchNrlOdds(): Promise<OddsEvent[]> {
  const key = ensureKey();
  const url = `${BASE}/sports/${SPORT}/odds/?apiKey=${key}&regions=${REGION}&markets=${BULK_MARKETS}&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API HTTP ${res.status}`);
  const data = (await res.json()) as unknown[];
  const events = (data as Array<Record<string, unknown>>).map(mapEvent);
  // Persist immediately so cold-start workers see fresh data without re-billing.
  // TTL derived from the events' own kickoffs.
  const ttl = oddsTtl(events.map((e) => e.commenceUtc));
  await writeOddsCache(BULK_CACHE_KEY, events, ttl).catch(() => {});
  return events;
}

// ---------------------------------------------------------------------------
// Round-wide soft refresh — mirrors maybeSweepRoundTeamLists.
// When ANY match's odds are requested, we touch the bulk payload once. The
// bulk call already covers every match in the round, so this is effectively a
// throttled "refresh the round" operation. Throttled to once per round per 2m.
// ---------------------------------------------------------------------------
const roundOddsSweepAt = new Map<string, number>();
const ROUND_SWEEP_INTERVAL_MS = 2 * MIN;

async function maybeSweepRoundOdds(triggerMatchId: string): Promise<void> {
  const parts = triggerMatchId.split("/");
  const season = Number(parts[0]);
  const round = Number((parts[1] ?? "").replace(/\D/g, ""));
  if (!Number.isFinite(season) || !Number.isFinite(round)) return;
  const roundKey = `${season}:${round}`;
  const last = roundOddsSweepAt.get(roundKey) ?? 0;
  if (Date.now() - last < ROUND_SWEEP_INTERVAL_MS) return;
  roundOddsSweepAt.set(roundKey, Date.now());

  // Check current cache freshness; only refetch if expired or close to it.
  const fresh = await readOddsCacheEntry<OddsEvent[]>(BULK_CACHE_KEY).catch(() => null);
  if (fresh) {
    // Already fresh — no need to spend a credit.
    return;
  }
  // Background refetch; errors swallowed.
  await fetchNrlOdds().catch(() => {});
}

// ---------------------------------------------------------------------------
// Canonical accessor used everywhere downstream. Returns the OddsEvent for a
// specific NRL match id, reading from cache and triggering a soft round
// refresh in the background. Never throws — graceful fallback to null lets
// callers render "Odds temporarily unavailable" if credits are exhausted.
// ---------------------------------------------------------------------------
export async function getNrlOdds(matchId: string): Promise<OddsEvent | null> {
  // 1. Fresh cache hit — instant.
  let events: OddsEvent[] | null = null;
  const freshEntry = await readOddsCacheEntry<OddsEvent[]>(BULK_CACHE_KEY).catch(() => null);
  if (freshEntry) events = freshEntry.payload;

  // 2. No fresh data — try live. If that fails, fall back to stale cache.
  if (!events) {
    try {
      events = await fetchNrlOdds();
    } catch {
      const stale = await readOddsCacheStaleEntry<OddsEvent[]>(BULK_CACHE_KEY).catch(() => null);
      events = stale?.payload ?? null;
    }
  }

  // 3. Fire-and-forget round sweep (throttled, no-op if cache is still fresh).
  void maybeSweepRoundOdds(matchId).catch(() => {});

  if (!events || events.length === 0) return null;
  return matchEventToFixture(events, matchId);
}

// Match a NRL match id (e.g. "2026/round-8/storm-v-broncos") to its Odds API
// event by team nickname. Returns null if no event matches.
async function matchEventToFixture(events: OddsEvent[], matchId: string): Promise<OddsEvent | null> {
  // Try to look up fixture details to resolve team nicknames precisely.
  const parts = matchId.split("/");
  const season = Number(parts[0]);
  const draw = await fetchDraw(season).catch(() => [] as NrlFixture[]);
  const fixture = draw.find((f) => f.matchId === matchId);
  if (!fixture) return null;
  const home = findTeam(fixture.homeTeam.nickName)?.nickname ?? fixture.homeTeam.nickName;
  const away = findTeam(fixture.awayTeam.nickName)?.nickname ?? fixture.awayTeam.nickName;
  return (
    events.find((e) => {
      const eh = e.homeNickname;
      const ea = e.awayNickname;
      return (eh === home && ea === away) || (eh === away && ea === home);
    }) ?? null
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function fairPrice(probability: number): number {
  return Number((1 / clamp(probability, 0.05, 0.95)).toFixed(2));
}

function teamStrength(row?: NrlLadderRow): number {
  if (!row || row.played === 0) return 0;
  const winRate = (row.wins + row.drawn * 0.5) / row.played;
  const differential = row.diff / Math.max(1, row.played);
  return (winRate - 0.5) * 18 + differential * 0.35;
}

function avgPoints(home?: NrlLadderRow, away?: NrlLadderRow): number {
  const rows = [home, away].filter((r): r is NrlLadderRow => !!r && r.played > 0);
  if (rows.length === 0) return 43.5;
  const total = rows.reduce((sum, r) => sum + (r.for + r.against) / r.played, 0);
  return total / rows.length;
}

// Estimated odds (free fallback — no API cost). Still emits spreads/totals
// markets so downstream consumers that look for them don't break when live
// bookmaker data is unavailable.
export function buildEstimatedOdds(fixtures: NrlFixture[], ladder: NrlLadderRow[]): OddsEvent[] {
  const ladderByNick = new Map(ladder.map((r) => [findTeam(r.nickname)?.nickname ?? r.nickname, r]));
  return fixtures
    .filter((f) => !/full\s*time|fulltime|final|completed/i.test(f.matchState))
    .map((f) => {
      const home = findTeam(f.homeTeam.nickName)?.nickname ?? f.homeTeam.nickName;
      const away = findTeam(f.awayTeam.nickName)?.nickname ?? f.awayTeam.nickName;
      const homeRow = ladderByNick.get(home);
      const awayRow = ladderByNick.get(away);
      const homeStrength = teamStrength(homeRow) + 1.5;
      const awayStrength = teamStrength(awayRow);
      const diff = homeStrength - awayStrength;
      const homeProb = clamp(0.5 + diff * 0.018, 0.25, 0.75);
      const awayProb = 1 - homeProb;
      const homePrice = fairPrice(homeProb);
      const awayPrice = fairPrice(awayProb);
      const spread = Math.round(Math.abs(diff) * 1.35 * 2) / 2;
      const total = Math.round(clamp(avgPoints(homeRow, awayRow), 36, 52) * 2) / 2;
      const homePoint = diff >= 0 ? -spread : spread;
      const awayPoint = -homePoint;
      const book = "Model estimate";

      return {
        id: `estimate:${f.matchId}`,
        commenceUtc: f.kickoffUtc,
        homeTeam: f.homeTeam.nickName,
        awayTeam: f.awayTeam.nickName,
        homeNickname: home,
        awayNickname: away,
        bookmakers: [{
          key: "model_estimate",
          title: book,
          lastUpdate: new Date().toISOString(),
          markets: [
            { key: "h2h", outcomes: [{ name: home, price: homePrice }, { name: away, price: awayPrice }] },
            { key: "spreads", outcomes: [{ name: home, price: 1.91, point: homePoint }, { name: away, price: 1.91, point: awayPoint }] },
            { key: "totals", outcomes: [{ name: "Over", price: 1.91, point: total }, { name: "Under", price: 1.91, point: total }] },
          ],
        }],
      } satisfies OddsEvent;
    });
}

// ---------------------------------------------------------------------------
// fetchEventOdds — kept for backwards compatibility but now reads from the
// bulk cache. We no longer hit the per-event /events/:id/odds endpoint (used
// to burn 1 credit per call per event). Triggers a bulk refresh on miss.
// ---------------------------------------------------------------------------
export async function fetchEventOdds(eventId: string): Promise<OddsEvent | null> {
  const fresh = await readOddsCacheEntry<OddsEvent[]>(BULK_CACHE_KEY).catch(() => null);
  let events = fresh?.payload ?? null;
  if (!events) {
    try { events = await fetchNrlOdds(); }
    catch {
      const stale = await readOddsCacheStaleEntry<OddsEvent[]>(BULK_CACHE_KEY).catch(() => null);
      events = stale?.payload ?? null;
    }
  }
  return events?.find((e) => e.id === eventId) ?? null;
}

// ---------------------------------------------------------------------------
// Tryscorer markets — fetched per-event from /events/:id/odds (bulk /odds
// does NOT accept player_*  markets, only featured h2h/spreads/totals).
// Each call costs 1 credit per region per market = 1 credit. We cache each
// event's tryscorer payload with the same kickoff-aware TTL ladder used for
// h2h so a typical round only burns ~8 credits per refresh cycle.
// Only `anytime` is requested; `first`/`multi` stay [] for shape parity.
// ---------------------------------------------------------------------------
export type TryscorerOdds = {
  player: string;
  price: number;
  book: string;
};

export type TryscorerMarkets = {
  first: TryscorerOdds[];   // always [] — not fetched (saves credits)
  anytime: TryscorerOdds[]; // populated from per-event /events/:id/odds call
  multi: TryscorerOdds[];   // always [] — not fetched (saves credits)
  hasAny: boolean;
  lastUpdate: string | null;
};

async function fetchEventTryscorerLive(eventId: string): Promise<OddsEvent | null> {
  const key = ensureKey();
  const url = `${BASE}/sports/${SPORT}/events/${eventId}/odds/?apiKey=${key}&regions=${REGION}&markets=${TRYSCORER_MARKET}&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return mapEvent(data);
}

export async function fetchTryscorerOdds(eventId: string): Promise<TryscorerMarkets> {
  const empty: TryscorerMarkets = { first: [], anytime: [], multi: [], hasAny: false, lastUpdate: null };
  const cacheKey = tryscorerCacheKey(eventId);

  // 1. Fresh cache for this event.
  let event: OddsEvent | null = null;
  const fresh = await readOddsCacheEntry<OddsEvent>(cacheKey).catch(() => null);
  if (fresh) event = fresh.payload;

  // 2. Miss → live per-event fetch (1 credit). Fall back to stale on error.
  if (!event) {
    try {
      event = await fetchEventTryscorerLive(eventId);
      if (event) {
        const ttl = oddsTtl(event.commenceUtc);
        await writeOddsCache(cacheKey, event, ttl).catch(() => {});
      }
    } catch {
      const stale = await readOddsCacheStaleEntry<OddsEvent>(cacheKey).catch(() => null);
      event = stale?.payload ?? null;
    }
  }
  if (!event) return empty;

  // Best (highest) price per player across all bookies for anytime markets.
  const best = new Map<string, TryscorerOdds>();
  let lastUpdate: string | null = null;

  for (const b of event.bookmakers) {
    for (const m of b.markets) {
      if (m.key !== "player_try_scorer_anytime") continue;
      if (!lastUpdate || b.lastUpdate > lastUpdate) lastUpdate = b.lastUpdate;
      for (const o of m.outcomes) {
        // "Yes" outcomes carry the player in `description`; some books put it in `name`.
        const player: string | undefined =
          o.description ?? (o.name !== "Yes" && o.name !== "No" ? o.name : undefined);
        if (!player || typeof o.price !== "number") continue;
        const existing = best.get(player);
        if (!existing || o.price > existing.price) {
          best.set(player, { player, price: o.price, book: b.title });
        }
      }
    }
  }

  const anytime = Array.from(best.values()).sort((a, b) => a.price - b.price);
  return {
    first: [],
    anytime,
    multi: [],
    hasAny: anytime.length > 0,
    lastUpdate,
  };
}

function mapEvent(e: Record<string, unknown>): OddsEvent {
  const eAny = e as {
    id: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers?: Array<{
      key: string;
      title: string;
      last_update: string;
      markets?: Array<{ key: string; outcomes?: Array<{ name: string; price: number; point?: number; description?: string }> }>;
    }>;
  };
  return {
    id: eAny.id,
    commenceUtc: eAny.commence_time,
    homeTeam: eAny.home_team,
    awayTeam: eAny.away_team,
    homeNickname: findTeam(eAny.home_team)?.nickname ?? null,
    awayNickname: findTeam(eAny.away_team)?.nickname ?? null,
    bookmakers: (eAny.bookmakers ?? []).map((b) => ({
      key: b.key,
      title: b.title,
      lastUpdate: b.last_update,
      markets: (b.markets ?? []).map((m) => ({
        key: m.key,
        outcomes: (m.outcomes ?? []).map((o) => ({
          name: o.name, price: o.price, point: o.point, description: o.description,
        })),
      })),
    })),
  };
}

// Helper: best price for each side from H2H across bookmakers
export function bestH2H(ev: OddsEvent): { home: { price: number; book: string } | null; away: { price: number; book: string } | null } {
  const best: { home: { price: number; book: string } | null; away: { price: number; book: string } | null } = { home: null, away: null };
  for (const b of ev.bookmakers) {
    const h2h = b.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    for (const o of h2h.outcomes) {
      const isHome = findTeam(o.name)?.nickname === ev.homeNickname;
      const slot = isHome ? "home" : "away";
      const current = best[slot];
      if (!current || o.price > current.price) {
        best[slot] = { price: o.price, book: b.title };
      }
    }
  }
  return best;
}
