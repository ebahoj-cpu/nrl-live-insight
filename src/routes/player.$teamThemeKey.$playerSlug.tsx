import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getPlayerProfile } from "@/server/player-profile.functions";
import { PlayerProfileCard } from "@/components/PlayerModal";
import { ArrowLeft } from "lucide-react";

const searchSchema = z.object({
  firstName: fallback(z.string().optional(), undefined),
  lastName: fallback(z.string().optional(), undefined),
  teamNickname: fallback(z.string().optional(), undefined),
  position: fallback(z.string().optional(), undefined),
  jerseyNumber: fallback(z.coerce.number().optional(), undefined),
  headImage: fallback(z.string().optional(), undefined),
}).passthrough();

const playerQO = (args: {
  teamThemeKey: string;
  teamNickname: string;
  firstName: string;
  lastName: string;
  position?: string;
  jerseyNumber?: number;
}) => queryOptions({
  queryKey: ["playerProfile", `${args.teamThemeKey}:${args.firstName}:${args.lastName}`],
  queryFn: () => getPlayerProfile({ data: args }),
});

export const Route = createFileRoute("/player/$teamThemeKey/$playerSlug")({
  validateSearch: zodValidator(searchSchema),
  head: ({ search }) => ({
    meta: [
      { title: `${search.firstName ?? "Player"} ${search.lastName ?? ""} – Player Profile | LINEBREAK` },
      { name: "description", content: `NRL player profile for ${search.firstName ?? ""} ${search.lastName ?? ""}. Stats, form, and Performance Edge.` },
    ],
  }),
  loader: ({ context: { queryClient }, params, search }) => {
    if (!search.firstName || !search.lastName) return;
    const args = {
      teamThemeKey: params.teamThemeKey,
      teamNickname: search.teamNickname ?? params.teamThemeKey,
      firstName: search.firstName,
      lastName: search.lastName,
      position: search.position,
      jerseyNumber: search.jerseyNumber,
    };
    void queryClient.ensureQueryData(playerQO(args));
  },
  component: PlayerPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-danger font-semibold">Couldn&apos;t load player</p>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <Link to="/" className="mt-6 inline-block px-5 py-2 bg-accent text-accent-foreground rounded-full font-semibold">
          Back to fixtures
        </Link>
      </div>
    </div>
  ),
});

function PlayerPage() {
  const { teamThemeKey, playerSlug } = Route.useParams();
  const search = Route.useSearch();

  const args = {
    firstName: search.firstName ?? "",
    lastName: search.lastName ?? "",
    teamThemeKey,
    teamNickname: search.teamNickname ?? teamThemeKey,
    position: search.position,
    jerseyNumber: search.jerseyNumber,
    headImage: search.headImage,
  };

  const { data, isFetching } = useSuspenseQuery(
    playerQO({
      teamThemeKey,
      teamNickname: search.teamNickname ?? teamThemeKey,
      firstName: search.firstName ?? "",
      lastName: search.lastName ?? "",
      position: search.position,
      jerseyNumber: search.jerseyNumber,
    })
  );

  return (
    <div className="min-h-screen pt-6 pb-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-0">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to fixtures
        </Link>

        <div className="card-surface overflow-hidden">
          <PlayerProfileCard args={args} payload={data} loading={isFetching} />
        </div>
      </div>
    </div>
  );
}
