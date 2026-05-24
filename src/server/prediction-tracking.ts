// Prediction tracking + learning layer.
//
// This module is *additive*: it never replaces the deterministic engine. It
// snapshots every pre-kickoff prediction, scores it once the actual NRL result
// arrives, distils structured lessons, and exposes aggregate model performance
// + a confidence-adjustment helper for future predictions.
//
// Snapshots are LOCKED — once a row exists for a match_id we never overwrite
// it. This guarantees we score what the model actually predicted before
// kickoff, not a regenerated post-hoc payload.

import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DeterministicInsights } from "./insights-engine";
import type { ScriptPayload } from "./script-engine";
import type { NrlMatchDetails, NrlMatchRecap } from "./nrl";
import type { OddsEvent, TryscorerMarkets } from "./odds";
import type { ModelMode } from "./model-mode";
import type { Insights } from "./ai-insights";

// ------------------------------------------------------------------
// Types (mirror the table columns; JSONB blobs typed for safety)
// ------------------------------------------------------------------

export type PredictionSnapshotRow = {
  id?: string;
  match_id: string;
  created_at?: string;
  round: number | null;
  season: number | null;
  home_team: string;
  away_team: string;
  kickoff_utc: string | null;
  model_mode: ModelMode;
  predicted_winner: string | null;
  predicted_margin_band: string | null;
  predicted_total_lean: "over" | "under" | null;
  predicted_total_line: number | null;
  predicted_htft: string | null;
  predicted_score_home: number | null;
  predicted_score_away: number | null;
  first_try_pick: string | null;
  anytime_try_picks: { name: string; team?: string }[];
  secondary_tier_picks: { name: string; team?: string }[];
  script_prediction: {
    tempo?: "slow" | "controlled" | "open" | null;
    flow?: "tight" | "blowout" | null;
    dominantTeam?: string | null;
    edge?: "left" | "right" | "middle" | null;
    summary?: string;
  } | null;
  confidence_scores: { team: number; player: number; script: number; overall: number } | null;
  odds_snapshot: Record<string, unknown> | null;
  data_sources: { nrl: boolean; odds: boolean; tryscorers: boolean } | null;
  locked_before_kickoff: boolean;
  snapshot_version?: string;
  sealed_at?: string | null;
  is_sealed?: boolean;
  snapshot_payload?: Record<string, unknown>;
  deterministic_payload?: Record<string, unknown> | null;
  simulation_payload?: Record<string, unknown> | null;
  insights_payload?: Record<string, unknown> | null;
  generated_bets?: unknown | null;
  payload_hash?: string | null;
  source_match_insights_key?: string | null;
};

export type ModelPerformance = {
  totalScored: number;
  winnerAccuracy: number;
  marginAccuracy: number;
  totalAccuracy: number;
  htftAccuracy: number;
  firstTryAccuracy: number;
  anytimeHitRate: number;
  overallAccuracy: number;
  byRiskTier: Record<"low" | "medium" | "high", { count: number; overall: number }>;
};

// ------------------------------------------------------------------
// Snapshot — versioned writes before kickoff, canonical seal at kickoff
// ------------------------------------------------------------------

const SNAPSHOT_VERSION = "prediction-v2";
const SEALED_SNAPSHOT_VERSION = "sealed-v2";

function normName(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  if (/^awaiting/i.test(t)) return null;
  return t;
}

