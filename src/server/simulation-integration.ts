// ============================================================================
// Simulation integration — Phase 2 wiring.
//
// Single entry point used by the match-insights flow to:
//   1. Check the ENABLE_SIMULATION_ENGINE feature flag.
//   2. Read a fresh SimulationSummary from `simulation_summaries` if one
//      exists and isn't expired (and forceRefresh isn't set).
//   3. Otherwise build a SimulationInput from existing app data
//      (SeasonSnapshot + named squads + weather + odds presence + modelMode),
//      run the Monte Carlo engine, persist the summary and return it.
//   4. NEVER throws — any failure (DB, sim crash, missing snapshot) returns
//      null so the deterministic engine can carry on.
//
// Also provides helpers to extract MarketPrices from the existing OddsEvent /
// TryscorerMarkets shapes so the bets engine can run buildValuePicks().
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SeasonSnapshot } from "./season-stats";
import type { NrlPlayer } from "./nrl";
import type { ModelMode } from "./model-mode";
import type { OddsEvent, TryscorerMarkets } from "./odds";
import type { WeatherSnapshot } from "./weather";
import type { SimulationSummary } from "./simulation-types";
import type { MarketPrices } from "./value-engine";
import type { NormalisedTeamStats, NormalisedInjury, NormalisedMatchOfficial } from "./nrl-data-types";
import { buildSimulationInput } from "./simulation-feature-builder";
import { runSimulation } from "./simulation-engine";
import { findTeam } from "@/lib/teams";

// Feature flag — default OFF. Server-only. NEVER expose to the client.
// Accepted truthy values: "true" | "1" | "yes" (case-insensitive).
export function isSimulationEnabled(): boolean {
  const v = (process.env.ENABLE_SIMULATION_ENGINE ?? "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

// Dev-only debug log. No-op in production. Never logs raw payloads.
function devLog(event: string, info?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.log(`[simulation:${event}]`, info ?? "");
}

// Defensive runtime validation. Treats malformed summaries as null so the
// deterministic engine carries on. We deliberately accept summaries that are
// internally close-to-valid (probabilities a few % off) by normalising them.
export function validateSimulation(s: SimulationSummary | null | undefined): SimulationSummary | null {
  if (!s || typeof s !== "object") return null;
  const required = [
    "matchId", "iterations", "seed",
    "homeWinProb", "awayWinProb", "drawProb",
    "expectedHomeScore", "expectedAwayScore", "expectedTotal",
    "totalLine", "overProbAtLine",
    "expectedMargin", "marginBands", "confidence",
  ] as const;
  for (const k of required) if ((s as Record<string, unknown>)[k] === undefined) return null;
  const isProb = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  // Match probabilities — normalise to sum 1 if drift is small, else reject.
  let h = typeof s.homeWinProb === "number" ? s.homeWinProb : NaN;
  let a = typeof s.awayWinProb === "number" ? s.awayWinProb : NaN;
  let d = typeof s.drawProb === "number" ? s.drawProb : NaN;
  if (![h, a, d].every((n) => Number.isFinite(n) && n >= -0.05 && n <= 1.05)) return null;
  h = clamp01(h); a = clamp01(a); d = clamp01(d);
  const sum = h + a + d;
  if (sum <= 0) return null;
  if (Math.abs(sum - 1) > 0.15) return null;
  h /= sum; a /= sum; d /= sum;

  const mb = s.marginBands ?? ({} as Record<string, number>);
  if (!isProb(mb.draw) || !isProb(mb["1-12"]) || !isProb(mb["13+"])) return null;

  if (!isProb(s.overProbAtLine)) return null;
  if (typeof s.expectedTotal !== "number" || !Number.isFinite(s.expectedTotal) || s.expectedTotal < 0) return null;
  if (typeof s.totalLine !== "number" || !Number.isFinite(s.totalLine)) return null;
  if (s.confidence !== "low" && s.confidence !== "medium" && s.confidence !== "high") return null;

  // playerProbabilities: drop entries that are malformed; if the whole array
  // is malformed treat as empty (still a usable summary for match-level).
  let pp = Array.isArray(s.playerProbabilities) ? s.playerProbabilities : [];
  pp = pp.filter((p) =>
    p && typeof p.name === "string" && p.name.trim().length > 0 &&
    isProb(p.firstTryProb) && isProb(p.anytimeProb) && isProb(p.multiTryProb),
  );

  return {
    ...s,
    homeWinProb: h,
    awayWinProb: a,
    drawProb: d,
    playerProbabilities: pp,
  };
}

// TTL by match state (ms).
function ttlForState(matchState: string | undefined): number {
  if (!matchState) return 30 * 60_000;
  if (/^(FullTime|Final|Completed)$/i.test(matchState)) return 7 * 24 * 60 * 60_000;
  if (/InProgress|Live|HalfTime|Post/i.test(matchState)) return 5 * 60_000;
  return 30 * 60_000; // pre-match
}

function weatherTempoModifier(w: WeatherSnapshot | null | undefined): number | undefined {
  if (!w) return undefined;
  // Wet/heavy = negative tempo. Hot/dry calm = mildly positive.
  const wet = (w.precipMm ?? 0) > 4 || /wet|heavy/i.test(w.groundCondition || "");
  if (wet) return -0.6;
  if ((w.windKph ?? 0) > 35) return -0.3;
  return 0.1;
}

// ---------- Cache ----------
async function readCachedSummary(matchId: string): Promise<SimulationSummary | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("simulation_summaries" as never)
      .select("payload, expires_at")
      .eq("match_id" as never, matchId as never)
      .order("generated_at" as never, { ascending: false } as never)
      .limit(1)
      .maybeSingle();
    if (error || !data) { devLog("cache-miss", { matchId }); return null; }
    const row = data as unknown as { payload: SimulationSummary; expires_at: string };
    if (Date.parse(row.expires_at) <= Date.now()) { devLog("cache-expired", { matchId }); return null; }
    const valid = validateSimulation(row.payload);
    if (!valid) { devLog("validation-failed", { matchId, where: "cache" }); return null; }
    devLog("cache-hit", { matchId });
    return valid;
  } catch (e) {
    console.warn("[simulation] readCachedSummary failed:", e);
    return null;
  }
}

