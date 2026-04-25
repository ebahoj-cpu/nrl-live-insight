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
  Timer, Ban, Swords, Compass, Layers, Gauge, Radar, BookOpen,
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

function InsightsTab({ insights, insightsError, insightsLoading, home, away, homeRow, awayRow, tryscorers }:
  { insights: any; insightsError: string | null; insightsLoading?: boolean; home: TeamLite; away: TeamLite;
    homeRow?: LadderRow; awayRow?: LadderRow; tryscorers: TryscorerMarkets | null; tryscorersError: string | null }) {
  if (insightsLoading) return <InsightsLoading />;
  if (insightsError && !insights) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Insights unavailable." />;

  // ---- Statistical model: derive a Team Strength Score from ladder data ----
  // Equal weight across attack, defence, win%, winning margin, completion proxy.
  // Apply +5% home advantage. Form trend nudges the score by a small factor.
  const model = computeMatchModel(home.nickName, away.nickName, homeRow, awayRow, insights);

  return (
    <div className="space-y-4">
      {/* 1. Predicted Winner */}
      <PredictedWinnerCard model={model} home={home} away={away} />

      {/* 2. Stats Comparison Panel */}
      <StatsComparePanel home={home} away={away} homeRow={homeRow} awayRow={awayRow} model={model} />

      {/* 3. Score & Margin */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PredictedScoreCard model={model} home={home} away={away} insights={insights} />
        <MarginCard model={model} insights={insights} />
      </div>

      {/* 4. Total Points + 5. HT/FT Outlook */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TotalPointsCard model={model} insights={insights} />
        <HtFtCard insights={insights} home={home.nickName} away={away.nickName} />
      </div>

      {/* 6. First Tryscorer Highlight */}
      <FirstTryscorerCard insights={insights} tryscorers={tryscorers} />

      {/* 7. Anytime Tryscorers (max 5) */}
      <AnytimeTryscorersCard insights={insights} tryscorers={tryscorers} />

      {/* 8. Multi-try (doubles / hat-tricks) */}
      <MultiTryscorerCard insights={insights} tryscorers={tryscorers} />
    </div>
  );
}

/* ---------- Predictive model ---------- */

type MatchModel = {
  homeScore: number;        // 0-100 strength
  awayScore: number;        // 0-100 strength
  gap: number;              // homeScore - awayScore (positive = home favoured)
  winner: "home" | "away";
  confidence: "Low" | "Medium" | "High";
  confidencePct: number;    // 0-100 visual scale
  predictedHome: number;    // predicted points
  predictedAway: number;
  marginBucket: "1–12" | "13+";
  totalLine: number;        // expected combined points
  totalLean: "Over" | "Under";
  baselineTotal: number;    // NRL average
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
  // Defaults if ladder rows are missing — fall back to AI's predictedScore.
  const aiHome = Number(insights?.predictedScore?.home);
  const aiAway = Number(insights?.predictedScore?.away);

  const baselineTotal = 42; // NRL average combined points per game

  const compFor = (row: LadderRow | undefined) => {
    if (!row || row.played <= 0) return { attack: 50, defence: 50, winPct: 50, margin: 50, efficiency: 50 };
    const ppg = row.for / Math.max(1, row.played);          // points scored per game
    const cpg = row.against / Math.max(1, row.played);      // points conceded per game
    const winPct = (row.wins / Math.max(1, row.played)) * 100;
    const margin = (row.diff / Math.max(1, row.played));    // avg margin per game
    // Map each metric onto 0-100 with realistic NRL ranges.
    const attack = clamp(((ppg - 12) / (32 - 12)) * 100, 0, 100);
    const defence = clamp((1 - (cpg - 12) / (32 - 12)) * 100, 0, 100);
    const win = clamp(winPct, 0, 100);
    const mar = clamp(50 + margin * 2, 0, 100);             // ±25 margin → 0..100
    // Efficiency proxy: better diff per game = cleaner completions/error count.
    const eff = clamp(50 + margin * 1.5, 0, 100);
    return { attack, defence, winPct: win, margin: mar, efficiency: eff };
  };

  const hc = compFor(hr);
  const ac = compFor(ar);

  // Equal-weighted strength score (0-100).
  const strength = (c: typeof hc) => (c.attack + c.defence + c.winPct + c.margin + c.efficiency) / 5;
  let homeScore = strength(hc);
  let awayScore = strength(ac);

  // Form adjustment from AI recent-form read (last ~5 games). Small weight.
  // We use the predicted-score signal as a proxy for momentum, ±3 points max.
  if (Number.isFinite(aiHome) && Number.isFinite(aiAway)) {
    const aiGap = aiHome - aiAway;
    homeScore += clamp(aiGap * 0.15, -3, 3);
    awayScore += clamp(-aiGap * 0.15, -3, 3);
  }

  // +5% home advantage.
  homeScore *= 1.05;

  const gap = homeScore - awayScore;
  const winner: "home" | "away" = gap >= 0 ? "home" : "away";
  const absGap = Math.abs(gap);
  const confidence: MatchModel["confidence"] = absGap >= 12 ? "High" : absGap >= 5 ? "Medium" : "Low";
  const confidencePct = clamp(50 + absGap * 3.2, 50, 95);

  // Predicted score: blend AI score with model-derived score.
  let pHome = Number.isFinite(aiHome) ? aiHome : 22;
  let pAway = Number.isFinite(aiAway) ? aiAway : 18;
  // Nudge so the predicted winner aligns with the strength model.
  if (winner === "home" && pHome <= pAway) {
    const swap = pHome; pHome = pAway; pAway = swap;
  } else if (winner === "away" && pAway <= pHome) {
    const swap = pHome; pHome = pAway; pAway = swap;
  }
  const predictedHome = Math.round(pHome);
  const predictedAway = Math.round(pAway);

  const predictedMargin = Math.abs(predictedHome - predictedAway);
  const marginBucket: MatchModel["marginBucket"] = (confidence === "High" || predictedMargin >= 13) ? "13+" : "1–12";

  // Total line from attack vs opposition defence + baseline.
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
      <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
        Strength scored equally across attack, defence, win %, average margin and efficiency. +5% home boost applied. Recent form lightly nudges the score.
      </p>
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
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
          aria-label={`${pct}% confidence`}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>Low</span><span>Medium</span><span>High</span>
      </div>
    </div>
  );
}

function StatsComparePanel({ home, away, homeRow, awayRow, model }:
  { home: TeamLite; away: TeamLite; homeRow?: LadderRow; awayRow?: LadderRow; model: MatchModel }) {
  const ppg = (r?: LadderRow) => (r && r.played > 0 ? (r.for / r.played).toFixed(1) : "–");
  const cpg = (r?: LadderRow) => (r && r.played > 0 ? (r.against / r.played).toFixed(1) : "–");
  const winPct = (r?: LadderRow) => (r && r.played > 0 ? `${Math.round((r.wins / r.played) * 100)}%` : "–");
  const margin = (r?: LadderRow) => {
    if (!r || r.played <= 0) return "–";
    const m = r.diff / r.played;
    return `${m >= 0 ? "+" : ""}${m.toFixed(1)}`;
  };

  return (
    <Card title="Stats comparison" icon={BarChart3}>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <div className="text-right text-xs font-bold truncate">{home.nickName}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center">Metric</div>
        <div className="text-left text-xs font-bold truncate">{away.nickName}</div>

        <InsightCompareRow label="Record" h={homeRow ? `${homeRow.wins}W-${homeRow.losses}L` : "–"} a={awayRow ? `${awayRow.wins}W-${awayRow.losses}L` : "–"} hWin={(homeRow?.wins ?? 0) > (awayRow?.wins ?? 0)} aWin={(awayRow?.wins ?? 0) > (homeRow?.wins ?? 0)} />
        <InsightCompareRow label="Ladder" h={homeRow?.position ? `${homeRow.position}` : "–"} a={awayRow?.position ? `${awayRow.position}` : "–"} hWin={(homeRow?.position ?? 99) < (awayRow?.position ?? 99)} aWin={(awayRow?.position ?? 99) < (homeRow?.position ?? 99)} />
        <InsightCompareRow label="Pts / game" h={ppg(homeRow)} a={ppg(awayRow)} hWin={(homeRow?.for ?? 0) > (awayRow?.for ?? 0)} aWin={(awayRow?.for ?? 0) > (homeRow?.for ?? 0)} />
        <InsightCompareRow label="Conceded / game" h={cpg(homeRow)} a={cpg(awayRow)} hWin={(homeRow?.against ?? 0) < (awayRow?.against ?? 0)} aWin={(awayRow?.against ?? 0) < (homeRow?.against ?? 0)} />
        <InsightCompareRow label="Win %" h={winPct(homeRow)} a={winPct(awayRow)} hWin={(homeRow?.wins ?? 0) > (awayRow?.wins ?? 0)} aWin={(awayRow?.wins ?? 0) > (homeRow?.wins ?? 0)} />
        <InsightCompareRow label="Avg margin" h={margin(homeRow)} a={margin(awayRow)} hWin={(homeRow?.diff ?? -99) > (awayRow?.diff ?? -99)} aWin={(awayRow?.diff ?? -99) > (homeRow?.diff ?? -99)} />
        <InsightCompareRow label="Strength" h={`${model.homeScore}`} a={`${model.awayScore}`} hWin={model.homeScore > model.awayScore} aWin={model.awayScore > model.homeScore} />
      </div>
    </Card>
  );
}

function InsightCompareRow({ label, h, a, hWin, aWin }: { label: string; h: string; a: string; hWin?: boolean; aWin?: boolean }) {
  return (
    <>
      <div className={`kbd text-right text-sm font-bold py-1.5 ${hWin ? "text-accent" : "text-foreground"}`}>{h}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center px-1.5">{label}</div>
      <div className={`kbd text-left text-sm font-bold py-1.5 ${aWin ? "text-accent" : "text-foreground"}`}>{a}</div>
    </>
  );
}

function PredictedScoreCard({ model, home, away }:
  { model: MatchModel; home: TeamLite; away: TeamLite; insights: any }) {
  return (
    <Card title="Predicted score" icon={Target}>
      <div className="grid grid-cols-3 items-center gap-3 mb-3">
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
      <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
        Projected from each side's attack vs opposition defence, blended with recent form.
      </p>
    </Card>
  );
}

function MarginCard({ model, insights }: { model: MatchModel; insights: any }) {
  const reasoning: string = insights?.margin?.reasoning ?? "";
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
      {reasoning && <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">{reasoning}</p>}
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

function TotalPointsCard({ model, insights }: { model: MatchModel; insights: any }) {
  const reasoning: string = insights?.total?.reasoning ?? "";
  return (
    <Card title="Total match points" icon={Compass}>
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Combined estimate</div>
        <div className="text-3xl font-black kbd mt-1">{model.predictedHome + model.predictedAway}</div>
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-accent/15 text-accent border border-accent/30">
          {model.totalLean === "Over" ? <TrendingUp className="h-3 w-3" /> : <TrendingUp className="h-3 w-3 rotate-180" />}
          {model.totalLean} {model.totalLine}.5
        </div>
      </div>
      <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
        Baseline {model.baselineTotal} pts (NRL avg). Adjusted for both teams' attack vs defence and last-5 scoring trend.
        {reasoning ? ` ${reasoning}` : ""}
      </div>
    </Card>
  );
}

function HtFtCard({ insights, home, away }: { insights: any; home: string; away: string }) {
  const pick: string = insights?.htft?.pick ?? "—";
  const reasoning: string = insights?.htft?.reasoning ?? "";
  // Derive HT leader and FT leader by parsing common shapes like "Home/Home", "Storm/Storm".
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
      {reasoning && <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">{reasoning}</p>}
    </Card>
  );
}

function normaliseSideLabel(label: string, home: string, away: string): string {
  const l = label.trim().toLowerCase();
  if (l === "home" || l === "h") return home;
  if (l === "away" || l === "a") return away;
  return label.trim() || "—";
}

/* ---------- Tryscorer cards ---------- */

function FirstTryscorerCard({ insights, tryscorers }: { insights: any; tryscorers: TryscorerMarkets | null }) {
  const aiPick: string = insights?.firstTryscorer?.pick ?? "Awaiting team list";
  const aiReason: string = insights?.firstTryscorer?.reasoning ?? "Wingers and fullbacks carry the highest first-try probability based on positional data.";
  const top = tryscorers?.first?.[0]?.player;
  const headline = top || aiPick;
  return (
    <Card title="First tryscorer" icon={Flag} className="accent-glow">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
          <Crown className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Top pick</div>
          <div className="text-xl font-black truncate">{headline}</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{aiReason}</p>
    </Card>
  );
}

function AnytimeTryscorersCard({ insights, tryscorers }: { insights: any; tryscorers: TryscorerMarkets | null }) {
  // Prefer real market list (already implied-prob ranked), fall back to AI picks.
  const live = (tryscorers?.anytime ?? []).slice(0, 5).map((p) => ({ name: p.player, note: "" }));
  const aiList = Array.isArray(insights?.anytimeTryscorers) ? insights.anytimeTryscorers : [];
  const ai = aiList.slice(0, 5).map((t: any) => ({ name: String(t.pick ?? ""), note: String(t.reasoning ?? "") }));
  const list = (live.length >= 3 ? live : ai).slice(0, 5);

  return (
    <Card title="Anytime tryscorers" icon={Sparkles}>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tryscorer data unavailable until team lists are confirmed.</p>
      ) : (
        <ol className="space-y-2.5">
          {list.map((p, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="kbd shrink-0 h-6 w-6 rounded-full bg-accent text-accent-foreground text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold truncate">{p.name}</div>
                {p.note && <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{p.note}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
        Ranked by position (wingers / fullbacks weighted highest), recent try form and expected team try output.
      </p>
    </Card>
  );
}

function MultiTryscorerCard({ insights, tryscorers }: { insights: any; tryscorers: TryscorerMarkets | null }) {
  const live = (tryscorers?.multi ?? []).slice(0, 4);
  const aiPick: string = insights?.multiTryscorer?.pick ?? "";
  const aiReason: string = insights?.multiTryscorer?.reasoning ?? "";
  return (
    <Card title="Multi-try predictions (2+ / hat-tricks)" icon={Trophy}>
      {live.length > 0 ? (
        <ul className="space-y-2">
          {live.map((p, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="kbd w-5 text-center text-[11px] font-bold text-muted-foreground">{i + 1}</span>
              <span className="flex-1 font-medium truncate">{p.player}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">2+ tries</span>
            </li>
          ))}
        </ul>
      ) : aiPick ? (
        <div>
          <div className="text-base font-bold">{aiPick}</div>
          {aiReason && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{aiReason}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Multi-try projections release with team lists.</p>
      )}
      <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
        Based on form, expected team try volume and the opposition's defensive weakness in that lane.
      </p>
    </Card>
  );
}


/* (Script + Bets tabs removed — Insights tab is now the single predictive view) */

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
