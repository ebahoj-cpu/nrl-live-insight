import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { getMatchPage, getMatchInsights } from "@/server/index.functions";
import { TeamLogo } from "@/components/TeamLogo";
import type { TryscorerMarkets, OddsEvent } from "@/server/odds";
import { bestH2H } from "@/server/odds";
import { Fragment, Suspense, useState } from "react";
import {
  ArrowLeft, Clock, MapPin, Users, BarChart3, Sparkles,
  Trophy, Target, Flag, Crown, TrendingUp, AlertCircle, CloudSun, Calendar, Zap, Hourglass,
  ThumbsUp, ThumbsDown, Activity, Shield, Compass, Gauge, Check,
  Receipt, X, Newspaper, History, GraduationCap, ScrollText,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const matchQO = (matchId: string) => queryOptions({
  queryKey: ["match", matchId],
  queryFn: () => getMatchPage({ data: { matchId } }),
});

const insightsQO = (matchId: string) => queryOptions({
  queryKey: ["match-insights", matchId],
  queryFn: () => getMatchInsights({ data: { matchId } }),
  staleTime: 60 * 60_000,
  retry: 1,
});

export const Route = createFileRoute("/match/$matchId")({
  parseParams: (p) => ({ matchId: decodeURIComponent(p.matchId) }),
  stringifyParams: (p) => ({ matchId: encodeURIComponent(p.matchId) }),
  loader: ({ context: { queryClient }, params }) => {
    void queryClient.ensureQueryData(matchQO(params.matchId));
  },
  component: MatchPage,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="py-16 text-center">
        <p className="text-danger font-semibold">Couldn't load match details</p>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          The NRL fixture feed didn't respond. This is usually temporary — try again in a moment.
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">{error.message}</p>
        <button onClick={() => router.invalidate()} className="mt-4 px-4 py-2 bg-accent text-accent-foreground rounded-full font-semibold">
          Retry
        </button>
      </div>
    );
  },
});

type TabKey = "lineup" | "stats" | "insights" | "bet" | "aftermatch" | "script";

function MatchPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-muted-foreground">Loading match…</div>}>
      <MatchInner />
    </Suspense>
  );
}

