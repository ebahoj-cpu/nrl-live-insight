import { Link } from "@tanstack/react-router";
import { TeamLogo } from "./TeamLogo";
import type { NrlFixture } from "@/server/nrl";
import type { OddsEvent } from "@/server/odds";
import { findTeam } from "@/lib/teams";

function formatKickoff(utc: string) {
  if (!utc) return "TBC";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

function bestPrice(odds: OddsEvent | null, nickname: string | null): { price: number; book: string } | null {
  if (!odds || !nickname) return null;
  let best: { price: number; book: string } | null = null;
  for (const b of odds.bookmakers) {
    const h2h = b.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    for (const o of h2h.outcomes) {
      if (findTeam(o.name)?.nickname === nickname) {
        if (!best || o.price > best.price) best = { price: o.price, book: b.title };
      }
    }
  }
  return best;
}

export function MatchCard({ fixture, odds }: { fixture: NrlFixture; odds: OddsEvent | null }) {
  const homeNick = findTeam(fixture.homeTeam.nickName)?.nickname ?? fixture.homeTeam.nickName;
  const awayNick = findTeam(fixture.awayTeam.nickName)?.nickname ?? fixture.awayTeam.nickName;
  const homeOdds = bestPrice(odds, homeNick);
  const awayOdds = bestPrice(odds, awayNick);

  const fav = homeOdds && awayOdds ? (homeOdds.price < awayOdds.price ? "home" : "away") : null;

  return (
    <Link
      to="/match/$matchId"
      params={{ matchId: fixture.matchId }}
      className="glass p-5 hover:border-accent/50 transition group block"
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
        <span>{formatKickoff(fixture.kickoffUtc)}</span>
        <span className="truncate ml-3 text-right">{fixture.venue}</span>
      </div>

      <div className="flex items-center justify-between gap-3">
        {/* Home */}
        <div className="flex flex-col items-center text-center w-24">
          <TeamLogo themeKey={fixture.homeTeam.themeKey} name={fixture.homeTeam.nickName} size={56} />
          <div className="mt-2 text-sm font-semibold leading-tight">{fixture.homeTeam.nickName}</div>
          {fixture.homeTeam.teamPosition && (
            <div className="text-[10px] text-muted-foreground">{fixture.homeTeam.teamPosition}</div>
          )}
        </div>

        {/* Odds / vs */}
        <div className="flex-1 flex flex-col items-center">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Best H2H</div>
          <div className="flex items-center gap-2 mt-1 kbd">
            <span className={`px-2 py-1 rounded-md text-sm font-semibold ${fav === "home" ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}>
              {homeOdds ? homeOdds.price.toFixed(2) : "—"}
            </span>
            <span className="text-muted-foreground text-xs">vs</span>
            <span className={`px-2 py-1 rounded-md text-sm font-semibold ${fav === "away" ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}>
              {awayOdds ? awayOdds.price.toFixed(2) : "—"}
            </span>
          </div>
          {(homeOdds || awayOdds) && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {(homeOdds?.book || awayOdds?.book) ?? ""}
            </div>
          )}
        </div>

        {/* Away */}
        <div className="flex flex-col items-center text-center w-24">
          <TeamLogo themeKey={fixture.awayTeam.themeKey} name={fixture.awayTeam.nickName} size={56} />
          <div className="mt-2 text-sm font-semibold leading-tight">{fixture.awayTeam.nickName}</div>
          {fixture.awayTeam.teamPosition && (
            <div className="text-[10px] text-muted-foreground">{fixture.awayTeam.teamPosition}</div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
        <span>{fixture.matchState}</span>
        <span className="text-accent font-medium opacity-0 group-hover:opacity-100 transition">View analysis →</span>
      </div>
    </Link>
  );
}
