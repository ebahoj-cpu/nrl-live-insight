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
  Coins, ThumbsUp, ThumbsDown, Activity, Brain, Wind, Flame, Snowflake, Minus,
  ArrowUpRight, ArrowDownRight, Shield, Swords, Layers, Gauge,
} from "lucide-react";

const matchQO = (matchId: string) => queryOptions({
  queryKey: ["match", matchId],
  queryFn: () => getMatchPage({ data: { matchId } }),
  staleTime: 5 * 60_000, // keep fresh for 5 minutes — fast tab switching
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

type TabKey = "teams" | "stats" | "players" | "insights" | "script";

function MatchPage() {
  return (
    <Suspense fallback={<MatchSkeleton />}>
      <MatchInner />
    </Suspense>
  );
}

function MatchSkeleton() {
  return (
    <div className="pt-6 space-y-4">
      <div className="h-4 w-32 bg-surface rounded animate-pulse" />
      <div className="glass p-8 h-48 animate-pulse" />
      <div className="grid grid-cols-5 gap-1 p-1 glass">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 bg-surface-2 rounded animate-pulse" />)}
      </div>
      <div className="glass p-6 h-64 animate-pulse" />
    </div>
  );
}

function MatchInner() {
  const { matchId } = Route.useParams();
  const { data } = useSuspenseQuery(matchQO(matchId));
  const { details, ladder, insights, insightsError, tryscorers, statsBundle, statEdges, homePlayerForms, awayPlayerForms } = data;
  const [tab, setTab] = useState<TabKey>("teams");

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

      {/* Tabs — Teams · Stats · Players · Insights · Script */}
      <nav className="mt-6 grid grid-cols-5 gap-1 p-1 glass" role="tablist">
        <TabButton active={tab === "teams"} onClick={() => setTab("teams")} icon={Users} label="Teams" />
        <TabButton active={tab === "stats"} onClick={() => setTab("stats")} icon={BarChart3} label="Stats" />
        <TabButton active={tab === "players"} onClick={() => setTab("players")} icon={Activity} label="Players" />
        <TabButton active={tab === "insights"} onClick={() => setTab("insights")} icon={Sparkles} label="Insights" />
        <TabButton active={tab === "script"} onClick={() => setTab("script")} icon={ScrollText} label="Script" />
      </nav>

      <div className="mt-6">
        {tab === "teams" && <TeamsTab home={details.homeTeam} away={details.awayTeam} />}
        {tab === "stats" && (
          <StatsTab
            home={details.homeTeam} away={details.awayTeam}
            homeRow={homeRow} awayRow={awayRow}
            statsBundle={statsBundle} statEdges={statEdges}
            history={details.history}
          />
        )}
        {tab === "players" && (
          <PlayersTab
            home={details.homeTeam.nickName} away={details.awayTeam.nickName}
            homeForms={homePlayerForms} awayForms={awayPlayerForms}
          />
        )}
        {tab === "insights" && (
          <InsightsTab
            insights={insights} insightsError={insightsError}
            home={details.homeTeam.nickName} away={details.awayTeam.nickName}
            tryscorers={tryscorers} kickoffUtc={details.kickoffUtc}
          />
        )}
        {tab === "script" && (
          <ScriptTab
            insights={insights} insightsError={insightsError}
            home={details.homeTeam} away={details.awayTeam}
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

/* ================= TEAMS TAB (lineups + form) ================= */

const POSITION_ORDER = [
  "Fullback","Winger","Centre","Five-Eighth","Halfback",
  "Prop","Hooker","2nd Row","Lock","Interchange","Reserve",
];

function TeamsTab({ home, away }: { home: any; away: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SquadPanel team={home} />
        <SquadPanel team={away} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormStrip team={home} />
        <FormStrip team={away} />
      </div>
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
        <div className="text-xs text-muted-foreground">
          {sorted.length === 0 ? "Squad not yet named" : `${sorted.length} players named`}
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">Confirmed lineup typically drops 24 hours before kickoff.</p>
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

function FormStrip({ team }: { team: any }) {
  const form = (team.recentForm ?? []).slice(0, 5);
  return (
    <Card title={`${team.nickName} · last 5`} icon={Activity}>
      {form.length === 0 ? (
        <div className="text-xs text-muted-foreground">No recent matches recorded.</div>
      ) : (
        <>
          <div className="flex gap-1 mb-3">
            {form.map((f: any, i: number) => (
              <span
                key={i}
                title={`${f.result} ${f.score}`}
                className={`h-7 flex-1 rounded-md flex items-center justify-center text-[11px] font-black ${
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
          <div className="space-y-1.5">
            {form.map((f: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border last:border-0">
                <span className="text-muted-foreground truncate pr-2">{f.summary}</span>
                <span className={`kbd font-bold shrink-0 ${f.result === "Won" ? "text-accent" : f.result === "Lost" ? "text-danger" : ""}`}>{f.score}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/* ================= STATS TAB ================= */

function fmtSigned(n: number) { return n > 0 ? `+${n}` : `${n}`; }

function StatsTab({ home, away, homeRow, awayRow, statsBundle, statEdges, history }:
  { home: any; away: any; homeRow?: any; awayRow?: any; statsBundle: any; statEdges: StatEdge[]; history?: any }) {

  const hasStats = statsBundle && statEdges.length > 0;

  // Key team metrics derived from ladder + statsBundle averages
  const homeKey = deriveKeyMetrics(homeRow, statsBundle?.home);
  const awayKey = deriveKeyMetrics(awayRow, statsBundle?.away);
  const haveKey = (homeKey && awayKey) ? true : false;

  return (
    <div className="space-y-4">
      {/* Season snapshot from ladder */}
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

      {/* Per-game team stats */}
      <Card title="Team stats · last 5 played (2026)" icon={BarChart3}>
        {!hasStats ? (
          <p className="text-xs text-muted-foreground">Per-game stats build after both teams have played 2026 matches.</p>
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

      {/* Key team metrics */}
      {haveKey && (
        <Card title="Key team metrics" icon={Gauge}>
          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            <div className="text-right">{home.nickName}</div>
            <div className="text-center">Metric</div>
            <div className="text-left">{away.nickName}</div>
          </div>
          <div className="space-y-1">
            <KeyRow label="Avg points scored" h={homeKey!.avgFor} a={awayKey!.avgFor} higherWins={homeKey!.avgFor > awayKey!.avgFor} />
            <KeyRow label="Avg points conceded" h={homeKey!.avgAgainst} a={awayKey!.avgAgainst} higherWins={homeKey!.avgAgainst < awayKey!.avgAgainst} />
            <KeyRow label="Completion rate" h={`${homeKey!.completion}%`} a={`${awayKey!.completion}%`} higherWins={homeKey!.completion > awayKey!.completion} />
            <KeyRow label="Effective tackle %" h={`${homeKey!.tackleEff}%`} a={`${awayKey!.tackleEff}%`} higherWins={homeKey!.tackleEff > awayKey!.tackleEff} />
            <KeyRow label="Missed tackles / game" h={homeKey!.missed} a={awayKey!.missed} higherWins={homeKey!.missed < awayKey!.missed} />
            <KeyRow label="Run metres / game" h={homeKey!.runMetres} a={awayKey!.runMetres} higherWins={homeKey!.runMetres > awayKey!.runMetres} last />
          </div>
        </Card>
      )}

      {/* Head to head */}
      <H2HCard home={home} away={away} history={history} />
    </div>
  );
}

type KeyMetrics = {
  avgFor: number; avgAgainst: number;
  completion: number; tackleEff: number;
  missed: number; runMetres: number;
};

function deriveKeyMetrics(row: any, stats: TeamStats | undefined): KeyMetrics | null {
  if (!row) return null;
  const played = Math.max(1, row.played || 1);
  const find = (field: string) => stats?.stats.find((s) => s.field === field && s.samples > 0);
  const completion = find("Completion Rate")?.avg ?? 0;
  const tackleEff = find("Effective Tackle %")?.avg ?? 0;
  const missed = find("Missed Tackles")?.avg ?? 0;
  const runMetres = find("All Run Metres")?.avg ?? 0;
  return {
    avgFor: Number((row.for / played).toFixed(1)),
    avgAgainst: Number((row.against / played).toFixed(1)),
    completion: Math.round(completion),
    tackleEff: Math.round(tackleEff),
    missed: Math.round(missed),
    runMetres: Math.round(runMetres),
  };
}

function KeyRow({ label, h, a, higherWins, last }: { label: string; h: any; a: any; higherWins?: boolean; last?: boolean }) {
  return (
    <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 py-2 ${last ? "" : "border-b border-border"}`}>
      <div className={`text-right kbd font-bold ${higherWins ? "text-accent" : "text-foreground"}`}>{h}</div>
      <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground px-2 whitespace-nowrap">{label}</div>
      <div className={`text-left kbd font-bold ${higherWins === false ? "text-accent" : "text-foreground"}`}>{a}</div>
    </div>
  );
}

function H2HCard({ home, away, history }: { home: any; away: any; history?: any }) {
  // history shape varies — safely extract: { matches?: [...], homeWins, awayWins, drawn }
  const matches: any[] = Array.isArray(history?.matches) ? history.matches : Array.isArray(history) ? history : [];
  const homeWins = history?.homeWins ?? matches.filter((m) => isWinFor(m, home.nickName)).length;
  const awayWins = history?.awayWins ?? matches.filter((m) => isWinFor(m, away.nickName)).length;
  const drawn = history?.drawn ?? Math.max(0, matches.length - homeWins - awayWins);

  return (
    <Card title="Head to head" icon={Swords}>
      {matches.length === 0 && homeWins === 0 && awayWins === 0 ? (
        <p className="text-xs text-muted-foreground">No prior meeting data available.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 items-center gap-2 mb-4">
            <div className="text-center">
              <div className="text-2xl font-black kbd text-accent">{homeWins}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{home.nickName} wins</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black kbd text-muted-foreground">{drawn}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Drawn</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-black kbd text-accent">{awayWins}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{away.nickName} wins</div>
            </div>
          </div>
          {matches.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Last 2 meetings</div>
              <div className="space-y-2">
                {matches.slice(0, 2).map((m, i) => <H2HRow key={i} m={m} home={home.nickName} away={away.nickName} />)}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function isWinFor(m: any, team: string): boolean {
  const winner = m?.winnerNickName ?? m?.winner;
  if (winner) return winner === team;
  const hs = Number(m?.homeScore ?? 0); const as = Number(m?.awayScore ?? 0);
  if (m?.homeNickName === team) return hs > as;
  if (m?.awayNickName === team) return as > hs;
  return false;
}

function H2HRow({ m, home, away }: { m: any; home: string; away: string }) {
  const homeScore = m?.homeScore ?? m?.home?.score ?? "—";
  const awayScore = m?.awayScore ?? m?.away?.score ?? "—";
  const homeNick = m?.homeNickName ?? home;
  const awayNick = m?.awayNickName ?? away;
  const venue = m?.venue ?? m?.venueName ?? "";
  const date = m?.kickOffTimeLong ?? m?.startTime ?? m?.matchDate ?? "";
  return (
    <div className="rounded-lg bg-surface-2/40 p-3 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold">{homeNick} <span className="kbd ml-1">{homeScore}</span></span>
        <span className="text-muted-foreground">vs</span>
        <span className="font-semibold"><span className="kbd mr-1">{awayScore}</span> {awayNick}</span>
      </div>
      <div className="text-[10px] text-muted-foreground text-center">
        {date ? formatShortDate(date) : ""}{venue ? ` · ${venue}` : ""}
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

// Trend pill kept (used in PlayersTab if we later show; here we keep API stable)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const hasAny = (homeForms?.length ?? 0) + (awayForms?.length ?? 0) > 0
    && (homeForms.some((p) => p.appearances > 0) || awayForms.some((p) => p.appearances > 0));

  if (!hasAny) return <Empty msg="Player form builds after named squads play matches." />;

  // Tag each player with their team for the combined leaderboards
  const allPlayers = [
    ...homeForms.filter((p) => p.appearances > 0).map((p) => ({ ...p, team: home })),
    ...awayForms.filter((p) => p.appearances > 0).map((p) => ({ ...p, team: away })),
  ];

  return (
    <div className="space-y-4">
      {/* Per-team last 5 totals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TeamTotalsCard team={home} forms={homeForms} />
        <TeamTotalsCard team={away} forms={awayForms} />
      </div>

      {/* Combined Top 5 leaderboards */}
      <Card title="Top 5 · combined (betting focus)" icon={Trophy} className="accent-glow">
        <p className="text-[11px] text-muted-foreground mb-4 italic">Both squads merged. Rankings use last-5 averages — strongest recent form first.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          <Leaderboard title="Try scorers" players={topN(allPlayers, (p) => p.avgTries)} unit="T/g" valueOf={(p) => p.avgTries.toFixed(2)} />
          <Leaderboard title="Try assists" players={topN(allPlayers, (p) => p.avgTryAssists)} unit="TA/g" valueOf={(p) => p.avgTryAssists.toFixed(2)} />
          <Leaderboard title="Line breaks" players={topN(allPlayers, (p) => p.avgLineBreaks)} unit="LB/g" valueOf={(p) => p.avgLineBreaks.toFixed(2)} />
          <Leaderboard title="Tackle busts" players={topN(allPlayers, (p) => p.avgTackleBreaks)} unit="TB/g" valueOf={(p) => p.avgTackleBreaks.toFixed(2)} />
          <Leaderboard title="Run metres" players={topN(allPlayers, (p) => p.avgRunMetres)} unit="m/g" valueOf={(p) => `${p.avgRunMetres}`} />
        </div>
      </Card>

      {/* Per-team form panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PlayerFormPanel team={home} forms={homeForms} />
        <PlayerFormPanel team={away} forms={awayForms} />
      </div>
    </div>
  );
}

function topN<T>(arr: T[], score: (x: T) => number, n = 5): T[] {
  return [...arr].sort((a, b) => score(b) - score(a)).filter((x) => score(x) > 0).slice(0, n);
}

function Leaderboard({ title, players, unit, valueOf }: {
  title: string; players: (PlayerForm & { team: string })[]; unit: string; valueOf: (p: PlayerForm) => string;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-bold">{title}</div>
      {players.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No samples yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {players.map((p, i) => (
            <li key={`${p.firstName}-${p.lastName}`} className="flex items-center gap-2 text-xs py-1 border-b border-border last:border-0">
              <span className="kbd w-5 text-center text-[10px] font-bold text-muted-foreground">{i + 1}</span>
              <span className="flex-1 truncate font-medium">{p.firstName} {p.lastName}</span>
              <span className="text-[10px] text-muted-foreground hidden sm:inline truncate max-w-[60px]">{p.team}</span>
              <span className="kbd font-bold text-accent">{valueOf(p)}</span>
              <span className="text-[9px] uppercase text-muted-foreground tracking-wider">{unit}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamTotalsCard({ team, forms }: { team: string; forms: PlayerForm[] }) {
  const withData = forms.filter((p) => p.appearances > 0);
  const sum = (k: keyof PlayerForm) => Number(withData.reduce((acc, p) => acc + (p[k] as number), 0).toFixed(1));
  return (
    <Card title={`${team} · squad last 5 avg`} icon={BarChart3}>
      {withData.length === 0 ? (
        <p className="text-xs text-muted-foreground">No player history yet.</p>
      ) : (
        <div className="grid grid-cols-5 gap-2 text-center">
          <Mini label="T" value={sum("avgTries").toFixed(1)} />
          <Mini label="LB" value={sum("avgLineBreaks").toFixed(1)} />
          <Mini label="TB" value={sum("avgTackleBreaks").toFixed(1)} />
          <Mini label="m" value={`${Math.round(sum("avgRunMetres"))}`} />
          <Mini label="TA" value={sum("avgTryAssists").toFixed(1)} />
        </div>
      )}
    </Card>
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
  if (!insights) return <Empty msg="Insights generating — check back shortly." />;

  const winnerName = insights.winner.team === "home" ? home : away;
  const teamName = (side: "home" | "away") => side === "home" ? home : away;

  return (
    <div className="space-y-4">
      {/* 1. Winning Team */}
      <Card title="Winning team" icon={Trophy} className="accent-glow">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pick</div>
            <div className="text-2xl font-black mt-1">{winnerName}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</div>
            <div className="kbd font-black text-accent text-xl mt-1">{Math.round(insights.winner.confidence * 100)}%</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{insights.winner.reasoning}</p>
      </Card>

      {/* 2. Winning Margin */}
      <PickCard icon={Target} market="Winning margin" pick={`${winnerName} by ${insights.margin.bucket}`} reasoning={insights.margin.reasoning} />

      {/* 3. Predicted result */}
      <Card title="Predicted result" icon={Sparkles}>
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{home}</div>
            <div className="text-4xl font-black kbd">{insights.predictedScore.home}</div>
          </div>
          <div className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">final</div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{away}</div>
            <div className="text-4xl font-black kbd">{insights.predictedScore.away}</div>
          </div>
        </div>
      </Card>

      {/* 4. Total points */}
      <PickCard
        icon={TrendingUp}
        market={`Total points · line ${insights.total.line}`}
        pick={insights.total.pick.toUpperCase()}
        reasoning={insights.total.reasoning}
      />

      {/* 5. Half-time / full-time */}
      <PickCard
        icon={Clock}
        market="Half-time / Full-time"
        pick={resolveHtFt(insights.htft.pick, home, away)}
        reasoning={insights.htft.reasoning}
      />

      {/* 6. Tryscorer markets */}
      <Card title="Try scorer markets" icon={Flag}>
        <div className="space-y-3">
          <BetRow label="First try scorer" pick={insights.firstTryscorer.pick} reasoning={insights.firstTryscorer.reasoning} />
          {insights.firstSecondThird && (
            <BetRow
              label="1st / 2nd / 3rd try scorer"
              pick={insights.firstSecondThird.picks?.join(" → ") ?? "—"}
              reasoning={insights.firstSecondThird.reasoning}
            />
          )}
          {insights.doubleTryscorer && (
            <BetRow label="Potential double (2+)" pick={insights.doubleTryscorer.pick} reasoning={insights.doubleTryscorer.reasoning} />
          )}
          {insights.multiTryscorer && (
            <BetRow label="Multi try scorer lean" pick={insights.multiTryscorer.pick} reasoning={insights.multiTryscorer.reasoning} />
          )}
        </div>
        {(insights.anytimeTryscorers ?? []).length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-bold">Anytime try scorers</div>
            <ul className="space-y-2">
              {insights.anytimeTryscorers.slice(0, 5).map((t: any, i: number) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="kbd w-5 h-5 shrink-0 rounded bg-accent/15 text-accent text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="font-semibold">{t.pick}</div>
                    <div className="text-[11px] text-muted-foreground">{t.reasoning}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* 7. Edge attack vs defence cards */}
      {(insights.leftEdge || insights.rightEdge) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {insights.leftEdge && <EdgeCard side="Left" edge={insights.leftEdge} teamName={teamName} />}
          {insights.rightEdge && <EdgeCard side="Right" edge={insights.rightEdge} teamName={teamName} />}
        </div>
      )}

      {/* 8. Edge nuggets */}
      {insights.edgeNuggets?.length > 0 && (
        <Card title="Edge insights" icon={Zap}>
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

      {/* 9. Market vs model */}
      {insights.bettingIntelligence?.length > 0 && (
        <Card title="Market vs model" icon={Brain}>
          <p className="text-[11px] text-muted-foreground mb-4 italic">Where bookmaker pricing diverges from what the data suggests.</p>
          <div className="space-y-3">
            {insights.bettingIntelligence.map((b: any, i: number) => <BettingCompareRow key={i} b={b} />)}
          </div>
        </Card>
      )}

      {/* 10. Weather */}
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

      {/* 11. Keys to victory */}
      {insights.keysToVictory && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KeysCard team={home} keys={insights.keysToVictory.home} />
          <KeysCard team={away} keys={insights.keysToVictory.away} />
        </div>
      )}

      {/* 12. Live tryscorer odds (if released) */}
      <TryscorersSection tryscorers={tryscorers} kickoffUtc={kickoffUtc} />
    </div>
  );
}

function resolveHtFt(pick: string, home: string, away: string): string {
  // Replace literal "home" / "away" with team names where present
  return (pick || "")
    .replace(/\bhome\b/gi, home)
    .replace(/\baway\b/gi, away);
}

function BetRow({ label, pick, reasoning }: { label: string; pick: string; reasoning: string }) {
  return (
    <div className="flex gap-3 py-2 border-b border-border last:border-0">
      <span className="kbd shrink-0 w-32 sm:w-40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground self-start mt-0.5">{label}</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm">{pick}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{reasoning}</div>
      </div>
    </div>
  );
}

function EdgeCard({ side, edge, teamName }: { side: "Left" | "Right"; edge: any; teamName: (s: "home" | "away") => string }) {
  const attacker = teamName(edge.attackingTeam);
  const target = teamName(edge.vulnerableTeam);
  const oppositeSide = side === "Left" ? "right" : "left";
  return (
    <Card title={`${side} edge attack`} icon={Swords} className="accent-glow">
      <div className="rounded-lg bg-surface-2/50 p-3 mb-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider mb-1">
          <span className="text-accent font-bold">Attack · {attacker}</span>
          <Layers className="h-3 w-3 text-muted-foreground" />
          <span className="text-danger font-bold">vs {target} {oppositeSide} D</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          <span className="font-semibold text-foreground">Shape: </span>{edge.attackingShape}
        </p>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          <span className="font-semibold text-foreground">Vulnerability: </span>{edge.vulnerability}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-bold">Attackers</div>
          <ul className="space-y-0.5 text-xs">
            {edge.keyAttackers?.map((n: string, i: number) => <li key={i} className="flex gap-1.5"><Swords className="h-3 w-3 text-accent shrink-0 mt-0.5" />{n}</li>)}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-bold">Targeted defenders</div>
          <ul className="space-y-0.5 text-xs">
            {edge.keyDefenders?.map((n: string, i: number) => <li key={i} className="flex gap-1.5"><Shield className="h-3 w-3 text-danger shrink-0 mt-0.5" />{n}</li>)}
          </ul>
        </div>
      </div>

      {edge.tryscorerLeans?.length > 0 && (
        <div className="mb-3 pt-2 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-bold">Try scorer leans</div>
          <div className="flex flex-wrap gap-1.5">
            {edge.tryscorerLeans.map((n: string, i: number) => (
              <span key={i} className="kbd text-[11px] font-bold bg-accent text-accent-foreground px-2 py-0.5 rounded">{n}</span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground italic">{edge.gameScript}</p>
    </Card>
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

function TryscorersSection({ tryscorers, kickoffUtc }: { tryscorers: TryscorerMarkets | null; kickoffUtc: string }) {
  const hasReal = tryscorers?.hasAny ?? false;
  if (!hasReal) {
    return (
      <Card title="Live tryscorer odds" icon={Hourglass}>
        <p className="text-sm text-muted-foreground">
          AU bookmakers release tryscorer markets once team lists are confirmed (usually <span className="font-semibold text-foreground">~24 hours before kickoff</span>). They&rsquo;ll appear here automatically.
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">Kickoff: {new Date(kickoffUtc).toLocaleString()}</p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <div className="glass p-3 flex items-center justify-between text-xs">
        <div className="inline-flex items-center gap-2">
          <Flag className="h-4 w-4 text-accent" />
          <span className="font-bold uppercase tracking-wider">Live tryscorer odds</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-accent font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" /> Live
        </span>
      </div>
      {tryscorers!.first.length > 0 && <TryOddsCard title="First tryscorer" icon={Flag} picks={tryscorers!.first.slice(0, 6)} note="Best price across AU bookies." />}
      {tryscorers!.anytime.length > 0 && <TryOddsCard title="Anytime tryscorer" icon={Sparkles} picks={tryscorers!.anytime.slice(0, 8)} note="Strongest implied chances first." />}
      {tryscorers!.multi.length > 0 && <TryOddsCard title="2+ tries" icon={Trophy} picks={tryscorers!.multi.slice(0, 6)} note="Outsider value plays — pair with form." />}
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
  { insights: any; insightsError: string | null; home: any; away: any }) {
  if (insightsError) return <Empty msg={insightsError} />;
  if (!insights?.script) return <Empty msg="Script generating — check back shortly." />;

  const s = insights.script;

  return (
    <div className="space-y-4">
      {/* Tiered betting scripts — hero feature */}
      {insights.tieredBets?.length > 0 && (
        <Card title="Betting scripts · low / medium / high" icon={Coins} className="accent-glow">
          <p className="text-[11px] text-muted-foreground mb-4 italic">Three scenario-based multis combining anytime tryscorer + match result + total points.</p>
          <div className="space-y-3">
            {["low", "medium", "high"].map((tier) => {
              const bet = insights.tieredBets.find((b: any) => b.tier === tier);
              return bet ? <TieredBetCard key={tier} bet={bet} /> : null;
            })}
          </div>
        </Card>
      )}

      {/* Edge scripts */}
      {(insights.leftEdge || insights.rightEdge) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {insights.leftEdge && <EdgeScriptCard side="Left" edge={insights.leftEdge} home={home.nickName} away={away.nickName} />}
          {insights.rightEdge && <EdgeScriptCard side="Right" edge={insights.rightEdge} home={home.nickName} away={away.nickName} />}
        </div>
      )}

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
        <Card title="Stat-driven script — if/then" icon={Brain}>
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

      {s.milestones?.length > 0 && (
        <Card title="Upcoming milestones" icon={Crown}>
          <ul className="space-y-3">
            {s.milestones.map((m: string, i: number) => (
              <li key={i} className="flex gap-2 text-sm"><span className="text-accent shrink-0">›</span><span>{m}</span></li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="X-factor" icon={Sparkles}>
        <p className="text-sm leading-relaxed">{s.xFactor}</p>
      </Card>

      {s.bookieScript && (
        <Card title="Bookie script" icon={Coins}>
          <p className="text-[11px] text-muted-foreground mb-4 italic">How the bookmaker is praying this game plays out — and the result that hurts their book.</p>
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

function TieredBetCard({ bet }: { bet: any }) {
  const tone = bet.tier === "low" ? "border-accent/40 bg-accent/5"
    : bet.tier === "medium" ? "border-amber-500/40 bg-amber-500/5"
    : "border-danger/40 bg-danger/5";
  const tierLabel = bet.tier === "low" ? "LOW RISK" : bet.tier === "medium" ? "MEDIUM RISK" : "HIGH RISK";
  const tierColour = bet.tier === "low" ? "bg-accent text-accent-foreground"
    : bet.tier === "medium" ? "bg-amber-500 text-black"
    : "bg-danger text-white";
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`kbd text-[10px] font-bold px-2 py-0.5 rounded ${tierColour}`}>{tierLabel}</span>
        {bet.estimatedOdds && (
          <span className="kbd ml-auto text-xs font-bold text-accent">~${bet.estimatedOdds}</span>
        )}
      </div>
      <ul className="space-y-1.5 mb-3">
        {bet.legs.map((leg: any, i: number) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="text-accent shrink-0 mt-0.5">+</span>
            <span><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{leg.market}: </span><span className="font-semibold">{leg.pick}</span></span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground italic leading-relaxed">{bet.rationale}</p>
    </div>
  );
}

function EdgeScriptCard({ side, edge, home, away }: { side: "Left" | "Right"; edge: any; home: string; away: string }) {
  const attacker = edge.attackingTeam === "home" ? home : away;
  const target = edge.vulnerableTeam === "home" ? home : away;
  return (
    <Card title={`${side} edge script`} icon={ScrollText}>
      <div className="text-[11px] mb-3">
        <span className="kbd font-bold bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{attacker}</span>
        <span className="mx-2 text-muted-foreground">attacks →</span>
        <span className="kbd font-bold bg-danger/20 text-danger px-1.5 py-0.5 rounded">{target}'s {side === "Left" ? "right" : "left"} D</span>
      </div>
      <p className="text-sm leading-relaxed mb-3">{edge.gameScript}</p>
      {edge.tryscorerLeans?.length > 0 && (
        <div className="pt-3 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-bold">Linked try scorers</div>
          <div className="flex flex-wrap gap-1.5">
            {edge.tryscorerLeans.map((n: string, i: number) => (
              <span key={i} className="kbd text-[11px] font-bold bg-accent/15 text-accent px-2 py-0.5 rounded">{n}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ================= utilities ================= */

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

function formatShortDate(input: any) {
  try {
    const d = new Date(input);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" }).format(d);
  } catch { return ""; }
}

// keep tree-shaking honest
void TrendPill;
