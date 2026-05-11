// ============================================================================
// Edge Attack Model (Phase 4)
//
// Builds left/right/middle channel ratings using only NAMED squad players.
// Never invents player names. Without team lists the output drops to
// team-level only with low confidence.
// ============================================================================

import type { ConfidenceTier } from "./confidence";
import type { PlayerFeature, EdgeChannel } from "./simulation-types";

export type ChannelRatings = {
  left: number; right: number; middle: number;
};

export type EdgeAttackProfile = {
  homeLeftEdgeRating: number;
  homeRightEdgeRating: number;
  homeMiddleRating: number;
  awayLeftEdgeRating: number;
  awayRightEdgeRating: number;
  awayMiddleRating: number;
  bestAttackChannel: { team: "home" | "away"; channel: EdgeChannel } | null;
  weakestDefensiveChannel: { team: "home" | "away"; channel: EdgeChannel } | null;
  playerChannelMap: Record<string, EdgeChannel>;
  likelyEdgeTryScorers: { name: string; team: "home" | "away"; channel: EdgeChannel; weight: number }[];
  // Per-player anytime probability boost (capped) consumed by the engine.
  playerAnytimeBoost: Record<string, number>;
  confidence: ConfidenceTier;
  note: string;
};

function ratePlayer(p: PlayerFeature): number {
  return (
    p.triesPerGame * 1.0
    + p.lineBreaksPerGame * 0.6
    + p.tryAssistsPerGame * 0.3
    + p.tackleBreaksPerGame * 0.05
    + 0.05
  ) * (p.availabilityProb ?? 1);
}

function channelRatings(squad: PlayerFeature[]): ChannelRatings {
  const out: ChannelRatings = { left: 0, right: 0, middle: 0 };
  for (const p of squad) out[p.edgeChannel] += ratePlayer(p);
  return out;
}

export function neutralEdgeAttack(): EdgeAttackProfile {
  return {
    homeLeftEdgeRating: 50, homeRightEdgeRating: 50, homeMiddleRating: 50,
    awayLeftEdgeRating: 50, awayRightEdgeRating: 50, awayMiddleRating: 50,
    bestAttackChannel: null, weakestDefensiveChannel: null,
    playerChannelMap: {}, likelyEdgeTryScorers: [], playerAnytimeBoost: {},
    confidence: "low", note: "Team lists not named — channel attack unresolved.",
  };
}

export function buildEdgeAttackProfile(args: {
  homePlayers: PlayerFeature[];
  awayPlayers: PlayerFeature[];
  hasNamedTeamLists?: boolean;
}): EdgeAttackProfile {
  const named = args.hasNamedTeamLists !== false && args.homePlayers.length >= 13 && args.awayPlayers.length >= 13;
  if (!named) return neutralEdgeAttack();

  const homeRaw = channelRatings(args.homePlayers);
  const awayRaw = channelRatings(args.awayPlayers);
  // Normalise to 0..100 around 50 baseline.
  const norm = (v: number) => clamp(40 + v * 8, 20, 90);
  const home = { left: norm(homeRaw.left), right: norm(homeRaw.right), middle: norm(homeRaw.middle) };
  const away = { left: norm(awayRaw.left), right: norm(awayRaw.right), middle: norm(awayRaw.middle) };

  // Best attacking channel: the (team, channel) pair with the highest rating
  // matched against the OPPOSING channel weakness.
  type Cand = { team: "home" | "away"; channel: EdgeChannel; net: number };
  const candidates: Cand[] = [];
  for (const ch of ["left", "right", "middle"] as EdgeChannel[]) {
    candidates.push({ team: "home" as const, channel: ch, net: home[ch] - away[oppositeFor("home", ch)] });
    candidates.push({ team: "away" as const, channel: ch, net: away[ch] - home[oppositeFor("away", ch)] });
  }
  candidates.sort((a, b) => b.net - a.net);
  const best = candidates[0];
  // Weakest defensive channel: lowest rating on each side; pick the worst overall.
  const defs: Cand[] = [
    { team: "home" as const, channel: "left", net: -home.left },
    { team: "home" as const, channel: "right", net: -home.right },
    { team: "home" as const, channel: "middle", net: -home.middle },
    { team: "away" as const, channel: "left", net: -away.left },
    { team: "away" as const, channel: "right", net: -away.right },
    { team: "away" as const, channel: "middle", net: -away.middle },
  ].sort((a, b) => b.net - a.net);
  const weakest = defs[0];

  const playerChannelMap: Record<string, EdgeChannel> = {};
  const playerAnytimeBoost: Record<string, number> = {};
  const likelyEdgeTryScorers: EdgeAttackProfile["likelyEdgeTryScorers"] = [];

  const apply = (squad: PlayerFeature[], team: "home" | "away") => {
    for (const p of squad) {
      const key = p.name.toLowerCase();
      playerChannelMap[key] = p.edgeChannel;
      const teamRating = team === "home" ? home[p.edgeChannel] : away[p.edgeChannel];
      const oppRating = team === "home" ? away[oppositeFor("home", p.edgeChannel)] : home[oppositeFor("away", p.edgeChannel)];
      const lean = (teamRating - oppRating) / 100; // -1..+1
      const boost = clamp(lean * 0.04, -0.04, 0.04);
      if (boost !== 0) playerAnytimeBoost[key] = boost;
      const w = ratePlayer(p) * (1 + Math.max(0, lean));
      if ((p.position || "").match(/wing|centre|fullback|five|halfback/i)) {
        likelyEdgeTryScorers.push({ name: p.name, team, channel: p.edgeChannel, weight: w });
      }
    }
  };
  apply(args.homePlayers, "home");
  apply(args.awayPlayers, "away");
  likelyEdgeTryScorers.sort((a, b) => b.weight - a.weight);

  return {
    homeLeftEdgeRating: home.left, homeRightEdgeRating: home.right, homeMiddleRating: home.middle,
    awayLeftEdgeRating: away.left, awayRightEdgeRating: away.right, awayMiddleRating: away.middle,
    bestAttackChannel: best ? { team: best.team, channel: best.channel } : null,
    weakestDefensiveChannel: weakest ? { team: weakest.team, channel: weakest.channel } : null,
    playerChannelMap, likelyEdgeTryScorers: likelyEdgeTryScorers.slice(0, 6),
    playerAnytimeBoost,
    confidence: "medium",
    note: best ? `${best.team === "home" ? "Home" : "Away"} ${best.channel} edge projects strongest.` : "Even channel matchup.",
  };
}

function oppositeFor(_team: "home" | "away", channel: EdgeChannel): EdgeChannel {
  if (channel === "left") return "right";
  if (channel === "right") return "left";
  return "middle";
}
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
