// The Odds API — live AU bookmaker odds for NRL.
// Docs: https://the-odds-api.com/liveapi/guides/v4/
// Markets confirmed available: h2h, spreads (line), totals (over/under).
// NOTE: Player props (try scorers etc.) are NOT offered by any region for NRL.

import { findTeam } from "@/lib/teams";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "rugbyleague_nrl";

export type Outcome = { name: string; price: number; point?: number };
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

export async function fetchEventOdds(eventId: string): Promise<OddsEvent | null> {
  const key = ensureKey();
  const url = `${BASE}/sports/${SPORT}/events/${eventId}/odds/?apiKey=${key}&regions=au&markets=h2h,spreads,totals&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as any;
  return mapEvent(data);
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
          name: o.name, price: o.price, point: o.point,
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