function pickName(p: { name?: string } | undefined | null): string | null {
  return normName(p?.name);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function buildFullSnapshotPayload(args: {
  row: PredictionSnapshotRow;
  deterministic: DeterministicInsights;
  script: ScriptPayload | null;
  odds: OddsEvent | null;
  tryscorers: TryscorerMarkets | null;
  insightsPayload?: Insights | null;
  simulationPayload?: unknown | null;
  generatedBets?: unknown | null;
}) {
  return {
    snapshotVersion: args.row.snapshot_version ?? SNAPSHOT_VERSION,
    matchId: args.row.match_id,
    generatedAt: args.deterministic.generatedAt,
    sealedAt: args.row.sealed_at ?? null,
    projectedWinner: args.row.predicted_winner,
    projectedMargin: args.row.predicted_margin_band,
    projectedScore: { home: args.row.predicted_score_home, away: args.row.predicted_score_away },
    projectedTotals: { lean: args.row.predicted_total_lean, line: args.row.predicted_total_line },
    htft: args.row.predicted_htft,
    firstTryScorer: args.row.first_try_pick,
    anytimeScorers: args.row.anytime_try_picks,
    secondaryScorers: args.row.secondary_tier_picks,
    deterministic: args.deterministic,
    simulation: args.simulationPayload ?? null,
    odds: args.odds,
    tryscorers: args.tryscorers,
    insights: args.insightsPayload ?? null,
    script: args.script,
    bets: args.generatedBets ?? null,
    dataSources: args.row.data_sources,
  };
}

export type AdvancedSnapshotExtras = {
  rawSimulationProb?: { home: number; away: number; draw: number } | null;
  calibratedProb?: { home: number; away: number; draw: number } | null;
  modelDrivers?: unknown[] | null;
  advancedModelVersion?: string | null;
  valueEdges?: unknown | null;
  marketSnapshot?: unknown | null;
};

export function buildSnapshotRow(args: {
  matchId: string;
  details: NrlMatchDetails;
  insights: DeterministicInsights;
  script: ScriptPayload | null;
  odds: OddsEvent | null;
  tryscorers: TryscorerMarkets | null;
  round?: number | null;
  season?: number | null;
  advanced?: AdvancedSnapshotExtras;
}): PredictionSnapshotRow {
  const { details, insights, script } = args;
  const ko = details.kickoffUtc ? new Date(details.kickoffUtc) : null;
  const kickoffPassed = ko ? ko.getTime() <= Date.now() : false;

  const tempo: "slow" | "controlled" | "open" | null = insights.totalPoints?.lean === "over"
    ? "open" : insights.totalPoints?.lean === "under" ? "slow" : "controlled";
  const flow: "tight" | "blowout" | null = insights.margin?.bucket === "13+" ? "blowout" : "tight";

  const adv = args.advanced ?? {};
  const base: PredictionSnapshotRow = {
    match_id: args.matchId,
    round: args.round ?? (details as { roundNumber?: number }).roundNumber ?? null,
    season: args.season ?? (ko ? ko.getUTCFullYear() : null),
    home_team: details.homeTeam.nickName,
    away_team: details.awayTeam.nickName,
    kickoff_utc: details.kickoffUtc ?? null,
    model_mode: insights.mode,
    predicted_winner: insights.matchWinner?.nickname ?? null,
    predicted_margin_band: insights.margin?.bucket ?? null,
    predicted_total_lean: insights.totalPoints?.lean ?? null,
    predicted_total_line: insights.totalPoints?.line ?? null,
    predicted_htft: insights.htft?.pick ?? null,
    predicted_score_home: insights.predictedScore?.home ?? null,
    predicted_score_away: insights.predictedScore?.away ?? null,
    first_try_pick: pickName(insights.firstTryscorer),
    anytime_try_picks: (insights.topAnytimeOverall ?? []).slice(0, 5)
      .map((p) => ({ name: p.name, team: p.team })).filter((p) => normName(p.name)),
    secondary_tier_picks: [
      ...(insights.forwardPicks ?? []).map((p) => ({ name: p.name, team: p.team })),
      ...(insights.predictedOutcome?.picks ?? []).map((p) => ({ name: p.name, team: p.team })),
    ].filter((p) => normName(p.name)),
    script_prediction: script ? {
      tempo, flow,
      dominantTeam: insights.matchWinner?.nickname ?? null,
      edge: script.edges?.leftConfidence === "market-supported" ? "left"
            : script.edges?.rightConfidence === "market-supported" ? "right" : null,
      summary: script.summary,
    } : { tempo, flow, dominantTeam: insights.matchWinner?.nickname ?? null, edge: null },
    confidence_scores: {
      team: insights.confidence === "high" ? 0.85 : insights.confidence === "medium" ? 0.6 : 0.35,
      player: insights.mode === "final" ? 0.7 : insights.mode === "market" ? 0.6 : 0.4,
      script: script ? 0.7 : 0.4,
      overall: insights.confidence === "high" ? 0.75 : insights.confidence === "medium" ? 0.55 : 0.35,
    },
    odds_snapshot: args.odds ? (args.odds as unknown as Record<string, unknown>) : null,
    data_sources: {
      nrl: true,
      odds: !!args.odds,
      tryscorers: !!args.tryscorers?.hasAny,
    },
    locked_before_kickoff: !kickoffPassed,
    snapshot_version: SNAPSHOT_VERSION,
    sealed_at: null,
    is_sealed: false,
    snapshot_payload: {},
    deterministic_payload: insights as unknown as Record<string, unknown>,
    simulation_payload: (adv.rawSimulationProb ?? null) as unknown as Record<string, unknown> | null,
    insights_payload: null,
    generated_bets: null,
    payload_hash: null,
    source_match_insights_key: null,
  };
  const row = {
    ...base,
    ...(adv.rawSimulationProb != null ? { raw_simulation_prob: adv.rawSimulationProb } : {}),
    ...(adv.calibratedProb != null ? { calibrated_prob: adv.calibratedProb } : {}),
    ...(adv.modelDrivers != null ? { model_drivers: adv.modelDrivers } : {}),
    ...(adv.advancedModelVersion != null ? { advanced_model_version: adv.advancedModelVersion } : {}),
    ...(adv.valueEdges != null ? { value_edges: adv.valueEdges } : {}),
    ...(adv.marketSnapshot != null ? { market_snapshot: adv.marketSnapshot } : {}),
  } as PredictionSnapshotRow;
  const fullPayload = buildFullSnapshotPayload({
    row,
    deterministic: insights,
    script,
    odds: args.odds,
    tryscorers: args.tryscorers,
    simulationPayload: adv.rawSimulationProb ?? null,
  });
  return {
    ...row,
    snapshot_payload: fullPayload,
    payload_hash: hashPayload(fullPayload),
  };
}

// Versioned insert-only. Pre-kickoff predictions may evolve, but each version is
// preserved. At/after kickoff, callers seal exactly one canonical version.
export async function snapshotPrediction(row: PredictionSnapshotRow): Promise<void> {
  if (!row.locked_before_kickoff) return;
  try {
    const { error } = await supabaseAdmin
      .from("prediction_snapshots" as never)
      .insert(row as never)
      .select("id")
      .maybeSingle();
    // Unique violation = already locked. That's expected and desirable.
    if (error && !/duplicate key|unique/i.test(error.message)) {
      console.warn("snapshotPrediction failed:", error.message);
    }
  } catch (e) {
    console.warn("snapshotPrediction threw:", e);
  }
}

export async function readSealedPredictionSnapshot(matchId: string): Promise<PredictionSnapshotRow | null> {
  try {
    const { data } = await supabaseAdmin
      .from("prediction_snapshots" as never)
      .select("*")
      .eq("match_id" as never, matchId as never)
      .eq("is_sealed" as never, true as never)
      .order("sealed_at" as never, { ascending: false } as never)
      .limit(1)
      .maybeSingle();
    return (data as PredictionSnapshotRow | null) ?? null;
  } catch {
    return null;
  }
}

export async function readLatestPreKickoffPredictionSnapshot(matchId: string, kickoffUtc?: string | null): Promise<PredictionSnapshotRow | null> {
  try {
    const { data } = await supabaseAdmin
      .from("prediction_snapshots" as never)
      .select("*")
      .eq("match_id" as never, matchId as never)
      .order("created_at" as never, { ascending: true } as never)
      .limit(100);
    const rows = (data as PredictionSnapshotRow[] | null) ?? [];
    if (!rows.length) return null;
    const kickoffMs = kickoffUtc ? Date.parse(kickoffUtc) : NaN;
    const pre = Number.isFinite(kickoffMs)
      ? rows.filter((r) => Date.parse(r.created_at ?? "") <= kickoffMs)
      : rows;
    return pre[pre.length - 1] ?? rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function sealPredictionSnapshot(args: {
  matchId: string;
  kickoffUtc?: string | null;
  insightsPayload?: Insights | null;
  sourceMatchInsightsKey?: string | null;
}): Promise<PredictionSnapshotRow | null> {
  const existing = await readSealedPredictionSnapshot(args.matchId);
  if (existing) return existing;
  const source = await readLatestPreKickoffPredictionSnapshot(args.matchId, args.kickoffUtc);
  if (!source) return null;
  const sealedAt = new Date().toISOString();
  const snapshotPayload = {
    ...(source.snapshot_payload ?? {}),
    snapshotVersion: SEALED_SNAPSHOT_VERSION,
    sealedAt,
    insights: args.insightsPayload ?? source.insights_payload ?? (source.snapshot_payload as { insights?: unknown } | undefined)?.insights ?? null,
  };
  const sealedRow = {
    ...source,
    id: undefined,
    created_at: undefined,
    snapshot_version: SEALED_SNAPSHOT_VERSION,
    sealed_at: sealedAt,
    is_sealed: true,
    locked_before_kickoff: true,
    insights_payload: (args.insightsPayload ?? source.insights_payload ?? null) as unknown as Record<string, unknown> | null,
    snapshot_payload: snapshotPayload,
    payload_hash: hashPayload(snapshotPayload),
    source_match_insights_key: args.sourceMatchInsightsKey ?? source.source_match_insights_key ?? null,
  } as PredictionSnapshotRow;
  try {
    const { data, error } = await supabaseAdmin
      .from("prediction_snapshots" as never)
      .insert(sealedRow as never)
      .select("*")
      .maybeSingle();
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return readSealedPredictionSnapshot(args.matchId);
      console.warn("sealPredictionSnapshot failed:", error.message);
      return null;
    }
    return (data as PredictionSnapshotRow | null) ?? sealedRow;
  } catch (e) {
    console.warn("sealPredictionSnapshot threw:", e);
    return readSealedPredictionSnapshot(args.matchId);
  }
}

async function readSnapshot(matchId: string): Promise<PredictionSnapshotRow | null> {
  return readSealedPredictionSnapshot(matchId) ?? readLatestPreKickoffPredictionSnapshot(matchId);
}

// ------------------------------------------------------------------
// Result + Score — runs after FullTime
// ------------------------------------------------------------------

function normPlayerKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");
}

export async function recordResultAndScore(args: {
  matchId: string;
  details: NrlMatchDetails;
  recap: NrlMatchRecap | null;
}): Promise<void> {
  const finished = /^(FullTime|Final|Completed)$/i.test(args.details.matchState);
  if (!finished) return;

  const snap = await readSnapshot(args.matchId);
  // No locked snapshot → nothing to score against.
  if (!snap) return;

  // Guard: if a score row already exists, we're done.
  try {
    const { data: existing } = await supabaseAdmin
      .from("prediction_scores" as never)
      .select("id")
      .eq("match_id" as never, args.matchId as never)
      .maybeSingle();
    if (existing) return;
  } catch {
    // continue
  }

  const homeScore = args.details.homeTeam.score;
  const awayScore = args.details.awayTeam.score;
  if (typeof homeScore !== "number" || typeof awayScore !== "number") return;

  const actualWinner = homeScore > awayScore ? args.details.homeTeam.nickName
    : homeScore < awayScore ? args.details.awayTeam.nickName : "Draw";
  const actualMargin = Math.abs(homeScore - awayScore);
  const actualMarginBand = actualMargin === 0 ? "Draw" : actualMargin <= 12 ? "1-12" : "13+";
  const actualTotal = homeScore + awayScore;
  const actualTotalResult: "over" | "under" | null = snap.predicted_total_line != null
    ? (actualTotal > snap.predicted_total_line ? "over" : "under") : null;
  const firstTry = args.recap?.firstTry?.name ?? null;
  const allTryscorers = [
    ...(args.recap?.homeTryscorers ?? []),
    ...(args.recap?.awayTryscorers ?? []),
  ];
  const tryOrder = args.recap?.tryOrder ?? [];

  // Insert result row (idempotent via UNIQUE constraint on match_id)
  await supabaseAdmin
    .from("prediction_results" as never)
    .insert({
      match_id: args.matchId,
      actual_winner: actualWinner,
      actual_margin_band: actualMarginBand,
      actual_total_points: actualTotal,
      actual_total_result: actualTotalResult,
      actual_htft: actualWinner === "Draw" ? "Draw" : `${actualWinner}/${actualWinner}`,
      actual_score_home: homeScore,
      actual_score_away: awayScore,
      actual_first_try_scorer: firstTry,
      actual_try_scorers: allTryscorers as unknown as Record<string, unknown>,
      actual_try_order: tryOrder as unknown as Record<string, unknown>,
      team_stats: null,
      player_stats: null,
    } as never)
    .then(() => undefined, (e: { message?: string }) => {
      if (!/duplicate key|unique/i.test(e?.message ?? "")) console.warn("insert result:", e?.message);
    });

  // ---- Score the snapshot ----
  const winnerCorrect = !!(snap.predicted_winner && snap.predicted_winner === actualWinner);
  const marginCorrect = !!(snap.predicted_margin_band && snap.predicted_margin_band === actualMarginBand);
  const totalCorrect = snap.predicted_total_lean && actualTotalResult
    ? snap.predicted_total_lean === actualTotalResult : null;
  const htftCorrect = snap.predicted_htft
    ? snap.predicted_htft.toLowerCase().endsWith(actualWinner.toLowerCase()) : null;
  const firstTryCorrect = !!(snap.first_try_pick && firstTry &&
    normPlayerKey(snap.first_try_pick) === normPlayerKey(firstTry));

  const scoredSet = new Set(allTryscorers.map((t) => normPlayerKey(t.name)));
  const anytimePicks = (snap.anytime_try_picks ?? []).map((p) => p.name).filter(Boolean);
  const anytimeHits = anytimePicks.filter((n) => scoredSet.has(normPlayerKey(n))).length;
  const secondaryPicks = (snap.secondary_tier_picks ?? []).map((p) => p.name).filter(Boolean);
  const secondaryHits = secondaryPicks.filter((n) => scoredSet.has(normPlayerKey(n))).length;

  // Script accuracy: tempo/flow/dominantTeam against actuals
  const tempoLine = snap.predicted_total_line ?? 42;
  const actualTempo: "slow" | "controlled" | "open" =
    actualTotal >= tempoLine + 8 ? "open" : actualTotal <= tempoLine - 8 ? "slow" : "controlled";
  const actualFlow: "tight" | "blowout" = actualMargin >= 13 ? "blowout" : "tight";
  const sp = snap.script_prediction ?? {};
  const scriptParts: boolean[] = [];
  if (sp.tempo) scriptParts.push(sp.tempo === actualTempo);
  if (sp.flow) scriptParts.push(sp.flow === actualFlow);
  if (sp.dominantTeam) scriptParts.push(sp.dominantTeam === actualWinner);
  const scriptAccuracy = scriptParts.length ? scriptParts.filter(Boolean).length / scriptParts.length : null;

  const teamParts: number[] = [
    winnerCorrect ? 1 : 0,
    marginCorrect ? 1 : 0,
    ...(totalCorrect == null ? [] : [totalCorrect ? 1 : 0]),
    ...(htftCorrect == null ? [] : [htftCorrect ? 1 : 0]),
  ];
  const teamScore = teamParts.length ? teamParts.reduce((a, b) => a + b, 0) / teamParts.length : 0;

  const anytimeRate = anytimePicks.length ? anytimeHits / anytimePicks.length : 0;
  const secondaryRate = secondaryPicks.length ? secondaryHits / secondaryPicks.length : 0;
  const playerParts: number[] = [
    ...(snap.first_try_pick ? [firstTryCorrect ? 1 : 0] : []),
    ...(anytimePicks.length ? [anytimeRate] : []),
    ...(secondaryPicks.length ? [secondaryRate] : []),
  ];
  const playerScore = playerParts.length ? playerParts.reduce((a, b) => a + b, 0) / playerParts.length : 0;

  // Weighted: 50% team markets + 35% player markets + 15% script.
  const totalModelScore = teamScore * 0.5 + playerScore * 0.35 + (scriptAccuracy ?? 0) * 0.15;
  const riskTier = snap.model_mode === "early" ? "high"
    : snap.model_mode === "squad" ? "medium" : "low";

  // Phase 5 — calibration & error fields. All optional / null-safe.
  const snapAny = snap as unknown as Record<string, unknown>;
  const calibrated = snapAny.calibrated_prob as { home?: number; away?: number; draw?: number } | null | undefined;
  let calibrationAccuracy: number | null = null;
  if (calibrated && typeof calibrated.home === "number" && typeof calibrated.away === "number") {
    const winnerProb = actualWinner === args.details.homeTeam.nickName
      ? (calibrated.home ?? 0)
      : actualWinner === args.details.awayTeam.nickName
        ? (calibrated.away ?? 0)
        : (calibrated.draw ?? 0);
    calibrationAccuracy = Math.round(winnerProb * 1000) / 1000;
  }
  const confidenceBucket = snap.confidence_scores?.overall != null
    ? snap.confidence_scores.overall >= 0.7 ? "high"
      : snap.confidence_scores.overall >= 0.5 ? "medium" : "low"
    : null;
  const expectedTotalError = snap.predicted_total_line != null
    ? Math.abs(snap.predicted_total_line - actualTotal) : null;
  const predictedMarginErr = snap.predicted_score_home != null && snap.predicted_score_away != null
    ? Math.abs((snap.predicted_score_home - snap.predicted_score_away) - (homeScore - awayScore)) : null;
  const scoreErr = snap.predicted_score_home != null && snap.predicted_score_away != null
    ? Math.abs(snap.predicted_score_home - homeScore) + Math.abs(snap.predicted_score_away - awayScore) : null;

  await supabaseAdmin
    .from("prediction_scores" as never)
    .insert({
      match_id: args.matchId,
      winner_correct: winnerCorrect,
      margin_correct: marginCorrect,
      total_correct: totalCorrect,
      htft_correct: htftCorrect,
      first_try_correct: firstTryCorrect,
      anytime_hits: anytimeHits,
      anytime_checked: anytimePicks.length,
      anytime_hit_rate: anytimePicks.length ? anytimeRate : null,
      secondary_hits: secondaryHits,
      secondary_checked: secondaryPicks.length,
      script_accuracy: scriptAccuracy,
      team_market_score: teamScore,
      player_market_score: playerScore,
      total_model_score: totalModelScore,
      risk_tier: riskTier,
      calibration_accuracy: calibrationAccuracy,
      confidence_bucket: confidenceBucket,
      expected_total_error: expectedTotalError,
      predicted_margin_error: predictedMarginErr,
      score_error: scoreErr,
    } as never)
    .then(() => undefined, (e: { message?: string }) => {
      if (!/duplicate key|unique/i.test(e?.message ?? "")) console.warn("insert score:", e?.message);
    });

  // ---- Generate structured lessons ----
  await generateLessons(args.matchId, {
    winnerCorrect, marginCorrect, totalCorrect, htftCorrect, firstTryCorrect,
    anytimeRate, scriptAccuracy, teamScore, playerScore,
  });
}

// ------------------------------------------------------------------
// Lessons — structured, machine-consumable signals (NOT prose)
// ------------------------------------------------------------------

type LessonInputs = {
  winnerCorrect: boolean;
  marginCorrect: boolean;
  totalCorrect: boolean | null;
  htftCorrect: boolean | null;
  firstTryCorrect: boolean;
  anytimeRate: number;
  scriptAccuracy: number | null;
  teamScore: number;
  playerScore: number;
};

async function generateLessons(matchId: string, s: LessonInputs): Promise<void> {
  const lessons: { category: string; lesson: string; adjustment_signal: "increase" | "decrease" | "hold"; confidence_impact: number }[] = [];

  const push = (category: string, hit: boolean, weight: number) => {
    lessons.push({
      category,
      lesson: hit ? `${category} call landed — reinforce signal weighting` : `${category} call missed — soften signal weighting`,
      adjustment_signal: hit ? "increase" : "decrease",
      confidence_impact: hit ? weight : -weight,
    });
  };

  push("winner", s.winnerCorrect, 0.05);
  push("margin", s.marginCorrect, 0.04);
  if (s.totalCorrect != null) push("total", s.totalCorrect, 0.03);
  if (s.htftCorrect != null) push("htft", s.htftCorrect, 0.02);
  push("first_try", s.firstTryCorrect, 0.04);

  // Anytime — graded by hit rate, not pass/fail
  lessons.push({
    category: "anytime",
    lesson: s.anytimeRate >= 0.5 ? "Anytime tryscorer board converted strongly"
      : s.anytimeRate >= 0.25 ? "Anytime tryscorer board partially converted"
      : "Anytime tryscorer board underperformed",
    adjustment_signal: s.anytimeRate >= 0.5 ? "increase" : s.anytimeRate >= 0.25 ? "hold" : "decrease",
    confidence_impact: (s.anytimeRate - 0.33) * 0.1, // centred at typical baseline
  });

  if (s.scriptAccuracy != null) {
    lessons.push({
      category: "script",
      lesson: s.scriptAccuracy >= 0.66 ? "Game-script read aligned with how match unfolded"
        : s.scriptAccuracy >= 0.34 ? "Script read partially aligned"
        : "Script read diverged from actual flow",
      adjustment_signal: s.scriptAccuracy >= 0.66 ? "increase" : s.scriptAccuracy >= 0.34 ? "hold" : "decrease",
      confidence_impact: (s.scriptAccuracy - 0.5) * 0.08,
    });
  }

  const overall = (s.teamScore + s.playerScore) / 2;
  lessons.push({
    category: "overall",
    lesson: overall >= 0.6 ? "Strong overall read — keep current weights"
      : overall >= 0.4 ? "Mixed read — minor recalibration"
      : "Weak read — meaningful recalibration",
    adjustment_signal: overall >= 0.6 ? "increase" : overall >= 0.4 ? "hold" : "decrease",
    confidence_impact: (overall - 0.5) * 0.1,
  });

  if (!lessons.length) return;
  await supabaseAdmin
    .from("model_lessons" as never)
    .insert(lessons.map((l) => ({ ...l, match_id: matchId })) as never)
    .then(() => undefined, (e: { message?: string }) => {
      console.warn("insert lessons:", e?.message);
    });
}

// ------------------------------------------------------------------
// Aggregate model performance
// ------------------------------------------------------------------

export async function getModelPerformance(): Promise<ModelPerformance> {
  const empty: ModelPerformance = {
    totalScored: 0,
    winnerAccuracy: 0, marginAccuracy: 0, totalAccuracy: 0, htftAccuracy: 0,
    firstTryAccuracy: 0, anytimeHitRate: 0, overallAccuracy: 0,
    byRiskTier: { low: { count: 0, overall: 0 }, medium: { count: 0, overall: 0 }, high: { count: 0, overall: 0 } },
  };
  try {
    const { data } = await supabaseAdmin
      .from("prediction_scores" as never)
      .select("*");
    const rows = (data as Array<{
      winner_correct: boolean | null; margin_correct: boolean | null;
      total_correct: boolean | null; htft_correct: boolean | null;
      first_try_correct: boolean | null;
      anytime_hit_rate: number | null;
      total_model_score: number | null;
      risk_tier: "low" | "medium" | "high" | null;
    }> | null) ?? [];
    if (!rows.length) return empty;
    const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const tier: ModelPerformance["byRiskTier"] = { low: { count: 0, overall: 0 }, medium: { count: 0, overall: 0 }, high: { count: 0, overall: 0 } };
    for (const r of rows) {
      const t = r.risk_tier && tier[r.risk_tier] ? r.risk_tier : "medium";
      tier[t].count += 1;
      tier[t].overall += r.total_model_score ?? 0;
    }
    for (const k of ["low", "medium", "high"] as const) {
      tier[k].overall = tier[k].count ? tier[k].overall / tier[k].count : 0;
    }
    return {
      totalScored: rows.length,
      winnerAccuracy: mean(rows.filter((r) => r.winner_correct != null).map((r) => r.winner_correct ? 1 : 0)),
      marginAccuracy: mean(rows.filter((r) => r.margin_correct != null).map((r) => r.margin_correct ? 1 : 0)),
      totalAccuracy: mean(rows.filter((r) => r.total_correct != null).map((r) => r.total_correct ? 1 : 0)),
      htftAccuracy: mean(rows.filter((r) => r.htft_correct != null).map((r) => r.htft_correct ? 1 : 0)),
      firstTryAccuracy: mean(rows.filter((r) => r.first_try_correct != null).map((r) => r.first_try_correct ? 1 : 0)),
      anytimeHitRate: mean(rows.filter((r) => r.anytime_hit_rate != null).map((r) => r.anytime_hit_rate as number)),
      overallAccuracy: mean(rows.map((r) => r.total_model_score ?? 0)),
      byRiskTier: tier,
    };
  } catch {
    return empty;
  }
}

// ------------------------------------------------------------------
// Confidence adjustment helper (used by future predictions)
//
// This is a soft nudge applied on top of the deterministic confidence — it
// never overrides picks, only tightens or relaxes the surfaced confidence
// based on how recent lessons have played out for that category.
// ------------------------------------------------------------------

export type ConfidenceAdjustments = Record<string, number>; // category → delta in [-0.2, +0.2]

export async function getConfidenceAdjustments(lookback = 30): Promise<ConfidenceAdjustments> {
  const out: ConfidenceAdjustments = {};
  try {
    const { data } = await supabaseAdmin
      .from("model_lessons" as never)
      .select("category, confidence_impact, created_at")
      .order("created_at" as never, { ascending: false })
      .limit(lookback * 8); // ~8 lessons per match
    const rows = (data as Array<{ category: string; confidence_impact: number }> | null) ?? [];
    const buckets = new Map<string, number[]>();
    for (const r of rows) {
      if (!buckets.has(r.category)) buckets.set(r.category, []);
      buckets.get(r.category)!.push(r.confidence_impact);
    }
    for (const [cat, impacts] of buckets) {
      const sum = impacts.reduce((a, b) => a + b, 0);
      // Cap at ±0.2 so a hot/cold streak can't dominate the deterministic engine.
      out[cat] = Math.max(-0.2, Math.min(0.2, sum / Math.max(impacts.length, 5)));
    }
    return out;
  } catch {
    return out;
  }
}
