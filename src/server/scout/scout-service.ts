// ============================================================================
// Scout intelligence service.
//
// Responsibilities:
//   • readSimulationSummary(matchId) — pulls the cached Monte-Carlo summary
//     written by getOrGenerateSimulation. We never re-run the engine here.
//   • simulateWithModifiers(summary, modifiers) — analytic perturbation of an
//     existing summary. Bounded deltas; deterministic; no DB writes.
//   • buildMatchContext(args) — assembles a ScoutMatchContext bundle from the
//     existing engines (sim, calibration, value, correlation, staking).
//   • getOrBuildContext(args) — cached wrapper for warm reuse.
//
// Numbers in the bundle come from existing engines only — Scout's LLM layer
// never invents probabilities or prices.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cached } from "../cache";
import { applyCorrelationGuard, type GuardLeg } from "../correlation-guard";
import { isSimulationEnabled, validateSimulation, buildMarketPrices } from "../simulation-integration";
import { recommendStake } from "../staking-model";
import { buildValuePicks } from "../value-engine";
import { fairOddsToProbability } from "../fair-odds";
import type { OddsEvent, TryscorerMarkets } from "../odds";
import type {
  NewsModifier,
  ScoutBetSuggestion,
  ScoutMatchContext,
  SimulationSummary,
} from "./scout-contracts";

// ---------- Cached simulation read ----------------------------------------

export async function readSimulationSummary(matchId: string): Promise<SimulationSummary | null> {
  if (!isSimulationEnabled()) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("simulation_summaries" as never)
      .select("payload, expires_at")
      .eq("match_id" as never, matchId as never)
      .order("generated_at" as never, { ascending: false } as never)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as { payload: SimulationSummary; expires_at: string };
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    return validateSimulation(row.payload);
  } catch (e) {
    console.warn("[scout-service] readSimulationSummary failed:", e);
    return null;
  }
}

// ---------- Modifier perturbation -----------------------------------------

const CLAMP_TEAM = 0.15;       // |Δattack|, |Δtempo| ceiling per modifier
const CLAMP_PLAYER = 0.25;     // |Δ try rate| ceiling per modifier
const CLAMP_POINTS = 6;        // |Δ expected points| ceiling per modifier

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function aggregateImpacts(modifiers: NewsModifier[], homeNick: string, awayNick: string) {
  let homePts = 0, awayPts = 0;
  let homeAttack = 0, awayAttack = 0;
  let tempo = 0;
  const playerRate = new Map<string, number>();

  for (const m of modifiers) {
    const impact = m.impact;
    const teamMatch = m.team ? m.team.toLowerCase() : null;
    const isHome = teamMatch === homeNick.toLowerCase();
    const isAway = teamMatch === awayNick.toLowerCase();
    const points = clamp(impact.expectedPoints ?? 0, -CLAMP_POINTS, CLAMP_POINTS);
    const attack = clamp(impact.attack ?? 0, -CLAMP_TEAM, CLAMP_TEAM);
    const t = clamp(impact.tempo ?? 0, -CLAMP_TEAM, CLAMP_TEAM);
    if (isHome) { homePts += points; homeAttack += attack; }
    else if (isAway) { awayPts += points; awayAttack += attack; }
    else {
      // Untargeted (weather / venue / official) — split evenly.
      homePts += points / 2; awayPts += points / 2;
    }
    tempo += t;
    if (impact.affectedPlayer && impact.playerTryRate) {
      const k = impact.affectedPlayer.toLowerCase();
      playerRate.set(k, clamp((playerRate.get(k) ?? 0) + impact.playerTryRate, -CLAMP_PLAYER, CLAMP_PLAYER));
    }
  }

  // Re-clamp totals so 5 stacked modifiers can't blow past safety bounds.
  return {
    homePts: clamp(homePts, -CLAMP_POINTS * 1.5, CLAMP_POINTS * 1.5),
    awayPts: clamp(awayPts, -CLAMP_POINTS * 1.5, CLAMP_POINTS * 1.5),
    homeAttack: clamp(homeAttack, -CLAMP_TEAM, CLAMP_TEAM),
    awayAttack: clamp(awayAttack, -CLAMP_TEAM, CLAMP_TEAM),
    tempo: clamp(tempo, -CLAMP_TEAM, CLAMP_TEAM),
    playerRate,
  };
}

// Logistic mapper from margin → P(home win). Calibrated softly off the
// existing summary's home/away probs so stable perturbations stay close to
// the original distribution.
function marginToHomeProb(margin: number, scale = 8): number {
  return 1 / (1 + Math.exp(-margin / scale));
}

