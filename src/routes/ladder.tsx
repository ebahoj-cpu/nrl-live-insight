import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { getLadder, getProjectedLadder } from "@/server/index.functions";
import { TeamLogo } from "@/components/TeamLogo";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

const ladderQO = () => queryOptions({
  queryKey: ["ladder"],
  queryFn: () => getLadder({ data: {} }),
});

const projectedQO = () => queryOptions({
  queryKey: ["projected-ladder"],
  queryFn: () => getProjectedLadder({ data: {} }),
});

export const Route = createFileRoute("/ladder")({
  head: () => ({
    meta: [
      { title: "NRL Ladder — LINEBREAK" },
      { name: "description", content: "Live NRL standings and projected end-of-season ladder using remaining fixture predictions." },
      { property: "og:title", content: "NRL Ladder — LINEBREAK" },
      { property: "og:description", content: "Live NRL standings, top 8, and projected finish." },
    ],
  }),
  loader: ({ context: { queryClient } }) => {
    void queryClient.ensureQueryData(ladderQO());
  },
  component: LadderPage,
  errorComponent: ({ error }) => (
    <div className="py-16 text-center">
      <p className="text-danger font-semibold">Ladder unavailable</p>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
    </div>
  ),
});

function LadderPage() {
  const [tab, setTab] = useState("live");
  return (
    <div className="pt-8">
      <header className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.25em] text-accent font-bold">NRL Premiership</div>
        <h1 className="font-display font-extrabold text-lg sm:text-xl tracking-tight mt-1">Ladder</h1>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="live">Live Ladder</TabsTrigger>
          <TabsTrigger value="projected">Projected Ladder</TabsTrigger>
        </TabsList>
        <TabsContent value="live">
          <Suspense fallback={<div className="h-96 bg-surface rounded animate-pulse" />}>
            <LiveLadder />
          </Suspense>
        </TabsContent>
        <TabsContent value="projected">
          <Suspense fallback={<div className="h-96 bg-surface rounded animate-pulse" />}>
            <ProjectedLadder />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LiveLadder() {
  const rows = useSuspenseQuery(ladderQO()).data;
  return (
    <>
      <p className="text-xs text-muted-foreground mb-2">Top 8 highlighted · live standings</p>
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-bold w-8">#</th>
                <th className="px-2 py-2 text-left font-bold">Team</th>
                <th className="px-2 py-2 text-center font-bold">P</th>
                <th className="px-2 py-2 text-center font-bold hidden xs:table-cell">W</th>
                <th className="px-2 py-2 text-center font-bold hidden xs:table-cell">L</th>
                <th className="px-2 py-2 text-center font-bold">Diff</th>
                <th className="px-2 py-2 text-right font-bold pr-3">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const inTop8 = r.position <= 8;
                return (
                  <tr key={r.teamId} className={`border-t border-border ${inTop8 ? "bg-accent/5" : ""}`}>
                    <td className="px-2 py-2 font-bold tabular-nums">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${inTop8 ? "bg-accent text-accent-foreground" : "bg-surface-2 text-muted-foreground"} text-xs`}>
                        {r.position}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <TeamLogo themeKey={r.themeKey} name={r.nickname} size={22} />
                        <span className="font-semibold truncate">{r.nickname}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">{r.played}</td>
                    <td className="px-2 py-2 text-center tabular-nums hidden xs:table-cell">{r.wins}</td>
                    <td className="px-2 py-2 text-center tabular-nums hidden xs:table-cell">{r.losses}</td>
                    <td className={`px-2 py-2 text-center tabular-nums font-semibold ${r.diff > 0 ? "text-accent" : r.diff < 0 ? "text-danger" : "text-muted-foreground"}`}>
                      {r.diff > 0 ? "+" : ""}{r.diff}
                    </td>
                    <td className="px-2 py-2 text-right pr-3 font-extrabold tabular-nums">{r.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ProjectedLadder() {
  const { projected, remainingFixtures, snapshotCoverage } = useSuspenseQuery(projectedQO()).data;
  return (
    <>
      <p className="text-xs text-muted-foreground mb-2">
        Projected from current ladder + remaining fixture predictions.
        <span className="ml-1 opacity-70">({snapshotCoverage}/{remainingFixtures} games using locked predictions)</span>
      </p>
      <div className="rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-bold w-8">#</th>
                <th className="px-2 py-2 text-left font-bold">Team</th>
                <th className="px-2 py-2 text-center font-bold">Mv</th>
                <th className="px-2 py-2 text-center font-bold hidden xs:table-cell">W</th>
                <th className="px-2 py-2 text-center font-bold hidden xs:table-cell">L</th>
                <th className="px-2 py-2 text-center font-bold">Diff</th>
                <th className="px-2 py-2 text-right font-bold pr-3">Pts</th>
              </tr>
            </thead>
            <tbody>
              {projected.map((r) => {
                const inTop8 = r.position <= 8;
                const conf = r.confidence;
                return (
                  <tr key={r.teamId} className={`border-t border-border ${inTop8 ? "bg-accent/5" : ""}`}>
                    <td className="px-2 py-2 font-bold tabular-nums">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${inTop8 ? "bg-accent text-accent-foreground" : "bg-surface-2 text-muted-foreground"} text-xs`}>
                        {r.position}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <TeamLogo themeKey={r.themeKey} name={r.nickname} size={22} />
                        <span className="font-semibold truncate">{r.nickname}</span>
                        <span
                          className={`text-[9px] uppercase tracking-wide font-bold ml-1 ${conf === "high" ? "text-accent" : conf === "medium" ? "text-muted-foreground" : "text-danger/80"}`}
                          title={`Confidence: ${conf} · ${r.estimatedGames} estimated game(s)`}
                        >
                          {conf}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      <MovementBadge movement={r.movement} />
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums hidden xs:table-cell">{r.wins}</td>
                    <td className="px-2 py-2 text-center tabular-nums hidden xs:table-cell">{r.losses}</td>
                    <td className={`px-2 py-2 text-center tabular-nums font-semibold ${r.diff > 0 ? "text-accent" : r.diff < 0 ? "text-danger" : "text-muted-foreground"}`}>
                      {r.diff > 0 ? "+" : ""}{r.diff}
                    </td>
                    <td className="px-2 py-2 text-right pr-3 font-extrabold tabular-nums">{r.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function MovementBadge({ movement }: { movement: number }) {
  if (movement === 0) return <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Minus className="h-3 w-3" /></span>;
  if (movement > 0) return <span className="inline-flex items-center gap-0.5 text-accent font-semibold"><ArrowUp className="h-3 w-3" />{movement}</span>;
  return <span className="inline-flex items-center gap-0.5 text-danger font-semibold"><ArrowDown className="h-3 w-3" />{Math.abs(movement)}</span>;
}