async function writeSummary(args: {
  matchId: string;
  summary: SimulationSummary;
  homeNickname: string;
  awayNickname: string;
  modelMode: ModelMode;
  ttlMs: number;
  round?: number;
  season?: number;
}): Promise<void> {
  try {
    const s = args.summary;
    const expiresAt = new Date(Date.now() + args.ttlMs).toISOString();
    const { error } = await supabaseAdmin
      .from("simulation_summaries" as never)
      .insert([{
        match_id: args.matchId,
        home_team: args.homeNickname,
        away_team: args.awayNickname,
        round: args.round ?? null,
        season: args.season ?? null,
        model_mode: args.modelMode,
        iterations: s.iterations,
        seed: s.seed,
        home_win_prob: s.homeWinProb,
        away_win_prob: s.awayWinProb,
        draw_prob: s.drawProb,
        expected_total: s.expectedTotal,
        expected_margin: s.expectedMargin,
        margin_band_1_12: s.marginBands["1-12"],
        margin_band_13_plus: s.marginBands["13+"],
        upset_prob: s.upsetProb,
        blowout_prob: s.blowoutProb,
        confidence: s.confidence,
        source_coverage: s.coverage as never,
        payload: s as never,
        expires_at: expiresAt,
        generated_at: s.generatedAt,
      }] as never);
    if (error) console.warn("[simulation] writeSummary failed:", error.message);
  } catch (e) {
    console.warn("[simulation] writeSummary exception:", e);
  }
}

