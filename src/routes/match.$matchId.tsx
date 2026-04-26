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
  ThumbsUp, ThumbsDown, Activity, Shield, Eye, Compass, Gauge, Check,
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

type TabKey = "lineup" | "stats" | "insights";

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
  const { details, ladder, odds, tryscorers, oddsError, oddsStale, tryscorersError, recentRecaps } = data as any;

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
      <nav className="mt-6 grid grid-cols-3 gap-1 p-1 glass" role="tablist">
        <TabButton active={tab === "lineup"} onClick={() => setTab("lineup")} icon={Users} label="Lineup" />
        <TabButton active={tab === "stats"} onClick={() => setTab("stats")} icon={BarChart3} label="Stats" />
        <TabButton active={tab === "insights"} onClick={() => setTab("insights")} icon={Sparkles} label="Insights" />
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
          />
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

type TeamNews = { ins: string[]; outs: string[]; blurb: string; sourceUrl: string } | null;

function LineupTab({ home, away, officials, teamNews }: { home: any; away: any; officials: { position: string; firstName: string; lastName: string; headImage?: string }[]; teamNews?: { home: TeamNews; away: TeamNews } }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <SquadPanel team={home} />
          <InjuryCard team={home} news={teamNews?.home ?? null} />
        </div>
        <div className="space-y-4">
          <SquadPanel team={away} />
          <InjuryCard team={away} news={teamNews?.away ?? null} />
        </div>
      </div>
      <OfficialsCard officials={officials} />
    </div>
  );
}