function MatchInner() {
  const { matchId } = Route.useParams();
  const { data } = useSuspenseQuery(matchQO(matchId));
  const { details, ladder, odds, tryscorers, oddsError, oddsStale, tryscorersError, recentRecaps, aftermatch, lessons } = data as any;

  // Lazy AI insights — fetched in background after the page renders.
  // Initial value comes from the page payload (cache hit on the server).
  const insightsQ = useQuery({
    ...insightsQO(matchId),
    initialData: (data as any).insights ? { insights: (data as any).insights, insightsError: null } : undefined,
  });
  const insights = insightsQ.data?.insights ?? null;
  const insightsError = insightsQ.data?.insightsError ?? (insightsQ.error as Error | null)?.message ?? null;
  const insightsLoading = insightsQ.isFetching && !insights;

  const [tab, setTab] = useState<TabKey>("lineup");

  const isFinished = /^(FullTime|Final|Completed)$/i.test(details.matchState);

  const homeRow = ladder.find((r: any) => r.nickname === details.homeTeam.nickName);
  const awayRow = ladder.find((r: any) => r.nickname === details.awayTeam.nickName);

  return (
    <div className="pt-6">
      <Link to="/" search={{ round: undefined }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to fixtures
      </Link>

      {/* Header */}
      <section className="glass p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-widest text-accent font-bold">Round {details.roundNumber}</div>
          {(() => {
            const hs = details.homeTeam.score;
            const as = details.awayTeam.score;
            const live = typeof hs === "number" && typeof as === "number" && /^(InProgress|Live|HalfTime)$/i.test(details.matchState);
            if (live) return <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-danger/15 text-danger"><span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />Live</span>;
            return null;
          })()}
        </div>
        {(() => {
          const hasScore = typeof details.homeTeam.score === "number" && typeof details.awayTeam.score === "number";
          const isFinishedOrLive = hasScore && /^(FullTime|Final|Completed|InProgress|Live|HalfTime)$/i.test(details.matchState);
          const h2h = odds ? bestH2H(odds) : null;
          const fav = h2h?.home && h2h?.away ? (h2h.home.price < h2h.away.price ? "home" : "away") : null;
          return (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center mt-4 gap-2 sm:gap-4">
              <div className="flex items-center justify-end gap-2 sm:gap-3 min-w-0">
                <TeamColumn name={details.homeTeam.nickName} themeKey={details.homeTeam.themeKey} position={details.homeTeam.position} />
                {!isFinishedOrLive && <OddsPill odds={h2h?.home ?? null} isFav={fav === "home"} />}
              </div>
              <div className="text-center px-1">
                {hasScore ? (
                  <div className="kbd flex items-center justify-center gap-3">
                    <span className={`text-4xl sm:text-5xl font-black tabular-nums ${details.homeTeam.score > details.awayTeam.score ? "text-accent" : ""}`}>{details.homeTeam.score}</span>
                    <span className="text-muted-foreground text-lg font-bold">–</span>
                    <span className={`text-4xl sm:text-5xl font-black tabular-nums ${details.awayTeam.score > details.homeTeam.score ? "text-accent" : ""}`}>{details.awayTeam.score}</span>
                  </div>
                ) : (
                  <div className="text-2xl sm:text-3xl font-extrabold">vs</div>
                )}
              </div>
              <div className="flex items-center justify-start gap-2 sm:gap-3 min-w-0">
                {!isFinishedOrLive && <OddsPill odds={h2h?.away ?? null} isFav={fav === "away"} />}
                <TeamColumn name={details.awayTeam.nickName} themeKey={details.awayTeam.themeKey} position={details.awayTeam.position} />
              </div>
            </div>
          );
        })()}

        <div className="mt-6 pt-5 border-t border-border space-y-2 text-sm text-center sm:text-left sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
          <div className="inline-flex items-center justify-center sm:justify-start gap-2 flex-wrap">
            <Calendar className="h-4 w-4 text-accent shrink-0" />
            <span className="text-muted-foreground">{formatDate(details.kickoffUtc)}</span>
            <span className="text-muted-foreground">·</span>
            <Clock className="h-4 w-4 text-accent shrink-0" />
            <span className="text-muted-foreground kbd">{formatTime(details.kickoffUtc)}</span>
          </div>
          <div className="flex items-center justify-center sm:justify-end gap-2">
            <MapPin className="h-4 w-4 text-accent shrink-0" />
            <span className="text-muted-foreground truncate">{details.venue}{details.venueCity ? `, ${details.venueCity}` : ""}</span>
          </div>
          {details.weather && (
            <div className="flex items-center justify-center sm:justify-start gap-2 sm:col-span-2 pt-3 border-t border-border flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <CloudSun className="h-4 w-4 text-accent shrink-0" />
                <span className="text-muted-foreground" suppressHydrationWarning>
                  {details.weather.tempC}° {shortWeather(details.weather.condition)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-accent shrink-0" />
                <span className="text-muted-foreground">{details.weather.windKph} km/h</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-accent shrink-0" />
                <span className="text-muted-foreground">{details.weather.groundCondition}</span>
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Tabs — icon-only on mobile, icon+label on sm+ */}
      <nav className={`mt-6 grid ${isFinished ? "grid-cols-5" : "grid-cols-5"} gap-1 p-1 glass`} role="tablist">
        <TabButton active={tab === "lineup"} onClick={() => setTab("lineup")} icon={Users} label="Lineup" />
        <TabButton active={tab === "stats"} onClick={() => setTab("stats")} icon={BarChart3} label="Stats" />
        <TabButton active={tab === "insights"} onClick={() => setTab("insights")} icon={Target} label="Insights" />
        <TabButton active={tab === "script"} onClick={() => setTab("script")} icon={ScrollText} label="Script" />
        {isFinished ? (
          <TabButton active={tab === "aftermatch"} onClick={() => setTab("aftermatch")} icon={History} label="Aftermatch" />
        ) : (
          <TabButton active={tab === "bet"} onClick={() => setTab("bet")} icon={Receipt} label="Bet" />
        )}
      </nav>

      <div className="mt-6">
        {tab === "lineup" && <LineupTab home={details.homeTeam} away={details.awayTeam} officials={details.officials} teamNews={details.teamNews} />}
        {tab === "stats" && <StatsTab home={details.homeTeam} away={details.awayTeam} homeRow={homeRow} awayRow={awayRow} statGroups={details.statGroups} recentRecaps={recentRecaps} />}
        {tab === "insights" && (
          <InsightsTab
            insights={insights}
            insightsError={insightsLoading ? null : insightsError}
            insightsLoading={insightsLoading}
            home={details.homeTeam}
            away={details.awayTeam}
            homeRow={homeRow}
            awayRow={awayRow}
            tryscorers={tryscorers}
            tryscorersError={tryscorersError}
            odds={odds}
            lessons={lessons}
          />
        )}
        {tab === "script" && (
          <GameScriptTab
            insights={insights}
            insightsLoading={insightsLoading}
            home={details.homeTeam}
            away={details.awayTeam}
          />
        )}
        {tab === "bet" && !isFinished && (
          <BetTab
            insights={insights}
            insightsError={insightsLoading ? null : insightsError}
            insightsLoading={insightsLoading}
            home={details.homeTeam}
            away={details.awayTeam}
            tryscorers={tryscorers}
            odds={odds}
          />
        )}
        {tab === "aftermatch" && isFinished && (
          <AftermatchTab
            aftermatch={aftermatch}
            home={details.homeTeam}
            away={details.awayTeam}
          />
        )}
      </div>

    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }:
  { active: boolean; onClick: () => void; icon: typeof Users; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TeamColumn({ name, themeKey }: { name: string; themeKey: string; position?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 min-w-0">
      <TeamLogo themeKey={themeKey} name={name} size={56} />
      <div className="text-xs sm:text-sm font-bold text-center leading-tight truncate max-w-full">{name}</div>
    </div>
  );
}

function OddsPill({ odds, isFav }: { odds: { price: number; book: string } | null; isFav: boolean }) {
  if (!odds) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-surface-2 text-[11px] font-bold tabular-nums text-muted-foreground border border-border shrink-0">—</span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-3 py-1 rounded-full bg-accent !text-black text-[12px] font-black tabular-nums tracking-tight shadow-[0_4px_14px_-4px_color-mix(in_oklab,var(--accent)_60%,transparent)] shrink-0"
      title={`Best price: ${odds.book}${isFav ? " · favourite" : ""}`}
    >
      {odds.price.toFixed(2)}
    </span>
  );
}

function shortWeather(c: string): string {
  if (!c) return "";
  const words = c.trim().split(/\s+/);
  return words.length <= 2 ? c : words.slice(0, 2).join(" ");
}

function Card({ title, icon: Icon, children, className = "" }:
  { title: string; icon?: typeof Users; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card-surface p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon className="h-4 w-4 text-accent" />}
        <h3 className="font-bold text-sm uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="glass p-6 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
      <AlertCircle className="h-4 w-4" /> {msg}
    </div>
  );
}

function InsightsLoading() {
  return (
    <div className="glass p-8 text-center text-sm text-muted-foreground">
      <div className="inline-flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-accent animate-pulse drop-shadow-[0_0_8px_hsl(var(--accent))]" />
      </div>
      <p className="text-[11px] mt-3 opacity-70">If this hasn't generated, refresh in 1 minute.</p>
    </div>
  );
}

/* ================= LINEUP TAB ================= */

// Strict NRL jersey-to-position map (1-13 starters).
// Numbers repeat (e.g. two Wingers, two Centres, two Props, two 2nd Rowers),
// so we map by jersey number rather than indexing a flat array.
const JERSEY_POSITION: Record<number, string> = {
  1: "Fullback",
  2: "Left Wing",
  3: "Left Centre",
  4: "Right Centre",
  5: "Right Wing",
  6: "Five-Eighth",
  7: "Halfback",
  8: "Prop",
  9: "Hooker",
  10: "Prop",
  11: "2nd Row",
  12: "2nd Row",
  13: "Lock",
};

// Used for stable secondary-sort of squad lists when jersey numbers tie.
const POSITION_ORDER = [
  "Fullback","Left Wing","Left Centre","Right Centre","Right Wing",
  "Five-Eighth","Halfback","Prop","Hooker","2nd Row","Lock",
  "Interchange","Reserve",
];

type NewsOut = { playerName: string; reason: string; sourceUrl: string; sourceTitle: string; source: string; publishedUtc: string };
type TeamNews = { ins: string[]; outs: string[]; blurb: string; sourceUrl: string; newsOuts?: NewsOut[] } | null;

function LineupTab({ home, away, officials, teamNews: _teamNews }: { home: any; away: any; officials: { position: string; firstName: string; lastName: string; headImage?: string }[]; teamNews?: { home: TeamNews; away: TeamNews } }) {
  return (
    <div className="space-y-4">
      <H2HPanel home={home} away={away} />
      <OfficialsCard officials={officials} />
    </div>
  );
}

function H2HPanel({ home, away }: { home: any; away: any }) {
  type P = { firstName: string; lastName: string; position: string; jerseyNumber?: number; isCaptain?: boolean; headImage?: string };
  const byNumber = (players: P[]) => {
    const m = new Map<number, P>();
    for (const p of players ?? []) if (p.jerseyNumber != null) m.set(p.jerseyNumber, p);
    return m;
  };
  const homeMap = byNumber(home.players);
  const rawAwayMap = byNumber(away.players);
  // Mirror the away backline so matchups align positionally:
  // home #2 (LW) faces away #5 (RW), home #3 (LC) faces away #4 (RC), and vice versa.
  // FB (#1) and forwards (#6+) keep their numbers.
  const awayMap = new Map(rawAwayMap);
  const swap = (a: number, b: number) => {
    const pa = rawAwayMap.get(a);
    const pb = rawAwayMap.get(b);
    if (pa) awayMap.set(b, pa); else awayMap.delete(b);
    if (pb) awayMap.set(a, pb); else awayMap.delete(a);
  };
  swap(2, 5);
  swap(3, 4);

  const positionFor = (n: number): string => {
    if (n >= 1 && n <= 13) return JERSEY_POSITION[n] ?? "";
    if (n <= 20) return "Interchange";
    return "Reserve";
  };

  const numbers: number[] = [];
  for (let i = 1; i <= 20; i++) {
    if (homeMap.has(i) || awayMap.has(i)) numbers.push(i);
  }
  const extraSet = new Set<number>();
  for (const n of homeMap.keys()) if (n > 20) extraSet.add(n);
  for (const n of awayMap.keys()) if (n > 20) extraSet.add(n);
  const extras = [...extraSet].sort((a, b) => a - b);

  // Headshot anchored to bottom of the row but allowed to overflow ABOVE the
  // card edge so the head/hair is never clipped. Row uses overflow-visible
  // and groups have extra vertical spacing so the overflow doesn't collide
  // with the row above.
  // Mobile: smaller (~25% reduction from w-24 → w-[72px]) headshots pushed to
  // the outer edges. The player's name sits as a gradient overlay across the
  // bottom of the headshot (where the jersey is, so the face is still visible)
  // AND repeats as a clean caption directly underneath the headshot.
  const HeadshotWithName = ({ p, side }: { p?: P; side: "left" | "right" }) => {
    const len = p?.lastName?.length ?? 0;
    // Aggressive scale-down so the surname always fits without truncation
    const lastSize =
      len >= 13 ? "text-[9px] sm:text-base"
      : len >= 11 ? "text-[10px] sm:text-lg"
      : len >= 9 ? "text-xs sm:text-lg"
      : "text-sm sm:text-xl";
    const firstLen = p?.firstName?.length ?? 0;
    const firstSize = firstLen >= 12 ? "text-[8px] sm:text-[11px]" : "text-[10px] sm:text-[12px]";
    return (
      <div className={`shrink-0 flex flex-col ${side === "left" ? "items-start" : "items-end"}`}>
        <div className="relative w-[72px] h-20 sm:w-28 sm:h-28 overflow-visible">
          {p?.headImage ? (
            <img
              src={p.headImage}
              alt=""
              loading="lazy"
              className={`pointer-events-none absolute bottom-0 h-[150%] w-auto max-w-none object-contain object-bottom drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)] ${
                side === "left" ? "left-0" : "right-0"
              }`}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : null}
        </div>
        {/* Caption centered under the player's face. Stays within the player's half so it never collides with the centre badge. */}
        <div className="mt-3 w-[88px] sm:w-32 leading-tight text-center">
          {p ? (
            <>
              <div className={`${firstSize} uppercase tracking-wider text-muted-foreground whitespace-nowrap`}>
                {p.firstName}
              </div>
              <div className={`font-black uppercase whitespace-nowrap ${lastSize}`}>
                {p.lastName}
                {p.isCaptain && <Crown className="inline h-3 w-3 mx-0.5 text-accent align-[-1px]" />}
              </div>
            </>
          ) : (
            <div className="text-[10px] sm:text-[12px] uppercase tracking-wider text-muted-foreground/60 italic">— TBC —</div>
          )}
        </div>
      </div>
    );
  };

  const CenterBadge = ({ n, label, displayNumber }: { n: number; label?: string; displayNumber?: string }) => (
    <div className="relative z-20 shrink-0 flex flex-col items-center justify-center px-2">
      <span className="flex h-9 min-w-9 sm:h-10 sm:min-w-10 px-1.5 items-center justify-center rounded-md bg-accent text-accent-foreground font-black text-sm sm:text-base tabular-nums shadow-md whitespace-nowrap">
        {displayNumber ?? n}
      </span>
      {/* Position pill — solid background so the label reads clearly even when it sits over a headshot */}
      <span className="mt-1.5 px-2 py-1 rounded-md bg-background/95 ring-1 ring-accent/50 text-[9px] sm:text-[10px] uppercase tracking-wider text-foreground font-bold whitespace-nowrap text-center shadow-md">
        {label ?? positionFor(n)}
      </span>
    </div>
  );

  // For backline matchups (2-5) the away jersey is mirrored, so show "home/away".
  const BACKLINE_PAIR: Record<number, number> = { 2: 5, 3: 4, 4: 3, 5: 2 };
  // Combined position label for the mirrored backline (home position / away position).
  const BACKLINE_LABEL: Record<number, string> = {
    2: "Left/Right Wing",
    3: "Left/Right Centre",
    4: "Right/Left Centre",
    5: "Right/Left Wing",
  };

  const Row = ({ n, label }: { n: number; label?: string }) => {
    const h = homeMap.get(n);
    const a = awayMap.get(n);
    const displayNumber = BACKLINE_PAIR[n] ? `${n}/${BACKLINE_PAIR[n]}` : undefined;
    const rowLabel = label ?? BACKLINE_LABEL[n];
    return (
      <li className="relative flex items-start justify-between gap-2 sm:gap-4 rounded-lg bg-accent/10 ring-1 ring-accent/25 hover:ring-accent/50 transition px-2 sm:px-4 py-2 overflow-visible">
        <HeadshotWithName p={h} side="left" />
        <div className="flex-1 flex items-center justify-center pt-4 sm:pt-6">
          <CenterBadge n={n} label={rowLabel} displayNumber={displayNumber} />
        </div>
        <HeadshotWithName p={a} side="right" />
      </li>
    );
  };

  return (
    <section className="card-surface p-4 sm:p-5">
      {numbers.length === 0 && extras.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-6">Squads not yet named.</div>
      ) : (
        <div className="space-y-12 pt-0">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-accent/80 mb-6">Starters</div>
            <ul className="space-y-10 sm:space-y-14">
              {numbers.filter((n) => n <= 13).map((n) => <Row key={n} n={n} />)}
            </ul>
          </div>
          {numbers.some((n) => n > 13 && n <= 20) && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-accent/80 mb-6">Interchange</div>
              <ul className="space-y-10 sm:space-y-14">
                {numbers.filter((n) => n > 13 && n <= 20).map((n) => <Row key={n} n={n} label="Bench" />)}
              </ul>
            </div>
          )}
          {extras.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-accent/80 mb-6">Reserves</div>
              <ul className="space-y-10 sm:space-y-14">
                {extras.map((n) => <Row key={n} n={n} label="Reserve" />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function InjuryCard({ team, news }: { team: { nickName: string }; news: TeamNews }) {
  const renderName = (n: string, tone: "in" | "out") => (
    <li
      key={`${tone}-${n}`}
      className="flex items-center gap-2 rounded-md bg-accent/15 ring-1 ring-accent/25 px-2 py-1"
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
          tone === "in" ? "bg-background text-success" : "bg-background text-danger"
        }`}
      >
        {tone === "in" ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
      </span>
      <span className="flex-1 min-w-0 font-extrabold uppercase tracking-wide text-xs truncate">{n}</span>
    </li>
  );

  const renderNewsOut = (o: NewsOut) => (
    <li
      key={`news-${o.playerName}`}
      className="rounded-md bg-danger/10 ring-1 ring-danger/40 px-2 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-background text-danger">
          <Newspaper className="h-3 w-3" />
        </span>
        <span className="flex-1 min-w-0 font-extrabold uppercase tracking-wide text-xs truncate">{o.playerName}</span>
      </div>
      <a
        href={o.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block text-[9px] uppercase tracking-wider text-danger/90 hover:text-danger hover:underline truncate"
        title={o.sourceTitle}
      >
        Breaking · {o.source} ↗
      </a>
    </li>
  );

  const newsOuts = news?.newsOuts ?? [];
  const hasAnyOuts = (news?.outs?.length ?? 0) > 0 || newsOuts.length > 0;

  return (
    <section className="card-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="h-4 w-4 text-accent shrink-0" />
        <h3 className="font-bold text-sm uppercase tracking-wider truncate">{team.nickName} · Ins & Outs</h3>
      </div>
      {!news || (news.ins.length === 0 && !hasAnyOuts && !news.blurb) ? (
        <p className="text-xs text-muted-foreground">Late mail not yet published. Updates land Tuesday/Thursday on NRL.com.</p>
      ) : (
        <div className="space-y-3">
          {newsOuts.length > 0 && (
            <div className="rounded-md bg-danger/5 ring-1 ring-danger/30 p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-bold text-danger">
                <Newspaper className="h-3 w-3" />
                <span>Breaking news · ruled out</span>
              </div>
              <ul className="space-y-1">{newsOuts.map(renderNewsOut)}</ul>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Sourced from headlines in the last 5 days. The official team list may not yet reflect this.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-accent/80">Ins</div>
              {news.ins.length === 0 ? (
                <div className="text-xs text-muted-foreground">—</div>
              ) : (
                <ul className="space-y-1">{news.ins.map((n) => renderName(n, "in"))}</ul>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-accent/80">Outs (official)</div>
              {news.outs.length === 0 ? (
                <div className="text-xs text-muted-foreground">—</div>
              ) : (
                <ul className="space-y-1">{news.outs.map((n) => renderName(n, "out"))}</ul>
              )}
            </div>
          </div>
          {news.blurb && (
            <p className="text-[11px] leading-relaxed text-muted-foreground border-t border-border pt-3">
              {news.blurb}
            </p>
          )}
          {news.sourceUrl && (
            <a href={news.sourceUrl} target="_blank" rel="noreferrer" className="text-[10px] uppercase tracking-wider text-accent hover:underline">
              Source: NRL.com team lists ↗
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function OfficialsCard({ officials }: { officials: { position: string; firstName: string; lastName: string; headImage?: string }[] }) {
  const filtered = (officials ?? []).filter((o) => /^Referee$/i.test(o.position) || /Senior Review|Bunker/i.test(o.position));
  if (filtered.length === 0) {
    return (
      <section className="card-surface p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="h-4 w-4 text-accent shrink-0" />
          <h3 className="font-bold text-sm uppercase tracking-wider truncate">Match Officials</h3>
        </div>
        <p className="text-xs text-muted-foreground">Officials not yet announced.</p>
      </section>
    );
  }
  const order = ["Referee", "Senior Review Official", "Bunker Official"];
  const sorted = [...filtered].sort((a, b) => {
    const ai = order.findIndex((o) => a.position.toLowerCase().includes(o.toLowerCase()));
    const bi = order.findIndex((o) => b.position.toLowerCase().includes(o.toLowerCase()));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return (
    <section className="card-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-4 w-4 text-accent shrink-0" />
        <h3 className="font-bold text-sm uppercase tracking-wider truncate">Match Officials</h3>
      </div>
      <ul className="space-y-1.5">
        {sorted.map((o, i) => {
          const isTMO = /Senior Review|Bunker/i.test(o.position);
          const code = isTMO ? "TMO" : "REF";
          const label = isTMO ? "TMO / Bunker" : "Referee";
          return (
            <li
              key={i}
              className="flex items-center gap-3 rounded-md bg-accent/15 ring-1 ring-accent/25 px-2 py-1.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-background text-accent font-extrabold text-[10px] tabular-nums">
                {code}
              </span>
              <span className="flex-1 min-w-0 font-extrabold uppercase tracking-wide text-sm truncate">
                {o.firstName} {o.lastName}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-accent/80 font-bold shrink-0">
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OfficialAvatar({ src, firstName, lastName, size }: { src?: string; firstName: string; lastName: string; size: number }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div
        className="rounded-full bg-surface flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0"
        style={{ width: size, height: size }}
      >
        {firstName.charAt(0)}{lastName.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`${firstName} ${lastName}`}
      onError={() => setErr(true)}
      className="rounded-full object-cover bg-surface shrink-0"
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}

function SquadPanel({ team, news }: { team: { nickName: string; themeKey: string; players: { firstName: string; lastName: string; position: string; jerseyNumber?: number; isCaptain?: boolean; headImage?: string }[] }; news?: TeamNews }) {
  const sorted = [...team.players].sort((a, b) => {
    const ai = a.jerseyNumber ?? 999;
    const bi = b.jerseyNumber ?? 999;
    if (ai !== bi) return ai - bi;
    const pi = POSITION_ORDER.indexOf(a.position);
    const pj = POSITION_ORDER.indexOf(b.position);
    return (pi === -1 ? 99 : pi) - (pj === -1 ? 99 : pj);
  });

  // Build a lookup of names that have been ruled out either by the official
  // Team Lists article OR by breaking news (cross-referenced from the news feed).
  const officialOutsLc = new Set((news?.outs ?? []).map((n) => n.toLowerCase()));
  const newsOutsByName = new Map<string, NewsOut>();
  for (const o of news?.newsOuts ?? []) newsOutsByName.set(o.playerName.toLowerCase(), o);

  type P = (typeof sorted)[number];
  const starters: P[] = [];
  const interchange: P[] = [];
  const reserves: P[] = [];
  const unnumbered: P[] = [];
  for (const p of sorted) {
    const n = p.jerseyNumber;
    if (n == null) unnumbered.push(p);
    else if (n <= 13) starters.push(p);
    else if (n <= 20) interchange.push(p);
    else reserves.push(p);
  }

  const renderRow = (p: P, i: number) => {
    // Prefer the canonical NRL position name from the jersey number, falling
    // back to whatever the feed reports (covers interchange/reserves).
    const positionLabel = p.jerseyNumber != null && JERSEY_POSITION[p.jerseyNumber]
      ? JERSEY_POSITION[p.jerseyNumber]
      : p.position;
    const fullName = `${p.firstName} ${p.lastName}`.toLowerCase();
    const newsOut = newsOutsByName.get(fullName);
    const isOut = officialOutsLc.has(fullName) || !!newsOut;
    return (
      <li
        key={i}
        // overflow-visible so the headshot can extend above the card edge.
        className={`relative flex items-stretch h-24 sm:h-28 rounded-lg overflow-visible ${
          isOut ? "bg-danger/10 ring-1 ring-danger/40" : "bg-accent/15 ring-1 ring-accent/25"
        }`}
      >
        {/* Headshot pinned to the left edge, bottom-aligned, overflows above and to the right */}
        <div className="relative shrink-0 self-stretch w-28 sm:w-32">
          {p.headImage ? (
            <img
              src={p.headImage}
              alt=""
              loading="lazy"
              className={`pointer-events-none absolute bottom-0 left-0 h-[150%] w-auto max-w-none object-contain object-bottom drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)] ${
                isOut ? "grayscale opacity-60" : ""
              }`}
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                img.style.display = "none";
                const sib = img.nextElementSibling as HTMLElement | null;
                if (sib) sib.style.display = "flex";
              }}
            />
          ) : null}
          <InitialsAvatar firstName={p.firstName} lastName={p.lastName} hidden={!!p.headImage} dimmed={isOut} />
        </div>

        {/* Jersey number badge — pushed well clear of the overlapping headshot */}
        <div className="shrink-0 flex flex-col items-center justify-center w-14 sm:w-16 ml-20 sm:ml-28">
          <span className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-md font-black text-base sm:text-lg tabular-nums ${
            isOut ? "bg-danger text-background line-through" : "bg-accent text-accent-foreground"
          }`}>
            {p.jerseyNumber ?? "—"}
          </span>
        </div>

        {/* Name + position — offset so it clears the overlapping headshot. Long surnames shrink to fit, never truncate. */}
        <div className="flex-1 min-w-0 flex flex-col justify-center px-2 sm:px-3 leading-tight">
          <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-muted-foreground whitespace-nowrap overflow-hidden">
            {p.firstName}
          </div>
          <div className={`font-black uppercase whitespace-nowrap ${
            (p.lastName?.length ?? 0) >= 13
              ? "text-[10px] sm:text-sm"
              : (p.lastName?.length ?? 0) >= 11
                ? "text-[11px] sm:text-base"
                : (p.lastName?.length ?? 0) >= 9
                  ? "text-xs sm:text-lg"
                  : "text-sm sm:text-lg"
          } ${isOut ? "text-danger line-through decoration-2" : ""}`}>
            {p.lastName}
            {p.isCaptain && <Crown className="inline h-3 w-3 sm:h-3.5 sm:w-3.5 mx-1 text-accent align-[-1px]" />}
          </div>
          <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-accent/70 font-bold mt-0.5 whitespace-nowrap">
            {positionLabel}
          </div>
          {isOut && (
            <a
              href={newsOut?.sourceUrl ?? news?.sourceUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => { if (!newsOut?.sourceUrl && !news?.sourceUrl) e.preventDefault(); }}
              className="mt-1 inline-flex items-center gap-1 self-start rounded-sm bg-danger/20 ring-1 ring-danger/50 px-1.5 py-0.5 text-[8px] sm:text-[9px] uppercase tracking-wider font-bold text-danger hover:bg-danger/30"
              title={newsOut?.sourceTitle ?? "Ruled out per official team list"}
            >
              {newsOut ? <Newspaper className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
              <span>Ruled out{newsOut ? ` · ${newsOut.source}` : ""}</span>
            </a>
          )}
        </div>
      </li>
    );
  };

  const Group = ({ label, items }: { label?: string; items: P[] }) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-3">
        {label && (
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent/80 pt-1">
            {label}
          </div>
        )}
        {/* generous spacing so headshot overflow doesn't collide with the row above */}
        <ul className="space-y-14 sm:space-y-16 pt-12">{items.map(renderRow)}</ul>
      </div>
    );
  };

  return (
    <section className="card-surface p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="h-4 w-4 text-accent shrink-0" />
          <h3 className="font-bold text-sm uppercase tracking-wider truncate">{team.nickName}</h3>
        </div>
        <TeamLogo themeKey={team.themeKey} name={team.nickName} size={36} />
      </div>
      {sorted.length === 0 ? (
        <div className="text-xs text-muted-foreground">Squad not yet named.</div>
      ) : (
        <div className="space-y-3">
          <Group items={starters} />
          <Group label="Interchange" items={interchange} />
          <Group label="Reserves" items={reserves} />
          {unnumbered.length > 0 && <Group label="Unnamed" items={unnumbered} />}
        </div>
      )}
    </section>
  );
}

/* ================= STATS TAB ================= */

type StatValue = { value: number; isLeader: boolean; numerator?: number; denominator?: number };
type TeamStat = { title: string; type: string; units?: string; homeValue: StatValue; awayValue: StatValue; maxValue?: number };
type StatGroup = { title: string; stats: TeamStat[] };

function fmtStatValue(v: StatValue, type: string, units?: string): string {
  if (type === "Percentage") return `${v.value.toFixed(0)}%`;
  if (type === "PercentageAndFraction") {
    return v.numerator != null && v.denominator != null
      ? `${v.value.toFixed(0)}% (${v.numerator}/${v.denominator})`
      : `${v.value.toFixed(0)}%`;
  }
  if (type === "Range") return `${v.value.toFixed(2)}${units ? ` ${units.toLowerCase()}` : ""}`;
  return `${v.value % 1 === 0 ? v.value.toFixed(0) : v.value.toFixed(1)}`;
}

function StatsTab({ home, away, homeRow, awayRow, statGroups, recentRecaps }:
  { home: any; away: any; homeRow?: any; awayRow?: any; statGroups: StatGroup[]; recentRecaps?: { home: any[]; away: any[] } }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SeasonStats team={home} row={homeRow} />
        <SeasonStats team={away} row={awayRow} />
      </div>

      {/* Recent recaps section removed per request */}

      {statGroups && statGroups.length > 0 && statGroups.map((g, gi) => (
        <Card key={gi} title={g.title} icon={Activity}>
          <div className="grid grid-cols-3 gap-2 mb-3 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            <div className="text-right">{home.nickName}</div>
            <div className="text-center">Stat</div>
            <div className="text-left">{away.nickName}</div>
          </div>
          <div className="space-y-2.5">
            {g.stats.map((s, si) => {
              const total = s.homeValue.value + s.awayValue.value || 1;
              const homePct = (s.homeValue.value / total) * 100;
              return (
                <div key={si}>
                  <div className="grid grid-cols-3 items-center gap-2 text-sm mb-1">
                    <div className={`text-right kbd font-bold ${s.homeValue.isLeader ? "text-accent" : "text-foreground"}`}>
                      {fmtStatValue(s.homeValue, s.type, s.units)}
                    </div>
                    <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">{s.title}</div>
                    <div className={`text-left kbd font-bold ${s.awayValue.isLeader ? "text-accent" : "text-foreground"}`}>
                      {fmtStatValue(s.awayValue, s.type, s.units)}
                    </div>
                  </div>
                  {/* dual bar */}
                  <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-2">
                    <div className={`${s.homeValue.isLeader ? "bg-accent" : "bg-muted-foreground/40"} transition-all`} style={{ width: `${homePct}%` }} />
                    <div className={`${s.awayValue.isLeader ? "bg-accent" : "bg-muted-foreground/40"} transition-all`} style={{ width: `${100 - homePct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      {(homeRow && awayRow) && (
        <Card title="Ladder side by side" icon={BarChart3}>
          <CompareRow label="Ladder position" h={`#${homeRow.position}`} a={`#${awayRow.position}`} />
          <CompareRow label="Wins" h={homeRow.wins} a={awayRow.wins} betterHigh higherWins={homeRow.wins > awayRow.wins} />
          <CompareRow label="Points for" h={homeRow.for} a={awayRow.for} betterHigh higherWins={homeRow.for > awayRow.for} />
          <CompareRow label="Points against" h={homeRow.against} a={awayRow.against} higherWins={homeRow.against < awayRow.against} />
          <CompareRow label="Differential" h={fmtSigned(homeRow.diff)} a={fmtSigned(awayRow.diff)} higherWins={homeRow.diff > awayRow.diff} />
          <CompareRow label="Comp points" h={homeRow.points} a={awayRow.points} higherWins={homeRow.points > awayRow.points} last />
        </Card>
      )}
    </div>
  );
}

function fmtSigned(n: number) { return n > 0 ? `+${n}` : `${n}`; }

function CompareRow({ label, h, a, higherWins, last }: { label: string; h: any; a: any; betterHigh?: boolean; higherWins?: boolean; last?: boolean }) {
  return (
    <div className={`grid grid-cols-3 items-center py-2.5 ${last ? "" : "border-b border-border"}`}>
      <div className={`text-right kbd font-semibold ${higherWins ? "text-accent" : "text-foreground"}`}>{h}</div>
      <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-left kbd font-semibold ${higherWins === false ? "text-accent" : "text-foreground"}`}>{a}</div>
    </div>
  );
}

function SeasonStats({ team, row }: { team: any; row?: any }) {
  return (
    <Card title={team.nickName} icon={Trophy}>
      <div className="flex items-center gap-3 mb-4">
        <TeamLogo themeKey={team.themeKey} name={team.nickName} size={36} />
        {row && <div className="text-xs text-muted-foreground">Ladder #{row.position}</div>}
      </div>

      {row ? (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Stat label="W-L" value={`${row.wins}-${row.losses}`} />
          <Stat label="Pts" value={String(row.points)} />
          <Stat label="PF" value={String(row.for)} />
          <Stat label="Diff" value={fmtSigned(row.diff)} accent={row.diff > 0} danger={row.diff < 0} />
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Form · Last 5</div>
        {team.recentForm.length > 0 ? (
          <div className="flex gap-1">
            {team.recentForm.slice(0, 5).map((f: any, i: number) => (
              <span
                key={i}
                title={`${f.result} ${f.score}`}
                className={`h-6 w-6 rounded-md flex items-center justify-center text-[11px] font-black ${
                  f.result === "Won"
                    ? "bg-accent text-accent-foreground shadow-[0_0_8px_color-mix(in_oklab,var(--accent)_55%,transparent)]"
                    : f.result === "Lost"
                    ? "bg-danger/15 text-danger border border-danger/30"
                    : "bg-surface-2 text-muted-foreground"
                }`}
              >
                {f.result.charAt(0)}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">—</div>
        )}
      </div>
    </Card>
  );
}

function RecentRecapsCard({ home, away, homeRecaps, awayRecaps }: {
  home: { nickName: string; themeKey: string };
  away: { nickName: string; themeKey: string };
  homeRecaps: any[];
  awayRecaps: any[];
}) {
  const blocks: { teamName: string; teamThemeKey: string; recaps: any[] }[] = [
    { teamName: home.nickName, teamThemeKey: home.themeKey, recaps: homeRecaps },
    { teamName: away.nickName, teamThemeKey: away.themeKey, recaps: awayRecaps },
  ];
  return (
    <Card title="Last 2 fixtures · scores & tryscorers" icon={Activity}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {blocks.map((b, bi) => (
          <div key={bi} className="bg-surface-2 rounded-xl p-3 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <TeamLogo themeKey={b.teamThemeKey} name={b.teamName} size={24} />
              <div className="text-xs font-bold uppercase tracking-wider">{b.teamName}</div>
            </div>
            {b.recaps.length === 0 ? (
              <div className="text-xs text-muted-foreground">Recap unavailable.</div>
            ) : (
              b.recaps.map((r: any, ri: number) => {
                const isHome = r.homeNick?.toLowerCase().includes(b.teamName.toLowerCase());
                const teamScore = isHome ? r.homeScore : r.awayScore;
                const oppScore = isHome ? r.awayScore : r.homeScore;
                const oppNick = isHome ? r.awayNick : r.homeNick;
                const oppThemeKey = isHome ? r.awayThemeKey : r.homeThemeKey;
                const teamTries = isHome ? r.homeTryscorers : r.awayTryscorers;
                const oppTries = isHome ? r.awayTryscorers : r.homeTryscorers;
                const won = (teamScore ?? 0) > (oppScore ?? 0);
                const draw = teamScore != null && oppScore != null && teamScore === oppScore;
                const resultBadge = draw ? "D" : won ? "W" : "L";
                const resultCls = draw
                  ? "bg-surface text-muted-foreground"
                  : won
                  ? "bg-accent text-accent-foreground"
                  : "bg-danger/15 text-danger border border-danger/30";
                return (
                  <div key={ri} className="bg-surface rounded-lg p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`h-5 w-5 rounded flex items-center justify-center text-[10px] font-black shrink-0 ${resultCls}`}>{resultBadge}</span>
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">vs</span>
                        <TeamLogo themeKey={oppThemeKey} name={oppNick} size={18} />
                        <span className="text-xs font-semibold truncate">{oppNick}</span>
                      </div>
                      <div className="kbd font-black text-sm shrink-0">
                        <span className={won ? "text-accent" : draw ? "" : "text-danger"}>{teamScore ?? "-"}</span>
                        <span className="text-muted-foreground">–</span>
                        <span>{oppScore ?? "-"}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <TryscorerList label={b.teamName} tries={teamTries ?? []} accent />
                      <TryscorerList label={oppNick} tries={oppTries ?? []} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function TryscorerList({ label, tries, accent }: { label: string; tries: { name: string; count: number }[]; accent?: boolean }) {
  return (
    <div>
      <div className={`text-[9px] uppercase tracking-wider mb-1 truncate ${accent ? "text-accent font-bold" : "text-muted-foreground"}`}>{label}</div>
      {tries.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No tries</div>
      ) : (
        <ul className="space-y-0.5">
          {tries.map((t, i) => (
            <li key={i} className="text-[11px] flex items-center justify-between gap-1">
              <span className="truncate">{t.name}</span>
              {t.count > 1 && <span className="kbd text-[9px] px-1 text-accent shrink-0">×{t.count}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className="bg-surface-2 rounded-lg p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-base font-bold kbd ${accent ? "text-accent" : danger ? "text-danger" : ""}`}>{value}</div>
    </div>
  );
}

/* ================= INSIGHTS TAB — STATISTICAL PREDICTION ENGINE ================= */

type LadderRow = {
  position: number;
  played: number;
  wins: number;
  losses: number;
  for: number;
  against: number;
  diff: number;
  points: number;
};

type TeamLite = { nickName: string; themeKey: string };

type TeamWithPlayers = TeamLite & { players?: { firstName: string; lastName: string; position: string }[] };

/* ================= GAME SCRIPT TAB ================= */

function GameScriptTab({ insights, insightsLoading, home, away }:
  { insights: any; insightsLoading?: boolean; home: TeamWithPlayers; away: TeamWithPlayers }) {
  if (insightsLoading && !insights) return <InsightsLoading />;
  const script = insights?.script as
    | { mode: string; confidence: string; summary: string;
        phases: { first20: string; twenty40: string; forty60: string; sixty80: string };
        edges: { left: string; right: string; middle: string };
        betting: { winnerLean: string; marginLean: string; totalLean: string; tryscorerLean: string };
        earlyNote?: string }
    | undefined;
  if (!script || !script.phases || !script.edges || !script.betting) {
    return <Empty msg="Script unavailable — refresh in a moment." />;
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-bold text-accent mb-1">{title}</div>
      <p className="text-sm leading-relaxed text-foreground/90">{children}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card title="Game Script" icon={ScrollText} className="accent-glow">
        <div className="flex items-center gap-2 mb-3">
          <TeamLogo themeKey={home.themeKey} name={home.nickName} size={22} />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">v</span>
          <TeamLogo themeKey={away.themeKey} name={away.nickName} size={22} />
          <span className="ml-auto text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
            {script.mode} · {script.confidence}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{script.summary}</p>
        {script.earlyNote && (
          <p className="text-[11px] mt-3 italic text-muted-foreground border-l-2 border-accent/40 pl-2">{script.earlyNote}</p>
        )}
      </Card>

      <Card title="Phase by phase" icon={Clock}>
        <div className="space-y-4">
          <Section title="First 20">{script.phases.first20}</Section>
          <Section title="20–40">{script.phases.twenty40}</Section>
          <Section title="40–60">{script.phases.forty60}</Section>
          <Section title="60–80">{script.phases.sixty80}</Section>
        </div>
      </Card>

      <Card title="Edges" icon={Compass}>
        <div className="space-y-4">
          <Section title="Left edge">{script.edges.left}</Section>
          <Section title="Right edge">{script.edges.right}</Section>
          <Section title="Middle">{script.edges.middle}</Section>
        </div>
      </Card>

      <Card title="Betting translation" icon={Receipt} className="accent-glow">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
            <span className="text-muted-foreground">Winner lean</span>
            <span className="font-bold">{script.betting.winnerLean}</span>
          </li>
          <li className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
            <span className="text-muted-foreground">Margin lean</span>
            <span className="font-bold">{script.betting.marginLean}</span>
          </li>
          <li className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
            <span className="text-muted-foreground">Total lean</span>
            <span className="font-bold">{script.betting.totalLean}</span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Tryscorer lean</span>
            <span className="font-bold text-right">{script.betting.tryscorerLean}</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}

function ScriptTab({ insights, insightsError, insightsLoading, home, away, homeRow, awayRow, tryscorers, odds }:
  { insights: any; insightsError: string | null; insightsLoading?: boolean; home: TeamWithPlayers; away: TeamWithPlayers;
    homeRow?: LadderRow; awayRow?: LadderRow; tryscorers: TryscorerMarkets | null; tryscorersError: string | null;
    odds?: OddsEvent | null }) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Insights unavailable." />;

  const model = computeMatchModel(home.nickName, away.nickName, homeRow, awayRow, insights);
  const bookieTotal = pickBookmakerTotal(odds ?? null);

  return (
    <div className="space-y-4">
      <PredictedWinnerCard model={model} home={home} away={away} />
      <StatsComparePanel home={home} away={away} homeRow={homeRow} awayRow={awayRow} model={model} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PredictedScoreCard model={model} home={home} away={away} />
        <MarginCard model={model} insights={insights} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TotalPointsCard model={model} bookieTotal={bookieTotal} />
        <HtFtCard insights={insights} home={home.nickName} away={away.nickName} />
      </div>

      <FirstTryscorerCard insights={insights} tryscorers={tryscorers} />
      <AnytimeTryscorersCard tryscorers={tryscorers} insights={insights} home={home} away={away} model={model} />
      <MultiTryscorerCard insights={insights} tryscorers={tryscorers} />
      <FormTryscorersCard insights={insights} home={home} away={away} />
      
    </div>
  );
}

/* ---------- Predictive model ---------- */

type MatchModel = {
  homeScore: number;
  awayScore: number;
  gap: number;
  winner: "home" | "away";
  confidence: "Low" | "Medium" | "High";
  confidencePct: number;
  predictedHome: number;
  predictedAway: number;
  marginBucket: "1–12" | "13+";
  totalLine: number;
  totalLean: "Over" | "Under";
  baselineTotal: number;
  components: {
    home: { attack: number; defence: number; winPct: number; margin: number; efficiency: number };
    away: { attack: number; defence: number; winPct: number; margin: number; efficiency: number };
  };
};

function computeMatchModel(
  homeName: string,
  awayName: string,
  hr: LadderRow | undefined,
  ar: LadderRow | undefined,
  insights: any,
): MatchModel {
  const aiHome = Number(insights?.predictedScore?.home);
  const aiAway = Number(insights?.predictedScore?.away);
  const baselineTotal = 42;

  const compFor = (row: LadderRow | undefined) => {
    if (!row || row.played <= 0) return { attack: 50, defence: 50, winPct: 50, margin: 50, efficiency: 50 };
    const ppg = row.for / Math.max(1, row.played);
    const cpg = row.against / Math.max(1, row.played);
    const winPct = (row.wins / Math.max(1, row.played)) * 100;
    const margin = (row.diff / Math.max(1, row.played));
    const attack = clamp(((ppg - 12) / (32 - 12)) * 100, 0, 100);
    const defence = clamp((1 - (cpg - 12) / (32 - 12)) * 100, 0, 100);
    const win = clamp(winPct, 0, 100);
    const mar = clamp(50 + margin * 2, 0, 100);
    const eff = clamp(50 + margin * 1.5, 0, 100);
    return { attack, defence, winPct: win, margin: mar, efficiency: eff };
  };

  const hc = compFor(hr);
  const ac = compFor(ar);
  const strength = (c: typeof hc) => (c.attack + c.defence + c.winPct + c.margin + c.efficiency) / 5;
  let homeScore = strength(hc);
  let awayScore = strength(ac);

  if (Number.isFinite(aiHome) && Number.isFinite(aiAway)) {
    const aiGap = aiHome - aiAway;
    homeScore += clamp(aiGap * 0.15, -3, 3);
    awayScore += clamp(-aiGap * 0.15, -3, 3);
  }

  homeScore *= 1.05; // home advantage

  const gap = homeScore - awayScore;
  const winner: "home" | "away" = gap >= 0 ? "home" : "away";
  const absGap = Math.abs(gap);
  const confidence: MatchModel["confidence"] = absGap >= 12 ? "High" : absGap >= 5 ? "Medium" : "Low";
  const confidencePct = clamp(50 + absGap * 3.2, 50, 95);

  let pHome = Number.isFinite(aiHome) ? aiHome : 22;
  let pAway = Number.isFinite(aiAway) ? aiAway : 18;
  if (winner === "home" && pHome <= pAway) { const s = pHome; pHome = pAway; pAway = s; }
  else if (winner === "away" && pAway <= pHome) { const s = pHome; pHome = pAway; pAway = s; }
  const predictedHome = Math.round(pHome);
  const predictedAway = Math.round(pAway);

  const predictedMargin = Math.abs(predictedHome - predictedAway);
  const marginBucket: MatchModel["marginBucket"] = (confidence === "High" || predictedMargin >= 13) ? "13+" : "1–12";

  const homeAttackVsAwayDef = (hc.attack + (100 - ac.defence)) / 2;
  const awayAttackVsHomeDef = (ac.attack + (100 - hc.defence)) / 2;
  const projected = baselineTotal * ((homeAttackVsAwayDef + awayAttackVsHomeDef) / 100);
  const totalLine = Math.round(projected);
  const totalLean: MatchModel["totalLean"] = totalLine >= baselineTotal ? "Over" : "Under";

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
    gap: Math.round(gap * 10) / 10,
    winner,
    confidence,
    confidencePct: Math.round(confidencePct),
    predictedHome,
    predictedAway,
    marginBucket,
    totalLine,
    totalLean,
    baselineTotal,
    components: { home: hc, away: ac },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Pull the most-common totals line from the bookmaker odds payload. */
function pickBookmakerTotal(odds: OddsEvent | null):
  { line: number; over: number; under: number; book: string } | null {
  if (!odds) return null;
  // line -> { totalPrice, count, bestBook { line, over, under, book, score } }
  const lineCounts = new Map<number, number>();
  type Best = { line: number; over: number; under: number; book: string; score: number };
  let best: Best | null = null;

  for (const b of odds.bookmakers) {
    const totals = b.markets.find((m) => m.key === "totals");
    if (!totals) continue;
    const byLine = new Map<number, { over?: number; under?: number }>();
    for (const o of totals.outcomes) {
      if (typeof o.point !== "number") continue;
      const slot = byLine.get(o.point) ?? {};
      if (o.name?.toLowerCase() === "over") slot.over = o.price;
      else if (o.name?.toLowerCase() === "under") slot.under = o.price;
      byLine.set(o.point, slot);
    }
    for (const [line, p] of byLine) {
      if (p.over == null || p.under == null) continue;
      lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
      const score = p.over + p.under;
      if (!best || score > best.score) {
        best = { line, over: p.over, under: p.under, book: b.title, score };
      }
    }
  }
  if (!best) return null;
  // Prefer the most common line if it differs from "best price" line
  let mostCommonLine = best.line;
  let max = 0;
  for (const [line, count] of lineCounts) {
    if (count > max) { max = count; mostCommonLine = line; }
  }
  if (mostCommonLine !== best.line) {
    // re-scan for best over/under at the most-common line
    let alt: Best | null = null;
    for (const b of odds.bookmakers) {
      const totals = b.markets.find((m) => m.key === "totals");
      if (!totals) continue;
      let over: number | undefined; let under: number | undefined;
      for (const o of totals.outcomes) {
        if (o.point !== mostCommonLine) continue;
        if (o.name?.toLowerCase() === "over") over = o.price;
        else if (o.name?.toLowerCase() === "under") under = o.price;
      }
      if (over != null && under != null) {
        const score = over + under;
        if (!alt || score > alt.score) alt = { line: mostCommonLine, over, under, book: b.title, score };
      }
    }
    if (alt) best = alt;
  }
  return { line: best.line, over: best.over, under: best.under, book: best.book };
}

/* ---------- Cards ---------- */

function PredictedWinnerCard({ model, home, away }:
  { model: MatchModel; home: TeamLite; away: TeamLite }) {
  const winnerTeam = model.winner === "home" ? home : away;
  return (
    <Card title="Predicted winner" icon={Trophy} className="accent-glow">
      <div className="flex items-center gap-4">
        <TeamLogo themeKey={winnerTeam.themeKey} name={winnerTeam.nickName} size={64} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Forecast winner</div>
          <div className="text-2xl font-black truncate">{winnerTeam.nickName}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="bg-surface-2 rounded-lg p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{home.nickName} strength</div>
          <div className="text-lg font-black kbd">{model.homeScore}</div>
        </div>
        <div className="bg-surface-2 rounded-lg p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{away.nickName} strength</div>
          <div className="text-lg font-black kbd">{model.awayScore}</div>
        </div>
      </div>
    </Card>
  );
}



function StatsComparePanel({ home, away, homeRow, awayRow, model }:
  { home: TeamLite; away: TeamLite; homeRow?: LadderRow; awayRow?: LadderRow; model: MatchModel }) {
  const hPlayed = Math.max(1, homeRow?.played ?? 0);
  const aPlayed = Math.max(1, awayRow?.played ?? 0);

  const rows: { label: string; hVal: number; aVal: number; hLabel: string; aLabel: string; lowerIsBetter?: boolean }[] = [
    {
      label: "Pts / game",
      hVal: (homeRow?.for ?? 0) / hPlayed,
      aVal: (awayRow?.for ?? 0) / aPlayed,
      hLabel: homeRow ? ((homeRow.for / hPlayed).toFixed(1)) : "–",
      aLabel: awayRow ? ((awayRow.for / aPlayed).toFixed(1)) : "–",
    },
    {
      label: "Conceded / game",
      hVal: (homeRow?.against ?? 0) / hPlayed,
      aVal: (awayRow?.against ?? 0) / aPlayed,
      hLabel: homeRow ? ((homeRow.against / hPlayed).toFixed(1)) : "–",
      aLabel: awayRow ? ((awayRow.against / aPlayed).toFixed(1)) : "–",
      lowerIsBetter: true,
    },
    {
      label: "Win %",
      hVal: homeRow ? (homeRow.wins / hPlayed) * 100 : 0,
      aVal: awayRow ? (awayRow.wins / aPlayed) * 100 : 0,
      hLabel: homeRow ? `${Math.round((homeRow.wins / hPlayed) * 100)}%` : "–",
      aLabel: awayRow ? `${Math.round((awayRow.wins / aPlayed) * 100)}%` : "–",
    },
    {
      label: "Avg margin",
      hVal: 50 + ((homeRow?.diff ?? 0) / hPlayed) * 2,
      aVal: 50 + ((awayRow?.diff ?? 0) / aPlayed) * 2,
      hLabel: homeRow ? fmtMargin(homeRow.diff / hPlayed) : "–",
      aLabel: awayRow ? fmtMargin(awayRow.diff / aPlayed) : "–",
    },
    {
      label: "Ladder",
      hVal: homeRow?.position ? 17 - homeRow.position : 0,
      aVal: awayRow?.position ? 17 - awayRow.position : 0,
      hLabel: homeRow?.position ? `${homeRow.position}` : "–",
      aLabel: awayRow?.position ? `${awayRow.position}` : "–",
    },
    {
      label: "Strength",
      hVal: model.homeScore,
      aVal: model.awayScore,
      hLabel: `${model.homeScore}`,
      aLabel: `${model.awayScore}`,
    },
  ];

  return (
    <Card title="Stats comparison" icon={BarChart3}>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center mb-2">
        <div className="text-right text-xs font-bold truncate">{home.nickName}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center px-2">vs</div>
        <div className="text-left text-xs font-bold truncate">{away.nickName}</div>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <StatBarRow key={r.label} {...r} />
        ))}
      </div>
    </Card>
  );
}

function fmtMargin(m: number): string {
  return `${m >= 0 ? "+" : ""}${m.toFixed(1)}`;
}

function StatBarRow({ label, hVal, aVal, hLabel, aLabel, lowerIsBetter }:
  { label: string; hVal: number; aVal: number; hLabel: string; aLabel: string; lowerIsBetter?: boolean }) {
  const total = Math.max(0.0001, hVal + aVal);
  // For "lower is better" stats (conceded), flip the proportions so the better team's bar is bigger.
  const hPct = lowerIsBetter ? clamp((aVal / total) * 100, 5, 95) : clamp((hVal / total) * 100, 5, 95);
  const aPct = 100 - hPct;
  const hBetter = lowerIsBetter ? hVal < aVal : hVal > aVal;
  const aBetter = lowerIsBetter ? aVal < hVal : aVal > hVal;
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-baseline">
        <div className={`text-right text-sm font-black tabular-nums ${hBetter ? "text-accent" : "text-foreground"}`}>{hLabel}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center px-2">{label}</div>
        <div className={`text-left text-sm font-black tabular-nums ${aBetter ? "text-accent" : "text-foreground"}`}>{aLabel}</div>
      </div>
      <div className="mt-1 flex h-1.5 w-full rounded-full overflow-hidden bg-surface-2">
        <div className={`${hBetter ? "bg-accent" : "bg-muted-foreground/40"} h-full transition-all`} style={{ width: `${hPct}%` }} />
        <div className={`${aBetter ? "bg-accent" : "bg-muted-foreground/40"} h-full transition-all`} style={{ width: `${aPct}%` }} />
      </div>
    </div>
  );
}

function PredictedScoreCard({ model, home, away }:
  { model: MatchModel; home: TeamLite; away: TeamLite }) {
  return (
    <Card title="Predicted score" icon={Target}>
      <div className="grid grid-cols-3 items-center gap-3">
        <div className="flex flex-col items-center text-center min-w-0">
          <TeamLogo themeKey={home.themeKey} name={home.nickName} size={64} />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5 truncate w-full">{home.nickName}</div>
        </div>
        <div className="text-center kbd">
          <span className={`text-3xl sm:text-4xl font-black tabular-nums ${model.predictedHome > model.predictedAway ? "text-accent" : ""}`}>{model.predictedHome}</span>
          <span className="text-muted-foreground mx-1.5 text-lg font-bold">–</span>
          <span className={`text-3xl sm:text-4xl font-black tabular-nums ${model.predictedAway > model.predictedHome ? "text-accent" : ""}`}>{model.predictedAway}</span>
        </div>
        <div className="flex flex-col items-center text-center min-w-0">
          <TeamLogo themeKey={away.themeKey} name={away.nickName} size={64} />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5 truncate w-full">{away.nickName}</div>
        </div>
      </div>
    </Card>
  );
}

function MarginCard({ model }: { model: MatchModel; insights: any }) {
  return (
    <Card title="Winning margin" icon={Gauge}>
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Predicted margin</div>
        <div className="text-3xl font-black kbd text-accent mt-1">{model.marginBucket}</div>
        <div className="text-xs text-muted-foreground mt-1">points</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <Bucket label="1–12" active={model.marginBucket === "1–12"} />
        <Bucket label="13+" active={model.marginBucket === "13+"} />
      </div>
    </Card>
  );
}

function Bucket({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`rounded-lg py-2 text-sm font-bold border ${active ? "bg-accent/15 text-accent border-accent/40" : "bg-surface-2 text-muted-foreground border-border"}`}>
      {label}
    </div>
  );
}

function TotalPointsCard({ model, bookieTotal }:
  { model: MatchModel; bookieTotal: { line: number; over: number; under: number; book: string } | null }) {
  const projected = model.predictedHome + model.predictedAway;
  // Use the bookmaker line when we have one — that's the market-set total.
  const line = bookieTotal?.line ?? model.totalLine + 0.5;
  const lean: "Over" | "Under" = projected >= line ? "Over" : "Under";

  return (
    <Card title="Total match points" icon={Compass}>
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Projected total</div>
        <div className="text-3xl font-black kbd mt-1">{projected}</div>
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-accent !text-white border border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)]">
          {lean === "Over" ? <TrendingUp className="h-3 w-3" /> : <TrendingUp className="h-3 w-3 rotate-180" />}
          {lean} {line}
        </div>
      </div>
      {bookieTotal ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="bg-surface-2 rounded-lg p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Over {bookieTotal.line}</div>
            <div className="text-sm font-black kbd">{bookieTotal.over.toFixed(2)}</div>
          </div>
          <div className="bg-surface-2 rounded-lg p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Under {bookieTotal.line}</div>
            <div className="text-sm font-black kbd">{bookieTotal.under.toFixed(2)}</div>
          </div>
        </div>
      ) : null}
      {bookieTotal ? (
        <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground text-center">Line via {bookieTotal.book}</div>
      ) : null}
    </Card>
  );
}

function HtFtCard({ insights, home, away }: { insights: any; home: string; away: string }) {
  const pick: string = insights?.htft?.pick ?? "—";
  const parts = pick.split(/\s*\/\s*/);
  const htLeader = parts[0] || "—";
  const ftLeader = parts[1] || parts[0] || "—";
  return (
    <Card title="Half-time / full-time" icon={Hourglass}>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-2 rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Half-time leader</div>
          <div className="text-sm font-bold mt-1 truncate">{normaliseSideLabel(htLeader, home, away)}</div>
        </div>
        <div className="bg-surface-2 rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Full-time winner</div>
          <div className="text-sm font-bold mt-1 truncate text-accent">{normaliseSideLabel(ftLeader, home, away)}</div>
        </div>
      </div>
    </Card>
  );
}

function normaliseSideLabel(label: string, home: string, away: string): string {
  const l = label.trim().toLowerCase();
  if (l === "home" || l === "h") return home;
  if (l === "away" || l === "a") return away;
  return label.trim() || "—";
}

/* ---------- Tryscorer model ---------- */

function impliedProb(price: number): number {
  return price > 0 ? 1 / price : 0;
}

function priceFromProb(prob: number): number {
  if (prob <= 0) return 99;
  // Add a small bookie margin so estimated prices look realistic.
  const fair = 1 / prob;
  return Math.max(1.5, Math.min(26, fair * 1.08));
}

/** Lookup a player in a squad by surname / full-name match. */
function affiliatePlayer(playerName: string, home: TeamWithPlayers, away: TeamWithPlayers): "home" | "away" | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const target = norm(playerName);
  if (!target) return null;
  const matches = (squad?: { firstName: string; lastName: string }[]) => {
    if (!squad) return false;
    return squad.some((p) => {
      const full = norm(`${p.firstName}${p.lastName}`);
      const last = norm(p.lastName);
      if (!last) return false;
      return full === target || target === last || target.endsWith(last) || full.includes(target) || target.includes(last);
    });
  };
  if (matches(home.players)) return "home";
  if (matches(away.players)) return "away";
  return null;
}

