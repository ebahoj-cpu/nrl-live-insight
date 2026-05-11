// ============================================================================
// Head-to-Head Model (Phase 4)
//
// Derives a small, bounded modifier from recent meetings between two teams.
// Recent games matter more (last 3 weighted heavier), small samples lower
// confidence, and the H2H output is only ever a *modifier* — never strong
// enough to flip a confident model winner.
// ============================================================================

import type { NormalisedHistoricalMatch } from "./nrl-data-types";
import type { ConfidenceTier } from "./confidence";

export type HeadToHeadProfile = {
  recentHeadToHeadGames: number;
  homeWins: number;
  awayWins: number;
  draws: number;
  avgTotal: number;
  avgMargin: number;          // signed, positive = home-style margin
  closeGameRate: number;      // <= 6 pts
  blowoutRate: number;        // >= 13 pts
  homeVenueEdge: number | null;
  stylisticNote: string;
  // Bounded modifiers consumed by the simulation engine.
  marginModifier: number;     // points added to expected margin (signed)
  totalModifier: number;      // points added to expected total
  closeGameLift: number;      // 0..0.1
  blowoutLift: number;        // 0..0.1
  confidence: ConfidenceTier;
};

export function neutralHeadToHead(): HeadToHeadProfile {
  return {
    recentHeadToHeadGames: 0,
    homeWins: 0, awayWins: 0, draws: 0,
    avgTotal: 0, avgMargin: 0,
    closeGameRate: 0, blowoutRate: 0,
    homeVenueEdge: null,
    stylisticNote: "No recent H2H sample.",
    marginModifier: 0, totalModifier: 0,
    closeGameLift: 0, blowoutLift: 0,
    confidence: "low",
  };
}

export function buildHeadToHead(args: {
  homeNickname: string;
  awayNickname: string;
  history?: NormalisedHistoricalMatch[] | null;
  venue?: string | null;
}): HeadToHeadProfile {
  const list = (args.history ?? []).filter((m) =>
    [m.homeNickname.toLowerCase(), m.awayNickname.toLowerCase()].sort().join("|") ===
    [args.homeNickname.toLowerCase(), args.awayNickname.toLowerCase()].sort().join("|"),
  );
  if (list.length === 0) return neutralHeadToHead();

  // Sort newest → oldest, keep up to 5.
  const sorted = [...list].sort((a, b) => Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc)).slice(0, 5);

  // Weights: most recent 3 = 1.0, older = 0.5.
  const weighted = sorted.map((m, i) => ({ m, w: i < 3 ? 1.0 : 0.5 }));
  const totalW = weighted.reduce((s, x) => s + x.w, 0) || 1;

  let homeWins = 0, awayWins = 0, draws = 0;
  let totSum = 0, marginSum = 0, close = 0, blowout = 0;
  let venueHomeWins = 0, venueGames = 0;

  for (const { m, w } of weighted) {
    const homeIsArgsHome = m.homeNickname.toLowerCase() === args.homeNickname.toLowerCase();
    const signedMargin = homeIsArgsHome ? m.margin : -m.margin;
    if (signedMargin > 0) homeWins += w;
    else if (signedMargin < 0) awayWins += w;
    else draws += w;
    totSum += m.totalPoints * w;
    marginSum += signedMargin * w;
    if (Math.abs(m.margin) <= 6) close += w;
    if (Math.abs(m.margin) >= 13) blowout += w;
    if (args.venue && m.homeNickname.toLowerCase() === args.homeNickname.toLowerCase()) {
      venueGames += w;
      if (m.margin > 0) venueHomeWins += w;
    }
  }

  const avgTotal = totSum / totalW;
  const avgMargin = marginSum / totalW;
  const closeRate = close / totalW;
  const blowoutRate = blowout / totalW;
  const homeVenueEdge = venueGames > 0 ? (venueHomeWins / venueGames - 0.5) * 2 : null;

  // Bounded modifiers — never large enough to flip a confident result.
  const sampleScale = Math.min(1, sorted.length / 4); // full strength at 4+ games
  const marginModifier = clamp(avgMargin * 0.15 * sampleScale, -3, 3);
  const totalModifier = clamp((avgTotal - 40) * 0.1 * sampleScale, -3, 3);
  const closeGameLift = clamp(closeRate * 0.08 * sampleScale, 0, 0.08);
  const blowoutLift = clamp(blowoutRate * 0.08 * sampleScale, 0, 0.08);

  const stylisticNote =
    blowoutRate >= 0.6 ? "Recent meetings have been blowouts."
    : closeRate >= 0.6 ? "Recent meetings have been tight."
    : avgTotal >= 46 ? "Recent meetings trended high-scoring."
    : avgTotal <= 32 ? "Recent meetings trended low-scoring."
    : "Recent meetings balanced.";

  // Confidence: small sample = low; older-only sample = low; otherwise medium.
  const confidence: ConfidenceTier =
    sorted.length >= 4 ? "medium"
    : sorted.length >= 2 ? "low"
    : "low";

  return {
    recentHeadToHeadGames: sorted.length,
    homeWins: Math.round(homeWins), awayWins: Math.round(awayWins), draws: Math.round(draws),
    avgTotal, avgMargin,
    closeGameRate: closeRate, blowoutRate,
    homeVenueEdge,
    stylisticNote,
    marginModifier, totalModifier,
    closeGameLift, blowoutLift,
    confidence,
  };
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