function InjuryCard({ team, news }: { team: { nickName: string }; news: TeamNews }) {
  return (
    <section className="card-surface p-5">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="h-4 w-4 text-accent shrink-0" />
        <h3 className="font-bold text-sm uppercase tracking-wider truncate">{team.nickName} · Ins & Outs</h3>
      </div>
      {!news || (news.ins.length === 0 && news.outs.length === 0 && !news.blurb) ? (
        <p className="text-xs text-muted-foreground">Late mail not yet published. Updates land Tuesday/Thursday on NRL.com.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-success mb-1.5 flex items-center gap-1">
                <ThumbsUp className="h-3 w-3" /> Ins
              </div>
              {news.ins.length === 0 ? (
                <div className="text-xs text-muted-foreground">—</div>
              ) : (
                <ul className="space-y-1">
                  {news.ins.map((n, i) => (
                    <li key={i} className="text-xs font-medium">{n}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-danger mb-1.5 flex items-center gap-1">
                <ThumbsDown className="h-3 w-3" /> Outs
              </div>
              {news.outs.length === 0 ? (
                <div className="text-xs text-muted-foreground">—</div>
              ) : (
                <ul className="space-y-1">
                  {news.outs.map((n, i) => (
                    <li key={i} className="text-xs font-medium">{n}</li>
                  ))}
                </ul>
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
  // We only display the on-field Referee and the Senior Review / Bunker Official.
  const filtered = (officials ?? []).filter((o) => /^Referee$/i.test(o.position) || /Senior Review|Bunker/i.test(o.position));
  if (filtered.length === 0) {
    return (
      <Card title="Match officials" icon={Shield}>
        <p className="text-xs text-muted-foreground">Officials not yet announced.</p>
      </Card>
    );
  }
  const order = ["Referee", "Senior Review Official", "Bunker Official"];
  const sorted = [...filtered].sort((a, b) => {
    const ai = order.findIndex((o) => a.position.toLowerCase().includes(o.toLowerCase()));
    const bi = order.findIndex((o) => b.position.toLowerCase().includes(o.toLowerCase()));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return (
    <Card title="Match officials" icon={Shield}>
      <div className="grid grid-cols-2 gap-3">
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

function InsightsTab({ insights, insightsError, insightsLoading, home, away, homeRow, awayRow, tryscorers, odds }:
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
  const tone = model.confidence === "High" ? "text-accent" : model.confidence === "Medium" ? "text-foreground" : "text-muted-foreground";
  return (
    <Card title="Predicted winner" icon={Trophy} className="accent-glow">
      <div className="flex items-center gap-4">
        <TeamLogo themeKey={winnerTeam.themeKey} name={winnerTeam.nickName} size={64} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Forecast winner</div>
          <div className="text-2xl font-black truncate">{winnerTeam.nickName}</div>
          <div className={`mt-1 text-xs font-bold ${tone}`}>
            {model.confidence} confidence · {model.confidencePct}%
          </div>
        </div>
      </div>
      <ConfidenceMeter pct={model.confidencePct} confidence={model.confidence} />
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
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

function ConfidenceMeter({ pct, confidence }: { pct: number; confidence: string }) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Confidence scale</span>
        <span className="text-[10px] font-bold kbd">{confidence}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} aria-label={`${pct}% confidence`} />
      </div>
      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>Low</span><span>Medium</span><span>High</span>
      </div>
    </div>
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
          <TeamLogo themeKey={home.themeKey} name={home.nickName} size={36} />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 truncate w-full">{home.nickName}</div>
        </div>
        <div className="text-center kbd">
          <span className={`text-3xl sm:text-4xl font-black tabular-nums ${model.predictedHome > model.predictedAway ? "text-accent" : ""}`}>{model.predictedHome}</span>
          <span className="text-muted-foreground mx-1.5 text-lg font-bold">–</span>
          <span className={`text-3xl sm:text-4xl font-black tabular-nums ${model.predictedAway > model.predictedHome ? "text-accent" : ""}`}>{model.predictedAway}</span>
        </div>
        <div className="flex flex-col items-center text-center min-w-0">
          <TeamLogo themeKey={away.themeKey} name={away.nickName} size={36} />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 truncate w-full">{away.nickName}</div>
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
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-accent/15 text-accent border border-accent/30">
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
      <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-wider">
        {board.hasLive ? (
          <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/30 font-bold">Live odds{board.book ? ` · ${board.book}` : ""}</span>
        ) : (
          <span className="px-2 py-0.5 rounded-md bg-surface-2 text-muted-foreground border border-border font-bold">Model · markets release with team lists</span>
        )}
      </div>
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
              <span className="text-[11px] kbd text-muted-foreground tabular-nums">{Math.round(p.prob * 100)}%</span>
              <span className="text-sm kbd font-black tabular-nums">{p.price.toFixed(2)}</span>
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
              <span className="text-sm kbd font-black tabular-nums">{p.price.toFixed(2)}</span>
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


/* ================= BET BUILDER TAB ================= */

type RiskLevel = "low" | "medium" | "high" | "ultra";

const RISK_META: Record<RiskLevel, { label: string; tagline: string; tries: number; tone: string; dot: string }> = {
  low:    { label: "Low Risk",        tagline: "Safer model picks",       tries: 1, tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400", dot: "bg-emerald-500" },
  medium: { label: "Medium Risk",     tagline: "Balanced selections",     tries: 2, tone: "border-amber-500/40 bg-amber-500/10 text-amber-400",       dot: "bg-amber-500" },
  high:   { label: "High Risk",       tagline: "Stretches the model",     tries: 4, tone: "border-orange-500/40 bg-orange-500/10 text-orange-400",    dot: "bg-orange-500" },
  ultra:  { label: "Ultra High Risk", tagline: "Top probability stack",   tries: 5, tone: "border-rose-500/40 bg-rose-500/10 text-rose-400",          dot: "bg-rose-500" },
};

type WinnerOption = "win" | "win-1-12" | "win-13";
type TotalOption = "over" | "under";
type HtFtOption = "HH" | "HA" | "AH" | "AA";

type SlipLeg = {
  id: string;          // unique key (group:variant)
  group: string;       // mutex group — adding a new leg in the same group replaces it
  label: string;
  detail?: string;
  price: number;
  source: "live" | "model";
};

function BetBuilderTab({ insights, insightsError, insightsLoading, home, away, homeRow, awayRow, tryscorers, odds }: {
  insights: any; insightsError: string | null; insightsLoading?: boolean;
  home: TeamWithPlayers; away: TeamWithPlayers;
  homeRow?: LadderRow; awayRow?: LadderRow;
  tryscorers: TryscorerMarkets | null;
  odds?: OddsEvent | null;
}) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Bet Builder needs Insights data to run." />;

  const model = computeMatchModel(home.nickName, away.nickName, homeRow, awayRow, insights);
  const board = buildAnytimeBoard(tryscorers, home, away, model);
  const allTryscorers = [...board.home, ...board.away].sort((a, b) => b.prob - a.prob);

  const winnerName = model.winner === "home" ? home.nickName : away.nickName;
  const loserName = model.winner === "home" ? away.nickName : home.nickName;
  const modelHtFt: HtFtOption = inferHtFt(insights, home.nickName, away.nickName, model);

  // Live H2H prices
  const h2h = odds ? bestH2H(odds) : { home: null, away: null };
  const winnerLive = model.winner === "home" ? h2h.home : h2h.away;
  const loserLive  = model.winner === "home" ? h2h.away : h2h.home;

  // Estimate winner-by-margin prices from H2H + a bucket multiplier when not live.
  const baseWinnerPrice = winnerLive?.price ?? estimatePriceFromConfidence(model.confidencePct);
  const winPrices = {
    win: baseWinnerPrice,
    "win-1-12": +(baseWinnerPrice * 1.85).toFixed(2),
    "win-13": +(baseWinnerPrice * 2.6).toFixed(2),
    "loser": loserLive?.price ?? +(estimatePriceFromConfidence(100 - model.confidencePct)).toFixed(2),
  };

  // Totals — prefer bookmaker line/prices.
  const bookieTotal = pickBookmakerTotal(odds ?? null);
  const totalLine = bookieTotal?.line ?? model.totalLine + 0.5;
  const overPrice  = bookieTotal?.over  ?? +(1.92).toFixed(2);
  const underPrice = bookieTotal?.under ?? +(1.92).toFixed(2);

  // HT/FT estimated prices — same-side ~3.0, comeback ~12.
  const htftPrice = (opt: HtFtOption): number => {
    const sameSide = opt[0] === opt[1];
    const matchesModel = opt === modelHtFt;
    if (sameSide) return matchesModel ? 3.20 : 4.50;
    return matchesModel ? 8.00 : 13.00;
  };

  // ======= SLIP STATE =======
  const [stake, setStake] = useState<number>(10);
  const [legs, setLegs] = useState<SlipLeg[]>(() => ([
    { id: `winner:${model.marginBucket === "13+" ? "win-13" : "win-1-12"}`,
      group: "winner",
      label: model.marginBucket === "13+" ? `${winnerName} by 13+` : `${winnerName} by 1–12`,
      detail: `Confidence ${model.confidencePct}%`,
      price: model.marginBucket === "13+" ? winPrices["win-13"] : winPrices["win-1-12"],
      source: winnerLive ? "live" : "model" },
    { id: `total:${model.totalLean === "Over" ? "over" : "under"}`,
      group: "total",
      label: `${model.totalLean} ${totalLine}`,
      detail: `Projected ${model.predictedHome + model.predictedAway} pts`,
      price: model.totalLean === "Over" ? overPrice : underPrice,
      source: bookieTotal ? "live" : "model" },
  ]));

  function setLeg(leg: SlipLeg) {
    setLegs((cur) => {
      const filtered = cur.filter((l) => l.group !== leg.group);
      // toggle off if same id
      if (cur.some((l) => l.id === leg.id)) return filtered;
      return [...filtered, leg];
    });
  }

  function toggleTryscorer(p: AnytimePick) {
    const id = `try:${p.name}`;
    setLegs((cur) => {
      const existing = cur.find((l) => l.id === id);
      if (existing) return cur.filter((l) => l.id !== id);
      return [...cur, {
        id,
        group: id, // unique group per player so multiple can stack
        label: `${p.name} anytime`,
        detail: `${p.team === "home" ? home.nickName : away.nickName} · ${Math.round(p.prob * 100)}%`,
        price: p.price,
        source: p.source,
      }];
    });
  }

  function removeLeg(id: string) { setLegs((cur) => cur.filter((l) => l.id !== id)); }
  function clearSlip() { setLegs([]); }

  const isActive = (id: string) => legs.some((l) => l.id === id);
  const tryIds = new Set(legs.filter((l) => l.id.startsWith("try:")).map((l) => l.id));

  // Multi calculation
  const combinedOdds = legs.reduce((acc, l) => acc * l.price, 1);
  const projectedReturn = stake * combinedOdds;
  const projectedProfit = projectedReturn - stake;

  return (
    <div className="space-y-4">
      {/* Live odds banner */}
      <div className="text-[11px] uppercase tracking-wider flex items-center gap-2">
        {h2h.home || h2h.away || bookieTotal ? (
          <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/30 font-bold">Live odds {h2h.home?.book ?? bookieTotal?.book}</span>
        ) : (
          <span className="px-2 py-0.5 rounded-md bg-surface-2 text-muted-foreground border border-border font-bold">Model-estimated prices</span>
        )}
        <span className="text-muted-foreground">Click any market to add to your slip.</span>
      </div>

      {/* Winner market */}
      <Card title="1. Winner market" icon={Trophy}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <PickButton
            active={isActive("winner:win")}
            onClick={() => setLeg({ id: "winner:win", group: "winner", label: `${winnerName} to win`, detail: `Confidence ${model.confidencePct}%`, price: winPrices.win, source: winnerLive ? "live" : "model" })}
            title={`${winnerName} win`}
            subtitle={`Confidence ${model.confidencePct}%`}
            price={winPrices.win}
            recommended={model.marginBucket !== "13+" && model.marginBucket !== "1–12"}
          />
          <PickButton
            active={isActive("winner:win-1-12")}
            onClick={() => setLeg({ id: "winner:win-1-12", group: "winner", label: `${winnerName} by 1–12`, detail: "Tight margin", price: winPrices["win-1-12"], source: "model" })}
            title={`${winnerName} by 1–12`}
            subtitle="Tight margin"
            price={winPrices["win-1-12"]}
            recommended={model.marginBucket === "1–12"}
          />
          <PickButton
            active={isActive("winner:win-13")}
            onClick={() => setLeg({ id: "winner:win-13", group: "winner", label: `${winnerName} by 13+`, detail: "Comfortable win", price: winPrices["win-13"], source: "model" })}
            title={`${winnerName} by 13+`}
            subtitle="Comfortable win"
            price={winPrices["win-13"]}
            recommended={model.marginBucket === "13+"}
          />
        </div>
        {loserLive && (
          <div className="mt-2">
            <PickButton
              active={isActive("winner:loser")}
              onClick={() => setLeg({ id: "winner:loser", group: "winner", label: `${loserName} to win (upset)`, detail: "Against the model", price: winPrices.loser, source: "live" })}
              title={`${loserName} upset`}
              subtitle="Against the model"
              price={winPrices.loser}
            />
          </div>
        )}
      </Card>

      {/* Total points */}
      <Card title="2. Total points" icon={TrendingUp}>
        <div className="grid grid-cols-2 gap-2">
          <PickButton
            active={isActive("total:over")}
            onClick={() => setLeg({ id: "total:over", group: "total", label: `Over ${totalLine}`, detail: `Projected ${model.predictedHome + model.predictedAway}`, price: overPrice, source: bookieTotal ? "live" : "model" })}
            title={`Over ${totalLine}`}
            subtitle={`Projected ${model.predictedHome + model.predictedAway} pts`}
            price={overPrice}
            recommended={model.totalLean === "Over"}
          />
          <PickButton
            active={isActive("total:under")}
            onClick={() => setLeg({ id: "total:under", group: "total", label: `Under ${totalLine}`, detail: `Projected ${model.predictedHome + model.predictedAway}`, price: underPrice, source: bookieTotal ? "live" : "model" })}
            title={`Under ${totalLine}`}
            subtitle={`Projected ${model.predictedHome + model.predictedAway} pts`}
            price={underPrice}
            recommended={model.totalLean === "Under"}
          />
        </div>
      </Card>

      {/* HT/FT */}
      <Card title="3. Half-time / full-time" icon={Hourglass}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(["HH","HA","AH","AA"] as HtFtOption[]).map((opt) => {
            const price = htftPrice(opt);
            return (
              <PickButton
                key={opt}
                active={isActive(`htft:${opt}`)}
                onClick={() => setLeg({ id: `htft:${opt}`, group: "htft", label: `HT/FT: ${htftLabel(opt, home.nickName, away.nickName)}`, detail: htftDescription(opt), price, source: "model" })}
                title={htftLabel(opt, home.nickName, away.nickName)}
                subtitle={htftDescription(opt)}
                price={price}
                recommended={modelHtFt === opt}
              />
            );
          })}
        </div>
      </Card>

      {/* Anytime tryscorers — 3 per team */}
      <Card title="4. Anytime tryscorers" icon={Flag}>
        <div className="text-[11px] text-muted-foreground mb-3">Tap any player to add to your slip.</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TryscorerPickColumn title={home.nickName} picks={board.home} active={tryIds} onPick={toggleTryscorer} accent />
          <TryscorerPickColumn title={away.nickName} picks={board.away} active={tryIds} onPick={toggleTryscorer} />
        </div>
      </Card>

      {/* Slip with calculated returns */}
      <Card title="Your bet slip" icon={Sparkles} className="accent-glow">
        {legs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No selections yet — pick markets above to build your multi.</p>
        ) : (
          <>
            <ul className="space-y-2 mb-4">
              {legs.map((l) => (
                <li key={l.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">{l.label}</div>
                    {l.detail && <div className="text-[11px] text-muted-foreground truncate">{l.detail}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-black kbd tabular-nums">{l.price.toFixed(2)}</div>
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{l.source === "live" ? "Live" : "Model"}</div>
                  </div>
                  <button
                    onClick={() => removeLeg(l.id)}
                    className="text-[11px] font-bold text-muted-foreground hover:text-danger px-2 py-1 rounded shrink-0"
                    aria-label="Remove leg"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground block mb-1">Stake ($)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={stake}
                  onChange={(e) => setStake(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-base font-black kbd tabular-nums focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground block mb-1">Multi odds</label>
                <div className="rounded-lg bg-surface-2 border border-border px-3 py-2 text-base font-black kbd tabular-nums">{combinedOdds.toFixed(2)}</div>
              </div>
            </div>

            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Projected return</div>
                <div className="text-2xl font-black kbd text-accent tabular-nums">${projectedReturn.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Profit</div>
                <div className="text-2xl font-black kbd tabular-nums">+${projectedProfit.toFixed(2)}</div>
              </div>
            </div>

            <button
              onClick={clearSlip}
              className="mt-3 w-full text-xs uppercase tracking-wider font-bold text-muted-foreground hover:text-danger py-2"
            >
              Clear slip
            </button>
          </>
        )}
      </Card>

      <p className="text-[11px] text-muted-foreground text-center">
        Live prices are best-available across AU bookmakers via the odds feed. Model prices are estimates from the Insights model. 18+ · Bet responsibly.
      </p>
    </div>
  );
}

function TryscorerPickColumn({ title, picks, active, onPick, accent }:
  { title: string; picks: AnytimePick[]; active: Set<string>; onPick: (p: AnytimePick) => void; accent?: boolean }) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider font-bold mb-2 ${accent ? "text-accent" : "text-muted-foreground"}`}>{title}</div>
      {picks.length === 0 ? (
        <p className="text-xs text-muted-foreground">Squad not yet available.</p>
      ) : (
        <ul className="space-y-1.5">
          {picks.map((p) => {
            const id = `try:${p.name}`;
            const selected = active.has(id);
            return (
              <li key={p.name}>
                <button
                  onClick={() => onPick(p)}
                  className={`w-full flex items-center gap-2 text-left rounded-lg p-2 border transition ${selected ? "border-accent bg-accent/10" : "border-border bg-surface-2 hover:border-accent/40"}`}
                >
                  <span className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${selected ? "bg-accent text-accent-foreground" : "bg-surface text-muted-foreground"}`}>
                    {selected ? <Check className="h-3 w-3" /> : <Flag className="h-3 w-3" />}
                  </span>
                  <span className="flex-1 min-w-0 text-sm font-semibold truncate">{p.name}</span>
                  <span className="text-[10px] kbd text-muted-foreground tabular-nums">{Math.round(p.prob * 100)}%</span>
                  <span className="text-sm kbd font-black tabular-nums">{p.price.toFixed(2)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function estimatePriceFromConfidence(confidencePct: number): number {
  // 50% conf → 1.92, 75% → 1.40, 95% → 1.10
  const prob = Math.max(0.05, Math.min(0.95, confidencePct / 100));
  return Math.max(1.05, +(1 / prob * 0.95).toFixed(2));
}

function PickButton({ active, onClick, title, subtitle, price, recommended }:
  { active: boolean; onClick: () => void; title: string; subtitle?: string; price?: number; recommended?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`relative text-left rounded-lg p-3 border transition ${active ? "border-accent bg-accent/10" : "border-border bg-surface-2 hover:border-accent/40"}`}
    >
      {recommended && (
        <span className="absolute top-1.5 right-1.5 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-accent text-accent-foreground">Model</span>
      )}
      <div className="text-sm font-bold truncate pr-12">{title}</div>
      {subtitle && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</div>}
      {typeof price === "number" && (
        <div className="mt-2 text-base font-black kbd tabular-nums">{price.toFixed(2)}</div>
      )}
    </button>
  );
}

function SlipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border last:border-0 pb-2 last:pb-0">
      <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-semibold text-right">{value}</span>
    </div>
  );
}

function htftLabel(opt: HtFtOption, home: string, away: string): string {
  const map: Record<HtFtOption, [string, string]> = {
    HH: [home, home], HA: [home, away], AH: [away, home], AA: [away, away],
  };
  const [ht, ft] = map[opt];
  return `${ht} / ${ft}`;
}

function htftDescription(opt: HtFtOption): string {
  switch (opt) {
    case "HH": return "Home leads, home wins";
    case "AA": return "Away leads, away wins";
    case "HA": return "Home leads, away comeback";
    case "AH": return "Away leads, home comeback";
  }
}

function winnerLabel(opt: WinnerOption, winner: string): string {
  if (opt === "win") return `${winner} to win`;
  if (opt === "win-1-12") return `${winner} by 1–12`;
  return `${winner} by 13+`;
}

function inferHtFt(insights: any, home: string, away: string, model: MatchModel): HtFtOption {
  const pick: string = String(insights?.htft?.pick ?? "");
  const parts = pick.split(/\s*\/\s*/).map((p) => p.trim().toLowerCase());
  const side = (s: string): "H" | "A" | null => {
    if (!s) return null;
    if (s === "home" || s === "h" || s === home.toLowerCase()) return "H";
    if (s === "away" || s === "a" || s === away.toLowerCase()) return "A";
    return null;
  };
  const ht = side(parts[0] ?? "");
  const ft = side(parts[1] ?? parts[0] ?? "");
  if (ht && ft) return `${ht}${ft}` as HtFtOption;
  // Fallback to model winner with HT = same as FT
  const w = model.winner === "home" ? "H" : "A";
  return `${w}${w}` as HtFtOption;
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

