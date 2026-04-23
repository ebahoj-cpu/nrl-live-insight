import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getMatchPage } from "@/server/index.functions";
import { TeamLogo } from "@/components/TeamLogo";
import type { TryscorerMarkets, TryscorerOdds } from "@/server/odds";
import type { StatEdge, AggregatedStat, TeamStats } from "@/server/stats";
import type { PlayerForm } from "@/server/players";
import { Suspense, useState } from "react";
import {
  ArrowLeft, Clock, MapPin, Users, BarChart3, Sparkles, ScrollText,
  Trophy, Target, Flag, Crown, TrendingUp, AlertCircle, CloudSun, Calendar, Zap, Hourglass,
  Coins, ThumbsUp, ThumbsDown, Activity, Brain, Wind, Droplet, Flame, Snowflake, Minus,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";

const matchQO = (matchId: string) => queryOptions({
  queryKey: ["match", matchId],
  queryFn: () => getMatchPage({ data: { matchId } }),
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
        <p className="text-danger font-semibold">Match data unavailable</p>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button onClick={() => router.invalidate()} className="mt-4 px-4 py-2 bg-accent text-accent-foreground rounded-full font-semibold">
          Retry
        </button>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="py-16 text-center">
      <p>Match not found.</p>
      <Link to="/" className="text-accent">Back to fixtures</Link>
    </div>
  ),
});

