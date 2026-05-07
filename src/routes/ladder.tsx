import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getLadder } from "@/server/index.functions";
import { TeamLogo } from "@/components/TeamLogo";

const ladderQO = () => queryOptions({
  queryKey: ["ladder"],
  queryFn: () => getLadder({ data: {} }),
});

export const Route = createFileRoute("/ladder")({
  head: () => ({
    meta: [
      { title: "NRL Ladder — LINEBREAK" },
      { name: "description", content: "Live NRL standings and top 8." },
      { property: "og:title", content: "NRL Ladder — LINEBREAK" },
      { property: "og:description", content: "Live NRL standings and top 8." },
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
  const rows = useSuspenseQuery(ladderQO()).data;
  return (
    <div className="pt-8">
      <header className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.25em] text-accent font-bold">NRL Premiership</div>
        <h1 className="font-display font-extrabold text-lg sm:text-xl tracking-tight mt-1">Ladder</h1>
        <p className="text-xs text-muted-foreground mt-2">Top 8 highlighted · live standings</p>
      </header>

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
    </div>
  );
}
