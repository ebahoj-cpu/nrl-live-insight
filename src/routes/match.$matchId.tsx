import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getMatchPage } from "@/server/index.functions";
import { TeamLogo } from "@/components/TeamLogo";
import { findTeam } from "@/lib/teams";
import type { OddsEvent } from "@/server/odds";
import { Suspense } from "react";
import { ArrowLeft, Sparkles, TrendingUp } from "lucide-react";

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
  const { details, odds, ladder, insights, insightsError } = data;

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
            <div className="text-xs text-muted-foreground">{formatKickoff(details.kickoffUtc)}</div>
            <div className="text-2xl sm:text-3xl font-extrabold mt-1">vs</div>
            <div className="text-xs text-muted-foreground mt-1">{details.venue}</div>
            <div className="text-[10px] text-muted-foreground">{details.venueCity}</div>
          </div>
          <TeamColumn name={details.awayTeam.nickName} themeKey={details.awayTeam.themeKey} position={details.awayTeam.position} />
        </div>
      </section>

      {/* Live odds */}
      <Section title="Live H2H Odds" subtitle="Best price across AU bookmakers">
        {odds && odds.bookmakers.length > 0 ? (
          <OddsTable odds={odds} home={details.homeTeam.nickName} away={details.awayTeam.nickName} />
        ) : (
          <Empty msg="No live odds posted yet for this match." />
        )}
      </Section>

      {/* Lines & totals */}
      {odds && (
        <Section title="Spreads & Totals" subtitle="Line and over/under markets">
          <SpreadTotalsTable odds={odds} home={details.homeTeam.nickName} away={details.awayTeam.nickName} />
        </Section>
      )}

      {/* Stats / form */}
      <Section title="Form & Season Stats" subtitle="Source: NRL.com">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormPanel team={details.homeTeam} row={homeRow} />
          <FormPanel team={details.awayTeam} row={awayRow} />
        </div>
      </Section>

      {/* AI Insights */}
      <Section title="AI Betting Insights" subtitle="Generated from live data">
        {insightsError && <Empty msg={insightsError} />}
        {insights && <InsightsPanel insights={insights} home={details.homeTeam.nickName} away={details.awayTeam.nickName} />}
        {!insights && !insightsError && <Empty msg="Insights unavailable." />}
      </Section>

      <p className="text-[11px] text-muted-foreground text-center mt-10">
        Updated {new Date(data.generatedAt).toLocaleTimeString()} · Bet responsibly · 18+
      </p>
    </div>
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

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="font-display font-bold text-xl">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="glass p-6 text-center text-sm text-muted-foreground">{msg}</div>;
}

