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
            const finished = typeof hs === "number" && typeof as === "number" && /^(FullTime|Final|Completed)$/i.test(details.matchState);
            const live = typeof hs === "number" && typeof as === "number" && /^(InProgress|Live|HalfTime)$/i.test(details.matchState);
            if (finished) return <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-surface-2 text-muted-foreground">Full Time</span>;
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

        <div className="mt-6 pt-5 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="inline-flex items-center gap-2">
            <Calendar className="h-4 w-4 text-accent shrink-0" />
            <span className="text-muted-foreground">{formatDate(details.kickoffUtc)}</span>
            <span className="text-muted-foreground">·</span>
            <Clock className="h-4 w-4 text-accent shrink-0" />
            <span className="text-muted-foreground kbd">{formatTime(details.kickoffUtc)}</span>
          </div>
          <div className="inline-flex items-center gap-2 sm:justify-end sm:text-right">
            <MapPin className="h-4 w-4 text-accent shrink-0" />
            <span className="text-muted-foreground truncate">{details.venue}{details.venueCity ? `, ${details.venueCity}` : ""}</span>
          </div>
          {details.weather && (
            <div className="inline-flex items-center gap-2 sm:col-span-2 pt-3 border-t border-border">
              <CloudSun className="h-4 w-4 text-accent shrink-0" />
              <span className="text-muted-foreground">
                {details.weather.tempC}° {details.weather.condition} · {details.weather.windKph} km/h wind · {details.weather.precipMm}mm rain
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold text-foreground">{details.weather.groundCondition} ground</span>
            </div>
          )}
        </div>
      </section>

      {/* Tabs */}
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
      className={`inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function TeamColumn({ name, themeKey, position }: { name: string; themeKey: string; position?: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <TeamLogo themeKey={themeKey} name={name} size={84} />
      <div className="mt-3 text-base sm:text-lg font-bold">{name}</div>
      {position && <div className="text-xs text-muted-foreground">{position}</div>}
    </div>
  );
}

function Card({ title, icon: Icon, children, className = "" }:
  { title: string; icon?: typeof Users; children: React.ReactNode; className?: string }) {
  return (
    <section className={`glass p-5 ${className}`}>
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
    const ai = POSITION_ORDER.indexOf(a.position);
    const bi = POSITION_ORDER.indexOf(b.position);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return (
    <Card title={team.nickName} icon={Users}>
      <div className="flex items-center gap-3 mb-4">
        <TeamLogo themeKey={team.themeKey} name={team.nickName} size={36} />
        <div className="text-xs text-muted-foreground">{sorted.length} players named</div>
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
    </Card>
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

      {recentRecaps && (recentRecaps.home?.length || recentRecaps.away?.length) ? (
        <RecentRecapsCard home={home} away={away} homeRecaps={recentRecaps.home ?? []} awayRecaps={recentRecaps.away ?? []} />
      ) : null}

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
      ) : (
        <div className="text-xs text-muted-foreground mb-4">No 2026 ladder data yet.</div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Form · Last 5</div>
        {team.recentForm.length > 0 && (
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
        )}
      </div>
      {team.recentForm.length === 0 ? (
        <div className="text-xs text-muted-foreground">No recent matches.</div>
      ) : (
        <div className="space-y-1.5">
          {team.recentForm.slice(0, 5).map((f: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground truncate pr-2">{f.summary}</span>
              <span className={`kbd font-bold shrink-0 ${f.result === "Won" ? "text-accent" : f.result === "Lost" ? "text-danger" : ""}`}>{f.score}</span>
            </div>
          ))}
        </div>
      )}
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

function InsightsTab({ insights, insightsError, insightsLoading, home, away, tryscorers, tryscorersError, oddsError, oddsStale, kickoffUtc }:
  { insights: any; insightsError: string | null; insightsLoading?: boolean; home: string; away: string; tryscorers: TryscorerMarkets | null; tryscorersError: string | null; oddsError: string | null; oddsStale: boolean; kickoffUtc: string }) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Insights unavailable." />;

  const winnerName = insights.winner.team === "home" ? home : away;

  return (
    <div className="space-y-4">
      {(oddsError || oddsStale) && (
        <div className="glass p-3 text-xs text-muted-foreground inline-flex items-center gap-2 w-full">
          <AlertCircle className="h-3.5 w-3.5 text-accent" />
          {oddsStale ? "Showing last cached odds — live feed temporarily unavailable." : "Live odds temporarily unavailable. Insights still based on form & ladder."}
        </div>
      )}

      {/* 1. Winning team + 2. Winning margin */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Winning team" icon={Trophy} className="accent-glow">
          <div className="text-2xl font-black mb-2">{winnerName}</div>
          <p className="text-xs text-muted-foreground">{insights.winner.reasoning}</p>
        </Card>
        <Card title="Winning margin" icon={Target}>
          <div className="text-2xl font-black mb-2">{winnerName} by {insights.margin.bucket}</div>
          <p className="text-xs text-muted-foreground">{insights.margin.reasoning}</p>
        </Card>
      </div>

      {/* 3. Predicted result */}
      <Card title="Predicted result" icon={Sparkles}>
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{home}</div>
            <div className="text-4xl font-black kbd">{insights.predictedScore.home}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Final score</div>
            <div className="text-sm font-bold mt-1 text-accent">{winnerName}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{away}</div>
            <div className="text-4xl font-black kbd">{insights.predictedScore.away}</div>
          </div>
        </div>
      </Card>

      {/* 4. Total points + 5. HT/FT */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PickCard
          icon={TrendingUp}
          market={`Total points ${insights.total.line}`}
          pick={insights.total.pick.toUpperCase()}
          reasoning={insights.total.reasoning}
        />
        <PickCard
          icon={Clock}
          market="Half-time / Full-time"
          pick={insights.htft.pick}
          reasoning={insights.htft.reasoning}
        />
      </div>

      {/* 6. First tryscorer + 7. Top 5 anytime + 8. Multi tryscorer */}
      <TryscorersSection
        tryscorers={tryscorers}
        aiAnytime={insights.anytimeTryscorers}
        aiFirst={insights.firstTryscorer}
        aiMulti={insights.multiTryscorer}
        kickoffUtc={kickoffUtc}
      />

      {/* 9. Keys to victory — both teams */}
      {insights.keysToVictory && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KeysCard team={home} keys={insights.keysToVictory.home} />
          <KeysCard team={away} keys={insights.keysToVictory.away} />
        </div>
      )}

      {/* 9b. Weakness exploit — opposition flaws + 3 players to watch */}
      {insights.weaknessExploit && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <WeaknessExploitCard team={home} opponent={away} data={insights.weaknessExploit.home} />
          <WeaknessExploitCard team={away} opponent={home} data={insights.weaknessExploit.away} />
        </div>
      )}

      {/* Key factors */}
      <Card title="Key factors" icon={TrendingUp}>
        <ul className="space-y-2 text-sm">
          {insights.keyFactors.map((k: string, i: number) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent">›</span>
              <span>{k}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
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
    opponentWeakness: string;
    targetArea: string;
    tacticalPlan: string;
    playersToWatch: { name: string; role: string; why: string }[];
  };
}) {
  return (
    <Card title={`${team} — exploit ${opponent}`} icon={Crosshair}>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-danger font-bold mb-1">Opposition weakness</div>
          <p className="leading-relaxed">{data.opponentWeakness}</p>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-accent font-bold mb-1">Target area</div>
          <p className="leading-relaxed">{data.targetArea}</p>
        </div>
        <div>
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

  return (
    <div className="space-y-4">
      <Card title="Head to head" icon={ScrollText}>
        <div className="flex items-center justify-center gap-6 mb-4">
          <TeamLogo themeKey={home.themeKey} name={home.nickName} size={48} />
          <span className="text-muted-foreground text-sm font-bold">vs</span>
          <TeamLogo themeKey={away.themeKey} name={away.nickName} size={48} />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{s.headToHead}</p>
      </Card>

      <Card title="Form analysis" icon={TrendingUp}>
        <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{s.formAnalysis}</p>
      </Card>

      <Card title="X-factor" icon={Sparkles} className="accent-glow">
        <p className="text-sm leading-relaxed">{s.xFactor}</p>
      </Card>

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
    </div>
  );
}

/* ================= BETS TAB ================= */

function BetsTab({ insights, insightsError, insightsLoading }: { insights: any; insightsError: string | null; insightsLoading?: boolean }) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights?.betSuggestions?.length && !insights?.getTheaSpecial) return <Empty msg="Bet suggestions unavailable." />;

  const riskMeta: Record<string, { label: string; cls: string; desc: string; payout: string }> = {
    low:    { label: "Low risk",    cls: "border-accent/40 bg-accent/5",        desc: "Safer combo, modest return",       payout: "$100" },
    medium: { label: "Medium risk", cls: "border-yellow-500/40 bg-yellow-500/5", desc: "Balanced risk vs reward",           payout: "$1,000" },
    high:   { label: "High risk",   cls: "border-danger/40 bg-danger/5",        desc: "Long shot — biggest payout",        payout: "$10,000" },
  };

  const tierOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const sorted = [...(insights.betSuggestions || [])].sort((a: any, b: any) => (tierOrder[a.risk] ?? 99) - (tierOrder[b.risk] ?? 99));

  return (
    <div className="space-y-4">
      {insights.getTheaSpecial && <GetTheaCard special={insights.getTheaSpecial} />}
      {insights.upset && <UpsetCard upset={insights.upset} /> }

      {sorted.map((b: any, i: number) => {
        const meta = riskMeta[b.risk] ?? riskMeta.medium;
        const target = b.targetPayout ? `$${Number(b.targetPayout).toLocaleString()}` : meta.payout;
        return (
          <div key={i} className={`glass p-5 border-2 ${meta.cls}`}>
            <div className="flex items-center justify-between mb-3 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-accent">{meta.label}</div>
                <div className="text-[11px] text-muted-foreground">{meta.desc}</div>
              </div>
              <div className="flex flex-col items-end">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Target payout</div>
                <div className="kbd text-base font-black text-accent leading-none">{target}</div>
              </div>
            </div>

            <h3 className="font-bold text-base mb-3">{b.title}</h3>

            <ul className="space-y-1.5 mb-4">
              {b.legs.map((leg: any, li: number) => (
                <li key={li} className="flex items-center justify-between gap-2 text-sm rounded-md bg-surface-2/40 px-2 py-1.5">
                  <div className="flex gap-2 min-w-0">
                    <span className="text-accent shrink-0">✓</span>
                    <span className="truncate">{typeof leg === "string" ? leg : leg.pick}</span>
                  </div>
                  {typeof leg === "object" && leg.decimalOdds && (
                    <span className="kbd text-[11px] font-bold text-accent shrink-0">${Number(leg.decimalOdds).toFixed(2)}</span>
                  )}
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-3 gap-2 mb-3 pt-3 border-t border-border">
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Odds</div>
                <div className="text-lg font-black kbd text-accent">{b.estimatedOdds}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stake</div>
                <div className="text-lg font-black kbd">{b.stake}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Return</div>
                <div className="text-lg font-black kbd text-accent">{b.potentialReturn}</div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">{b.reasoning}</p>
          </div>
        );
      })}
    </div>
  );
}

function GetTheaCard({ special }: { special: any }) {
  const odds = Number(special.combinedOdds) || 0;
  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-accent bg-gradient-to-br from-accent/15 via-surface-2/60 to-danger/10 p-5 shadow-[0_0_40px_-10px_hsl(var(--accent))]">
      <div className="absolute top-0 right-0 px-3 py-1 bg-accent text-accent-foreground text-[10px] font-black uppercase tracking-widest rounded-bl-xl">
        ⚡ Special
      </div>
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-5 w-5 text-accent" />
        <div className="text-[10px] uppercase tracking-[0.25em] font-black text-accent">GET THEA</div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 italic">
        The single best $5 → $1,000 play of the slate, built from every angle: stats, weakness exploit, X-factor, weather, psychology.
      </p>

      <h3 className="font-black text-base mb-3 leading-tight">{special.title}</h3>

      <ul className="space-y-1.5 mb-4">
        {(special.legs || []).map((leg: any, li: number) => (
          <li key={li} className="flex items-center justify-between gap-2 text-sm rounded-md bg-background/40 px-2.5 py-2 border border-accent/20">
            <div className="flex gap-2 min-w-0">
              <span className="text-accent shrink-0">⚡</span>
              <span className="truncate font-semibold">{leg.pick}</span>
            </div>
            <span className="kbd text-[11px] font-bold text-accent shrink-0">${Number(leg.decimalOdds).toFixed(2)}</span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-4 gap-2 mb-3 pt-3 border-t border-accent/30">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Odds</div>
          <div className="text-lg font-black kbd text-accent">${odds.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stake</div>
          <div className="text-lg font-black kbd">{special.stake}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Return</div>
          <div className="text-lg font-black kbd text-accent">{special.potentialReturn}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</div>
          <div className="text-lg font-black kbd">{Math.round(Number(special.confidence) || 0)}%</div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{special.reasoning}</p>
    </div>
  );
}


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