/** Position weight for try-scoring likelihood (higher = more likely to score). */
function positionWeight(rawPos: string): number {
  const p = (rawPos || "").toLowerCase();
  if (/wing/.test(p)) return 1.00;
  if (/full ?back|fullback|fb\b/.test(p)) return 0.85;
  if (/centre|center/.test(p)) return 0.75;
  if (/five|5\/?8|stand ?off/.test(p)) return 0.55;
  if (/half|halfback/.test(p)) return 0.50;
  if (/lock/.test(p)) return 0.40;
  if (/second ?row|backrow|2nd row|edge/.test(p)) return 0.45;
  if (/hooker|dummy ?half/.test(p)) return 0.30;
  if (/prop|front ?row/.test(p)) return 0.20;
  return 0.35; // bench / unknown
}

type AnytimePick = {
  name: string;
  price: number;
  prob: number;
  team: "home" | "away";
  source: "live" | "model";
  book?: string;
};

/**
 * Build the canonical anytime tryscorer list: 3 from each team.
 * Uses live bookmaker prices when published, otherwise estimates from
 * position weighting + the model's predicted try output for each side.
 */
function buildTeamTryscorers(
  team: "home" | "away",
  squad: TeamWithPlayers,
  predictedPoints: number,
  liveByName: Map<string, { price: number; book: string }>,
): AnytimePick[] {
  const players = squad.players ?? [];
  if (players.length === 0) return [];

  // Estimate team try volume from predicted points (≈ 4 pts per try after conversions).
  const expectedTries = Math.max(1.5, Math.min(6, predictedPoints / 4.5));

  // Weight every player by position; first 17 (named squad) only.
  const named = players.slice(0, 17);
  const weights = named.map((p) => ({ player: p, w: positionWeight(p.position) }));
  const totalW = weights.reduce((s, x) => s + x.w, 0) || 1;

  const picks: AnytimePick[] = weights.map(({ player, w }) => {
    const fullName = `${player.firstName} ${player.lastName}`.trim();
    const live = liveByName.get(fullName.toLowerCase()) ?? liveByName.get(player.lastName.toLowerCase());
    let prob: number;
    let price: number;
    let source: "live" | "model" = "model";
    let book: string | undefined;

    if (live) {
      price = live.price;
      prob = impliedProb(price);
      source = "live";
      book = live.book;
    } else {
      // Model probability: share of expected tries × conversion rate.
      const share = w / totalW;
      // Probability that THIS player scores at least one try ≈ 1 - (1 - share)^expectedTries
      prob = 1 - Math.pow(1 - share, expectedTries);
      prob = Math.min(0.78, Math.max(0.06, prob));
      price = priceFromProb(prob);
    }

    return { name: fullName, price, prob, team, source, book };
  });

  return picks.sort((a, b) => b.prob - a.prob).slice(0, 3);
}

