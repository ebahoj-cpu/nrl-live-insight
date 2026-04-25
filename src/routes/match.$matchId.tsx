import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { getMatchPage, getMatchInsights } from "@/server/index.functions";
import { TeamLogo } from "@/components/TeamLogo";
import type { TryscorerMarkets, TryscorerOdds } from "@/server/odds";
import { Suspense, useState } from "react";
import {
  ArrowLeft, Clock, MapPin, Users, BarChart3, Sparkles, ScrollText,
  Trophy, Target, Flag, Crown, TrendingUp, AlertCircle, CloudSun, Calendar, Zap, Hourglass,
  Coins, ThumbsUp, ThumbsDown, Wallet, Activity, Shield, Brain, Crosshair, Eye,
  Timer, Ban, Swords, Compass, Layers, Gauge, Radar, ListChecks, BookOpen, Map,
} from "lucide-react";

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

type TabKey = "lineup" | "stats" | "insights" | "script" | "bets";

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
  const { details, ladder, tryscorers, oddsError, oddsStale, tryscorersError, recentRecaps } = data as any;

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

  const homeRow = ladder.find((r: any) => r.nickname === details.homeTeam.nickName);
  const awayRow = ladder.find((r: any) => r.nickname === details.awayTeam.nickName);

  return (
    <div className="pt-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
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
        <div className="grid grid-cols-3 items-center mt-4 gap-4">
          <TeamColumn name={details.homeTeam.nickName} themeKey={details.homeTeam.themeKey} position={details.homeTeam.position} />
          <div className="text-center">
            {(typeof details.homeTeam.score === "number" && typeof details.awayTeam.score === "number") ? (
              <div className="kbd flex items-center justify-center gap-3">
                <span className={`text-4xl sm:text-5xl font-black tabular-nums ${details.homeTeam.score > details.awayTeam.score ? "text-accent" : ""}`}>{details.homeTeam.score}</span>
                <span className="text-muted-foreground text-lg font-bold">–</span>
                <span className={`text-4xl sm:text-5xl font-black tabular-nums ${details.awayTeam.score > details.homeTeam.score ? "text-accent" : ""}`}>{details.awayTeam.score}</span>
              </div>
            ) : (
              <div className="text-2xl sm:text-3xl font-extrabold">vs</div>
            )}
          </div>
          <TeamColumn name={details.awayTeam.nickName} themeKey={details.awayTeam.themeKey} position={details.awayTeam.position} />
        </div>

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
      <nav className="mt-6 grid grid-cols-5 gap-1 p-1 glass" role="tablist">
        <TabButton active={tab === "lineup"} onClick={() => setTab("lineup")} icon={Users} label="Lineup" />
        <TabButton active={tab === "stats"} onClick={() => setTab("stats")} icon={BarChart3} label="Stats" />
        <TabButton active={tab === "insights"} onClick={() => setTab("insights")} icon={Sparkles} label="Insights" />
        <TabButton active={tab === "script"} onClick={() => setTab("script")} icon={ScrollText} label="Script" />
        <TabButton active={tab === "bets"} onClick={() => setTab("bets")} icon={Wallet} label="Bets" />
      </nav>

      <div className="mt-6">
        {tab === "lineup" && <LineupTab home={details.homeTeam} away={details.awayTeam} officials={details.officials} />}
        {tab === "stats" && <StatsTab home={details.homeTeam} away={details.awayTeam} homeRow={homeRow} awayRow={awayRow} statGroups={details.statGroups} recentRecaps={recentRecaps} />}
        {tab === "insights" && (
          <InsightsTab
            insights={insights}
            insightsError={insightsLoading ? null : insightsError}
            insightsLoading={insightsLoading}
            home={details.homeTeam.nickName}
            away={details.awayTeam.nickName}
            tryscorers={tryscorers}
            tryscorersError={tryscorersError}
            oddsError={oddsError}
            oddsStale={oddsStale}
            kickoffUtc={details.kickoffUtc}
          />
        )}
        {tab === "script" && (
          <ScriptTab insights={insights} insightsError={insightsLoading ? null : insightsError} insightsLoading={insightsLoading} home={details.homeTeam} away={details.awayTeam} />
        )}
        {tab === "bets" && (
          <BetsTab insights={insights} insightsError={insightsLoading ? null : insightsError} insightsLoading={insightsLoading} />
        )}
      </div>

      <p className="text-[11px] text-muted-foreground text-center mt-10">
        Updated {new Date(data.generatedAt).toLocaleTimeString()} · Bet responsibly · 18+
      </p>
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
        <Sparkles className="h-5 w-5 text-accent animate-pulse" />
        <span>Generating AI insights — this can take 20–40 seconds…</span>
      </div>
      <p className="text-[11px] mt-2 opacity-70">Cached for an hour after first load.</p>
    </div>
  );
}

/* ================= LINEUP TAB ================= */

const POSITION_ORDER = [
  "Fullback","Winger","Centre","Five-Eighth","Halfback",
  "Prop","Hooker","2nd Row","Lock","Interchange","Reserve",
];

function LineupTab({ home, away, officials }: { home: any; away: any; officials: { position: string; firstName: string; lastName: string; headImage?: string }[] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SquadPanel team={home} />
        <SquadPanel team={away} />
      </div>
      <OfficialsCard officials={officials} />
    </div>
  );
}