export function simulateWithModifiers(
  summary: SimulationSummary,
  modifiers: NewsModifier[],
  homeNick: string,
  awayNick: string,
): SimulationSummary {
  if (!modifiers.length) return summary;
  const agg = aggregateImpacts(modifiers, homeNick, awayNick);

  const homeScore = Math.max(0, summary.expectedHomeScore + agg.homePts + summary.expectedHomeScore * agg.homeAttack);
  const awayScore = Math.max(0, summary.expectedAwayScore + agg.awayPts + summary.expectedAwayScore * agg.awayAttack);
  const total = (homeScore + awayScore) * (1 + agg.tempo);
  const margin = homeScore - awayScore;
  const homeWinProb = clamp(marginToHomeProb(margin), 0.02, 0.98);
  const drawProb = Math.max(0.005, summary.drawProb * 0.9);
  const awayWinProb = Math.max(0, 1 - homeWinProb - drawProb);

  const totalLine = Math.round(total * 2) / 2;
  // Approximate over-prob shift: scale around how much total moved vs the
  // original line; use existing overProbAtLine as a soft baseline.
  const totalDelta = total - summary.expectedTotal;
  const overProbAtLine = clamp(summary.overProbAtLine + totalDelta * 0.02, 0.02, 0.98);

  const absMargin = Math.abs(margin);
  const marginBands = {
    draw: drawProb,
    "1-12": clamp(absMargin <= 12 ? 0.55 - drawProb : 0.4 - drawProb, 0.05, 0.7),
    "13+": clamp(absMargin > 12 ? 0.45 : 0.3, 0.05, 0.7),
  };
  // Renormalise.
  const bandSum = marginBands.draw + marginBands["1-12"] + marginBands["13+"];
  marginBands.draw /= bandSum;
  marginBands["1-12"] /= bandSum;
  marginBands["13+"] /= bandSum;

  const playerProbabilities = summary.playerProbabilities.map((p) => {
    const delta = agg.playerRate.get(p.name.toLowerCase()) ?? 0;
    return {
      ...p,
      anytimeProb: clamp(p.anytimeProb * (1 + delta), 0, 0.99),
      firstTryProb: clamp(p.firstTryProb * (1 + delta), 0, 0.99),
      multiTryProb: clamp(p.multiTryProb * (1 + delta * 0.8), 0, 0.95),
    };
  });

  return {
    ...summary,
    expectedHomeScore: Math.round(homeScore * 10) / 10,
    expectedAwayScore: Math.round(awayScore * 10) / 10,
    expectedTotal: Math.round(total * 10) / 10,
    expectedMargin: Math.round(margin * 10) / 10,
    homeWinProb,
    awayWinProb,
    drawProb,
    totalLine,
    overProbAtLine,
    marginBands,
    playerProbabilities,
    generatedAt: new Date().toISOString(),
    iterations: summary.iterations,
    seed: summary.seed,
  };
}

// ---------- Bundle assembly ----------------------------------------------

export type BuildContextArgs = {
  matchId: string;
  homeNickname: string;
  awayNickname: string;
  kickoffUtc?: string;
  venue?: string;
  status?: string;
  odds: OddsEvent | null;
  tryscorers: TryscorerMarkets | null;
  modifiers: NewsModifier[];
};

function gapsFor(prices: ReturnType<typeof buildMarketPrices>, sumExists: boolean): string[] {
  const gaps: string[] = [];
  if (!sumExists) gaps.push("Simulation engine output unavailable for this fixture.");
  if (prices.homeWin == null && prices.awayWin == null) gaps.push("No head-to-head market price posted.");
  if (prices.overAtLine == null) gaps.push("Over/Under prices missing at the model line.");
  if (!prices.anytime || Object.keys(prices.anytime).length === 0) gaps.push("No anytime tryscorer market posted.");
  return gaps;
}

function bundleConfidenceReasons(s: SimulationSummary | null, gaps: string[], modifiersCount: number): { tier: SimulationSummary["confidence"]; reasons: string[] } {
  if (!s) return { tier: "low", reasons: ["Simulation output unavailable; falling back to heuristics"] };
  const reasons: string[] = [];
  if (s.calibration?.method) reasons.push(`Calibration: ${s.calibration.method}`);
  if (s.coverage) reasons.push(`Data coverage tier: ${s.coverage.tier ?? "unknown"}`);
  if (gaps.length) reasons.push(`${gaps.length} data gap(s) flagged`);
  if (modifiersCount > 0) reasons.push(`${modifiersCount} session news modifier(s) applied`);
  // News injection drops confidence one tier (max).
  let tier = s.confidence;
  if (modifiersCount > 0) {
    if (tier === "high") tier = "medium";
    else if (tier === "medium") tier = "low";
  }
  return { tier, reasons };
}

