import { Link } from "@tanstack/react-router";
import { TeamLogo } from "./TeamLogo";
import type { NrlFixture } from "@/server/nrl";
import type { OddsEvent } from "@/server/odds";
import type { WeatherSnapshot } from "@/server/weather";
import { findTeam } from "@/lib/teams";
import { Calendar, Clock, MapPin, ArrowRight, CloudSun } from "lucide-react";

function formatDate(utc: string) {
  if (!utc) return "TBC";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: "short", day: "numeric", month: "short",
  }).format(d);
}

function formatTime(utc: string) {
  if (!utc) return "";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d).toLowerCase();
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

export function MatchCard({ fixture, odds }: { fixture: NrlFixture & { weather?: WeatherSnapshot | null }; odds: OddsEvent | null }) {
  const homeNick = findTeam(fixture.homeTeam.nickName)?.nickname ?? fixture.homeTeam.nickName;
  const awayNick = findTeam(fixture.awayTeam.nickName)?.nickname ?? fixture.awayTeam.nickName;
  const homeOdds = bestPrice(odds, homeNick);
  const awayOdds = bestPrice(odds, awayNick);

  const fav = homeOdds && awayOdds ? (homeOdds.price < awayOdds.price ? "home" : "away") : null;
  const w = fixture.weather ?? null;

  // Match is finished if matchState indicates it AND we have a numeric score
  const homeScore = fixture.homeTeam.score;
  const awayScore = fixture.awayTeam.score;
  const isFinished =
    typeof homeScore === "number" &&
    typeof awayScore === "number" &&
    /^(FullTime|Final|Completed)$/i.test(fixture.matchState);
  const isLive = /^(InProgress|Live|HalfTime)$/i.test(fixture.matchState) &&
    typeof homeScore === "number" && typeof awayScore === "number";

  const winner: "home" | "away" | "draw" | null = isFinished
    ? homeScore! > awayScore! ? "home" : homeScore! < awayScore! ? "away" : "draw"
    : null;

  return (
    <Link
      to="/match/$matchId"
      params={{ matchId: fixture.matchId }}
      className="card-surface p-5 hover:border-accent/50 transition group block flex flex-col h-full"
    >
      {/* Meta — day/date/time centered on top, venue below */}
      <div className="text-xs text-muted-foreground mb-5 space-y-1.5">
        <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span>{formatDate(fixture.kickoffUtc)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="kbd">{formatTime(fixture.kickoffUtc)}</span>
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 font-bold uppercase tracking-wider text-[10px] px-2 py-0.5 rounded-md bg-danger/15 text-danger">
              <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center justify-center min-w-0">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="truncate">{fixture.venue}</span>
          </span>
        </div>
      </div>

      {/* Teams + odds OR scores */}
      <div className="grid grid-cols-3 items-center gap-3 flex-1">
        <div className="flex flex-col items-center text-center">
          <TeamLogo themeKey={fixture.homeTeam.themeKey} name={fixture.homeTeam.nickName} size={56} />
          <div className="mt-2 text-sm font-semibold leading-tight">{fixture.homeTeam.nickName}</div>
        </div>

        <div className="flex flex-col items-center justify-center">
          {(isFinished || isLive) ? (
            <>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {isLive ? "Score" : "Final"}
              </div>
              <div className="flex items-center gap-2 mt-1.5 kbd">
                <span className={`text-2xl font-black tabular-nums ${winner === "home" ? "text-accent" : "text-foreground"}`}>
                  {homeScore}
                </span>
                <span className="text-muted-foreground text-xs font-bold">–</span>
                <span className={`text-2xl font-black tabular-nums ${winner === "away" ? "text-accent" : "text-foreground"}`}>
                  {awayScore}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">H2H</div>
              <div className="flex items-center gap-1.5 mt-1.5 kbd">
                <span className={`px-2 py-1 rounded-md text-sm font-semibold ${fav === "home" ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}>
                  {homeOdds ? homeOdds.price.toFixed(2) : "—"}
                </span>
                <span className="text-muted-foreground text-xs">v</span>
                <span className={`px-2 py-1 rounded-md text-sm font-semibold ${fav === "away" ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}>
                  {awayOdds ? awayOdds.price.toFixed(2) : "—"}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col items-center text-center">
          <TeamLogo themeKey={fixture.awayTeam.themeKey} name={fixture.awayTeam.nickName} size={56} />
          <div className="mt-2 text-sm font-semibold leading-tight">{fixture.awayTeam.nickName}</div>
        </div>
      </div>

      {/* Footer — weather/ground left, view analysis right */}
      <div className="mt-5 pt-4 border-t border-border flex items-center justify-between gap-3 text-xs">
        <div className="inline-flex items-center gap-1.5 text-muted-foreground min-w-0">
          <CloudSun className="h-3.5 w-3.5 shrink-0 text-accent" />
          {w ? (
            <span className="truncate">
              {w.tempC}° {shortCondition(w.condition)}
            </span>
          ) : (
            <span className="truncate">Forecast pending</span>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent !text-white font-bold text-xs tracking-wide group-hover:gap-2.5 transition-all shrink-0 shadow-[0_4px_14px_-4px_color-mix(in_oklab,var(--accent)_60%,transparent)]">
          View Analysis <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

function shortCondition(c: string): string {
  if (!c) return "";
  // Keep at most 2 words; trim long descriptors like "Partly cloudy with showers"
  const words = c.trim().split(/\s+/);
  if (words.length <= 2) return c;
  return words.slice(0, 2).join(" ");
}