function OfficialsCard({ officials }: { officials: { position: string; firstName: string; lastName: string; headImage?: string }[] }) {
  if (!officials || officials.length === 0) {
    return (
      <Card title="Match officials" icon={Shield}>
        <p className="text-xs text-muted-foreground">Officials not yet announced.</p>
      </Card>
    );
  }
  // Order: Referee, Senior Review Official (TMO/Bunker), Touch Judge, Pocket Referee, others
  const order = ["Referee", "Senior Review Official", "Bunker Official", "Touch Judge", "Pocket Referee"];
  const sorted = [...officials].sort((a, b) => {
    const ai = order.findIndex((o) => a.position.toLowerCase().includes(o.toLowerCase()));
    const bi = order.findIndex((o) => b.position.toLowerCase().includes(o.toLowerCase()));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return (
    <Card title="Match officials" icon={Shield}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {sorted.map((o, i) => {
          const isTMO = /Senior Review|Bunker/i.test(o.position);
          const isRef = /^Referee$/i.test(o.position);
          return (
            <div key={i} className={`bg-surface-2 rounded-lg p-3 flex items-center gap-3 ${isRef ? "ring-1 ring-accent/40" : ""}`}>
              <OfficialAvatar src={o.headImage} firstName={o.firstName} lastName={o.lastName} size={isRef ? 56 : 44} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{o.firstName} {o.lastName}</div>
                <div className={`text-[10px] uppercase tracking-wider truncate ${isTMO ? "text-accent font-bold" : isRef ? "text-foreground font-bold" : "text-muted-foreground"}`}>
                  {isTMO ? "TMO / Bunker" : o.position}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
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

function SquadPanel({ team }: { team: { nickName: string; themeKey: string; players: { firstName: string; lastName: string; position: string; jerseyNumber?: number; isCaptain?: boolean }[] } }) {
  const sorted = [...team.players].sort((a, b) => {
    const ai = a.jerseyNumber ?? 999;
    const bi = b.jerseyNumber ?? 999;
    if (ai !== bi) return ai - bi;
    const pi = POSITION_ORDER.indexOf(a.position);
    const pj = POSITION_ORDER.indexOf(b.position);
    return (pi === -1 ? 99 : pi) - (pj === -1 ? 99 : pj);
  });
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
        <ul className="space-y-2">
          {sorted.map((p, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              {p.jerseyNumber != null && (
                <span className="kbd w-6 text-center text-xs font-bold text-muted-foreground">{p.jerseyNumber}</span>
              )}
              <span className="flex-1">
                <span className="font-medium">{p.firstName} {p.lastName}</span>
                {p.isCaptain && <Crown className="inline h-3 w-3 ml-1.5 text-accent" />}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{p.position}</span>
            </li>
          ))}
        </ul>
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

/* ================= INSIGHTS TAB ================= */

function InsightsTab({ insights, insightsError, insightsLoading, home, away, tryscorers, oddsError, oddsStale, kickoffUtc }:
  { insights: any; insightsError: string | null; insightsLoading?: boolean; home: string; away: string; tryscorers: TryscorerMarkets | null; tryscorersError: string | null; oddsError: string | null; oddsStale: boolean; kickoffUtc: string }) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Insights unavailable." />;

  // The Insights tab is the MATCH INTELLIGENCE engine — pure tactical /
  // structural read. Betting picks live on the Bets tab; narrative / script
  // lives on the Script tab. We render strictly the intelligence object here.
  const intel = insights.intelligence;

  if (!intel) {
    return (
      <Empty msg="Match intelligence regenerating — check back in a moment." />
    );
  }

  return (
    <div className="space-y-4">
      {(oddsError || oddsStale) && (
        <div className="glass p-3 text-xs text-muted-foreground inline-flex items-center gap-2 w-full">
          <AlertCircle className="h-3.5 w-3.5 text-accent" />
          {oddsStale ? "Showing last cached odds — live feed temporarily unavailable." : "Live odds temporarily unavailable. Intelligence still based on form, structure & squad."}
        </div>
      )}

      {/* 1. MATCH OVERVIEW */}
      <Card title="Match overview" icon={BookOpen} className="accent-glow">
        <p className="text-sm leading-relaxed">{intel.matchOverview}</p>
      </Card>

      {/* 2. TEAM PROFILE — both sides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TeamProfileCard team={home} profile={intel.teamProfile?.home} />
        <TeamProfileCard team={away} profile={intel.teamProfile?.away} />
      </div>

      {/* 3. ATTACKING STRUCTURE */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AttackingStructureCard team={home} data={intel.attackingStructure?.home} />
        <AttackingStructureCard team={away} data={intel.attackingStructure?.away} />
      </div>

      {/* 4. DEFENSIVE WEAKNESSES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DefensiveWeaknessCard team={home} data={intel.defensiveWeaknesses?.home} />
        <DefensiveWeaknessCard team={away} data={intel.defensiveWeaknesses?.away} />
      </div>

      {/* 5. KEY MATCHUPS */}
      {Array.isArray(intel.keyMatchups) && intel.keyMatchups.length > 0 && (
        <KeyMatchupsCard matchups={intel.keyMatchups} home={home} away={away} />
      )}

      {/* 6. GAME SCRIPT — 5 phases */}
      <GameScriptPhasesCard phases={intel.gameScript ?? []} />

      {/* 7. PLAYER INFLUENCE MAPPING */}
      {Array.isArray(intel.playerInfluence) && intel.playerInfluence.length > 0 && (
        <PlayerInfluenceCard influencers={intel.playerInfluence} home={home} away={away} />
      )}

      {/* 8. HISTORICAL CONTEXT (only if meaningful) */}
      {typeof intel.historicalContext === "string" && intel.historicalContext.trim().length > 0 && (
        <Card title="Historical context" icon={ScrollText}>
          <p className="text-sm leading-relaxed text-muted-foreground">{intel.historicalContext}</p>
        </Card>
      )}

      {/* 9. CONTEXTUAL FACTORS */}
      {Array.isArray(intel.contextualFactors) && intel.contextualFactors.length > 0 && (
        <Card title="Contextual factors" icon={Compass}>
          <ul className="space-y-2 text-sm">
            {intel.contextualFactors.map((c: string, i: number) => (
              <li key={i} className="flex gap-2">
                <span className="text-accent shrink-0">›</span>
                <span className="leading-relaxed">{c}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 10. RARE EVENT NOTE — kept brief, low-weight modifier */}
      {typeof intel.rareEventNote === "string" && intel.rareEventNote.trim().length > 0 && (
        <div className="glass p-3 text-xs text-muted-foreground inline-flex items-start gap-2 w-full">
          <AlertCircle className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
          <span className="leading-relaxed">{intel.rareEventNote}</span>
        </div>
      )}

      {/* 11. INSIGHT SUMMARY — final tactical takeaway */}
      {typeof intel.insightSummary === "string" && intel.insightSummary.trim().length > 0 && (
        <Card title="Insight summary" icon={Sparkles} className="accent-glow">
          <p className="text-sm leading-relaxed">{intel.insightSummary}</p>
        </Card>
      )}

      {/* Live tryscorer markets — kept as a real-data widget when team lists are out.
          Pure read of bookie tryscorer pricing; not betting analysis or picks. */}
      <TryscorersSection
        tryscorers={tryscorers}
        aiAnytime={insights.anytimeTryscorers ?? []}
        aiFirst={insights.firstTryscorer ?? { pick: "Awaiting team list", reasoning: "Tryscorer markets open ~24h before kickoff." }}
        aiMulti={insights.multiTryscorer ?? { pick: "Awaiting team list", reasoning: "" }}
        kickoffUtc={kickoffUtc}
      />
    </div>
  );
}

/* ---------- Match-intelligence card components ---------- */

const RATING_TONE: Record<string, string> = {
  elite: "text-accent",
  strong: "text-accent",
  "above average": "text-foreground",
  average: "text-muted-foreground",
  "below average": "text-danger",
  struggling: "text-danger",
};

function RatingPill({ label, value }: { label: string; value?: string }) {
  const v = (value ?? "average").toLowerCase();
  const tone = RATING_TONE[v] ?? "text-muted-foreground";
  return (
    <div className="bg-surface-2 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-xs font-bold uppercase tracking-wider ${tone}`}>{value || "average"}</span>
    </div>
  );
}

function TeamProfileCard({ team, profile }: { team: string; profile: any }) {
  if (!profile) return null;
  return (
    <Card title={`${team} — profile`} icon={Gauge}>
      <p className="text-sm leading-relaxed mb-3">{profile.identity}</p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <RatingPill label="Attack" value={profile.attackRating} />
        <RatingPill label="Defence" value={profile.defenceRating} />
      </div>
      <div className="space-y-2">
        <ProfileRow label="Form read" body={profile.formRead} />
        <ProfileRow label="Scoring pattern" body={profile.scoringPattern} />
        <ProfileRow label="Consistency" body={profile.consistency} />
      </div>
    </Card>
  );
}

function ProfileRow({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-accent font-bold mb-1">{label}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function AttackingStructureCard({ team, data }: { team: string; data: any }) {
  if (!data) return null;
  return (
    <Card title={`${team} — attacking structure`} icon={Swords}>
      <div className="space-y-3 text-sm">
        <ProfileRow label="Edge balance" body={data.edgeBalance} />
        <ProfileRow label="Set-play vs broken-play" body={data.setPlayVsBroken} />
        <ProfileRow label="Red zone tendency" body={data.redZoneTendency} />
        <ProfileRow label="Where the tries come from" body={data.forwardVsBacklineTries} />
        {Array.isArray(data.primaryPlaymakers) && data.primaryPlaymakers.length > 0 && (
          <div className="pt-1 border-t border-border/40">
            <div className="text-[10px] uppercase tracking-wider text-accent font-bold mb-2">Primary playmakers</div>
            <ul className="space-y-2">
              {data.primaryPlaymakers.map((p: any, i: number) => (
                <li key={i} className="text-xs">
                  <div className="font-semibold">
                    {p.name} <span className="text-muted-foreground font-normal">· {p.role}</span>
                  </div>
                  <div className="text-muted-foreground leading-relaxed mt-0.5">{p.influence}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function DefensiveWeaknessCard({ team, data }: { team: string; data: any }) {
  if (!data) return null;
  return (
    <Card title={`${team} — defensive weaknesses`} icon={Radar}>
      <div className="space-y-3 text-sm">
        {Array.isArray(data.missedTackleZones) && data.missedTackleZones.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-danger font-bold mb-2">Missed tackle zones</div>
            <ul className="flex flex-wrap gap-1.5">
              {data.missedTackleZones.map((z: string, i: number) => (
                <li key={i} className="text-xs px-2 py-1 rounded-md bg-danger/10 text-danger font-semibold border border-danger/20">{z}</li>
              ))}
            </ul>
          </div>
        )}
        <ProfileRow label="Edge fragility" body={data.edgeFragility} />
        <ProfileRow label="Line speed & ruck issues" body={data.lineSpeedRuckIssues} />
        {Array.isArray(data.positionalMismatches) && data.positionalMismatches.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-danger font-bold mb-2">Positional mismatches</div>
            <ul className="flex flex-wrap gap-1.5">
              {data.positionalMismatches.map((m: string, i: number) => (
                <li key={i} className="text-xs px-2 py-1 rounded-md bg-danger/10 text-danger font-semibold border border-danger/20">{m}</li>
              ))}
            </ul>
          </div>
        )}
        <ProfileRow label="Pressure points" body={data.pressurePoints} />
      </div>
    </Card>
  );
}

function KeyMatchupsCard({ matchups, home, away }: { matchups: any[]; home: string; away: string }) {
  return (
    <Card title="Key matchups" icon={Crosshair}>
      <ol className="space-y-4">
        {matchups.map((m: any, i: number) => {
          const edgeLabel = m.edge === "home" ? home : m.edge === "away" ? away : "Even";
          const edgeTone = m.edge === "even" ? "bg-surface-2 text-muted-foreground" : "bg-accent text-accent-foreground";
          return (
            <li key={i} className="bg-surface-2 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-sm font-bold leading-tight">{m.area}</div>
                <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md shrink-0 ${edgeTone}`}>
                  Edge: {edgeLabel}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <div className="bg-surface rounded-lg p-2">
                  <div className="text-[10px] uppercase tracking-wider text-accent font-bold mb-1">{home}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{m.homeSide}</p>
                </div>
                <div className="bg-surface rounded-lg p-2">
                  <div className="text-[10px] uppercase tracking-wider text-accent font-bold mb-1">{away}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{m.awaySide}</p>
                </div>
              </div>
              {m.why && <p className="text-xs leading-relaxed">{m.why}</p>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function GameScriptPhasesCard({ phases }: { phases: any[] }) {
  if (!phases || phases.length === 0) return null;
  return (
    <Card title="Game script — phase by phase" icon={Hourglass}>
      <ol className="relative border-l border-border pl-4 space-y-4">
        {phases.map((p: any, i: number) => (
          <li key={i} className="relative">
            <span className="absolute -left-[22px] top-1 h-3 w-3 rounded-full bg-accent ring-4 ring-background" />
            <div className="text-[10px] uppercase tracking-widest text-accent font-bold mb-1">{p.window}</div>
            <p className="text-sm leading-relaxed text-muted-foreground">{p.read}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

const ROLE_TONE: Record<string, { dot: string; text: string }> = {
  "Tempo controller": { dot: "bg-accent", text: "text-accent" },
  "Edge finisher": { dot: "bg-accent", text: "text-accent" },
  "Forward momentum": { dot: "bg-foreground/60", text: "text-foreground" },
  "Defensive anchor": { dot: "bg-foreground/60", text: "text-foreground" },
  "Disruptor": { dot: "bg-danger", text: "text-danger" },
  "Momentum shifter": { dot: "bg-danger", text: "text-danger" },
};

function PlayerInfluenceCard({ influencers, home, away }: { influencers: any[]; home: string; away: string }) {
  return (
    <Card title="Player influence" icon={Layers}>
      <ul className="space-y-3">
        {influencers.map((p: any, i: number) => {
          const tone = ROLE_TONE[p.role] ?? { dot: "bg-muted-foreground", text: "text-muted-foreground" };
          const teamLabel = p.team === "home" ? home : away;
          return (
            <li key={i} className="bg-surface-2 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                <span className="text-sm font-bold">{p.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">· {teamLabel}</span>
                <span className={`ml-auto text-[10px] uppercase tracking-wider font-bold ${tone.text}`}>{p.role}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.expectedImpact}</p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}


function TryscorersSection({ tryscorers, aiAnytime, aiFirst, aiMulti, kickoffUtc }: {
  tryscorers: TryscorerMarkets | null;
  aiAnytime: { pick: string; reasoning: string }[];
  aiFirst: { pick: string; reasoning: string };
  aiMulti: { pick: string; reasoning: string };
  kickoffUtc: string;
}) {
  const hasReal = tryscorers?.hasAny ?? false;

  return (
    <div className="space-y-4">
      {/* Header strip showing live vs awaiting */}
      <div className="glass p-3 flex items-center justify-between text-xs">
        <div className="inline-flex items-center gap-2">
          <Flag className="h-4 w-4 text-accent" />
          <span className="font-bold uppercase tracking-wider">Tryscorer markets</span>
        </div>
        {hasReal ? (
          <span className="inline-flex items-center gap-1.5 text-accent font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> Live odds
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Hourglass className="h-3.5 w-3.5" /> Awaiting team list
          </span>
        )}
      </div>

      {hasReal ? (
        <>
          {tryscorers!.first.length > 0 && (
            <TryOddsCard
              title="First tryscorer"
              icon={Flag}
              picks={tryscorers!.first.slice(0, 6)}
              note="Best price across AU bookies. Higher decimal = longer odds."
            />
          )}
          {tryscorers!.anytime.length > 0 && (
            <TryOddsCard
              title="Anytime tryscorer"
              icon={Sparkles}
              picks={tryscorers!.anytime.slice(0, 8)}
              note="Strongest implied chances first."
            />
          )}
          {tryscorers!.multi.length > 0 && (
            <TryOddsCard
              title="2+ tries (double / hat-trick)"
              icon={Trophy}
              picks={tryscorers!.multi.slice(0, 6)}
              note="Outsider value plays — pair with form."
            />
          )}
          {tryscorers!.lastUpdate && (
            <p className="text-[11px] text-muted-foreground text-center">
              Odds updated {new Date(tryscorers!.lastUpdate).toLocaleTimeString()}
            </p>
          )}
        </>
      ) : (
        <Card title="Tryscorer odds — coming soon" icon={Hourglass}>
          <p className="text-sm text-muted-foreground mb-4">
            AU bookmakers release tryscorer markets once team lists are confirmed
            (usually around <span className="font-semibold text-foreground">24 hours before kickoff</span>).
            They&rsquo;ll appear here automatically as soon as they&rsquo;re live.
          </p>
          <p className="text-[11px] text-muted-foreground mb-4">
            Kickoff: {new Date(kickoffUtc).toLocaleString()}
          </p>

          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Early AI lean (no markets yet)
          </div>
          <div className="space-y-3">
            <PreviewRow label="First" pick={aiFirst.pick} reasoning={aiFirst.reasoning} />
            <PreviewRow label="Multi" pick={aiMulti.pick} reasoning={aiMulti.reasoning} />
            {aiAnytime.slice(0, 3).map((t, i) => (
              <PreviewRow key={i} label={`#${i + 1}`} pick={t.pick} reasoning={t.reasoning} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function TryOddsCard({ title, icon, picks, note }: {
  title: string;
  icon: typeof Flag;
  picks: TryscorerOdds[];
  note: string;
}) {
  return (
    <Card title={title} icon={icon}>
      <ul className="divide-y divide-border">
        {picks.map((p, i) => (
          <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="kbd w-5 text-center text-[11px] font-bold text-muted-foreground">{i + 1}</span>
            <span className="flex-1 font-medium truncate">{p.player}</span>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">{p.book}</span>
            <span className="kbd font-bold text-accent">${p.price.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground mt-3">{note}</p>
    </Card>
  );
}

function PreviewRow({ label, pick, reasoning }: { label: string; pick: string; reasoning: string }) {
  return (
    <div className="flex gap-3">
      <span className="kbd shrink-0 w-12 h-6 rounded-md bg-surface-2 text-[10px] font-bold text-muted-foreground flex items-center justify-center uppercase">
        {label}
      </span>
      <div className="min-w-0">
        <div className="font-semibold text-sm">{pick}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{reasoning}</div>
      </div>
    </div>
  );
}

function PickCard({ icon: Icon, market, pick, reasoning }:
  { icon: typeof Sparkles; market: string; pick: string; reasoning: string }) {
  return (
    <div className="glass p-4 flex flex-col">
      <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        <Icon className="h-3.5 w-3.5 text-accent" /> {market}
      </div>
      <div className="font-bold mb-1.5">{pick}</div>
      <div className="text-xs text-muted-foreground">{reasoning}</div>
    </div>
  );
}

function KeysCard({ team, keys }: { team: string; keys: string[] }) {
  return (
    <Card title={`${team} — keys to victory`} icon={Zap}>
      <ol className="space-y-3">
        {keys.map((k, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="kbd w-6 h-6 shrink-0 rounded-full bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center">{i + 1}</span>
            <span className="leading-relaxed">{k}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function WeaknessExploitCard({ team, opponent, data }: {
  team: string;
  opponent: string;
  data: {
    opponentWeaknesses?: string[];
    opponentWeakness?: string; // legacy single-string fallback for cached payloads
    targetAreas?: string[];
    targetArea?: string;       // legacy fallback
    tacticalPlan: string;
    playersToWatch: { name: string; role: string; why: string }[];
  };
}) {
  const weaknesses = data.opponentWeaknesses && data.opponentWeaknesses.length > 0
    ? data.opponentWeaknesses
    : data.opponentWeakness ? [data.opponentWeakness] : [];
  const areas = data.targetAreas && data.targetAreas.length > 0
    ? data.targetAreas
    : data.targetArea ? [data.targetArea] : [];

  return (
    <Card title={`${team} — exploit ${opponent}`} icon={Crosshair}>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-danger font-bold mb-2">
            {weaknesses.length} potential exploit{weaknesses.length === 1 ? "" : "s"}
          </div>
          <ol className="space-y-1.5">
            {weaknesses.map((w, i) => (
              <li key={i} className="flex gap-2 leading-relaxed">
                <span className="kbd w-5 h-5 shrink-0 rounded-full bg-danger/15 text-danger text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                <span>{w}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="pt-1">
          <div className="text-[10px] uppercase tracking-widest text-accent font-bold mb-2">
            Target area{areas.length === 1 ? "" : "s"}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {areas.map((a, i) => (
              <li key={i} className="text-xs px-2 py-1 rounded-md bg-accent/10 text-accent font-semibold border border-accent/20">
                {a}
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">Tactical plan</div>
          <p className="leading-relaxed text-muted-foreground">{data.tacticalPlan}</p>
        </div>

        <div className="pt-2 border-t border-border/40">
          <div className="text-[10px] uppercase tracking-widest text-accent font-bold mb-2 flex items-center gap-1.5">
            <Eye className="h-3 w-3" /> 3 players to watch
          </div>
          <ol className="space-y-2">
            {data.playersToWatch.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="kbd w-6 h-6 shrink-0 rounded-full bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <div className="min-w-0">
                  <div className="font-semibold leading-tight">
                    {p.name} <span className="text-[11px] text-muted-foreground font-normal">· {p.role}</span>
                  </div>
                  <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{p.why}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}

/* ================= SCRIPT TAB ================= */

function ScriptTab({ insights, insightsError, insightsLoading, home, away }:
  { insights: any; insightsError: string | null; insightsLoading?: boolean; home: any; away: any }) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError) return <Empty msg={insightsError} />;
  if (!insights?.script) return <Empty msg="Script unavailable." />;

  const s = insights.script;
  const homeName = home.nickName;
  const awayName = away.nickName;

  return (
    <div className="space-y-4">
      <Card title="Head to head" icon={ScrollText}>
        <div className="flex items-center justify-center gap-10 mb-4">
          <div className="flex flex-col items-center gap-2">
            <TeamLogo themeKey={home.themeKey} name={home.nickName} size={56} />
            <span className="text-xs font-bold uppercase tracking-wider">{home.nickName}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <TeamLogo themeKey={away.themeKey} name={away.nickName} size={56} />
            <span className="text-xs font-bold uppercase tracking-wider">{away.nickName}</span>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{s.headToHead}</p>
      </Card>

      <Card title="Form analysis" icon={TrendingUp}>
        <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{s.formAnalysis}</p>
      </Card>

      <Card title="X-factor" icon={Sparkles} className="accent-glow">
        <p className="text-sm leading-relaxed">{s.xFactor}</p>
      </Card>

      {insights.gameFlow && (
        <GameFlowCard flow={insights.gameFlow} home={homeName} away={awayName} />
      )}

      {insights.tryscorerScript && (
        <TryscorerScriptCard
          script={insights.tryscorerScript}
          home={home}
          away={away}
        />
      )}

      {s.psychological && (
        <Card title="Psychological" icon={Brain}>
          <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{s.psychological}</p>
        </Card>
      )}

      <Card title="Upcoming milestones" icon={Crown}>
        <ul className="space-y-3">
          {s.milestones.map((m: string, i: number) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="text-accent shrink-0">›</span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      </Card>

      {s.bookieScript && (
        <Card title="Bookie script" icon={Coins}>
          <p className="text-[11px] text-muted-foreground mb-4 italic">
            How an Australian bookmaker is praying this game plays out — and the result that hurts their book.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
              <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-accent font-bold mb-2">
                <ThumbsUp className="h-3.5 w-3.5" /> Bookies want
              </div>
              <p className="text-sm leading-relaxed">{s.bookieScript.wantToWin}</p>
            </div>
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
              <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-danger font-bold mb-2">
                <ThumbsDown className="h-3.5 w-3.5" /> Bookies fear
              </div>
              <p className="text-sm leading-relaxed">{s.bookieScript.wantToLose}</p>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground border-t border-border pt-3">
            <span className="font-bold text-foreground">Liability: </span>{s.bookieScript.liability}
          </div>
        </Card>
      )}

      {s.matchFix && (
        <Card title="Match Fix script" icon={Eye}>
          <p className="text-[11px] text-muted-foreground mb-4 italic">
            Tongue-in-cheek: how head office would script this game for ratings, sponsors and the finals race. Strictly for laughs — not an actual accusation 🙃
          </p>

          <div className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/5 p-4 mb-3">
            <div className="text-[10px] uppercase tracking-wider text-fuchsia-400 font-bold mb-1">Preferred winner</div>
            <p className="text-sm font-semibold leading-relaxed">{s.matchFix.preferredWinner}</p>
          </div>

          <div className="rounded-xl border border-border bg-surface-2/40 p-4 mb-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">Broadcast / ratings angle</div>
            <p className="text-sm leading-relaxed">{s.matchFix.ratingsAngle}</p>
          </div>

          {Array.isArray(s.matchFix.refereeNudges) && s.matchFix.refereeNudges.length > 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 mb-3">
              <div className="text-[10px] uppercase tracking-wider text-yellow-500 font-bold mb-2">Referee nudges 👀</div>
              <ul className="space-y-1.5">
                {s.matchFix.refereeNudges.map((n: string, i: number) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="text-yellow-500 shrink-0">▸</span>
                    <span className="leading-relaxed">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 mb-3">
            <div className="text-[10px] uppercase tracking-wider text-accent font-bold mb-1">Narrative moment</div>
            <p className="text-sm leading-relaxed">{s.matchFix.narrativeMoment}</p>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold shrink-0">Conspiracy meter</div>
            <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent via-yellow-500 to-fuchsia-500"
                style={{ width: `${Math.max(0, Math.min(100, Number(s.matchFix.conspiracyRating) || 0))}%` }}
              />
            </div>
            <div className="kbd text-sm font-black text-fuchsia-400 shrink-0">
              {Math.round(Number(s.matchFix.conspiracyRating) || 0)}%
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ================= BETS TAB ================= */

function GameFlowCard({ flow, home, away }: { flow: any; home: string; away: string }) {
  const ht = flow.halftimeScore || { home: 0, away: 0 };
  const leader = flow.halftimeLeader === "home" ? home : flow.halftimeLeader === "away" ? away : "Level";
  return (
    <Card title="Game flow" icon={Timer}>
      <p className="text-[11px] text-muted-foreground mb-4 italic">
        Quarter-by-quarter script — how the match unfolds, HT score and HT/FT double.
      </p>

      {/* HT score band */}
      <div className="rounded-xl bg-surface-2 p-4 mb-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-center mb-2">Half-time score</div>
        <div className="grid grid-cols-3 items-center gap-2">
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{home}</div>
            <div className={`text-3xl font-black kbd ${ht.home > ht.away ? "text-accent" : ""}`}>{ht.home}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-muted-foreground uppercase tracking-widest">Leading</div>
            <div className="text-sm font-bold text-accent leading-tight mt-0.5">{leader}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{away}</div>
            <div className={`text-3xl font-black kbd ${ht.away > ht.home ? "text-accent" : ""}`}>{ht.away}</div>
          </div>
        </div>
      </div>

      {/* Phase blocks */}
      <div className="space-y-3 text-sm">
        {flow.openingTen && (
          <PhaseBlock label="Opening 10" text={flow.openingTen} />
        )}
        {flow.firstHalf && (
          <PhaseBlock label="First half" text={flow.firstHalf} />
        )}
        {flow.secondHalf && (
          <PhaseBlock label="Second half" text={flow.secondHalf} />
        )}
        {flow.closing && (
          <PhaseBlock label="Final 10" text={flow.closing} />
        )}
      </div>

      {/* Momentum swings */}
      {flow.momentumSwings?.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[10px] uppercase tracking-widest text-accent font-bold mb-2">Momentum swings</div>
          <ul className="space-y-1.5">
            {flow.momentumSwings.map((m: string, i: number) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed">
                <span className="text-accent shrink-0">⟶</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* HT/FT double */}
      {flow.halftimeDouble && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-widest text-accent font-bold">HT/FT double</div>
            {typeof flow.halftimeDouble.confidence === "number" && (
              <div className="kbd text-[10px] font-bold text-muted-foreground">{Math.round(flow.halftimeDouble.confidence)}% confidence</div>
            )}
          </div>
          <div className="text-base font-black mb-1">{flow.halftimeDouble.pick}</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{flow.halftimeDouble.reasoning}</p>
        </div>
      )}
    </Card>
  );
}

function PhaseBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="kbd shrink-0 w-20 h-6 rounded-md bg-surface-2 text-[10px] font-bold text-muted-foreground flex items-center justify-center uppercase">
        {label}
      </span>
      <p className="text-sm leading-relaxed text-muted-foreground flex-1">{text}</p>
    </div>
  );
}

function TryscorerScriptCard({ script, home, away }: {
  script: { home: any; away: any; summary: string };
  home: { nickName: string; themeKey: string };
  away: { nickName: string; themeKey: string };
}) {
  return (
    <Card title="Tryscorer script" icon={Flag}>
      <p className="text-[11px] text-muted-foreground mb-4 italic">
        Picks anchored to live AU bookie prices when available. Plus trap names to fade this week.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TryscorerTeamBlock team={home} data={script.home} />
        <TryscorerTeamBlock team={away} data={script.away} />
      </div>
      {script.summary && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">Match read</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{script.summary}</p>
        </div>
      )}
    </Card>
  );
}

function TryscorerTeamBlock({ team, data }: {
  team: { nickName: string; themeKey: string };
  data: { picks: { name: string; market: string; price: number | null; reasoning: string }[]; avoid: { name: string; reasoning: string }[] };
}) {
  const marketLabel = (m: string) => m === "first" ? "FTS" : m === "2+" ? "2+ tries" : "Anytime";
  return (
    <div className="bg-surface-2 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-3">
        <TeamLogo themeKey={team.themeKey} name={team.nickName} size={24} />
        <div className="text-xs font-bold uppercase tracking-wider">{team.nickName}</div>
      </div>

      <ol className="space-y-2 mb-3">
        {(data?.picks ?? []).map((p, i) => (
          <li key={i} className="bg-surface rounded-lg p-2.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="kbd w-5 h-5 shrink-0 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                <span className="font-semibold text-sm truncate">{p.name}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent font-bold">{marketLabel(p.market)}</span>
                {p.price != null && (
                  <span className="kbd text-[11px] font-black text-accent">${Number(p.price).toFixed(2)}</span>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{p.reasoning}</p>
          </li>
        ))}
      </ol>

      {data?.avoid?.length > 0 && (
        <div className="pt-3 border-t border-border/40">
          <div className="text-[10px] uppercase tracking-widest text-danger font-bold mb-1.5 inline-flex items-center gap-1.5">
            <Ban className="h-3 w-3" /> Avoid
          </div>
          <ul className="space-y-1.5">
            {data.avoid.map((a, i) => (
              <li key={i} className="text-[11px] leading-relaxed">
                <span className="font-semibold text-foreground">{a.name}</span>
                <span className="text-muted-foreground"> — {a.reasoning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type BetCategoryKey =
  | "gameScript" | "smallStake" | "mediumStake" | "bigStake" | "getThea"
  | "anytimeMulti" | "multiTryStack" | "pointsParty"
  | "upset" | "bookieFear" | "firstTryscorer";

const BET_ORDER: BetCategoryKey[] = [
  "gameScript", "smallStake", "mediumStake", "bigStake", "getThea",
  "anytimeMulti", "multiTryStack", "pointsParty",
  "upset", "bookieFear", "firstTryscorer",
];

const BET_META: Record<BetCategoryKey, {
  label: string;
  tagline: string;
  target: string;
  Icon: any;
  accent: string; // tailwind colour class fragment for borders/text
}> = {
  gameScript:     { label: "Game Script Bet",   tagline: "The cleanest read of the match — winner + margin + total + HT/FT + a tryscorer from each team.", target: "$10 → $500",  Icon: ScrollText, accent: "accent" },
  smallStake:     { label: "$5 → $100",         tagline: "Small stake, solid return — favourite + margin + a strong anytime tryscorer.",                  target: "$5 → ~$100",  Icon: Shield,    accent: "emerald-500" },
  mediumStake:    { label: "$10 → $500",        tagline: "Medium stake, big swing — favourite + total + two anytime tryscorers do the lifting.",          target: "$10 → ~$500", Icon: Activity,  accent: "yellow-500" },
  bigStake:       { label: "$20 → $1,000",      tagline: "Bigger stake, cleaner multiplier — five legs leaning the right way.",                            target: "$20 → ~$1,000", Icon: Crosshair, accent: "orange-500" },
  getThea:        { label: "GET THEA Bet",      tagline: "The bet of the slate — $5 chasing five figures.",                                                target: "$5 → ~$10,000", Icon: Sparkles,  accent: "accent" },
  anytimeMulti:   { label: "Anytime Try Multi", tagline: "Pure anytime tryscorer 4-leg — best finishing names from both sides.",                          target: "$10 → ~$300+", Icon: Target,    accent: "accent" },
  multiTryStack:  { label: "Multi-Try Stack",   tagline: "Three players in high-volume scoring lanes — all to bag 2+ tries.",                              target: "$10 → BIG",    Icon: Trophy,    accent: "fuchsia-500" },
  pointsParty:    { label: "Points + Tries",    tagline: "Total points over + the two finishers most likely to score them.",                              target: "$10 → ~$300",  Icon: TrendingUp, accent: "sky-500" },
  upset:          { label: "Upset Bet",         tagline: "Against the market — the underdog gets it done.",                                                target: "$20 single",   Icon: Zap,       accent: "yellow-500" },
  bookieFear:     { label: "Bookie Fear Bet",   tagline: "The result the bookies fear — heavy public exposure with multiple tryscorers.",                  target: "$10 → BIG",    Icon: ThumbsDown, accent: "danger" },
  firstTryscorer: { label: "First Tryscorer Bet", tagline: "Standalone single — first try of the match.",                                                  target: "$5 single",    Icon: Flag,      accent: "rose-500" },
};

function BetsTab({ insights, insightsError, insightsLoading }: { insights: any; insightsError: string | null; insightsLoading?: boolean }) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;

  const rawBets = insights?.bets;
  // Support both shapes: legacy Record<key, BetPlay> and new BetPlay[] with `category`.
  const byKey: Record<string, any> = {};
  if (Array.isArray(rawBets)) {
    for (const b of rawBets) if (b?.category) byKey[b.category] = b;
  } else if (rawBets && typeof rawBets === "object") {
    Object.assign(byKey, rawBets);
  }
  if (Object.keys(byKey).length === 0) return <Empty msg="Bet suggestions unavailable. Hit Refresh Insights to generate them." />;

  return (
    <div className="space-y-4">
      {BET_ORDER.map((key) => {
        const bet = byKey[key];
        if (!bet) return null;
        return <BetCard key={key} categoryKey={key} bet={bet} />;
      })}
    </div>
  );
}

function BetCard({ categoryKey, bet }: { categoryKey: BetCategoryKey; bet: any }) {
  const meta = BET_META[categoryKey];
  const Icon = meta.Icon;
  const odds = Number(bet.combinedOdds) || 0;
  const accent = meta.accent;
  // Build dynamic class strings — kept on a small whitelist so Tailwind picks them up.
  const borderCls = accentBorder(accent);
  const tintCls = accentTint(accent);
  const textCls = accentText(accent);

  return (
    <div className={`relative overflow-hidden rounded-2xl border-2 ${borderCls} ${tintCls} p-5`}>
      <div className={`absolute top-0 right-0 px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-bl-xl ${accentBadge(accent)}`}>
        {meta.target}
      </div>

      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-5 w-5 ${textCls}`} />
        <div className={`text-[10px] uppercase tracking-[0.25em] font-black ${textCls}`}>{meta.label}</div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 italic">{meta.tagline}</p>

      <h3 className="font-black text-base mb-3 leading-tight">{bet.title}</h3>

      <ul className="space-y-1.5 mb-4">
        {(bet.legs || []).map((leg: any, li: number) => (
          <li key={li} className="flex items-center justify-between gap-2 text-sm rounded-md bg-background/40 px-2.5 py-2 border border-border">
            <div className="flex gap-2 min-w-0">
              <span className={`shrink-0 ${textCls}`}>✓</span>
              <span className="truncate font-medium">{typeof leg === "string" ? leg : leg.pick}</span>
            </div>
            {typeof leg === "object" && leg.decimalOdds && (
              <span className={`kbd text-[11px] font-bold shrink-0 ${textCls}`}>${Number(leg.decimalOdds).toFixed(2)}</span>
            )}
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-3 gap-2 mb-3 pt-3 border-t border-border">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Odds</div>
          <div className={`text-lg font-black kbd ${textCls}`}>${odds.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stake</div>
          <div className="text-lg font-black kbd">{bet.stake}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Payout</div>
          <div className={`text-lg font-black kbd ${textCls}`}>{bet.potentialReturn}</div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{bet.reasoning}</p>
    </div>
  );
}

// Accent class helpers — kept verbose so Tailwind doesn't tree-shake them.
function accentBorder(a: string) {
  switch (a) {
    case "accent": return "border-accent/50";
    case "danger": return "border-danger/50";
    case "emerald-500": return "border-emerald-500/50";
    case "yellow-500": return "border-yellow-500/50";
    case "orange-500": return "border-orange-500/50";
    case "sky-500": return "border-sky-500/50";
    case "rose-500": return "border-rose-500/50";
    case "fuchsia-500": return "border-fuchsia-500/50";
    default: return "border-border";
  }
}
function accentTint(a: string) {
  switch (a) {
    case "accent": return "bg-gradient-to-br from-accent/10 via-surface-2/40 to-transparent";
    case "danger": return "bg-gradient-to-br from-danger/10 via-surface-2/40 to-transparent";
    case "emerald-500": return "bg-gradient-to-br from-emerald-500/10 via-surface-2/40 to-transparent";
    case "yellow-500": return "bg-gradient-to-br from-yellow-500/10 via-surface-2/40 to-transparent";
    case "orange-500": return "bg-gradient-to-br from-orange-500/10 via-surface-2/40 to-transparent";
    case "sky-500": return "bg-gradient-to-br from-sky-500/10 via-surface-2/40 to-transparent";
    case "rose-500": return "bg-gradient-to-br from-rose-500/10 via-surface-2/40 to-transparent";
    case "fuchsia-500": return "bg-gradient-to-br from-fuchsia-500/10 via-surface-2/40 to-transparent";
    default: return "bg-surface-2/30";
  }
}
function accentText(a: string) {
  switch (a) {
    case "accent": return "text-accent";
    case "danger": return "text-danger";
    case "emerald-500": return "text-emerald-500";
    case "yellow-500": return "text-yellow-500";
    case "orange-500": return "text-orange-500";
    case "sky-500": return "text-sky-500";
    case "rose-500": return "text-rose-500";
    case "fuchsia-500": return "text-fuchsia-500";
    default: return "text-foreground";
  }
}
function accentBadge(a: string) {
  switch (a) {
    case "accent": return "bg-accent text-accent-foreground";
    case "danger": return "bg-danger text-white";
    case "emerald-500": return "bg-emerald-500 text-white";
    case "yellow-500": return "bg-yellow-500 text-yellow-950";
    case "orange-500": return "bg-orange-500 text-white";
    case "sky-500": return "bg-sky-500 text-white";
    case "rose-500": return "bg-rose-500 text-white";
    case "fuchsia-500": return "bg-fuchsia-500 text-white";
    default: return "bg-muted text-foreground";
  }
}


function formatDate(utc: string) {
  if (!utc) return "TBC";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Pacific/Auckland",
    weekday: "short", day: "numeric", month: "short",
  }).format(d);
}

function formatTime(utc: string) {
  if (!utc) return "";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Pacific/Auckland",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d).toLowerCase();
}