function OddsTable({ odds, home, away }: { odds: OddsEvent; home: string; away: string }) {
  const homeNick = findTeam(home)?.nickname ?? home;
  const awayNick = findTeam(away)?.nickname ?? away;
  const rows = odds.bookmakers
    .map((b) => {
      const h2h = b.markets.find((m) => m.key === "h2h");
      if (!h2h) return null;
      const h = h2h.outcomes.find((o) => findTeam(o.name)?.nickname === homeNick);
      const a = h2h.outcomes.find((o) => findTeam(o.name)?.nickname === awayNick);
      if (!h || !a) return null;
      return { book: b.title, home: h.price, away: a.price, updated: b.lastUpdate };
    })
    .filter((r): r is { book: string; home: number; away: number; updated: string } => r !== null);

  const bestHome = Math.max(...rows.map((r) => r.home));
  const bestAway = Math.max(...rows.map((r) => r.away));

  return (
    <div className="glass overflow-hidden">
      <div className="grid grid-cols-3 gap-2 px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
        <span>Bookmaker</span>
        <span className="text-right">{home}</span>
        <span className="text-right">{away}</span>
      </div>
      {rows.map((r) => (
        <div key={r.book} className="grid grid-cols-3 gap-2 px-4 py-3 text-sm border-b border-border last:border-0">
          <span className="font-medium">{r.book}</span>
          <span className={`text-right kbd font-semibold ${r.home === bestHome ? "text-accent" : ""}`}>{r.home.toFixed(2)}</span>
          <span className={`text-right kbd font-semibold ${r.away === bestAway ? "text-accent" : ""}`}>{r.away.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function SpreadTotalsTable({ odds, home, away }: { odds: OddsEvent; home: string; away: string }) {
  const homeNick = findTeam(home)?.nickname ?? home;
  const rows = odds.bookmakers.map((b) => {
    const sp = b.markets.find((m) => m.key === "spreads");
    const tot = b.markets.find((m) => m.key === "totals");
    const homeSp = sp?.outcomes.find((o) => findTeam(o.name)?.nickname === homeNick);
    const awaySp = sp?.outcomes.find((o) => findTeam(o.name)?.nickname && findTeam(o.name)?.nickname !== homeNick);
    const over = tot?.outcomes.find((o) => o.name === "Over");
    const under = tot?.outcomes.find((o) => o.name === "Under");
    return { book: b.title, homeSp, awaySp, over, under };
  }).filter((r) => r.homeSp || r.over);

  if (rows.length === 0) return <Empty msg="No spread/total markets posted." />;

  return (
    <div className="glass overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left px-4 py-3">Bookmaker</th>
            <th className="text-right px-3 py-3">{home} line</th>
            <th className="text-right px-3 py-3">{away} line</th>
            <th className="text-right px-3 py-3">Over</th>
            <th className="text-right px-3 py-3">Under</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.book} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-medium">{r.book}</td>
              <td className="px-3 py-3 text-right kbd">{r.homeSp ? `${formatLine(r.homeSp.point)} @ ${r.homeSp.price.toFixed(2)}` : "—"}</td>
              <td className="px-3 py-3 text-right kbd">{r.awaySp ? `${formatLine(r.awaySp.point)} @ ${r.awaySp.price.toFixed(2)}` : "—"}</td>
              <td className="px-3 py-3 text-right kbd">{r.over ? `${r.over.point} @ ${r.over.price.toFixed(2)}` : "—"}</td>
              <td className="px-3 py-3 text-right kbd">{r.under ? `${r.under.point} @ ${r.under.price.toFixed(2)}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatLine(n: number | undefined): string {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

function FormPanel({ team, row }: { team: { nickName: string; themeKey: string; recentForm: { result: string; summary: string; score: string }[]; odds?: string }; row?: { played: number; wins: number; losses: number; for: number; against: number; diff: number; points: number; position: number } }) {
  return (
    <div className="glass p-5">
      <div className="flex items-center gap-3 mb-4">
        <TeamLogo themeKey={team.themeKey} name={team.nickName} size={40} />
        <div>
          <div className="font-bold">{team.nickName}</div>
          {row && <div className="text-xs text-muted-foreground">Ladder #{row.position}</div>}
        </div>
      </div>

      {row && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Stat label="W-L" value={`${row.wins}-${row.losses}`} />
          <Stat label="Pts" value={String(row.points)} />
          <Stat label="PF" value={String(row.for)} />
          <Stat label="Diff" value={(row.diff > 0 ? "+" : "") + row.diff} accent={row.diff > 0} danger={row.diff < 0} />
        </div>
      )}

      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Last 5</div>
      <div className="space-y-1.5">
        {team.recentForm.slice(0, 5).map((f, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <span className={`inline-block w-5 text-center font-bold rounded ${f.result === "Won" ? "bg-accent text-accent-foreground" : f.result === "Lost" ? "bg-danger/20 text-danger" : "bg-surface-2 text-muted-foreground"}`}>
                {f.result.charAt(0)}
              </span>
              <span className="text-muted-foreground">{f.summary}</span>
            </span>
            <span className="kbd font-semibold">{f.score}</span>
          </div>
        ))}
        {team.recentForm.length === 0 && <div className="text-xs text-muted-foreground">No recent matches.</div>}
      </div>
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

function InsightsPanel({ insights, home, away }: { insights: any; home: string; away: string }) {
  const winnerName = insights.winner.team === "home" ? home : away;
  return (
    <div className="space-y-4">
      <div className="glass p-5 accent-glow">
        <div className="flex items-center gap-2 text-accent text-xs font-bold uppercase tracking-wider mb-3">
          <Sparkles className="h-4 w-4" /> Predicted result
        </div>
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{home}</div>
            <div className="text-4xl font-black kbd">{insights.predictedScore.home}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Winner</div>
            <div className="text-sm font-bold mt-1">{winnerName}</div>
            <div className="mt-2 inline-block px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-xs font-bold">
              {insights.winner.confidence}% confident
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">{away}</div>
            <div className="text-4xl font-black kbd">{insights.predictedScore.away}</div>
          </div>
        </div>
        <div className="mt-4 text-xs text-muted-foreground border-t border-border pt-3">
          <span className="font-semibold text-foreground">Margin: {insights.margin.value}</span> · {insights.margin.reasoning}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Total {insights.total.line} ({insights.total.pick.toUpperCase()})</span> · {insights.total.reasoning}
        </div>
      </div>

      <div className="glass p-5">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
          <TrendingUp className="h-4 w-4" /> Key factors
        </div>
        <ul className="space-y-2 text-sm">
          {insights.keyFactors.map((k: string, i: number) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent">›</span>
              <span>{k}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {insights.bettingAngles.map((a: any, i: number) => (
          <div key={i} className="glass p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{a.market}</div>
              <div className="text-[10px] font-bold text-accent">{a.confidence}%</div>
            </div>
            <div className="font-bold mb-1">{a.pick}</div>
            <div className="text-xs text-muted-foreground">{a.reasoning}</div>
          </div>
        ))}
      </div>
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
