// Client-safe odds types + pure helpers. Mirrors a subset of `src/server/odds.ts`
// so the match route (and other client components) can import without dragging
// in the server-only Supabase admin client (blocked from client bundles).
import { findTeam } from "@/lib/teams";

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

export type TryscorerOdds = {
  player: string;
  price: number;
  book: string;
};

export type TryscorerMarkets = {
  anytime: TryscorerOdds[];
  first?: TryscorerOdds[];
  last?: TryscorerOdds[];
};

export function bestH2H(ev: OddsEvent): {
  home: { price: number; book: string } | null;
  away: { price: number; book: string } | null;
} {
  const best: {
    home: { price: number; book: string } | null;
    away: { price: number; book: string } | null;
  } = { home: null, away: null };
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