function buildAnytimeBoard(
  tryscorers: TryscorerMarkets | null,
  home: TeamWithPlayers,
  away: TeamWithPlayers,
  model: MatchModel,
): { home: AnytimePick[]; away: AnytimePick[]; hasLive: boolean; book: string | null } {
  // Index live odds by both full name and surname for robust matching.
  const liveByName = new Map<string, { price: number; book: string }>();
  let book: string | null = null;
  for (const t of tryscorers?.anytime ?? []) {
    const full = t.player.toLowerCase().trim();
    liveByName.set(full, { price: t.price, book: t.book });
    const parts = full.split(/\s+/);
    const last = parts[parts.length - 1];
    if (last && !liveByName.has(last)) liveByName.set(last, { price: t.price, book: t.book });
    if (!book) book = t.book;
  }

  const homePicks = buildTeamTryscorers("home", home, model.predictedHome, liveByName);
  const awayPicks = buildTeamTryscorers("away", away, model.predictedAway, liveByName);

  return {
    home: homePicks,
    away: awayPicks,
    hasLive: (tryscorers?.anytime?.length ?? 0) > 0,
    book,
  };
}

function FirstTryscorerCard({ insights, tryscorers }: { insights: any; tryscorers: TryscorerMarkets | null }) {
  const aiPick: string = insights?.firstTryscorer?.pick ?? "Awaiting team list";
  const top = tryscorers?.first?.[0];
  const headline = top?.player || aiPick;
  return (
    <Card title="First tryscorer" icon={Flag} className="accent-glow">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
          <Crown className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Top pick</div>
          <div className="text-xl font-black truncate">{headline}</div>
        </div>
        {top ? (
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Best</div>
            <div className="text-lg font-black kbd">{top.price.toFixed(2)}</div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function AnytimeTryscorersCard({ tryscorers, home, away, model }:
  { tryscorers: TryscorerMarkets | null; insights: any; home: TeamWithPlayers; away: TeamWithPlayers; model: MatchModel }) {
  const board = buildAnytimeBoard(tryscorers, home, away, model);

  return (
    <Card title="Anytime tryscorers" icon={Sparkles}>
      {board.hasLive ? (
        <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-wider">
          <span className="px-2 py-0.5 rounded-md bg-accent !text-white border border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)] font-bold">Live odds{board.book ? ` · ${board.book}` : ""}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TryscorerTeamColumn title={home.nickName} picks={board.home} accent />
        <TryscorerTeamColumn title={away.nickName} picks={board.away} />
      </div>
    </Card>
  );
}

function TryscorerTeamColumn({ title, picks, accent }: { title: string; picks: AnytimePick[]; accent?: boolean }) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider font-bold mb-2 ${accent ? "text-accent" : "text-muted-foreground"}`}>{title}</div>
      {picks.length === 0 ? (
        <p className="text-xs text-muted-foreground">Squad not yet available.</p>
      ) : (
        <ul className="space-y-1.5">
          {picks.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex items-center gap-2">
              <span className="kbd h-5 w-5 rounded-full bg-surface-2 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <span className="text-sm font-semibold truncate flex-1">{p.name}</span>
              <span className="text-xs font-black tabular-nums px-2 py-0.5 rounded-full bg-accent !text-white border border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)]">{p.price.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MultiTryscorerCard({ insights, tryscorers }: { insights: any; tryscorers: TryscorerMarkets | null }) {
  const live = (tryscorers?.multi ?? []).slice(0, 4);
  const aiPick: string = insights?.multiTryscorer?.pick ?? "";
  return (
    <Card title="Multi-try predictions (2+ tries)" icon={Trophy}>
      {live.length > 0 ? (
        <ul className="space-y-2">
          {live.map((p, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="kbd w-5 text-center text-[11px] font-bold text-muted-foreground">{i + 1}</span>
              <span className="flex-1 font-medium truncate">{p.player}</span>
              <span className="text-xs font-black tabular-nums px-2 py-0.5 rounded-full bg-accent !text-white border border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)]">{p.price.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      ) : aiPick ? (
        <div className="text-base font-bold">{aiPick}</div>
      ) : (
        <p className="text-sm text-muted-foreground">Multi-try markets release with team lists.</p>
      )}
    </Card>
  );
}


/* ---------- Form-based tryscorer suggestions (forwards welcome) ---------- */

function FormTryscorersCard({ insights, home, away }:
  { insights: any; home: TeamWithPlayers; away: TeamWithPlayers }) {
  const pool: { name: string; reasoning: string }[] = [
    ...(insights?.scriptAnalyst?.predictions?.anytimeTryscorers ?? []),
    ...(insights?.scriptAnalyst?.predictions?.scoringPool ?? []),
  ];

  // De-duplicate by name (case insensitive) preserving order.
  const seen = new Set<string>();
  const merged = pool.filter((p) => {
    const k = (p.name || "").toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Split by team using squad lookup; players that don't match either side
  // (generic "Knights winger" placeholders) get bucketed by simple text match.
  const homePicks: { name: string; reasoning: string }[] = [];
  const awayPicks: { name: string; reasoning: string }[] = [];
  for (const p of merged) {
    const aff = affiliatePlayer(p.name, home, away);
    if (aff === "home") homePicks.push(p);
    else if (aff === "away") awayPicks.push(p);
    else {
      const lc = p.name.toLowerCase();
      if (lc.includes(home.nickName.toLowerCase())) homePicks.push(p);
      else if (lc.includes(away.nickName.toLowerCase())) awayPicks.push(p);
    }
  }

  if (homePicks.length === 0 && awayPicks.length === 0) return null;

  return (
    <Card title="Form-based tryscorer suggestions" icon={Activity}>
      <p className="text-xs text-muted-foreground mb-3">
        Picks weighted by recent form, season output and matchup — not the shortest-priced favourites.
        Forwards and second-rowers included where the script suits them.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormPickColumn title={home.nickName} picks={homePicks.slice(0, 4)} accent />
        <FormPickColumn title={away.nickName} picks={awayPicks.slice(0, 4)} />
      </div>
    </Card>
  );
}

function FormPickColumn({ title, picks, accent }:
  { title: string; picks: { name: string; reasoning: string }[]; accent?: boolean }) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider font-bold mb-2 ${accent ? "text-accent" : "text-muted-foreground"}`}>{title}</div>
      {picks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No form-based picks yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {picks.map((p, i) => (
            <li key={`${p.name}-${i}`} className="bg-surface-2 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <span className="kbd h-5 w-5 rounded-full bg-background text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="text-sm font-bold flex-1">{p.name}</span>
              </div>
              {p.reasoning ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">{p.reasoning}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/* ============================================================
   Insights tab — strict analyst-format match intelligence.
   5 sections, NO probabilities / percentages / confidence scores.
   Every field is unique-per-fixture (driven by AI payload).
   ============================================================ */

function AnytimeOddsTag({ price }: { price: number | null }) {
  if (price == null) return null;
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30 text-[10px] font-black uppercase tracking-wider tabular-nums whitespace-nowrap"
      title="Anytime tryscorer odds (best market price)"
    >
      Anytime {price.toFixed(2)}
    </span>
  );
}

function InsightsTab({ insights, insightsError, insightsLoading, home, away, tryscorers, odds, lessons }:
  { insights: any; insightsError: string | null; insightsLoading?: boolean;
    home: TeamWithPlayers; away: TeamWithPlayers;
    homeRow?: LadderRow; awayRow?: LadderRow;
    tryscorers: TryscorerMarkets | null; tryscorersError?: string | null;
    odds?: OddsEvent | null;
    lessons?: { home: any | null; away: any | null } }) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Insights unavailable." />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Insights unavailable." />;

  const det = insights?.deterministic;
  if (!det) return <Empty msg="Stats engine output not yet computed for this fixture." />;

  const winnerNick: string = det.matchWinner?.nickname ?? home.nickName;
  const winnerSide: "home" | "away" = det.matchWinner?.team ?? "home";
  const winnerTeam = winnerSide === "home" ? home : away;
  const bestOdds = odds ? bestH2H(odds) : { home: null, away: null };
  const winnerPrice = winnerSide === "home" ? bestOdds.home : bestOdds.away;

  const firstTryPrice = tryscorers?.first?.[0]?.price ?? null;

  // Map player name -> best anytime tryscorer price (sourced from The Odds API).
  const anytimePriceByName = new Map<string, number>();
  for (const t of tryscorers?.anytime ?? []) {
    const key = t.player.trim().toLowerCase();
    const existing = anytimePriceByName.get(key);
    if (existing == null || t.price < existing) anytimePriceByName.set(key, t.price);
  }
  const getAnytime = (name?: string | null): number | null => {
    if (!name) return null;
    return anytimePriceByName.get(name.trim().toLowerCase()) ?? null;
  };

  // Map player name -> best 2+ tryscorer price.
  const multiPriceByName = new Map<string, number>();
  for (const t of tryscorers?.multi ?? []) {
    const key = t.player.trim().toLowerCase();
    const existing = multiPriceByName.get(key);
    if (existing == null || t.price < existing) multiPriceByName.set(key, t.price);
  }
  const getMulti = (name?: string | null): number | null => {
    if (!name) return null;
    return multiPriceByName.get(name.trim().toLowerCase()) ?? null;
  };

  return (
    <div className="space-y-4">
      {/* 1 — Match Winner */}
      <Card title="Match winner" icon={Trophy} className="accent-glow">
        <div className="flex items-center gap-3 mb-2">
          <TeamLogo themeKey={winnerTeam.themeKey} name={winnerNick} size={40} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Projected winner</div>
            <div className="text-lg font-black truncate">{winnerNick}</div>
          </div>
          {winnerPrice ? (
            <span className="text-base font-black tabular-nums px-3 py-1.5 rounded-full bg-accent !text-white border border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)] shrink-0">
              {winnerPrice.price.toFixed(2)}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{det.matchWinner?.reasoning}</p>
      </Card>

      {/* 2 — Winning Margin */}
      <Card title="Winning margin" icon={Gauge}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Projected margin band</div>
        <div className="text-2xl font-black mb-2 text-accent">{det.margin?.bucket}</div>
        <p className="text-sm leading-relaxed text-foreground/90">{det.margin?.reasoning}</p>
      </Card>

      {/* 3 — Predicted Score */}
      <Card title="Predicted score" icon={BarChart3}>
        <div className="flex items-center justify-center gap-4 mb-3">
          <div className="flex flex-col items-center gap-1">
            <TeamLogo themeKey={home.themeKey} name={home.nickName} size={32} />
            <div className="text-[11px] font-bold truncate max-w-[100px]">{home.nickName}</div>
          </div>
          <div className="kbd flex items-center gap-2 px-4 py-2">
            <span className="text-3xl font-black tabular-nums">{det.predictedScore?.home}</span>
            <span className="text-muted-foreground">–</span>
            <span className="text-3xl font-black tabular-nums">{det.predictedScore?.away}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <TeamLogo themeKey={away.themeKey} name={away.nickName} size={32} />
            <div className="text-[11px] font-bold truncate max-w-[100px]">{away.nickName}</div>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{det.predictedScore?.reasoning}</p>
      </Card>

      {/* 4 — Total Points (Over/Under) */}
      <Card title="Points over / under" icon={TrendingUp}>
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-2xl font-black text-accent uppercase">{det.totalPoints?.lean}</span>
          <span className="text-2xl font-black tabular-nums">{det.totalPoints?.line}</span>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{det.totalPoints?.reasoning}</p>
      </Card>

      {/* 5 — HT/FT Double */}
      <Card title="Halftime / fulltime double" icon={Hourglass}>
        <div className="text-2xl font-black mb-2 text-accent">{det.htft?.pick}</div>
        <p className="text-sm leading-relaxed text-foreground/90">{det.htft?.reasoning}</p>
      </Card>

      {/* 6 — First Tryscorer */}
      <Card title="First tryscorer" icon={Flag} className="accent-glow">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <Crown className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Top opening-set pick</div>
            <div className="text-xl font-black truncate">{det.firstTryscorer?.name}</div>
            <div className="text-[11px] text-muted-foreground">{det.firstTryscorer?.team} · {det.firstTryscorer?.position}</div>
            {det.firstTryscorer?.reasoning && (
              <p className="text-sm leading-relaxed text-foreground/90 mt-2">{det.firstTryscorer.reasoning}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {firstTryPrice != null ? (
              <span className="text-lg font-black tabular-nums px-3 py-1.5 rounded-full bg-accent !text-white border border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)]">
                {firstTryPrice.toFixed(2)}
              </span>
            ) : null}
            <AnytimeOddsTag price={getAnytime(det.firstTryscorer?.name)} />
          </div>
        </div>
      </Card>

      {/* 8 — Player Double (2+ tries) — moved to sit below First tryscorer */}
      <Card title="Player to score 2+ tries" icon={Crown}>
        {!det.playerDouble?.name || det.playerDouble.name === "Awaiting team list" ? (
          <p className="text-sm text-muted-foreground">{det.playerDouble?.reasoning ?? "Awaiting team list."}</p>
        ) : (
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <Crown className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Double-try ceiling</div>
              <div className="text-xl font-black truncate">{det.playerDouble.name}</div>
              <div className="text-[11px] text-muted-foreground">{det.playerDouble.team} · {det.playerDouble.position}</div>
              {det.playerDouble.reasoning && (
                <p className="text-sm leading-relaxed text-foreground/90 mt-2">{det.playerDouble.reasoning}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {(() => {
                const doublePrice = getMulti(det.playerDouble.name) ?? det.playerDouble.price ?? null;
                return doublePrice != null ? (
                  <span className="text-lg font-black tabular-nums px-3 py-1.5 rounded-full bg-accent !text-white border border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)]">
                    {doublePrice.toFixed(2)}
                  </span>
                ) : null;
              })()}
              <AnytimeOddsTag price={getAnytime(det.playerDouble.name)} />
            </div>
          </div>
        )}
      </Card>

      {/* 7 — First / Second / Third Tryscorer */}
      <Card title="First / second / third tryscorer" icon={Target}>
        <ul className="space-y-2.5">
          {[det.rankedTryscorers?.first, det.rankedTryscorers?.second, det.rankedTryscorers?.third].map((p: any, i: number) => (
            <li key={i} className="flex items-start gap-3 bg-surface-2 rounded-lg p-2.5">
              <span className="kbd h-6 w-6 rounded-full bg-background text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{p?.name ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground">{p?.team} · {p?.position}</div>
                {p?.reasoning && <p className="text-[11px] text-muted-foreground leading-snug mt-1">{p.reasoning}</p>}
              </div>
              <AnytimeOddsTag price={getAnytime(p?.name) ?? p?.price ?? null} />
            </li>
          ))}
        </ul>
      </Card>

      {/* 10 — Predicted Outcome (moved above Top 3 anytime) */}
      {det.predictedOutcome && (
        <Card title="Predicted outcome" icon={Trophy} className="accent-glow">
          <p className="text-sm leading-relaxed text-foreground/90 mb-3">{det.predictedOutcome.summary}</p>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Three anytime tryscorers backing this script</div>
          <ul className="space-y-2.5">
            {(det.predictedOutcome.picks ?? []).map((p: any, i: number) => (
              <li key={`${p.name}-${i}`} className="flex items-start gap-3 bg-surface-2 rounded-lg p-2.5">
                <span className="kbd h-6 w-6 rounded-full bg-background text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{p?.name ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{p?.team} · {p?.position}</div>
                  {p?.reasoning && <p className="text-[11px] text-muted-foreground leading-snug mt-1">{p.reasoning}</p>}
                </div>
                <AnytimeOddsTag price={getAnytime(p?.name) ?? p?.price ?? null} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 9 — Top 3 anytime tryscorers per team */}
      <Card title="Top 3 anytime tryscorers — each team" icon={Sparkles}>
        {((!det.topAnytimeHome || det.topAnytimeHome.length === 0) && (!det.topAnytimeAway || det.topAnytimeAway.length === 0)) ? (
          <p className="text-sm text-muted-foreground">Try-scoring board pending squad release.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: home?.nickName ?? "Home", themeKey: home?.themeKey ?? "", list: det.topAnytimeHome ?? [] },
              { label: away?.nickName ?? "Away", themeKey: away?.themeKey ?? "", list: det.topAnytimeAway ?? [] },
            ].map((col) => (
              <div key={col.label}>
                <div className="flex items-center gap-2 mb-2">
                  <TeamLogo themeKey={col.themeKey} name={col.label} size={22} />
                  <div className="text-sm font-black truncate">{col.label}</div>
                </div>
                {col.list.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Pending squad.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {col.list.slice(0, 3).map((r: any, i: number) => (
                      <li key={`${r.name}-${i}`} className="flex items-start gap-3 bg-surface-2 rounded-lg p-2.5">
                        <span className="kbd h-6 w-6 rounded-full bg-background text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold truncate">{r.name}</div>
                          <div className="text-[10px] text-muted-foreground">{r.position}</div>
                          {r.reasoning && <p className="text-[11px] text-muted-foreground leading-snug mt-1">{r.reasoning}</p>}
                        </div>
                        <AnytimeOddsTag price={getAnytime(r.name) ?? r.price ?? null} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 9b — Secondary Tier Picks (2 per team, forwards/outside top 6) */}
      <Card title="Secondary Tier Picks" icon={Sparkles}>
        {(!det.forwardPicks || det.forwardPicks.length === 0) ? (
          <p className="text-sm text-muted-foreground">Secondary tier picks pending squad release.</p>
        ) : (
          <>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Two per team — forwards / next-best scorers if the top 6 anytimes don't convert</div>
            <ul className="space-y-2.5">
              {det.forwardPicks.map((r: any, i: number) => (
                <li key={`${r.name}-${i}`} className="flex items-start gap-3 bg-surface-2 rounded-lg p-2.5">
                  <span className="kbd h-6 w-6 rounded-full bg-background text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground">{r.team} · {r.position}</div>
                    {r.reasoning && <p className="text-[11px] text-muted-foreground leading-snug mt-1">{r.reasoning}</p>}
                  </div>
                  <AnytimeOddsTag price={getAnytime(r.name) ?? r.price ?? null} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* 9c — Top 3 try assists per team */}
      <Card title="Top 3 try assists — each team" icon={Compass}>
        {((!det.tryAssistsHome || det.tryAssistsHome.length === 0) && (!det.tryAssistsAway || det.tryAssistsAway.length === 0)) ? (
          <p className="text-sm text-muted-foreground">Try-assist board pending squad release.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: home?.nickName ?? "Home", themeKey: home?.themeKey ?? "", list: det.tryAssistsHome ?? [] },
              { label: away?.nickName ?? "Away", themeKey: away?.themeKey ?? "", list: det.tryAssistsAway ?? [] },
            ].map((col) => (
              <div key={col.label}>
                <div className="flex items-center gap-2 mb-2">
                  <TeamLogo themeKey={col.themeKey} name={col.label} size={22} />
                  <div className="text-sm font-black truncate">{col.label}</div>
                </div>
                {col.list.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Pending squad.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {col.list.slice(0, 3).map((r: any, i: number) => (
                      <li key={`${r.name}-${i}`} className="flex items-start gap-3 bg-surface-2 rounded-lg p-2.5">
                        <span className="kbd h-6 w-6 rounded-full bg-background text-xs font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold truncate">{r.name}</div>
                          <div className="text-[10px] text-muted-foreground">{r.position}</div>
                          {r.reasoning && <p className="text-[11px] text-muted-foreground leading-snug mt-1">{r.reasoning}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Last week's lessons (carry-forward from previous Aftermatch) — always render so empty states are visible */}
      <LessonsCard home={home} away={away} lessons={lessons ?? { home: null, away: null }} />

    </div>
  );
}

function EdgeColumn({ title, themeKey, strengths, weaknesses, accent }:
  { title: string; themeKey: string; strengths: { title: string; detail: string }[]; weaknesses: { title: string; detail: string }[]; accent?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <TeamLogo themeKey={themeKey} name={title} size={28} />
        <div className={`text-sm font-black truncate ${accent ? "text-accent" : "text-foreground"}`}>{title}</div>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-success font-bold mb-1.5 flex items-center gap-1">
        <ThumbsUp className="h-3 w-3" /> Attacking edge
      </div>
      <ul className="space-y-1.5 mb-3">
        {strengths.length === 0 ? (
          <li className="text-xs text-muted-foreground">—</li>
        ) : strengths.map((s, i) => (
          <li key={i} className="text-xs leading-snug">
            <span className="font-bold">{s.title}.</span>{" "}
            <span className="text-muted-foreground">{s.detail}</span>
          </li>
        ))}
      </ul>
      <div className="text-[10px] uppercase tracking-wider text-warning font-bold mb-1.5 flex items-center gap-1">
        <ThumbsDown className="h-3 w-3" /> Defensive vulnerability
      </div>
      <ul className="space-y-1.5">
        {weaknesses.length === 0 ? (
          <li className="text-xs text-muted-foreground">—</li>
        ) : weaknesses.map((s, i) => (
          <li key={i} className="text-xs leading-snug">
            <span className="font-bold">{s.title}.</span>{" "}
            <span className="text-muted-foreground">{s.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutlookCell({ label, pick, price, accent }: { label: string; pick: string; price?: string | null; accent?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${accent ? "bg-accent/10 border-accent/30" : "bg-surface-2 border-border/40"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}</div>
      <div className={`text-sm font-black mt-1 leading-tight ${accent ? "text-accent" : "text-foreground"}`}>{pick}</div>
      {price ? (
        <div className="mt-1.5 text-[11px] font-black tabular-nums inline-block px-1.5 py-0.5 rounded-full bg-accent !text-white border border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)]">{price}</div>
      ) : null}
    </div>
  );
}

function capitaliseFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}


const formatDate = (utc: string): string => {
  if (!utc) return "TBC";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Pacific/Auckland",
    weekday: "short", day: "numeric", month: "short",
  }).format(d);
};

const formatTime = (utc: string): string => {
  if (!utc) return "";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Pacific/Auckland",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d).toLowerCase();
};

/* ================= BET TAB — PROFESSIONAL BETSLIP ================= */

type BetLeg = {
  id: string;
  market: string;
  selection: string;
  detail?: string;
  price: number;
  // Optional selectable options { label, price }
  options?: { label: string; price: number }[];
};

// Margin price by bucket (rough but consistent across both sides)
function marginPriceFor(bucket: string): number {
  switch (bucket) {
    case "1-12": return 1.65;
    case "13+":  return 2.40;
    case "1-2":  return 6.50;
    case "3-12": return 1.95;
    case "13-24": return 3.10;
    case "25+":  return 4.50;
    default: return 2.00;
  }
}

function htftPriceFor(label: string, favouriteLabel: string): number {
  // Cheaper for favourite/favourite, expensive for underdog double or comebacks
  if (label === favouriteLabel) return 2.40;
  if (label.includes("Draw")) return 21.0;
  const [ht, ft] = label.split(" / ");
  if (ht === ft) return 4.50; // led wire-to-wire by underdog
  return 6.50; // mixed comeback
}

function totalPriceFor(side: "Over" | "Under", line: number, lean: "Over" | "Under"): number {
  // Slight juice toward the leaning side
  return side === lean ? 1.85 : 1.95;
}

function BetTab({ insights, insightsError, insightsLoading, home, away, tryscorers, odds }:
  { insights: any; insightsError: string | null; insightsLoading?: boolean;
    home: TeamWithPlayers; away: TeamWithPlayers;
    tryscorers: TryscorerMarkets | null; odds?: OddsEvent | null }) {

  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Insights unavailable." />;
  const det = insights?.deterministic;
  if (!det) return <Empty msg="Stats engine output not yet computed for this fixture." />;

  // Best anytime price lookup
  const anytimePriceByName = new Map<string, number>();
  for (const t of tryscorers?.anytime ?? []) {
    const key = t.player.trim().toLowerCase();
    const existing = anytimePriceByName.get(key);
    if (existing == null || t.price < existing) anytimePriceByName.set(key, t.price);
  }
  const getAnytime = (name?: string | null): number | null => {
    if (!name) return null;
    return anytimePriceByName.get(name.trim().toLowerCase()) ?? null;
  };

  // Match Winner odds (selectable both sides)
  const winnerSide: "home" | "away" = det.matchWinner?.team ?? "home";
  const winnerNick: string = det.matchWinner?.nickname ?? home.nickName;
  const bestOdds = odds ? bestH2H(odds) : { home: null, away: null };
  const homeWinPrice = bestOdds.home?.price ?? (winnerSide === "home" ? 1.85 : 2.10);
  const awayWinPrice = bestOdds.away?.price ?? (winnerSide === "away" ? 1.85 : 2.10);
  const winnerOptions = [
    { label: home.nickName, price: Number(homeWinPrice.toFixed(2)) },
    { label: away.nickName, price: Number(awayWinPrice.toFixed(2)) },
  ];
  const initialWinner = winnerOptions.find((o) => o.label === winnerNick) ?? winnerOptions[0];

  // Winning margin — only 1-12 or 13+ per team. Mutually exclusive with Match Winner.
  // "No margin" leaves only the Match Winner price in the calc.
  // Prices vary by team (favourite vs underdog) and bucket so the calculator
  // recalculates the payout when the user picks a different outcome.
  const marginBuckets = ["1-12", "13+"];
  const NO_MARGIN_LABEL = "No margin (use match winner)";
  // Derive favourite from match-winner prices (lower price = favourite).
  const homeIsFav = homeWinPrice <= awayWinPrice;
  const marginPriceForTeam = (team: "home" | "away", bucket: string): number => {
    const isFav = team === "home" ? homeIsFav : !homeIsFav;
    if (bucket === "1-12") return Number((isFav ? 2.40 : 4.20).toFixed(2));
    // 13+
    return Number((isFav ? 3.50 : 8.00).toFixed(2));
  };
  const marginOptions: { label: string; price: number }[] = [
    { label: NO_MARGIN_LABEL, price: 1 },
    ...marginBuckets.map((b) => ({ label: `${home.nickName} ${b}`, price: marginPriceForTeam("home", b) })),
    ...marginBuckets.map((b) => ({ label: `${away.nickName} ${b}`, price: marginPriceForTeam("away", b) })),
  ];
  const rawDetBucket = String(det.margin?.bucket ?? "1-12").replace("–", "-");
  const detMarginBucket = rawDetBucket === "13+" ? "13+" : "1-12";
  const initialMarginLabel = `${winnerNick} ${detMarginBucket}`;
  const initialMargin = marginOptions.find((o) => o.label === initialMarginLabel) ?? marginOptions[0];

  // Total points — Over/Under selectable
  const rawLean = String(det.totalPoints?.lean ?? "Over").toLowerCase();
  const totalLean: "Over" | "Under" = rawLean.startsWith("u") ? "Under" : "Over";
  const totalLine = det.totalPoints?.line ?? 41.5;
  const totalOptions = [
    { label: `Over ${totalLine}`, price: totalPriceFor("Over", totalLine, totalLean) },
    { label: `Under ${totalLine}`, price: totalPriceFor("Under", totalLine, totalLean) },
  ];

  // HT/FT — all 9 combos
  const sides = [home.nickName, "Draw", away.nickName];
  const favouriteLabel = `${winnerNick} / ${winnerNick}`;
  const htftOptions = sides.flatMap((ht) =>
    sides.map((ft) => {
      const label = `${ht} / ${ft}`;
      return { label, price: htftPriceFor(label, favouriteLabel) };
    })
  );
  const detHtftPick = det.htft?.pick ?? favouriteLabel;
  const initialHtft = htftOptions.find((o) => o.label === detHtftPick) ?? htftOptions.find((o) => o.label === favouriteLabel)!;

  // 3 anytime tryscorers from insights
  const outcomePicks: any[] = det.predictedOutcome?.picks ?? [];
  const fallbackPicks: any[] = [
    ...(det.topAnytimeHome ?? []).slice(0, 2),
    ...(det.topAnytimeAway ?? []).slice(0, 1),
  ];
  const tryscorerPicks: any[] = (outcomePicks.length >= 3 ? outcomePicks : fallbackPicks).slice(0, 3);

  const initialLegs: BetLeg[] = [
    {
      id: "winner",
      market: "Match Winner",
      selection: initialWinner.label,
      price: initialWinner.price,
      options: winnerOptions,
    },
    {
      id: "margin",
      market: "Winning Margin",
      selection: initialMargin.label,
      price: initialMargin.price,
      options: marginOptions,
    },
    {
      id: "total",
      market: "Total Points",
      selection: `${totalLean} ${totalLine}`,
      price: totalPriceFor(totalLean, totalLine, totalLean),
      options: totalOptions,
    },
    {
      id: "htft",
      market: "Halftime / Fulltime Double",
      selection: initialHtft.label,
      price: initialHtft.price,
      options: htftOptions,
    },
    ...tryscorerPicks.map((p, i) => {
      const livePrice = getAnytime(p?.name);
      return {
        id: `tryscorer-${i}`,
        market: `Anytime Tryscorer ${i + 1}`,
        selection: p?.name ?? "—",
        detail: p?.team ? `${p.team}${p.position ? ` · ${p.position}` : ""}` : (p?.position ?? ""),
        price: livePrice ?? (typeof p?.price === "number" ? p.price : 4.50),
      };
    }),
  ];

  const [legs, setLegs] = useState<BetLeg[]>(initialLegs);
  const [stake, setStake] = useState<string>("10");
  const [addingTry, setAddingTry] = useState<boolean>(false);

  const removeLeg = (id: string) => setLegs((prev) => prev.filter((l) => l.id !== id));

  const updateLegSelection = (id: string, label: string) => {
    setLegs((prev) => prev.map((l) => {
      if (l.id !== id || !l.options) return l;
      const opt = l.options.find((o) => o.label === label);
      if (!opt) return l;
      return { ...l, selection: opt.label, price: opt.price };
    }));
  };

  // Players already on the slip (anytime legs) — exclude from add list
  const usedTryscorerNames = new Set(
    legs.filter((l) => l.market.startsWith("Anytime Tryscorer")).map((l) => l.selection.trim().toLowerCase())
  );

  // Live tryscorer markets sourced exclusively from The Odds API. No estimates —
  // if bookies haven't released player markets yet (~24h pre-game), the add
  // button is disabled with a clear message.
  type TryCandidate = { player: string; price: number; team: string; isEstimate: false };
  const allCandidates: TryCandidate[] = (tryscorers?.anytime ?? []).map((t) => {
    const aff = affiliatePlayer(t.player, home, away);
    const teamLabel = aff === "home" ? home.nickName : aff === "away" ? away.nickName : "";
    return { player: t.player, price: t.price, team: teamLabel, isEstimate: false };
  });
  const availableTryscorers = allCandidates
    .filter((t) => !usedTryscorerNames.has(t.player.trim().toLowerCase()))
    .sort((a, b) => a.price - b.price);
  const marketsLive = (tryscorers?.anytime?.length ?? 0) > 0;

  const addTryscorer = (name: string) => {
    const t = allCandidates.find((x) => x.player === name);
    if (!t) return;
    setLegs((prev) => {
      const idx = prev.filter((l) => l.market.startsWith("Anytime Tryscorer")).length + 1;
      return [
        ...prev,
        {
          id: `tryscorer-extra-${Date.now()}`,
          market: `Anytime Tryscorer ${idx}${t.isEstimate ? " (est.)" : ""}`,
          selection: t.player,
          detail: t.team,
          price: t.price,
        },
      ];
    });
    setAddingTry(false);
  };

  // Mutual exclusion: if a Winning Margin is selected (not "No margin"), exclude Match Winner from calc.
  const marginLeg = legs.find((l) => l.id === "margin");
  const marginActive = !!marginLeg && marginLeg.selection !== NO_MARGIN_LABEL;
  const totalOdds = legs.reduce((acc, l) => {
    if (marginActive && l.id === "winner") return acc;
    if (!marginActive && l.id === "margin") return acc;
    return acc * l.price;
  }, 1);
  const stakeNum = Math.max(0, Number(stake) || 0);
  const payout = stakeNum * totalOdds;
  const profit = payout - stakeNum;

  return (
    <div className="space-y-4 pt-4">
      <Card title="Betslip" icon={Receipt} className="accent-glow">
        <div className="flex items-center justify-between mb-4 -mt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            {(() => {
              const counted = legs.filter((l) => !((marginActive && l.id === "winner") || (!marginActive && l.id === "margin"))).length;
              return `${counted} ${counted === 1 ? "leg" : "legs"} · Multi`;
            })()}
          </div>
          <div className="flex items-center gap-1.5">
            <TeamLogo themeKey={home.themeKey} name={home.nickName} size={22} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">v</span>
            <TeamLogo themeKey={away.themeKey} name={away.nickName} size={22} />
          </div>
        </div>

        {legs.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No selections. Switch to Insights to rebuild your slip.
          </div>
        ) : (
          <ul className="space-y-2">
            {legs.map((leg) => {
              const excluded = (marginActive && leg.id === "winner") || (!marginActive && leg.id === "margin");
              return (
              <li
                key={leg.id}
                className={`bg-surface-2 rounded-lg px-3 py-3 sm:px-4 sm:py-3.5 grid grid-cols-[1fr_auto] items-center gap-3 sm:gap-4 border border-border/40 transition ${excluded ? "opacity-50" : ""}`}
              >
                <div className="min-w-0">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-2">
                    <span>{leg.market}</span>
                    {excluded && (
                      <span className="text-[8px] font-bold text-muted-foreground/80 bg-surface px-1.5 py-0.5 rounded normal-case tracking-normal">
                        not counted
                      </span>
                    )}
                  </div>
                  {leg.options ? (
                    <Select value={leg.selection} onValueChange={(v) => updateLegSelection(leg.id, v)}>
                      <SelectTrigger className="mt-1 h-auto min-h-[2rem] px-2 py-1 -ml-2 bg-transparent border border-transparent hover:border-accent/40 hover:bg-accent/5 focus:ring-0 focus:border-accent/60 rounded-md text-base font-bold text-foreground shadow-none transition w-fit max-w-full justify-start gap-1.5 [&>span]:line-clamp-none [&>span]:text-left [&>span]:whitespace-normal [&>span]:break-words [&>svg]:opacity-60 [&>svg]:shrink-0">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent
                        className="bg-surface-2 border-accent/30 text-foreground shadow-xl rounded-lg backdrop-blur"
                        position="popper"
                      >
                        {leg.options.map((o) => (
                          <SelectItem
                            key={o.label}
                            value={o.label}
                            className="text-sm font-semibold focus:bg-accent/20 focus:text-foreground data-[state=checked]:text-accent rounded-md"
                          >
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-base font-bold mt-1 break-words">{leg.selection}</div>
                  )}
                  {leg.detail ? (
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">{leg.detail}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0 self-center">
                  <span className={`text-sm font-black tabular-nums px-3 py-1 rounded-full border min-w-[3.25rem] text-center ${excluded ? "bg-surface text-muted-foreground border-border" : "bg-accent !text-white border-accent shadow-[0_2px_8px_-2px_color-mix(in_oklab,var(--accent)_60%,transparent)]"}`}>
                    {leg.price.toFixed(2)}
                  </span>
                  <button
                    onClick={() => removeLeg(leg.id)}
                    aria-label={`Remove ${leg.market}`}
                    className="h-6 w-6 rounded-full bg-surface hover:bg-danger/15 hover:text-danger text-muted-foreground flex items-center justify-center transition"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
        )}

        {/* Add tryscorer */}
        <div className="mt-3">
          {addingTry ? (
            <div className="bg-surface-2 rounded-lg p-2 border border-accent/40 flex items-center gap-2">
              <Select onValueChange={(v) => v && addTryscorer(v)}>
                <SelectTrigger className="flex-1 h-9 bg-transparent border-0 focus:ring-0 text-sm font-bold text-foreground shadow-none">
                  <SelectValue placeholder="Select a player…" />
                </SelectTrigger>
                <SelectContent
                  className="bg-surface-2 border-accent/30 text-foreground shadow-xl rounded-lg max-h-72"
                  position="popper"
                >
                  {availableTryscorers.map((t) => {
                    return (
                      <SelectItem
                        key={t.player}
                        value={t.player}
                        className="text-sm font-semibold focus:bg-accent/20 focus:text-foreground rounded-md"
                      >
                        <span className="flex items-center justify-between gap-4 w-full">
                          <span className="truncate">
                            {t.player}
                            {t.team ? <span className="text-muted-foreground font-normal"> · {t.team}</span> : null}
                          </span>
                          <span className="tabular-nums text-[11px] font-black text-accent">{t.price.toFixed(2)}{t.isEstimate ? "*" : ""}</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <button
                onClick={() => setAddingTry(false)}
                className="h-7 w-7 rounded-full bg-surface hover:bg-danger/15 hover:text-danger text-muted-foreground flex items-center justify-center transition"
                aria-label="Cancel add tryscorer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingTry(true)}
              disabled={availableTryscorers.length === 0}
              className="w-full text-[11px] uppercase tracking-wider font-bold py-2.5 rounded-lg border border-dashed border-accent/40 text-accent hover:bg-accent/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {availableTryscorers.length === 0
                ? marketsLive
                  ? "No more tryscorer markets"
                  : "Tryscorer odds open ~24h pre-game"
                : "+ Add another anytime tryscorer"}
            </button>
          )}
        </div>

        {/* Calculator */}
        <div className="mt-5 pt-4 border-t border-border space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="bet-stake" className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
              Stake
            </label>
            <div className="flex items-center gap-1 bg-surface-2 rounded-lg px-2 py-1.5 border border-border/40 focus-within:border-accent/60">
              <span className="text-sm font-bold text-muted-foreground">$</span>
              <input
                id="bet-stake"
                inputMode="decimal"
                value={stake}
                onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ""))}
                className="w-24 bg-transparent outline-none text-right text-base font-black tabular-nums"
                placeholder="0"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total odds</span>
            <span className="font-black tabular-nums kbd">{totalOdds.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Potential profit</span>
            <span className="font-black tabular-nums text-success">
              ${profit.toFixed(2)}
            </span>
          </div>

          <div className="rounded-lg bg-accent/10 border border-accent/30 px-4 py-3 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-bold text-accent">Potential payout</span>
            <span className="text-2xl font-black tabular-nums text-accent">
              ${payout.toFixed(2)}
            </span>
          </div>

          <p className="text-[10px] text-muted-foreground text-center pt-1">
            Odds shown are the best live market price from The Odds API. Confirm with your bookie before placing. 18+ · Bet responsibly.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ================= AFTERMATCH TAB ================= */

type AftermatchHit = { market: string; predicted: string; actual: string; status: "hit" | "miss" | "partial"; detail?: string };
type AftermatchPlayerHit = { name: string; predictedAs: string; scored: number; status: "hit" | "miss" };
type AftermatchPayload = {
  finalScore: { home: number; away: number };
  hits: AftermatchHit[];
  tryscorerHits: AftermatchPlayerHit[];
  scoreLine: { hits: number; total: number };
  consistencies: string[];
  inconsistencies: string[];
  summary: string;
};

function AftermatchTab({ aftermatch, home, away }:
  { aftermatch: AftermatchPayload | null; home: TeamWithPlayers; away: TeamWithPlayers }) {
  if (!aftermatch) {
    return <Empty msg="Aftermatch comparison is being generated — refresh in a moment." />;
  }
  const pct = aftermatch.scoreLine.total > 0
    ? Math.round((aftermatch.scoreLine.hits / aftermatch.scoreLine.total) * 100)
    : 0;
  return (
    <div className="space-y-4">
      <Card title="Aftermatch read" icon={History} className="accent-glow">
        <div className="flex items-center gap-3 mb-3">
          <TeamLogo themeKey={home.themeKey} name={home.nickName} size={36} />
          <div className="kbd flex items-center gap-2 px-3 py-1.5">
            <span className={`text-2xl font-black tabular-nums ${aftermatch.finalScore.home > aftermatch.finalScore.away ? "text-accent" : ""}`}>{aftermatch.finalScore.home}</span>
            <span className="text-muted-foreground">–</span>
            <span className={`text-2xl font-black tabular-nums ${aftermatch.finalScore.away > aftermatch.finalScore.home ? "text-accent" : ""}`}>{aftermatch.finalScore.away}</span>
          </div>
          <TeamLogo themeKey={away.themeKey} name={away.nickName} size={36} />
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hit rate</div>
            <div className="text-lg font-black tabular-nums text-accent">{aftermatch.scoreLine.hits}/{aftermatch.scoreLine.total} <span className="text-muted-foreground text-xs font-bold">({pct}%)</span></div>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{aftermatch.summary || "No summary available."}</p>
      </Card>

      <Card title="Predicted vs actual" icon={Target}>
        <div className="space-y-2">
          {aftermatch.hits.map((h, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-surface-2/50 border border-border">
              <StatusBadge status={h.status} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{h.market}</div>
                <div className="text-sm mt-0.5">
                  <span className="text-muted-foreground">Predicted:</span> <span className="font-semibold">{h.predicted}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Actual:</span> <span className="font-semibold">{h.actual}</span>
                </div>
                {h.detail && <div className="text-[11px] text-muted-foreground mt-0.5">{h.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {aftermatch.tryscorerHits.length > 0 && (
        <Card title="Tryscorer picks" icon={Flag}>
          <div className="space-y-1.5">
            {aftermatch.tryscorerHits.map((p, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-2/50 border border-border">
                <StatusBadge status={p.status} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{p.predictedAs}</div>
                </div>
                <div className="text-sm font-black tabular-nums">
                  {p.scored} {p.scored === 1 ? "try" : "tries"}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(aftermatch.consistencies.length > 0 || aftermatch.inconsistencies.length > 0) && (
        <Card title="Where the model held / slipped" icon={Activity}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ThumbsUp className="h-4 w-4 text-accent" />
                <h4 className="text-xs font-bold uppercase tracking-wider">Consistencies</h4>
              </div>
              {aftermatch.consistencies.length === 0 ? (
                <p className="text-xs text-muted-foreground">None this match.</p>
              ) : (
                <ul className="space-y-1.5">
                  {aftermatch.consistencies.map((c, i) => (
                    <li key={i} className="text-xs leading-relaxed text-foreground/90 flex gap-2">
                      <Check className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ThumbsDown className="h-4 w-4 text-danger" />
                <h4 className="text-xs font-bold uppercase tracking-wider">Inconsistencies</h4>
              </div>
              {aftermatch.inconsistencies.length === 0 ? (
                <p className="text-xs text-muted-foreground">None — a clean read.</p>
              ) : (
                <ul className="space-y-1.5">
                  {aftermatch.inconsistencies.map((c, i) => (
                    <li key={i} className="text-xs leading-relaxed text-foreground/90 flex gap-2">
                      <X className="h-3.5 w-3.5 text-danger shrink-0 mt-0.5" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "hit" | "miss" | "partial" }) {
  if (status === "hit") {
    return (
      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-accent !text-white shrink-0" title="Hit">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center justify-center h-6 px-2 rounded-full bg-surface-2 text-[10px] font-black uppercase tracking-wider text-foreground border border-border shrink-0" title="Partial">
        Part
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-danger/15 text-danger border border-danger/40 shrink-0" title="Miss">
      <X className="h-3.5 w-3.5" />
    </span>
  );
}

/* ================= LESSONS CARD (carry-forward in Insights tab) ================= */

type TeamLessonShape = {
  matchId: string;
  opponentNickname: string;
  finalScore: { team: number; opponent: number };
  result: "W" | "L" | "D";
  scoreLine: { hits: number; total: number };
  topConsistencies: string[];
  topInconsistencies: string[];
  summary: string;
};

function LessonsCard({ home, away, lessons }:
  { home: TeamWithPlayers; away: TeamWithPlayers; lessons: { home: TeamLessonShape | null; away: TeamLessonShape | null } }) {
  return (
    <Card title="Last week's lessons" icon={GraduationCap}>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        What the model learned from each side's most recent game — used to sharpen this week's read.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <LessonColumn team={home} lesson={lessons.home} />
        <LessonColumn team={away} lesson={lessons.away} />
      </div>
    </Card>
  );
}

function LessonColumn({ team, lesson }: { team: TeamWithPlayers; lesson: TeamLessonShape | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex items-center gap-2 mb-2">
        <TeamLogo themeKey={team.themeKey} name={team.nickName} size={28} />
        <div className="min-w-0">
          <div className="text-xs font-extrabold uppercase tracking-wider truncate">{team.nickName}</div>
          {lesson ? (
            <div className="text-[10px] text-muted-foreground">
              {lesson.result === "W" ? "Won" : lesson.result === "L" ? "Lost" : "Drew"} {lesson.finalScore.team}-{lesson.finalScore.opponent} v {lesson.opponentNickname}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">No prior comparison yet.</div>
          )}
        </div>
        {lesson && (
          <div className="ml-auto text-[10px] font-black tabular-nums text-accent">
            {lesson.scoreLine.hits}/{lesson.scoreLine.total}
          </div>
        )}
      </div>
      {lesson ? (
        <>
          {lesson.summary && (
            <p className="text-xs leading-relaxed text-foreground/90 mb-2">{lesson.summary}</p>
          )}
          {lesson.topConsistencies.length > 0 && (
            <div className="mb-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-accent mb-0.5">What worked</div>
              <ul className="space-y-0.5">
                {lesson.topConsistencies.slice(0, 2).map((c, i) => (
                  <li key={i} className="text-[11px] leading-snug text-foreground/85">• {c}</li>
                ))}
              </ul>
            </div>
          )}
          {lesson.topInconsistencies.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-danger mb-0.5">What missed</div>
              <ul className="space-y-0.5">
                {lesson.topInconsistencies.slice(0, 2).map((c, i) => (
                  <li key={i} className="text-[11px] leading-snug text-foreground/85">• {c}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">Lessons will appear here after this team plays a finished round.</p>
      )}
    </div>
  );
}

