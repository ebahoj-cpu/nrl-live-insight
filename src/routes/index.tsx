import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { getCurrentRoundFixtures, getOdds, getMatchPage } from "@/server/index.functions";
import { MatchCard } from "@/components/MatchCard";
import { Suspense, useEffect } from "react";

const fixturesQO = () => queryOptions({
  queryKey: ["fixtures", "current"],
  queryFn: () => getCurrentRoundFixtures({ data: {} }),
  staleTime: 5 * 60_000,
});
const oddsQO = () => queryOptions({
  queryKey: ["odds"],
  queryFn: () => getOdds({ data: {} }),
  staleTime: 2 * 60_000,
});

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) => {
    void queryClient.ensureQueryData(fixturesQO());
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
  const fx = useSuspenseQuery(fixturesQO()).data;
  const oddsList = useSuspenseQuery(oddsQO()).data;
  const qc = useQueryClient();

  // Background prefetch every fixture's match page so opening one feels instant.
  useEffect(() => {
    const ids = fx.fixtures.map((f) => f.matchId);
    const idle = (cb: () => void) =>
      typeof (window as any).requestIdleCallback === "function"
        ? (window as any).requestIdleCallback(cb)
        : setTimeout(cb, 800);
    const cancel = (h: any) =>
      typeof (window as any).cancelIdleCallback === "function"
        ? (window as any).cancelIdleCallback(h)
        : clearTimeout(h);
    const handles: any[] = [];
    ids.forEach((id, i) => {
      handles.push(idle(() => {
        setTimeout(() => {
          void qc.prefetchQuery({
            queryKey: ["match", id],
            queryFn: () => getMatchPage({ data: { matchId: id } }),
            staleTime: 5 * 60_000,
          });
        }, i * 250);
      }));
    });
    return () => handles.forEach(cancel);
  }, [fx.fixtures, qc]);

  return (
    <div className="pt-8">
      <header className="mb-8">
        <div className="text-[11px] uppercase tracking-[0.25em] text-accent font-bold">Season {fx.season}</div>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-1">
          NRL Fixtures · Round {fx.round}
        </h1>
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