type TabKey = "lineup" | "stats" | "players" | "script" | "insights";

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
  const { details, ladder, insights, insightsError, tryscorers, statsBundle, statEdges, homePlayerForms, awayPlayerForms } = data;
  const [tab, setTab] = useState<TabKey>("stats");

  const homeRow = ladder.find((r) => r.nickname === details.homeTeam.nickName);
  const awayRow = ladder.find((r) => r.nickname === details.awayTeam.nickName);

  return (
    <div className="pt-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to fixtures
      </Link>

      {/* Header */}
      <section className="glass p-6 sm:p-8">
        <div className="text-[11px] uppercase tracking-widest text-accent font-bold">Round {details.roundNumber}</div>
        <div className="grid grid-cols-3 items-center mt-4 gap-4">
          <TeamColumn name={details.homeTeam.nickName} themeKey={details.homeTeam.themeKey} position={details.homeTeam.position} />
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-extrabold">vs</div>
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
        <TabButton active={tab === "stats"} onClick={() => setTab("stats")} icon={BarChart3} label="Stats" />
        <TabButton active={tab === "players"} onClick={() => setTab("players")} icon={Activity} label="Players" />
        <TabButton active={tab === "script"} onClick={() => setTab("script")} icon={ScrollText} label="Script" />
        <TabButton active={tab === "insights"} onClick={() => setTab("insights")} icon={Sparkles} label="Insights" />
        <TabButton active={tab === "lineup"} onClick={() => setTab("lineup")} icon={Users} label="Lineup" />
      </nav>

      <div className="mt-6">
        {tab === "lineup" && <LineupTab home={details.homeTeam} away={details.awayTeam} />}
        {tab === "stats" && (
          <StatsTab
            home={details.homeTeam} away={details.awayTeam}
            homeRow={homeRow} awayRow={awayRow}
            statsBundle={statsBundle} statEdges={statEdges}
          />
        )}
        {tab === "players" && (
          <PlayersTab home={details.homeTeam.nickName} away={details.awayTeam.nickName}
                      homeForms={homePlayerForms} awayForms={awayPlayerForms} />
        )}
        {tab === "script" && (
          <ScriptTab insights={insights} insightsError={insightsError}
                     home={details.homeTeam} away={details.awayTeam}
                     homeRow={homeRow} awayRow={awayRow} weather={details.weather} />
        )}
        {tab === "insights" && (
          <InsightsTab
            insights={insights} insightsError={insightsError}
            home={details.homeTeam.nickName} away={details.awayTeam.nickName}
            tryscorers={tryscorers} kickoffUtc={details.kickoffUtc}
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
      className={`inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
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

function Card({ title, icon: Icon, children, className = "", action }:
  { title: string; icon?: typeof Users; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={`glass p-5 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-accent" />}
          <h3 className="font-bold text-sm uppercase tracking-wider">{title}</h3>
        </div>
        {action}
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

/* ================= LINEUP TAB ================= */

const POSITION_ORDER = [
  "Fullback","Winger","Centre","Five-Eighth","Halfback",
  "Prop","Hooker","2nd Row","Lock","Interchange","Reserve",
];

function LineupTab({ home, away }: { home: any; away: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SquadPanel team={home} />
      <SquadPanel team={away} />
    </div>
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

function fmtSigned(n: number) { return n > 0 ? `+${n}` : `${n}`; }

function StatsTab({ home, away, homeRow, awayRow, statsBundle, statEdges }:
  { home: any; away: any; homeRow?: any; awayRow?: any; statsBundle: any; statEdges: StatEdge[] }) {
  return (
    <div className="space-y-4">
      {/* Ladder snapshot */}
      {(homeRow && awayRow) && (
        <Card title="Season snapshot" icon={Trophy}>
          <div className="grid grid-cols-3 gap-2 text-center mb-4">
            <div className="text-xs text-muted-foreground truncate">{home.nickName}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">vs</div>
            <div className="text-xs text-muted-foreground truncate">{away.nickName}</div>
          </div>
          <CompareRow label="Ladder" h={`#${homeRow.position}`} a={`#${awayRow.position}`} higherWins={homeRow.position < awayRow.position} />
          <CompareRow label="Wins" h={homeRow.wins} a={awayRow.wins} higherWins={homeRow.wins > awayRow.wins} />
          <CompareRow label="Points for" h={homeRow.for} a={awayRow.for} higherWins={homeRow.for > awayRow.for} />
          <CompareRow label="Points against" h={homeRow.against} a={awayRow.against} higherWins={homeRow.against < awayRow.against} />
          <CompareRow label="Differential" h={fmtSigned(homeRow.diff)} a={fmtSigned(awayRow.diff)} higherWins={homeRow.diff > awayRow.diff} last />
        </Card>
      )}

      {/* NRL-style team stats — last 5 averages */}
      <Card title="Team stats · last 5 played" icon={BarChart3}>
        {!statsBundle || statEdges.length === 0 ? (
          <p className="text-xs text-muted-foreground">Per-game stats build after both teams have played matches in this season.</p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
              <div className="text-right">{home.nickName}</div>
              <div className="text-center">Stat</div>
              <div className="text-left">{away.nickName}</div>
            </div>
            <div className="space-y-1">
              {statEdges.map((e) => <StatRow key={e.field} edge={e} />)}
            </div>
          </>
        )}
      </Card>

      {/* Mismatches highlighted */}
      {statEdges.filter((e) => e.edge !== "even").length > 0 && (
        <Card title="Exploitable mismatches" icon={Target}>
          <ul className="space-y-2.5 text-sm">
            {statEdges.filter((e) => e.edge !== "even").slice(0, 6).map((e) => (
              <li key={e.field} className="flex gap-2.5">
                <span className="kbd shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent/15 text-accent uppercase">
                  {e.edge === "home" ? home.nickName : away.nickName}
                </span>
                <span><span className="font-semibold">{e.framing}</span> · {e.field} {e.homeAvg} vs {e.awayAvg}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Form pills + last 5 list per team */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormCard team={home} bundle={statsBundle?.home} />
        <FormCard team={away} bundle={statsBundle?.away} />
      </div>
    </div>
  );
}

function StatRow({ edge }: { edge: StatEdge }) {
  const edgeHome = edge.edge === "home";
  const edgeAway = edge.edge === "away";
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 py-2 border-b border-border last:border-0">
      <div className={`text-right kbd font-bold ${edgeHome ? "text-accent" : ""}`}>{edge.homeAvg}</div>
      <div className="text-center text-[11px] text-muted-foreground px-2 whitespace-nowrap">{edge.field}</div>
      <div className={`text-left kbd font-bold ${edgeAway ? "text-accent" : ""}`}>{edge.awayAvg}</div>
    </div>
  );
}

function CompareRow({ label, h, a, higherWins, last }: { label: string; h: any; a: any; higherWins?: boolean; last?: boolean }) {
  return (
    <div className={`grid grid-cols-3 items-center py-2.5 ${last ? "" : "border-b border-border"}`}>
      <div className={`text-right kbd font-semibold ${higherWins ? "text-accent" : "text-foreground"}`}>{h}</div>
      <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-left kbd font-semibold ${higherWins === false ? "text-accent" : "text-foreground"}`}>{a}</div>
    </div>
  );
}

function FormCard({ team, bundle }: { team: any; bundle?: TeamStats }) {
  return (
    <Card title={`${team.nickName} · form`} icon={Activity}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last 5</div>
        {team.recentForm.length > 0 && (
          <div className="flex gap-1">
            {team.recentForm.slice(0, 5).map((f: any, i: number) => (
              <span
                key={i}
                title={`${f.result} ${f.score}`}
                className={`h-6 w-6 rounded-md flex items-center justify-center text-[11px] font-black ${
                  f.result === "Won"
                    ? "bg-accent text-accent-foreground"
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
      {bundle && bundle.stats.some((s) => s.samples > 0) && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Trend last 3 vs prior</div>
          <div className="grid grid-cols-2 gap-1.5">
            {bundle.stats.filter((s) => s.samples >= 3).slice(0, 6).map((s) => <TrendPill key={s.field} stat={s} />)}
          </div>
        </div>
      )}
    </Card>
  );
}

function TrendPill({ stat }: { stat: AggregatedStat }) {
  const Icon = stat.trend === "up" ? ArrowUpRight : stat.trend === "down" ? ArrowDownRight : Minus;
  const colour = stat.trend === "up" ? "text-accent" : stat.trend === "down" ? "text-danger" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-1.5 text-[11px] py-1">
      <Icon className={`h-3 w-3 shrink-0 ${colour}`} />
      <span className="truncate">{stat.field}</span>
      <span className="kbd text-muted-foreground ml-auto shrink-0">{stat.last3Avg}</span>
    </div>
  );
}

/* ================= PLAYERS TAB ================= */

function PlayersTab({ home, away, homeForms, awayForms }:
  { home: string; away: string; homeForms: PlayerForm[]; awayForms: PlayerForm[] }) {
  const hasAny = (homeForms?.length ?? 0) + (awayForms?.length ?? 0) > 0;
  if (!hasAny) return <Empty msg="Player form builds after named squads play matches." />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <PlayerFormPanel team={home} forms={homeForms} />
      <PlayerFormPanel team={away} forms={awayForms} />
    </div>
  );
}

function PlayerFormPanel({ team, forms }: { team: string; forms: PlayerForm[] }) {
  const withData = forms.filter((p) => p.appearances > 0)
    .sort((a, b) => (b.avgRunMetres + b.avgTries * 50) - (a.avgRunMetres + a.avgTries * 50));
  return (
    <Card title={`${team} · player form`} icon={Activity}>
      {withData.length === 0 ? (
        <p className="text-xs text-muted-foreground">No matched player history (likely first appearances).</p>
      ) : (
        <ul className="space-y-3">
          {withData.slice(0, 8).map((p) => <PlayerRow key={`${p.firstName}-${p.lastName}`} p={p} />)}
        </ul>
      )}
    </Card>
  );
}

function PlayerRow({ p }: { p: PlayerForm }) {
  const TrendIcon = p.trend === "peak" ? Flame : p.trend === "cold" ? Snowflake : Minus;
  const trendColour = p.trend === "peak" ? "text-accent" : p.trend === "cold" ? "text-danger" : "text-muted-foreground";
  return (
    <li className="flex items-start gap-3 py-2 border-b border-border last:border-0">
      <span className="kbd w-7 h-7 shrink-0 text-xs font-bold rounded-md bg-surface-2 flex items-center justify-center">
        {p.jerseyNumber ?? "—"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm truncate">{p.firstName} {p.lastName}</span>
          {p.isCaptain && <Crown className="h-3 w-3 text-accent shrink-0" />}
          <TrendIcon className={`h-3.5 w-3.5 shrink-0 ${trendColour}`} />
        </div>
        <div className="text-[11px] text-muted-foreground">{p.position} · {p.roleNote}</div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5 text-[10px]">
          <Mini label="m" value={`${p.avgRunMetres}`} />
          <Mini label="tkl" value={`${p.avgTackles}`} />
          <Mini label="T" value={p.avgTries.toFixed(1)} />
          <Mini label="TA" value={p.avgTryAssists.toFixed(1)} />
        </div>
      </div>
    </li>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 rounded px-1.5 py-1 text-center">
      <div className="kbd font-bold">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

/* ================= INSIGHTS TAB ================= */

function InsightsTab({ insights, insightsError, home, away, tryscorers, kickoffUtc }:
  { insights: any; insightsError: string | null; home: string; away: string; tryscorers: TryscorerMarkets | null; kickoffUtc: string }) {
  if (insightsError) return <Empty msg={insightsError} />;
  if (!insights) return <Empty msg="Insights unavailable." />;

  const winnerName = insights.winner.team === "home" ? home : away;

  return (
    <div className="space-y-4">
      {/* Predicted result hero */}
      <Card title="Predicted result" icon={Sparkles} className="accent-glow">
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{home}</div>
            <div className="text-4xl font-black kbd">{insights.predictedScore.home}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Winner</div>
            <div className="text-sm font-bold mt-1">{winnerName}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{away}</div>
            <div className="text-4xl font-black kbd">{insights.predictedScore.away}</div>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{insights.winner.reasoning}</p>
      </Card>

      {/* Edge nuggets */}
      {insights.edgeNuggets?.length > 0 && (
        <Card title="Edge insights" icon={Zap} className="accent-glow">
          <ul className="space-y-2.5">
            {insights.edgeNuggets.map((n: any, i: number) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className={`kbd shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                  n.impact === "high" ? "bg-accent text-accent-foreground" :
                  n.impact === "medium" ? "bg-accent/20 text-accent" :
                  "bg-surface-2 text-muted-foreground"
                }`}>{n.label}</span>
                <span>{n.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Pick grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PickCard icon={Target} market="Winning margin" pick={`${winnerName} by ${insights.margin.bucket}`} reasoning={insights.margin.reasoning} />
        <PickCard icon={TrendingUp} market={`Total points ${insights.total.line}`} pick={insights.total.pick.toUpperCase()} reasoning={insights.total.reasoning} />
        <PickCard icon={Clock} market="Half-time / Full-time" pick={insights.htft.pick} reasoning={insights.htft.reasoning} />
        {(insights.bettingAngles ?? [])
          .filter((a: any) => !/try\s*scorer|tryscorer|first\s*try|anytime\s*try/i.test(`${a.market} ${a.pick}`))
          .map((a: any, i: number) => (
            <PickCard key={i} icon={Sparkles} market={a.market} pick={a.pick} reasoning={a.reasoning} />
          ))}
      </div>

      {/* Betting intelligence */}
      {insights.bettingIntelligence?.length > 0 && (
        <Card title="Market vs model" icon={Brain}>
          <p className="text-[11px] text-muted-foreground mb-4 italic">Where bookmaker pricing diverges from what the data suggests.</p>
          <div className="space-y-3">
            {insights.bettingIntelligence.map((b: any, i: number) => <BettingCompareRow key={i} b={b} />)}
          </div>
        </Card>
      )}

      {/* Weather impact */}
      {insights.weatherImpact && (
        <Card title="Weather & ground impact" icon={Wind}>
          <p className="text-sm leading-relaxed mb-2">{insights.weatherImpact.summary}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Tactical: </span>{insights.weatherImpact.tacticalNote}
            {insights.weatherImpact.favours !== "neither" && (
              <> · <span className="text-accent font-semibold">Favours {insights.weatherImpact.favours === "home" ? home : away}</span></>
            )}
          </p>
        </Card>
      )}

      {/* Keys to victory */}
      {insights.keysToVictory && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KeysCard team={home} keys={insights.keysToVictory.home} />
          <KeysCard team={away} keys={insights.keysToVictory.away} />
        </div>
      )}

      {/* Tryscorer odds */}
      <TryscorersSection
        tryscorers={tryscorers}
        aiAnytime={insights.anytimeTryscorers}
        aiFirst={insights.firstTryscorer}
        aiMulti={insights.multiTryscorer}
        kickoffUtc={kickoffUtc}
      />
    </div>
  );
}

function BettingCompareRow({ b }: { b: any }) {
  const tone = b.lean === "value" ? "border-accent/40 bg-accent/5"
    : b.lean === "fade" ? "border-danger/40 bg-danger/5"
    : "border-border bg-surface-2/40";
  const leanLabel = b.lean === "value" ? "VALUE" : b.lean === "fade" ? "FADE" : b.lean === "with_market" ? "WITH MARKET" : "NEUTRAL";
  const leanColour = b.lean === "value" ? "bg-accent text-accent-foreground"
    : b.lean === "fade" ? "bg-danger text-white"
    : "bg-surface-2 text-muted-foreground";
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider">{b.market}</span>
        <span className={`kbd ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${leanColour}`}>{leanLabel}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted-foreground">Market: </span>{b.marketSays}</div>
        <div><span className="text-muted-foreground">Model: </span>{b.modelSays}</div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">{b.reasoning}</p>
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
          {tryscorers!.first.length > 0 && <TryOddsCard title="First tryscorer" icon={Flag} picks={tryscorers!.first.slice(0, 6)} note="Best price across AU bookies." />}
          {tryscorers!.anytime.length > 0 && <TryOddsCard title="Anytime tryscorer" icon={Sparkles} picks={tryscorers!.anytime.slice(0, 8)} note="Strongest implied chances first." />}
          {tryscorers!.multi.length > 0 && <TryOddsCard title="2+ tries" icon={Trophy} picks={tryscorers!.multi.slice(0, 6)} note="Outsider value plays — pair with form." />}
        </>
      ) : (
        <Card title="Tryscorer odds — coming soon" icon={Hourglass}>
          <p className="text-sm text-muted-foreground mb-4">
            AU bookmakers release tryscorer markets once team lists are confirmed (usually <span className="font-semibold text-foreground">~24 hours before kickoff</span>). They&rsquo;ll appear here automatically.
          </p>
          <p className="text-[11px] text-muted-foreground mb-4">Kickoff: {new Date(kickoffUtc).toLocaleString()}</p>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Early AI lean</div>
          <div className="space-y-3">
            <PreviewRow label="First" pick={aiFirst.pick} reasoning={aiFirst.reasoning} />
            <PreviewRow label="Multi" pick={aiMulti.pick} reasoning={aiMulti.reasoning} />
            {aiAnytime.slice(0, 3).map((t, i) => <PreviewRow key={i} label={`#${i + 1}`} pick={t.pick} reasoning={t.reasoning} />)}
          </div>
        </Card>
      )}
    </div>
  );
}

function TryOddsCard({ title, icon, picks, note }: { title: string; icon: typeof Flag; picks: TryscorerOdds[]; note: string }) {
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
      <span className="kbd shrink-0 w-12 h-6 rounded-md bg-surface-2 text-[10px] font-bold text-muted-foreground flex items-center justify-center uppercase">{label}</span>
      <div className="min-w-0">
        <div className="font-semibold text-sm">{pick}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{reasoning}</div>
      </div>
    </div>
  );
}

function PickCard({ icon: Icon, market, pick, reasoning }: { icon: typeof Sparkles; market: string; pick: string; reasoning: string }) {
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

/* ================= SCRIPT TAB ================= */

function ScriptTab({ insights, insightsError, home, away }:
  { insights: any; insightsError: string | null; home: any; away: any; homeRow?: any; awayRow?: any; weather?: any }) {
  if (insightsError) return <Empty msg={insightsError} />;
  if (!insights?.script) return <Empty msg="Script unavailable." />;

  const s = insights.script;

  return (
    <div className="space-y-4">
      <Card title="Form narrative" icon={TrendingUp}>
        <p className="text-sm leading-relaxed">{s.formNarrative}</p>
      </Card>

      <Card title="Ladder context" icon={Trophy}>
        <p className="text-sm leading-relaxed">{s.ladderContext}</p>
      </Card>

      <Card title="Match style projection" icon={Activity}>
        <p className="text-sm leading-relaxed">{s.matchStyleProjection}</p>
      </Card>

      {s.statDrivenScript?.length > 0 && (
        <Card title="Stat-driven script — if/then" icon={Brain} className="accent-glow">
          <ul className="space-y-3">
            {s.statDrivenScript.map((line: string, i: number) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="kbd w-6 h-6 shrink-0 rounded-full bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <span className="leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s.psychologicalFactors?.length > 0 && (
        <Card title="Psychological factors" icon={Brain}>
          <ul className="space-y-2">
            {s.psychologicalFactors.map((p: string, i: number) => (
              <li key={i} className="flex gap-2 text-sm"><span className="text-accent shrink-0">›</span><span>{p}</span></li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Head to head" icon={ScrollText}>
        <div className="flex items-center justify-center gap-6 mb-4">
          <TeamLogo themeKey={home.themeKey} name={home.nickName} size={48} />
          <span className="text-muted-foreground text-sm font-bold">vs</span>
          <TeamLogo themeKey={away.themeKey} name={away.nickName} size={48} />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{s.headToHead}</p>
      </Card>

      <Card title="Upcoming milestones" icon={Crown}>
        <ul className="space-y-3">
          {s.milestones.map((m: string, i: number) => (
            <li key={i} className="flex gap-2 text-sm"><span className="text-accent shrink-0">›</span><span>{m}</span></li>
          ))}
        </ul>
      </Card>

      <Card title="X-factor" icon={Sparkles}>
        <p className="text-sm leading-relaxed">{s.xFactor}</p>
      </Card>

      {s.bookieScript && (
        <Card title="Bookie script" icon={Coins}>
          <p className="text-[11px] text-muted-foreground mb-4 italic">How an Australian bookmaker is praying this game plays out — and the result that hurts their book.</p>
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

function formatDate(utc: string) {
  if (!utc) return "TBC";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" }).format(d);
}

function formatTime(utc: string) {
  if (!utc) return "";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hour12: true }).format(d).toLowerCase();
}

// suppress unused import warnings — these icons are referenced via JSX only
void Droplet;
