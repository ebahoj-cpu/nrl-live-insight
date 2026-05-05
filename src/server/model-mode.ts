// Timing-aware prediction mode. Resolves which "model" should drive the
// outputs for a given match based on what real-world data is available
// right now. Used to gate tryscorer picks, bet tiers, and confidence labels.
//
//   early  — no named squads yet (pre-Tuesday 7pm)
//   squad  — squads named, no player odds
//   market — player tryscorer odds released (~24h pre-game)
//   final  — kickoff inside 60 minutes

export type ModelMode = "early" | "squad" | "market" | "final";
export type ModelConfidence = "low" | "medium" | "high";

export type ResolveArgs = {
  kickoffUtc: string;
  hasSquads: boolean;
  hasPlayerOdds: boolean;
};

export type ResolvedMode = {
  mode: ModelMode;
  confidence: ModelConfidence;
  msToKickoff: number;
};

const ONE_HOUR_MS = 60 * 60_000;

export function resolveModelMode(args: ResolveArgs): ResolvedMode {
  const ko = Date.parse(args.kickoffUtc);
  const msToKickoff = Number.isFinite(ko) ? ko - Date.now() : Number.POSITIVE_INFINITY;
  const inFinalHour = msToKickoff <= ONE_HOUR_MS;

  let mode: ModelMode;
  if (args.hasSquads && inFinalHour) mode = "final";
  else if (args.hasSquads && args.hasPlayerOdds) mode = "market";
  else if (args.hasSquads) mode = "squad";
  else mode = "early";

  const confidence: ModelConfidence =
    mode === "early" ? "low" : mode === "squad" ? "medium" : "high";

  return { mode, confidence, msToKickoff };
}

// Ordering used to detect when a stored payload is now stale because the
// match has progressed to a richer data state since it was generated.
const RANK: Record<ModelMode, number> = { early: 0, squad: 1, market: 2, final: 3 };

export function modeAdvanced(stored: ModelMode | undefined, current: ModelMode): boolean {
  if (!stored) return true;
  return RANK[current] > RANK[stored];
}

// Heuristic: a "named squad" requires at least 13 players with positions
// (i.e. NRL.com has published the team list, not an empty placeholder).
export function squadIsNamed(players: { position?: string }[] | undefined): boolean {
  if (!players || players.length < 13) return false;
  const named = players.filter((p) => (p.position ?? "").trim().length > 0);
  return named.length >= 13;
}

// Stable signature of a squad — changes whenever a player is added, removed,
// renamed, or reassigned. Used to invalidate cached insights when team lists
// are updated by NRL.com (e.g. late ins/outs after the official Tuesday drop).
export function squadSignature(players: { firstName?: string; lastName?: string; position?: string; jerseyNumber?: number }[] | undefined): string {
  if (!players || players.length === 0) return "empty";
  return players
    .map((p) => `${p.jerseyNumber ?? "?"}:${(p.firstName ?? "").toLowerCase()}-${(p.lastName ?? "").toLowerCase()}:${(p.position ?? "").toLowerCase()}`)
    .sort()
    .join("|");
}
