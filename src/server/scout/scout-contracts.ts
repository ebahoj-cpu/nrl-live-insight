// ============================================================================
// Scout intelligence contracts.
//
// Typed shapes that flow between the Scout service, memory, reasoning, and
// the LLM-facing orchestrator. Everything here is data only — pure types
// plus the Zod schemas used to parse user-supplied pieces (news injections,
// simulate-with-modifiers requests).
// ============================================================================

import { z } from "zod";
import type { ConfidenceTier } from "../confidence";
import type { ModelDriver } from "../model-driver-explainer";
import type { PlayerProbability, SimulationSummary } from "../simulation-types";
import type { ValuePick } from "../value-engine";
import type { MarketPrices } from "../simulation-integration";

// ---------- News injection ------------------------------------------------

export const NewsModifierKindSchema = z.enum([
  "injury",          // player out / doubtful
  "return",          // player back / cleared
  "weather",         // wet, windy, hot
  "venue_change",    // moved match
  "official_change", // referee swap
  "form_shift",      // late-mail momentum/attack/defence note
]);

export const NewsModifierSchema = z.object({
  id: z.string().min(1).max(64),
  kind: NewsModifierKindSchema,
  team: z.string().max(40).optional(),     // nickname when applicable
  matchId: z.string().max(64).optional(),  // scoped to one match if known
  description: z.string().min(1).max(280),
  impact: z.object({
    // All deltas are clamped at apply time; see scout-service.ts.
    expectedPoints: z.number().min(-15).max(15).optional(),    // ± points to expected score
    attack: z.number().min(-0.5).max(0.5).optional(),          // multiplicative adj on attack
    defence: z.number().min(-0.5).max(0.5).optional(),         // multiplicative adj on defence
    tempo: z.number().min(-0.5).max(0.5).optional(),           // multiplicative adj on total
    playerTryRate: z.number().min(-0.6).max(0.6).optional(),   // adj on per-player try probs
    affectedPlayer: z.string().max(80).optional(),
  }),
  createdAt: z.number().int(),             // epoch ms
});

export type NewsModifierKind = z.infer<typeof NewsModifierKindSchema>;
export type NewsModifier = z.infer<typeof NewsModifierSchema>;

// ---------- Simulate-with-modifiers request -------------------------------

export const SimulateWithModifiersInputSchema = z.object({
  matchId: z.string().min(1).max(64),
  modifiers: z.array(NewsModifierSchema).max(20),
});

export type SimulateWithModifiersInput = z.infer<typeof SimulateWithModifiersInputSchema>;

// ---------- Bet suggestion ------------------------------------------------

export type ScoutBetSuggestion = {
  market: ValuePick["market"];
  selection: string;
  team?: string;
  modelProb: number;       // 0..1
  impliedProb: number;     // 0..1
  marketOdds: number | null;
  edgePct: number;         // EV %
  recommendedStake: number;// dollars (fractional Kelly)
  fractionOfBankroll: number;
  confidence: ConfidenceTier;
  rationale: string;
};

// ---------- Match context bundle -----------------------------------------
// What the LLM is allowed to reason from. Numbers come exclusively from the
// existing engines — the LLM never invents probabilities or prices.

export type ScoutMatchContext = {
  match: {
    id: string;
    homeNickname: string;
    awayNickname: string;
    kickoffUtc?: string;
    venue?: string;
    status?: string;
  };
  // Provenance of the simulation block. "monte-carlo" = real cached summary;
  // "perturbed" = monte-carlo summary adjusted by news modifiers; "absent" =
  // no sim available.
  simulation:
    | {
        method: "monte-carlo" | "perturbed";
        iterations: number;
        seed: number;
        expectedHomeScore: number;
        expectedAwayScore: number;
        expectedTotal: number;
        homeWinProb: number;
        awayWinProb: number;
        drawProb: number;
        marginBands: { draw: number; "1-12": number; "13+": number };
        totalLine: number;
        overProbAtLine: number;
        htftProbabilities: Record<string, number>;
        playerProbabilities: PlayerProbability[];
      }
    | { method: "absent"; reason: string };
  calibration: { applied: boolean; method?: string; blendWeight?: number };
  confidence: { tier: ConfidenceTier; reasons: string[] };
  drivers: ModelDriver[];
  profiles: {
    referee?: unknown;
    fatigue?: unknown;
    ruckTempo?: unknown;
    edgeAttack?: unknown;
    momentum?: unknown;
  };
  market: MarketPrices;
  value: ValuePick[];
  bets: ScoutBetSuggestion[];          // EV>0 only, sorted by edge desc
  correlationWarnings: string[];
  modifiersApplied: NewsModifier[];
  dataGaps: string[];                  // explicit "missing market X / no squad named"
  generatedAt: string;
};

// ---------- Turn input (RPC boundary) -------------------------------------

export const ScoutChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

export const ScoutTurnInputSchema = z.object({
  messages: z.array(ScoutChatMessageSchema).min(1).max(40),
  // Reserved — UI doesn't pass this yet, but the orchestrator can derive it.
  sessionId: z.string().max(80).optional(),
});

export type ScoutChatMessage = z.infer<typeof ScoutChatMessageSchema>;
export type ScoutTurnInput = z.infer<typeof ScoutTurnInputSchema>;

// Re-export commonly-needed engine types so callers only import from here.
export type { SimulationSummary, ConfidenceTier, ValuePick, MarketPrices, ModelDriver, PlayerProbability };
