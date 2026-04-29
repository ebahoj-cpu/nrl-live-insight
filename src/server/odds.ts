// The Odds API — live AU bookmaker odds for NRL.
// Docs: https://the-odds-api.com/liveapi/guides/v4/
// Confirmed available: h2h, spreads, totals (always)
// Player markets (released ~24h before kickoff once team lists drop):
//   player_try_scorer_first, player_try_scorer_anytime, player_try_scorer_over

import { findTeam } from "@/lib/teams";
import type { NrlFixture, NrlLadderRow } from "./nrl";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "rugbyleague_nrl";

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
  const k = process.env.ODDS_API_KEY;
  if (!k) throw new Error("ODDS_API_KEY not configured");
  return k;
}

export async function fetchNrlOdds(): Promise<OddsEvent[]> {
  const key = ensureKey();
  const url = `${BASE}/sports/${SPORT}/odds/?apiKey=${key}&regions=au&markets=h2h,spreads,totals&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API HTTP ${res.status}`);
  const data = await res.json() as any[];
  return data.map(mapEvent);
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

export async function fetchEventOdds(eventId: string): Promise<OddsEvent | null> {
  const key = ensureKey();
  const url = `${BASE}/sports/${SPORT}/events/${eventId}/odds/?apiKey=${key}&regions=au&markets=h2h,spreads,totals&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as any;
  return mapEvent(data);
}

// Player tryscorer markets — only released by bookies once team lists drop
// (typically ~24h before kickoff). Returns null if no markets exist yet.
export type TryscorerOdds = {
  player: string;
  price: number;
  book: string;
};

export type TryscorerMarkets = {
  first: TryscorerOdds[];   // first tryscorer
  anytime: TryscorerOdds[]; // anytime tryscorer
  multi: TryscorerOdds[];   // 2+ tries
  hasAny: boolean;
  lastUpdate: string | null;
};

export async function fetchTryscorerOdds(eventId: string): Promise<TryscorerMarkets> {
  const key = ensureKey();
  const markets = "player_try_scorer_first,player_try_scorer_anytime,player_try_scorer_over";
  const url = `${BASE}/sports/${SPORT}/events/${eventId}/odds/?apiKey=${key}&regions=au&markets=${markets}&oddsFormat=decimal`;

  const res = await fetch(url);
  const empty: TryscorerMarkets = { first: [], anytime: [], multi: [], hasAny: false, lastUpdate: null };
  if (!res.ok) return empty;

  const data = await res.json() as any;
  const bookmakers: any[] = data?.bookmakers ?? [];
  if (bookmakers.length === 0) return empty;

  // Best price per player per market across all bookies
  const best: Record<"first" | "anytime" | "multi", Map<string, TryscorerOdds>> = {
    first: new Map(), anytime: new Map(), multi: new Map(),
  };
  let lastUpdate: string | null = null;

  for (const b of bookmakers) {
    for (const m of b.markets ?? []) {
      const slot: "first" | "anytime" | "multi" | null =
        m.key === "player_try_scorer_first" ? "first" :
        m.key === "player_try_scorer_anytime" ? "anytime" :
        m.key === "player_try_scorer_over" ? "multi" : null;
      if (!slot) continue;
      if (!lastUpdate || m.last_update > lastUpdate) lastUpdate = m.last_update;

      for (const o of m.outcomes ?? []) {
        // "Yes" outcomes carry the player in `description`. Some books put it in `name`.
        const player: string | undefined = o.description ?? (o.name !== "Yes" && o.name !== "No" ? o.name : undefined);
        if (!player || typeof o.price !== "number") continue;
        // For "over" markets, only keep 1.5 line (i.e. 2+ tries / double)
        if (slot === "multi" && o.point != null && o.point !== 1.5) continue;

        const existing = best[slot].get(player);
        if (!existing || o.price > existing.price) {
          best[slot].set(player, { player, price: o.price, book: b.title });
        }
      }
    }
  }

  const sortByPrice = (a: TryscorerOdds, b: TryscorerOdds) => a.price - b.price;
  const out: TryscorerMarkets = {
    first: Array.from(best.first.values()).sort(sortByPrice).slice(0, 12),
    // Return ALL anytime tryscorers (typically 30-36 players across both squads).
    anytime: Array.from(best.anytime.values()).sort(sortByPrice),
    multi: Array.from(best.multi.values()).sort(sortByPrice).slice(0, 12),
    hasAny: false,
    lastUpdate,
  };
  out.hasAny = out.first.length + out.anytime.length + out.multi.length > 0;
  return out;
}

function mapEvent(e: any): OddsEvent {
  return {
    id: e.id,
    commenceUtc: e.commence_time,
    homeTeam: e.home_team,
    awayTeam: e.away_team,
    homeNickname: findTeam(e.home_team)?.nickname ?? null,
    awayNickname: findTeam(e.away_team)?.nickname ?? null,
    bookmakers: (e.bookmakers ?? []).map((b: any) => ({
      key: b.key,
      title: b.title,
      lastUpdate: b.last_update,
      markets: (b.markets ?? []).map((m: any) => ({
        key: m.key,
        outcomes: (m.outcomes ?? []).map((o: any) => ({
          name: o.name, price: o.price, point: o.point, description: o.description,
        })),
      })),
    })),
  };
}

// Helper: best price for each side from H2H across bookmakers
export function bestH2H(ev: OddsEvent): { home: { price: number; book: string } | null; away: { price: number; book: string } | null } {
  let best: { home: any; away: any } = { home: null, away: null };
  for (const b of ev.bookmakers) {
    const h2h = b.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    for (const o of h2h.outcomes) {
      const isHome = findTeam(o.name)?.nickname === ev.homeNickname;
      const slot = isHome ? "home" : "away";
      if (!best[slot] || o.price > best[slot].price) {
        best[slot] = { price: o.price, book: b.title };
      }
    }
  }
  return best;
}