export async function buildMatchContext(args: BuildContextArgs): Promise<ScoutMatchContext> {
  const baseSummary = await readSimulationSummary(args.matchId);
  const summary = baseSummary ? simulateWithModifiers(baseSummary, args.modifiers, args.homeNickname, args.awayNickname) : null;

  const totalLine = summary?.totalLine ?? 40.5;
  const prices = buildMarketPrices({
    odds: args.odds,
    tryscorers: args.tryscorers,
    homeNickname: args.homeNickname,
    awayNickname: args.awayNickname,
    totalLine,
  });

  const gaps = gapsFor(prices, !!summary);
  const conf = bundleConfidenceReasons(summary, gaps, args.modifiers.length);

  const value = summary
    ? buildValuePicks({
        sim: summary,
        prices,
        confidence: conf.tier,
        homeNickname: args.homeNickname,
        awayNickname: args.awayNickname,
      })
    : [];

  // Promote +EV picks into structured bet suggestions with Kelly sizing.
  const bets: ScoutBetSuggestion[] = [];
  for (const v of value) {
    if (v.edge.suppressed || v.edge.evPct <= 0 || v.edge.marketOdds == null) continue;
    const stake = recommendStake({
      modelProb: v.modelProb,
      marketOdds: v.edge.marketOdds,
      confidence: conf.tier,
      riskTier: v.market === "anytime_tryscorer" || v.market === "first_tryscorer" || v.market === "multi_tryscorer" ? "high" : "medium",
    });
    if (stake.recommendedStake <= 0) continue;
    bets.push({
      market: v.market,
      selection: v.selection,
      modelProb: v.modelProb,
      impliedProb: fairOddsToProbability(v.edge.marketOdds),
      marketOdds: v.edge.marketOdds,
      edgePct: v.edge.evPct,
      recommendedStake: stake.recommendedStake,
      fractionOfBankroll: stake.fractionOfBankroll,
      confidence: conf.tier,
      rationale: v.rationale,
    });
  }

  // Apply correlation guard so multi-style stacks don't slip through.
  const guard = applyCorrelationGuard(
    bets.map<GuardLeg>((b, i) => ({
      id: `${b.market}_${i}`,
      market: b.market === "match_winner" ? "match_winner"
        : b.market === "margin" ? "margin"
        : b.market === "totals" ? "totals"
        : b.market === "anytime_tryscorer" ? "anytime_tryscorer"
        : b.market === "first_tryscorer" ? "first_tryscorer"
        : b.market === "multi_tryscorer" ? "multi_tryscorer"
        : "other",
      selection: b.selection,
      decimalOdds: b.marketOdds ?? undefined,
      modelProb: b.modelProb,
    })),
    {
      highTempoSupported: !!summary?.ruckTempoProfile,
      totalLeansOver: (summary?.overProbAtLine ?? 0) >= 0.6,
    },
  );
  const keptIds = new Set(guard.kept.map((l) => l.id));
  const filteredBets = bets.filter((_b, i) => keptIds.has(`${bets[i].market}_${i}`));
  const correlationWarnings = guard.removed.map((r) => `${r.leg.selection} suppressed: ${r.reason}`);

  return {
    match: {
      id: args.matchId,
      homeNickname: args.homeNickname,
      awayNickname: args.awayNickname,
      kickoffUtc: args.kickoffUtc,
      venue: args.venue,
      status: args.status,
    },
    simulation: summary
      ? {
          method: args.modifiers.length ? "perturbed" : "monte-carlo",
          iterations: summary.iterations,
          seed: summary.seed,
          expectedHomeScore: summary.expectedHomeScore,
          expectedAwayScore: summary.expectedAwayScore,
          expectedTotal: summary.expectedTotal,
          homeWinProb: summary.homeWinProb,
          awayWinProb: summary.awayWinProb,
          drawProb: summary.drawProb,
          marginBands: summary.marginBands,
          totalLine: summary.totalLine,
          overProbAtLine: summary.overProbAtLine,
          htftProbabilities: summary.htftProbabilities,
          playerProbabilities: summary.playerProbabilities,
        }
      : { method: "absent", reason: "No cached simulation summary for this fixture." },
    calibration: summary?.calibration
      ? {
          applied: true,
          method: summary.calibration.method,
          blendWeight: (summary.calibration as { blendWeight?: number }).blendWeight,
        }
      : { applied: false },
    confidence: conf,
    drivers: summary?.modelDrivers ?? [],
    profiles: {
      referee: summary?.refereeImpact,
      fatigue: summary?.fatigueProfile,
      ruckTempo: summary?.ruckTempoProfile,
      edgeAttack: summary?.edgeAttackProfile,
      momentum: summary?.momentumProfile,
    },
    market: prices,
    value,
    bets: filteredBets.sort((a, b) => b.edgePct - a.edgePct),
    correlationWarnings,
    modifiersApplied: args.modifiers,
    dataGaps: gaps,
    generatedAt: new Date().toISOString(),
  };
}

// 5-minute warm cache, keyed by matchId + a hash of active modifiers so a new
// news injection invalidates the cached bundle for that match.
function modifierKey(modifiers: NewsModifier[]): string {
  if (!modifiers.length) return "none";
  return modifiers.map((m) => m.id).sort().join("|");
}

export async function getOrBuildContext(args: BuildContextArgs): Promise<ScoutMatchContext> {
  const key = `scout:ctx:${args.matchId}:${modifierKey(args.modifiers)}`;
  return cached(key, 5 * 60_000, () => buildMatchContext(args));
}
