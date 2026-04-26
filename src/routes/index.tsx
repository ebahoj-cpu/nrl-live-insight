import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getCurrentRoundFixtures, getOdds } from "@/server/index.functions";
import { MatchCard } from "@/components/MatchCard";
import { Suspense, useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

const searchSchema = z.object({
  round: fallback(z.number().int().positive().optional(), undefined),
});

const fixturesQO = (round?: number) => queryOptions({
  queryKey: ["fixtures", round ?? "current"],
  queryFn: () => getCurrentRoundFixtures({ data: round ? { round } : {} }),
});
const oddsQO = () => queryOptions({
  queryKey: ["odds"],
  queryFn: () => getOdds({ data: {} }),
});

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(searchSchema),
  loaderDeps: ({ search }) => ({ round: search.round }),
  loader: ({ context: { queryClient }, deps }) => {
    void queryClient.ensureQueryData(fixturesQO(deps.round));
    void queryClient.ensureQueryData(oddsQO());
  },
  component: HomePage,
  errorComponent: ({ error }) => (
    <div className="py-16 text-center">
      <p className="text-danger font-semibold">Live data unavailable</p>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
    </div>
  ),
});

function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Fixtures />
    </Suspense>
  );
}

function Fixtures() {
  const { round } = Route.useSearch();
  const fx = useSuspenseQuery(fixturesQO(round)).data;
  const oddsList = useSuspenseQuery(oddsQO()).data;
  const navigate = useNavigate({ from: "/" });

  const isHistorical = fx.round < fx.currentRound;
  const isUpcoming = fx.round > fx.currentRound;

  return (
    <div className="pt-8">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-accent font-bold">Season {fx.season}</div>
          <h1 className="font-display font-extrabold text-lg sm:text-xl tracking-tight mt-1 flex items-center gap-2 flex-wrap">
            <span>NRL Fixtures · Round</span>
            <RoundSelector
              current={fx.round}
              currentRound={fx.currentRound}
              rounds={fx.rounds}
              onChange={(r) => navigate({ search: (prev) => ({ ...prev, round: r === fx.currentRound ? undefined : r }) })}
            />
          </h1>
          {isHistorical && (
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">
              Historical · results
            </div>
          )}
          {isUpcoming && (
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">
              Upcoming fixtures
            </div>
          )}
        </div>
      </header>

      {fx.fixtures.length === 0 ? (
        <div className="glass p-10 text-center text-muted-foreground">
          No fixtures available for this round.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fx.fixtures.map((f) => {
            const matched = oddsList.find((o) => {
              const sameDay = Math.abs(new Date(o.commenceUtc).getTime() - new Date(f.kickoffUtc).getTime()) < 12 * 3600_000;
              return sameDay && (
                (o.homeNickname === f.homeTeam.nickName && o.awayNickname === f.awayTeam.nickName) ||
                (o.homeNickname === f.awayTeam.nickName && o.awayNickname === f.homeTeam.nickName)
              );
            }) ?? null;
            return <MatchCard key={f.matchId} fixture={f} odds={matched} />;
          })}
        </div>
      )}
    </div>
  );
}

function RoundSelector({ current, currentRound, rounds, onChange }: {
  current: number; currentRound: number; rounds: number[]; onChange: (r: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/15 border border-accent/30 text-accent font-black tabular-nums hover:bg-accent/25 transition-colors text-base sm:text-lg"
      >
        <span>{current}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-44 max-h-72 overflow-y-auto rounded-xl glass shadow-2xl py-1.5 ring-1 ring-border/40"
        >
          {rounds.map((r) => {
            const selected = r === current;
            const isCurrent = r === currentRound;
            const past = r < currentRound;
            return (
              <button
                key={r}
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(r); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 text-sm hover:bg-surface-2 transition-colors ${selected ? "text-accent font-bold" : "text-foreground"}`}
              >
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">Round {r}</span>
                  {isCurrent && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold">Live</span>
                  )}
                  {past && !isCurrent && (
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Past</span>
                  )}
                </span>
                {selected && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="pt-8">
      <div className="h-9 w-64 bg-surface rounded mb-2 animate-pulse" />
      <div className="h-4 w-40 bg-surface rounded mb-6 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass p-5 h-44 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