// ---------- Public entry point ----------
export async function getOrGenerateSimulation(args: {
  matchId: string;
  homeNickname: string;
  awayNickname: string;
  homeSquad: NrlPlayer[];
  awaySquad: NrlPlayer[];
  snapshot: SeasonSnapshot | null;
  modelMode: ModelMode;
  matchState?: string;
  hasOdds?: boolean;
  weather?: WeatherSnapshot | null;
  round?: number;
  season?: number;
  forceRefresh?: boolean;
  // Phase 3 — optional enrichment from normalised data layer.
  normalisedHomeStats?: NormalisedTeamStats | null;
  normalisedAwayStats?: NormalisedTeamStats | null;
  injuries?: NormalisedInjury[] | null;
  officials?: NormalisedMatchOfficial[] | null;
  hasOfficials?: boolean;
  hasNamedTeamLists?: boolean;
}): Promise<SimulationSummary | null> {
  if (!isSimulationEnabled()) { devLog("flag-off"); return null; }
  if (!args.snapshot) return null;
  devLog("flag-on", { matchId: args.matchId, mode: args.modelMode });

  // 1) Cache
  if (!args.forceRefresh) {
    const cached = await readCachedSummary(args.matchId);
    if (cached) return cached;
  } else {
    devLog("force-refresh", { matchId: args.matchId });
  }

  // 2) Generate
  try {
    // Map normalised injuries → simple shape consumed by the feature builder.
    const injuries = (args.injuries ?? [])
      .filter((i) => i && typeof i.name === "string" && i.name.length > 0)
      .map((i) => ({
        name: i.name,
        teamNickname: i.teamNickname,
        status: i.status,
      }));
    const hasOfficials = args.hasOfficials ?? !!(args.officials && args.officials.length > 0);

    const input = buildSimulationInput({
      matchId: args.matchId,
      snapshot: args.snapshot,
      homeNickname: args.homeNickname,
      awayNickname: args.awayNickname,
      homeSquad: args.homeSquad,
      awaySquad: args.awaySquad,
      modelMode: args.modelMode,
      hasOdds: args.hasOdds,
      hasWeather: !!args.weather,
      weatherTempoModifier: weatherTempoModifier(args.weather),
      normalisedHomeStats: args.normalisedHomeStats ?? null,
      normalisedAwayStats: args.normalisedAwayStats ?? null,
      injuries: injuries.length ? injuries : undefined,
      hasOfficials,
      hasNamedTeamLists: args.hasNamedTeamLists,
    });
    const raw = runSimulation(input);
    const summary = validateSimulation(raw);
    if (!summary) { devLog("validation-failed", { matchId: args.matchId, where: "generate" }); return null; }
    devLog("generated", { matchId: args.matchId, confidence: summary.confidence });
    // Fire-and-forget persistence — don't block the page.
    void writeSummary({
      matchId: args.matchId,
      summary,
      homeNickname: args.homeNickname,
      awayNickname: args.awayNickname,
      modelMode: args.modelMode,
      ttlMs: ttlForState(args.matchState),
      round: args.round,
      season: args.season,
    });
    return summary;
  } catch (e) {
    devLog("fallback-used", { matchId: args.matchId });
    console.warn("[simulation] generation failed — falling back to deterministic only:", e);
    return null;
  }
}

// ---------- Market price extraction ----------
// Pulls the best (highest decimal odds) per outcome out of the existing
// OddsEvent / TryscorerMarkets shapes so the value engine can score them.
export function buildMarketPrices(args: {
  odds: OddsEvent | null;
  tryscorers: TryscorerMarkets | null;
  homeNickname: string;
  awayNickname: string;
  totalLine: number;
}): MarketPrices {
  const out: MarketPrices = {};
  if (args.odds) {
    for (const b of args.odds.bookmakers) {
      const h2h = b.markets.find((m) => m.key === "h2h");
      if (h2h) {
        for (const o of h2h.outcomes) {
          const isHome = findTeam(o.name)?.nickname === args.homeNickname;
          if (isHome && (out.homeWin == null || o.price > out.homeWin)) out.homeWin = o.price;
          else if (!isHome && (out.awayWin == null || o.price > out.awayWin)) out.awayWin = o.price;
        }
      }
      const totals = b.markets.find((m) => m.key === "totals");
      if (totals) {
        for (const o of totals.outcomes) {
          if (o.point !== args.totalLine) continue;
          if (o.name?.toLowerCase() === "over" && (out.overAtLine == null || o.price > out.overAtLine)) out.overAtLine = o.price;
          else if (o.name?.toLowerCase() === "under" && (out.underAtLine == null || o.price > out.underAtLine)) out.underAtLine = o.price;
        }
      }
    }
  }
  if (args.tryscorers) {
    out.anytime = {};
    out.firstTry = {};
    out.multiTry = {};
    for (const t of args.tryscorers.anytime ?? []) out.anytime[t.player.toLowerCase()] = t.price;
    for (const t of args.tryscorers.first ?? []) out.firstTry[t.player.toLowerCase()] = t.price;
    for (const t of args.tryscorers.multi ?? []) out.multiTry[t.player.toLowerCase()] = t.price;
  }
  return out;
}
