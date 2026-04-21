import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getMatchPage } from "@/server/index.functions";
import { TeamLogo } from "@/components/TeamLogo";
import { Suspense, useState } from "react";
import {
  ArrowLeft, Clock, MapPin, Users, BarChart3, Sparkles, ScrollText,
  Trophy, Target, Flag, Crown, TrendingUp, AlertCircle, CloudSun, Calendar, Zap,
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
});

type TabKey = "lineup" | "stats" | "insights" | "script";

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
  const { details, ladder, insights, insightsError } = data;
  const [tab, setTab] = useState<TabKey>("lineup");

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
      <nav className="mt-6 grid grid-cols-4 gap-1 p-1 glass" role="tablist">
        <TabButton active={tab === "lineup"} onClick={() => setTab("lineup")} icon={Users} label="Lineup" />
        <TabButton active={tab === "stats"} onClick={() => setTab("stats")} icon={BarChart3} label="Stats" />
        <TabButton active={tab === "insights"} onClick={() => setTab("insights")} icon={Sparkles} label="Insights" />
        <TabButton active={tab === "script"} onClick={() => setTab("script")} icon={ScrollText} label="Script" />
      </nav>

      <div className="mt-6">
        {tab === "lineup" && <LineupTab home={details.homeTeam} away={details.awayTeam} />}
        {tab === "stats" && <StatsTab home={details.homeTeam} away={details.awayTeam} homeRow={homeRow} awayRow={awayRow} />}
        {tab === "insights" && (
          <InsightsTab
            insights={insights}
            insightsError={insightsError}
            home={details.homeTeam.nickName}
            away={details.awayTeam.nickName}
          />
        )}
        {tab === "script" && (
          <ScriptTab insights={insights} insightsError={insightsError} home={details.homeTeam} away={details.awayTeam} />
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

function StatsTab({ home, away, homeRow, awayRow }: { home: any; away: any; homeRow?: any; awayRow?: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SeasonStats team={home} row={homeRow} />
        <SeasonStats team={away} row={awayRow} />
      </div>
      {(homeRow && awayRow) && (
        <Card title="Side by side" icon={BarChart3}>
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

      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Last 5</div>
      {team.recentForm.length === 0 ? (
        <div className="text-xs text-muted-foreground">No recent matches.</div>
      ) : (
        <div className="space-y-1.5">
          {team.recentForm.slice(0, 5).map((f: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`inline-block w-5 text-center font-bold rounded ${f.result === "Won" ? "bg-accent text-accent-foreground" : f.result === "Lost" ? "bg-danger/20 text-danger" : "bg-surface-2 text-muted-foreground"}`}>
                  {f.result.charAt(0)}
                </span>
                <span className="text-muted-foreground truncate">{f.summary}</span>
              </span>
              <span className="kbd font-semibold shrink-0">{f.score}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
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

function InsightsTab({ insights, insightsError, home, away }: { insights: any; insightsError: string | null; home: string; away: string }) {
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

      {/* Pick grid — no confidence percentages */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PickCard
          icon={Target}
          market="Winning margin"
          pick={`${winnerName} by ${insights.margin.bucket}`}
          reasoning={insights.margin.reasoning}
        />
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
        <PickCard
          icon={Flag}
          market="First tryscorer"
          pick={insights.firstTryscorer.pick}
          reasoning={insights.firstTryscorer.reasoning}
        />
        <PickCard
          icon={Trophy}
          market="Multi-tryscorer"
          pick={insights.multiTryscorer.pick}
          reasoning={insights.multiTryscorer.reasoning}
        />
        {insights.bettingAngles.map((a: any, i: number) => (
          <PickCard
            key={i}
            icon={Sparkles}
            market={a.market}
            pick={a.pick}
            reasoning={a.reasoning}
          />
        ))}
      </div>

      {/* Keys to victory — both teams */}
      {insights.keysToVictory && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KeysCard team={home} keys={insights.keysToVictory.home} />
          <KeysCard team={away} keys={insights.keysToVictory.away} />
        </div>
      )}

      {/* Anytime tryscorers */}
      <Card title="Anytime tryscorers" icon={Flag}>
        <ul className="space-y-3">
          {insights.anytimeTryscorers.map((t: any, i: number) => (
            <li key={i} className="flex gap-3">
              <span className="kbd w-6 h-6 shrink-0 rounded-full bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <div className="min-w-0">
                <div className="font-semibold text-sm">{t.pick}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.reasoning}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

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

function PickCard({ icon: Icon, market, pick, reasoning, confidence }:
  { icon: typeof Sparkles; market: string; pick: string; reasoning: string; confidence?: number }) {
  return (
    <div className="glass p-4 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-accent" /> {market}
        </div>
        {confidence != null && (
          <div className="text-[10px] font-bold text-accent">{confidence}%</div>
        )}
      </div>
      <div className="font-bold mb-1.5">{pick}</div>
      <div className="text-xs text-muted-foreground">{reasoning}</div>
    </div>
  );
}

/* ================= SCRIPT TAB ================= */

function ScriptTab({ insights, insightsError, home, away }:
  { insights: any; insightsError: string | null; home: any; away: any }) {
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
        <p className="text-sm leading-relaxed text-muted-foreground">{s.formAnalysis}</p>
      </Card>

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

      <Card title="X-factor" icon={Sparkles} className="accent-glow">
        <p className="text-sm leading-relaxed">{s.xFactor}</p>
      </Card>
    </div>
  );
}

function formatKickoff(utc: string) {
  if (!utc) return "TBC";
  const d = new Date(utc);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}
