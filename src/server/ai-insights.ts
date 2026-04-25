// AI-generated betting insights via Lovable AI Gateway.
// Uses tool-calling for structured output. Receives ONLY real data summaries.

import { dedupeInsights } from "./dedupe-insights";
import { normaliseInsights } from "./normalise-insights";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
// Use the strongest reasoning model — insights are generated ONCE per match
// and cached until ~1h before kickoff, so the extra latency/cost is paid once
// and the user gets the sharpest possible read for their bets.
const MODEL = "google/gemini-2.5-pro";
const FALLBACK_MODEL = "google/gemini-3-flash-preview";
const TIMEOUT_MS = 55_000; // pro model needs more headroom; still inside Worker budget

export type BettingAngle = {
  market: string;
  pick: string;
  reasoning: string;
  confidence: number;
};


export type BetLeg = {
  pick: string;          // e.g. "Roosters to win"
  decimalOdds: number;   // e.g. 1.45
};

// Unified shape used by EVERY bet card on the Bets tab.
// Each bet has 1-6 legs with real prices, server-computed math, and a "why".
export type BetPlay = {
  category: BetCategoryKey;
  title: string;
  legs: BetLeg[];
  combinedOdds: number;
  estimatedOdds: string;
  stake: string;             // default suggested stake (e.g. "$10") — UI allows override
  potentialReturn: string;   // computed from default stake — UI recomputes on change
  reasoning: string;
  // New fields for the risk-tier slip engine
  hitRateScore?: number;     // 0-100 — how likely the slip is to land (script convergence)
  scriptAlignment?: string;  // 1 short phrase: which simulation lever the slip leans on
  legCount?: number;         // convenience — server-set
};

// Risk tiers — replaces the legacy 11-category bet system.
// Every match produces ONE slip per tier, derived from the unified simulation.
export type BetCategoryKey = "low" | "medium" | "high" | "ultra";

export type GameFlow = {
  openingTen: string;          // who starts hot, who is slow out the blocks
  firstHalf: string;           // 2-3 sentences on how first half plays out
  halftimeScore: { home: number; away: number };
  halftimeLeader: "home" | "away" | "draw";
  secondHalf: string;          // 2-3 sentences on how second half plays out
  momentumSwings: string[];    // 2-4 short bullets: "10-20min: Storm grab early lead", "55min: away comeback"
  halftimeDouble: { pick: string; reasoning: string; confidence: number }; // e.g. "Storm / Storm"
  closing: string;             // final 10 minutes — likely close game, blowout, late try?
};

export type TryscorerScript = {
  home: {
    picks: { name: string; market: "first" | "anytime" | "2+"; price: number | null; reasoning: string }[]; // 3-4
    avoid: { name: string; reasoning: string }[]; // 1-2 trap players to fade this week
  };
  away: {
    picks: { name: string; market: "first" | "anytime" | "2+"; price: number | null; reasoning: string }[]; // 3-4
    avoid: { name: string; reasoning: string }[];
  };
  summary: string; // 2-3 sentences: overall tryscoring read for the match
};


// Match Intelligence — analyst-style breakdown shown on the Insights tab.
// NO betting language. NO probabilities. NO confidence scores. Pure tactical
// + structural read of how the game is likely to unfold and why.
export type TeamProfile = {
  identity: string;          // 1-2 sentences: who they are this season (e.g. "high-tempo, edge-reliant attack with a fragile right edge")
  attackRating: string;      // qualitative: "elite" | "strong" | "above average" | "average" | "below average" | "struggling"
  defenceRating: string;     // same scale
  formRead: string;          // 2-3 sentences: trajectory + quality of opposition + whether form is real or schedule-flattered
  scoringPattern: string;    // 1-2 sentences: how their points typically come (set-piece, broken play, kicks, forwards, edges)
  consistency: string;       // 1 sentence: volatile vs reliable, where the variance shows up
};

export type AttackingStructure = {
  edgeBalance: string;       // 1-2 sentences: left edge vs right edge vs middle distribution
  setPlayVsBroken: string;   // 1-2 sentences: structured set-play scoring vs broken-play / second-phase scoring
  redZoneTendency: string;   // 1-2 sentences: what they do once inside 20m
  forwardVsBacklineTries: string; // 1 sentence: where the tries come from
  primaryPlaymakers: { name: string; role: string; influence: string }[]; // 2-3 named playmakers shaping the attack
};

export type DefensiveWeaknesses = {
  missedTackleZones: string[];    // 1-3 short phrases: where missed tackles cluster
  edgeFragility: string;          // 1-2 sentences: which edge is leaking and why
  lineSpeedRuckIssues: string;    // 1-2 sentences: line speed and ruck defence problems
  positionalMismatches: string[]; // 1-3 short phrases: specific positional liabilities
  pressurePoints: string;         // 1-2 sentences: where the structure breaks down under sustained pressure
};

export type KeyMatchup = {
  area: string;          // e.g. "Right edge attack vs left edge defence" or "Forward pack collisions"
  homeSide: string;      // 1 sentence on what home team brings
  awaySide: string;      // 1 sentence on what away team brings
  edge: "home" | "away" | "even"; // who gains the structural advantage
  why: string;           // 1-2 sentences explaining why
};

export type GameScriptPhase = {
  window: string;        // "First 20" | "Second 20" | "Halftime" | "40-60" | "60-80"
  read: string;          // 1-2 sentences: expected flow in this phase, anchored to specific structural signals
};

export type PlayerInfluencer = {
  name: string;
  team: "home" | "away";
  role: string;          // "Tempo controller" | "Edge finisher" | "Forward momentum" | "Defensive anchor" | "Disruptor" | "Momentum shifter"
  expectedImpact: string;// 1-2 sentences: HOW they will influence this specific game
};

// ---- New analyst-style cards (Insights tab redesign) ----
export type SeasonOverview = {
  record: string;                  // "9W-5L" or "8 wins, 6 losses"
  ladderPosition: string;          // e.g. "4th" or "5th (28pts, +52 diff)"
  pointsDifferential: string;      // e.g. "+52 (PF 348, PA 296)"
  statTrends: string;              // 1-2 sentences: attack, defence, completion rate, errors
  vsTopVsBottom: string;           // 1-2 sentences: form against top half vs bottom half
  homeAwaySplit: string;           // 1-2 sentences: home form vs away form
  formTrajectory: "improving" | "declining" | "inconsistent" | "steady";
  trajectoryNote: string;          // 1 sentence on WHY that trajectory
  identity: string;                // 1-2 sentences: overall identity & playing style
};

export type KeyToVictory = {
  key: string;                     // 1 sentence: the lever (e.g. "Win the right-edge battle")
  targetsWeakness: string;         // 1 sentence: which OPPONENT weakness it attacks
  reasoning: string;               // 1-2 sentences: tactical / statistical justification
};

export type TeamStrength = {
  title: string;                   // short label e.g. "Edge attack volume"
  detail: string;                  // 1-2 sentences: stat / pattern that proves it
  impact: string;                  // 1 sentence: HOW it shapes games
};

export type TeamWeakness = {
  title: string;                   // short label e.g. "Right-edge defensive slide"
  detail: string;                  // 1-2 sentences: specific exploitable flaw
  howToTarget: string;             // 1 sentence: how the opponent attacks it this week
};

export type WatchPlayer = {
  name: string;                    // named squad only
  position: string;                // raw position (e.g. "Winger", "Halfback", "2nd Row")
  bucket: "back" | "half" | "forward"; // 3 backs, 1 half, 1 forward per team
  form: string;                    // 1 sentence: current form
  role: string;                    // 1 sentence: their specific role THIS matchup
  matchup: string;                 // 1 sentence: direct opponent / matchup impact
};

export type MatchIntelligence = {
  matchOverview: string;          // 3-4 sentences: narrative summary of expected game shape
  // NEW analyst cards
  seasonOverview: { home: SeasonOverview; away: SeasonOverview };
  keysToVictoryAnalyst: { home: KeyToVictory[]; away: KeyToVictory[] }; // exactly 3 per side, distinct
  strengths: { home: TeamStrength[]; away: TeamStrength[] };           // exactly 3 per side
  weaknesses: { home: TeamWeakness[]; away: TeamWeakness[] };          // exactly 3 per side
  playersToWatch: { home: WatchPlayer[]; away: WatchPlayer[] };        // 3 backs + 1 half + 1 forward per side
  // existing
  teamProfile: { home: TeamProfile; away: TeamProfile };
  attackingStructure: { home: AttackingStructure; away: AttackingStructure };
  defensiveWeaknesses: { home: DefensiveWeaknesses; away: DefensiveWeaknesses };
  keyMatchups: KeyMatchup[];      // 3-5 distinct matchups
  gameScript: GameScriptPhase[];  // exactly 5 phases in order
  playerInfluence: PlayerInfluencer[]; // 5-8 named influencers across both teams (mix of roles)
  historicalContext: string;      // 2-3 sentences if relevant; can be empty string if not
  contextualFactors: string[];    // 2-4 short bullets: venue, travel, weather, selection changes, momentum from disruptions
  rareEventNote: string;          // 1 sentence ack of low-weight scenario modifiers (sin bin / early injury / blowout) — kept short
  insightSummary: string;         // 2-3 sentences: final tactical takeaway of how the game is likely decided
};

// Match Simulation Engine — drives the Script tab. ONE unified simulation
// produces every market prediction (winner, margin, total, HT/FT, tryscorers).
// All recommended plays + ranked tryscorers MUST be derived from the same
// simulated game script — never analysed in isolation.
export type SimulationProfile = {
  tempo: "fast" | "moderate" | "slow";
  tempoNote: string;                // 1 sentence: WHY this tempo (rucks, kicking exchange, weather)
  dominance: "home" | "away" | "even";
  dominanceNote: string;            // 1 sentence: WHO controls the contest and how
  territoryBalance: string;         // 1 sentence: e.g. "55-45 home — repeat sets through right edge"
  scoringPattern: "early-burst" | "late-burst" | "spread" | "second-half-flood" | "first-half-flood";
  scoringPatternNote: string;       // 1 sentence: when the points come and why
  edgeAttack: { left: "high" | "medium" | "low"; right: "high" | "medium" | "low"; middle: "high" | "medium" | "low"; note: string };
  defensiveZones: string[];         // 2-4 short phrases: where each team's defence is most likely to break
  expectedTotalRange: { low: number; high: number; midpoint: number };
};

export type MarketPlay = {
  market: "match-winner" | "winning-margin" | "total-points" | "ht-ft" | "first-tryscorer" | "anytime-tryscorer" | "2-plus-tries" | "score-anytime-points";
  pick: string;                     // e.g. "Storm to win", "Storm 13+", "Over 44.5", "Storm/Storm", "Munster anytime"
  decimalOdds: number | null;       // bookie price (null if not available — UI hides edge)
  modelProbability: number;         // 0-100 — derived from the simulation
  impliedProbability: number;       // 0-100 — from the bookie price (100/odds), 0 if no price
  edgePct: number;                  // modelProbability - impliedProbability (positive = value)
  confidence: "high" | "medium" | "low";
  rationale: string;                // 1-2 sentences tying back to the simulation
  scriptAlignment: string;          // 1 short phrase: which simulation lever this leans on (e.g. "edge attack right", "second-half flood")
};

export type RankedTryscorer = {
  name: string;
  team: "home" | "away";
  position: string;
  market: "anytime" | "first" | "2+";
  decimalOdds: number | null;
  // Component scores — each 0-100. Final score is weighted blend.
  scores: {
    pais: number;            // Player Attacking Impact (line breaks, busts, metres, assists, form)
    ttcp: number;            // Team Try Creation Profile fit (edge balance, red zone, role)
    matchupExploit: number;  // Defensive weakness against this player's lane
    scriptFit: number;       // How well game script supports this scorer
    value: number;           // Odds inefficiency (model vs implied)
  };
  totalScore: number;        // 0-100 weighted total
  confidence: "high" | "medium" | "low";
  rationale: string;         // 1-2 sentences citing aligned signals (PAIS + matchup + script)
  stackable: boolean;        // True if game script supports stacking with team-mates
};

export type MatchSimulation = {
  profile: SimulationProfile;
  summary: string;                  // 2-3 sentences: the match in one read — what the simulation expects
  recommendedPlays: MarketPlay[];   // 6-10 plays across markets, ranked by edge and script alignment
  rankedTryscorers: RankedTryscorer[]; // 4-8 ranked players, ordered by totalScore desc
  correlatedAngle: string;          // 1-2 sentences: which 2-3 plays correlate (one script supports them all)
  scriptCaveat: string;             // 1 sentence: the scenario that breaks the simulation (sin bin, weather change, key injury)
};

export type Insights = {
  intelligence: MatchIntelligence;
  simulation: MatchSimulation;
  predictedScore: { home: number; away: number };
  winner: { team: "home" | "away"; confidence: number; reasoning: string };
  margin: { value: number; bucket: string; reasoning: string };
  total: { line: number; pick: "over" | "under"; reasoning: string };
  htft: { pick: string; reasoning: string; confidence: number };
  firstTryscorer: { pick: string; reasoning: string };
  anytimeTryscorers: { pick: string; reasoning: string }[];
  multiTryscorer: { pick: string; reasoning: string; confidence: number };
  keysToVictory: { home: string[]; away: string[] };
  keyFactors: string[];
  weaknessExploit: {
    home: {
      opponentWeaknesses: string[];      // exactly 3 specific defensive flaws in the opposition
      targetAreas: string[];             // 1-3 channels / phases / areas to attack
      tacticalPlan: string;              // 2-3 sentences how home team exploits them
      playersToWatch: { name: string; role: string; why: string }[]; // 3 players
    };
    away: {
      opponentWeaknesses: string[];
      targetAreas: string[];
      tacticalPlan: string;
      playersToWatch: { name: string; role: string; why: string }[];
    };
  };
  // All bets live here in one consistent shape — rendered as identical cards on the Bets tab.
  bets: BetPlay[];
  gameFlow: GameFlow;
  tryscorerScript: TryscorerScript;
  script: {
    headToHead: string;
    formAnalysis: string;
    xFactor: string;
    psychological: string;
    milestones: string[];
    bookieScript: {
      wantToWin: string;
      wantToLose: string;
      liability: string;
    };
    matchFix: {
      preferredWinner: string;     // team the NRL "wants" to win and why (ratings, finals race, marquee market)
      ratingsAngle: string;        // 2-3 sentences: how the broadcast script wants the game to flow
      refereeNudges: string[];     // 3-5 cheeky bullets — penalty counts, captain's challenges, bunker calls
      narrativeMoment: string;     // the storyline beat the NRL is engineering (return game, milestone try, comeback)
      conspiracyRating: number;    // 0-100 tongue-in-cheek "how scripted does this feel?" meter
    };
  };
};

export type RealOdds = {
  h2h: { home: { price: number; book: string } | null; away: { price: number; book: string } | null };
  totals: { line: number; over: number; under: number; book: string }[]; // best lines
  spreads: { line: number; homePrice: number; awayPrice: number; book: string }[];
  tryscorers: {
    first: { player: string; price: number }[];
    anytime: { player: string; price: number }[];
    multi: { player: string; price: number }[]; // 2+ tries
  };
};

export async function generateInsights(payload: {
  homeName: string;
  awayName: string;
  venue: string;
  homeRecentForm: { result: string; summary: string; score: string }[];
  awayRecentForm: { result: string; summary: string; score: string }[];
  homePosition?: string;
  awayPosition?: string;
  homeSquad: { firstName: string; lastName: string; position: string; isCaptain?: boolean }[];
  awaySquad: { firstName: string; lastName: string; position: string; isCaptain?: boolean }[];
  ladder: { nickname: string; played: number; wins: number; losses: number; for: number; against: number; diff: number; points: number }[];
  oddsSummary: string;
  realOdds?: RealOdds;
  weatherSummary?: string;
}): Promise<Insights> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const homeRow = payload.ladder.find((l) => l.nickname === payload.homeName);
  const awayRow = payload.ladder.find((l) => l.nickname === payload.awayName);

  const fmtSquad = (s: typeof payload.homeSquad) =>
    s.map((p) => `${p.position}: ${p.firstName} ${p.lastName}${p.isCaptain ? " (C)" : ""}`).join("; ") || "n/a";

  // Build a precise real-odds block — the AI MUST quote these prices exactly,
  // not invent fictional ones. This is what's been wrong vs TAB.
  const realOddsBlock = buildRealOddsBlock(payload.realOdds, payload.homeName, payload.awayName);

  const prompt = [
    `Match: ${payload.homeName} (home) vs ${payload.awayName} (away) at ${payload.venue}.`,
    homeRow ? `${payload.homeName}: ${homeRow.wins}W-${homeRow.losses}L, PF ${homeRow.for}, PA ${homeRow.against}, diff ${homeRow.diff}, pos ${payload.homePosition ?? "?"}.` : "",
    awayRow ? `${payload.awayName}: ${awayRow.wins}W-${awayRow.losses}L, PF ${awayRow.for}, PA ${awayRow.against}, diff ${awayRow.diff}, pos ${payload.awayPosition ?? "?"}.` : "",
    `${payload.homeName} named squad (NRL.com official): ${fmtSquad(payload.homeSquad)}`,
    `${payload.awayName} named squad (NRL.com official): ${fmtSquad(payload.awaySquad)}`,
    `Home recent form: ${payload.homeRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Away recent form: ${payload.awayRecentForm.map((f) => `${f.result} ${f.summary} ${f.score}`).join("; ") || "n/a"}`,
    `Live AU bookie odds summary: ${payload.oddsSummary}`,
    realOddsBlock,
    payload.weatherSummary ? `Forecast at venue at kickoff: ${payload.weatherSummary}` : "",
    `You are writing for a sharp NRL bettor. Output FEWER, BETTER, SHARPER insights — not more text. Every line you produce must pass this test: "If this insight was removed, would the user lose meaningful betting value?" If no, do NOT write it.

GLOBAL INSIGHT RULES (apply to EVERY field, every section):
1. UNIQUE — never restate the same idea twice. No paraphrased duplicates. If two sections would say "team X is in good form", only the strongest version survives, and it must add WHY that form is or isn't reliable for THIS bet.
2. EVIDENCE-BASED — every insight must cite something concrete from the data above: a stat (W-L, PF, PA, diff, ladder pos), a recent-form scoreline, a named squad player, a bookie price, a weather signal. No floating opinions.
3. CONTEXTUAL — explain why it matters for THIS specific game, not as a generic team summary.
4. DECISION-RELEVANT — must change a bet decision (winner, margin bucket, total, HT/FT, tryscorer market, line shopping, stake sizing).
5. NON-OBVIOUS — skip surface-level reads the user can already infer (e.g. "the favourite is favoured", "tries usually come from wingers").
6. ASYMMETRIC — never produce mirror-image content for both teams. If a key, weakness, or tactical plan reads identical with names swapped, REWRITE both sides so they target different channels, different phases, different named players, different markets.

SECTION DIFFERENTIATION (each section serves a DIFFERENT purpose — overlap is forbidden):
- script.headToHead: rivalry / venue history pattern only. NOT current form.
- script.formAnalysis: trajectory + quality of opposition faced + whether form is real or schedule-inflated. Must include a "form is misleading because…" angle when applicable. NOT rivalry. NOT player picks.
- script.xFactor: ONE single swing variable (one named player OR one matchup OR one tactical lever). Must NOT repeat anything from formAnalysis.
- script.psychological: external pressure / occasion / venue mentality only. NOT form, NOT rivalry trends.
- keysToVictory: 3 levers per team. Each side's 3 keys must use DIFFERENT levers (set-piece attack vs defensive structure vs game management). Cannot repeat what xFactor or weaknessExploit already said.
- weaknessExploit: defensive flaws of the OPPOSITION + how to attack them. Tied to specific markets that benefit. Must NOT restate keysToVictory.
- keyFactors: meta-level swing factors NOT covered above (referee tendencies, travel, late-mail risk, market movement, weather impact translated to a market). Cap at 3-4. If a candidate factor was already implied above, drop it.
- gameFlow: time-window-pinned predictions only (opening 10, halves, momentum swings at specific minute marks). NOT generic "team X is better" — every bullet must reference a window AND tie to an HT/FT or live-betting angle.
- tryscorerScript: per-player tryscoring rationale. Must cite role/edge/set-piece usage. Avoid players who only profile generically — pick spots where the matchup actually creates the chance.
- bets: market construction only. Reasoning must reference WHICH upstream insight (xFactor / weaknessExploit / gameFlow / bookieScript) the bet leans on, and WHY the market is mispriced or aligned.

ANTI-REPETITION ENFORCEMENT:
- Before finalising any string, scan everything you have written. If two strings share the same core point (≥60% semantic overlap), KEEP the strongest version and rewrite the other to add new information or DELETE it (drop array items rather than dilute).
- Never restate ladder position, W-L record, or recent-form summary in more than one section.
- Never repeat a player's name across keysToVictory + weaknessExploit.playersToWatch + tryscorerScript with the SAME reason. If the same player appears, each mention must justify a DIFFERENT market.

INSIGHT QUALITY BAR (examples):
- BAD: "Storm are a strong attacking team."
- GOOD: "Storm rank top-3 in red-zone conversion but face the league's #1 goal-line defence — anytime tryscorer prices on Storm outside backs are shorter than the matchup justifies; lean unders on Storm individual try lines."
- BAD: "Raiders are in good form."
- GOOD: "Raiders' 4-from-5 was built against opponents averaging 12th on the ladder; their h2h price is shorter than that schedule warrants — fade the favourite multi, take the underdog covering on +12.5."
- BAD: "Rain may affect the game."
- GOOD: "Forecast 4mm rain compresses attacking width and rewards middle-dominant packs — value lives on UNDER the main total and on forward anytime tries (named: <player>) over outside-back markets."

That is the minimum standard for EVERY string you emit.

Now produce the structured payload below. Be concise: one strong sentence beats three weak ones.

==============================================================================
TOP PRIORITY — produce an "intelligence" object (the Insights tab core).
==============================================================================
This is a MATCH INTELLIGENCE engine. It is NOT a betting tips engine. The
"intelligence" object is read by users who want to understand HOW the match
will unfold, WHY it will unfold that way, WHICH players and structures will
influence the outcome, and WHERE scoring and momentum shifts are most likely
to occur. Tone = blend of coaching analysis + sports journalism + data-driven
briefing.

HARD RULES for the entire "intelligence" object:
- NO betting language ("value", "price", "lean", "fade", "multi", "anytime
  tryscorer market", "stake", "payout", "covers", "the line", "odds",
  "favourite/underdog" framing). Talk about teams and structures, not markets.
- NO confidence scores, percentages, probabilities.
- NO full squad listings — only NAMED individual influencers when relevant.
- Every observation must tie back to GAME STRUCTURE (attacking shape,
  defensive structure, ruck speed, edge connection, kicking game, set-piece,
  field position, fatigue cycle), not opinion.
- ASYMMETRIC across the two teams — never mirror content with names swapped.
- EVIDENCE-BASED — cite real squad players, recent-form scorelines, ladder
  position, weather signal, venue. Never invent stats.

Produce these intelligence fields:

1. matchOverview (Card 1): 3-4 sentences. Narrative summary of expected game
   shape. Reference current ladder positions, points differential, what is at
   stake (finals push, must-win, rivalry, bounce-back), recent form (last 3-5
   results), venue impact / home-ground edge, and a brief stylistic matchup
   line.

1A. seasonOverview.home AND seasonOverview.away (Cards 2 & 3):
    - record: precise W-L (e.g. "9W-5L").
    - ladderPosition: e.g. "4th (28pts, +52 diff)" or "5th".
    - pointsDifferential: e.g. "+52 (PF 348, PA 296)".
    - statTrends: 1-2 sentences on attack, defence, completion rate, errors.
    - vsTopVsBottom: 1-2 sentences on form against top half vs bottom half.
    - homeAwaySplit: 1-2 sentences on home vs away record split.
    - formTrajectory: one of "improving" | "declining" | "inconsistent" | "steady".
    - trajectoryNote: 1 sentence on WHY (cite quality of opposition, scoreline
      pattern, structural change).
    - identity: 1-2 sentences on overall identity & playing style.
    The two side blocks MUST be asymmetric — never mirror with names swapped.

1B. keysToVictoryAnalyst.home AND keysToVictoryAnalyst.away (Cards 4 & 5):
    EXACTLY 3 keys per side. Each key is matchup-based and references a
    SPECIFIC weakness of the OPPONENT. Each key has:
    - key: 1 sentence stating the lever (e.g. "Win the right-edge battle").
    - targetsWeakness: 1 sentence naming the specific opposition weakness
      it attacks.
    - reasoning: 1-2 sentences with tactical or statistical justification.
    The two sides' keys must use DIFFERENT levers and target DIFFERENT
    weaknesses. No mirror content.

1C. strengths.home AND strengths.away (Cards 6 & 7):
    EXACTLY 3 proven strengths per side. Each:
    - title: short label (e.g. "Edge attack volume", "Goal-line defence").
    - detail: 1-2 sentences citing a season trend or stat that PROVES it.
    - impact: 1 sentence on HOW it shapes games.

1D. weaknesses.home AND weaknesses.away (Cards 8 & 9):
    EXACTLY 3 exploitable weaknesses per side. Each:
    - title: short, SPECIFIC label (e.g. "Right-edge defensive slide",
      "Slow starts", "Discipline in own half"). NEVER generic.
    - detail: 1-2 sentences citing the specific evidence.
    - howToTarget: 1 sentence on HOW the OPPONENT THIS WEEK attacks it.

1E. playersToWatch.home AND playersToWatch.away (Cards 10 & 11):
    EXACTLY 5 players per side, ALL from the named squad above:
    - 3 backs (bucket "back") — fullback / wingers / centres
    - 1 half (bucket "half") — halfback or five-eighth
    - 1 forward (bucket "forward") — prop / hooker / 2nd row / lock
    For EACH: name, position (raw e.g. "Winger"), bucket, form (1 sentence
    on current form), role (1 sentence on THIS specific matchup), matchup
    (1 sentence naming the direct opponent or matchup impact). NEVER invent
    players — squad members only.


2. teamProfile.home and teamProfile.away (each):
   - identity: 1-2 sentences on who they are this season (e.g. "high-tempo,
     edge-reliant attack with a fragile right-edge defence").
   - attackRating: one of "elite" | "strong" | "above average" | "average" |
     "below average" | "struggling".
   - defenceRating: same scale.
   - formRead: 2-3 sentences on trajectory + quality of opposition faced +
     whether form is real or schedule-inflated.
   - scoringPattern: 1-2 sentences on HOW their points typically come
     (set-piece structure, broken-play, kicks, forwards, edges).
   - consistency: 1 sentence on volatile vs reliable and where variance shows.

3. attackingStructure.home and attackingStructure.away (each):
   - edgeBalance: 1-2 sentences on left edge vs right edge vs middle distribution.
   - setPlayVsBroken: 1-2 sentences on structured vs broken-play / second-phase scoring.
   - redZoneTendency: 1-2 sentences on what they do once inside 20m.
   - forwardVsBacklineTries: 1 sentence on where the tries come from.
   - primaryPlaymakers: 2-3 NAMED squad players who shape the attack with
     {name, role, influence (1 sentence)}.

4. defensiveWeaknesses.home and defensiveWeaknesses.away (each):
   - missedTackleZones: 1-3 short phrases on where missed tackles cluster.
   - edgeFragility: 1-2 sentences on which edge leaks and why.
   - lineSpeedRuckIssues: 1-2 sentences on line speed / ruck defence problems.
   - positionalMismatches: 1-3 short phrases on specific positional liabilities.
   - pressurePoints: 1-2 sentences on where structure breaks under sustained pressure.

5. keyMatchups: 3-5 distinct matchups, each with {area, homeSide (1 sentence),
   awaySide (1 sentence), edge ("home"|"away"|"even"), why (1-2 sentences)}.
   Cover a mix: edge-vs-edge, forward-pack vs forward-pack, spine-vs-spine,
   kicking-game-vs-back-three. Each matchup must target a DIFFERENT structural
   area — no overlap.

6. gameScript: EXACTLY 5 phases, in order, with {window, read (1-2 sentences)}:
   - "First 20" — opening tempo, early territory battle, initial pressure patterns.
   - "Second 20" — settling phase, structural dominance begins to appear.
   - "Halftime" — expected score shape and momentum state.
   - "40-60" — fatigue phase, defensive breakdown risk increases.
   - "60-80" — closing phase, game control, momentum swings or consolidation.
   Each "read" must reference a structural signal (ruck speed, completion
   battle, bench impact, kicking exchange, edge fatigue) — not generic
   "team X is better".

7. playerInfluence: 5-8 NAMED influencers across BOTH teams (mix of roles).
   Each: {name (from the named squad above), team ("home"|"away"), role (one
   of: "Tempo controller", "Edge finisher", "Forward momentum", "Defensive
   anchor", "Disruptor", "Momentum shifter"), expectedImpact (1-2 sentences
   on HOW they will influence THIS specific game)}. Do NOT list full squads
   — only the genuine influencers.

8. historicalContext: 2-3 sentences ONLY if recent H2H / venue history
   reveals a repeated tactical pattern. If nothing meaningful, return "".

9. contextualFactors: 2-4 short bullets on venue, travel, weather impact on
   tempo and scoring, selection changes, and momentum shifts from lineup
   disruptions. Each bullet 1 sentence.

10. rareEventNote: 1 short sentence acknowledging low-weight scenario
    modifiers (early injury, sin bin, blowout). Kept brief — these are
    modifiers, not predictions.

11. insightSummary: 2-3 sentences on the FINAL tactical takeaway — how this
    game is most likely decided. This is the "if you read nothing else" line.

==============================================================================
SECONDARY OUTPUTS (kept for the other tabs — Bets, Script, etc.)
==============================================================================

CRITICAL — every insight in the secondary outputs below must serve a BETTOR reading this to land bets. Tie every observation to a specific market: who wins, who covers, who scores, when momentum swings, where the value sits.

Now produce 3 specific "keys to victory" for EACH team. These MUST be DIFFERENT for each team — NOT mirror images. Each team's keys are based on THEIR OWN strengths and HOW THEY can beat THIS specific opponent. Reference real squad players by name, real recent form trends, real opposition weaknesses, and real weather/ground impact. NEVER produce keys that are literally the same point with team names swapped (e.g. "Win the kick-and-chase so X start sets in their own half" used for both sides — that is forbidden). Each key should pick a different lever: e.g. one about set-piece attack from a specific named player, one about defensive structure exploiting a specific opposition weakness, one about game-management (kicking, ruck speed, completion).

Then produce a deep "script" with these distinct sections:
- headToHead: 3-5 sentences. Recent H2H meetings, score trends, venue history at THIS ground, who has owned the rivalry lately, and any tactical pattern that has decided recent matchups.
- formAnalysis: 3-5 sentences. Compare last-5 trajectories (improving / sliding / patchy), attack vs defence ratings, points-for and points-against trend, quality of opposition faced, and whether form is real or schedule-inflated.
- xFactor: the single biggest swing variable — usually one player, one matchup, or one tactical lever — and what specifically tips the game when it fires.
- psychological: 4-6 sentences. Cover ladder positioning pressure (top-4 chase, finals must-win, wooden-spoon avoidance), occasion (Anzac Round, Magic Round, Heritage Round, grand-final rematch, derby, retirement game), expected sell-out / crowd energy, recent emotional peaks (big wins, blow-out losses, coach pressure, off-field drama), home vs away mentality of each side this season, and stadium "voodoo" (sides that don't win at this venue, sides that can't lose at this venue, weather omens).
- milestones: 1-4 individual milestones approaching for either side (games, tries, points, coaching games).

Also produce a "bookieScript": from a sharp Australian bookmaker's perspective, which result/outcome they WANT to land (limits liability, public is on the other side), which result they want to AVOID (heavy public liability), and a one-sentence summary of where their book is most exposed.

ALSO produce a "matchFix" — a tongue-in-cheek "how the NRL would script this game for ratings/money" read. Be playful and clearly satirical (not a real accusation), but anchor it in genuine commercial logic — TV ratings, prime-time market (Sydney/Brisbane/Melbourne), finals race implications, marquee player storylines, sponsor angle, attendance, and the league office's preferred narrative.
- preferredWinner: which side V'landys / the broadcast would quietly prefer to win, and the commercial reason (e.g. "Storm — keeps Melbourne market engaged for finals push").
- ratingsAngle: 2-3 sentences on the broadcast's dream script — close margin into the last 10? blowout for a marquee? a comeback? Tie it to ratings.
- refereeNudges: 3-5 cheeky bullets on the "lean" — penalty count direction, captain's-challenge timing, bunker leniency on a marquee scorer, six-again calls in key sets, late-game obstruction call. Keep it cheeky / wink-wink, not malicious.
- narrativeMoment: the single storyline the NRL is engineering — return game, milestone try, coach-on-the-brink, retiring legend, debutant fairytale.
- conspiracyRating: 0-100 "how scripted does this feel?" meter (most matches sit 30-60 — a marquee finals race or grand-final rematch can sit higher).


ALSO produce a "weaknessExploit" for EACH team. The two teams' exploit blocks MUST be DIFFERENT — they target different channels, different phases, different named players, because the two opponents have genuinely different defensive profiles. Do NOT produce mirror-image content with names swapped. For each side identify:
- opponentWeaknesses: an array of EXACTLY 3 distinct, specific defensive flaws in the OPPOSITION based on recent form / known matchup data. Each one a concrete short phrase, e.g. "Right-edge defence leaking tries — missed tackle % at left centre", "Ruck speed drops sharply in second half", "Vulnerable under high bombs on left wing", "Slow line-speed against shape plays from scrum". The home team's "opponentWeaknesses" describe the AWAY team's flaws; the away team's "opponentWeaknesses" describe the HOME team's flaws — and these should NOT overlap unless both sides genuinely share the same flaw.
- targetAreas: an array of 1-3 specific channels / phases / parts of the field to attack — e.g. "Right edge 20m channel", "Inside ball off the ruck", "Bomb contests on the left wing", "Short side from scrum". Make these concrete and asymmetric across the two teams.
- tacticalPlan: 2-3 sentences on HOW this team weaponises those weaknesses — shape, ball-runners, kicking game, set-piece. Tie directly to BETTING value (which markets light up if this plan hits — e.g. "boosts our anytime tryscorer for [name] and over 22.5 first-half points").
- playersToWatch: exactly 3 NAMED squad players from THIS team most likely to score or directly influence scoring against those weaknesses — for each give role and a one-sentence why. Use only players from the named squad above.

ALSO produce a "gameFlow" object — a quarter-by-quarter script of how the match likely unfolds:
- openingTen: 1-2 sentences. Who starts hot, who is slow out the blocks, early field-position battle, opening kick chase.
- firstHalf: 2-3 sentences on how the first 40 mins plays out — completion battle, who scores first, set-piece tries, defensive lapses.
- halftimeScore: realistic { home, away } prediction. Should roughly match the predictedScore final but split sensibly across halves.
- halftimeLeader: "home", "away", or "draw" based on halftimeScore.
- secondHalf: 2-3 sentences on the second 40 — bench impact, kicking game in the wet/dry, who tires, late surge.
- momentumSwings: 2-4 short bullets pinned to time windows e.g. "10-20min: Storm grab early lead through Munster shape", "55min: Eels mount comeback off back-to-back sets", "70min: Roosters ice it through field goal".
- halftimeDouble: a HT/FT pick like "Storm / Storm" or "Draw / Storm" with reasoning and confidence 0-100. Mix in cross-overs (Draw/X or AwayHT/HomeFT) when the script supports it — don't always default to favourite/favourite.
- closing: 1-2 sentences on the final 10 — close finish, blowout, late try cover, golden point territory?

ALSO produce a "tryscorerScript" — a focused tryscoring read for both teams:
- For EACH team, pick 3-4 tryscorer plays from the named squad. Pull the price directly from the LIVE BOOKIE ODDS block (anytime / first / 2+) — set price to that exact number, otherwise null. Each pick has: name (named squad only), market ("first" | "anytime" | "2+"), price (number from real odds, or null if not yet listed), reasoning (1-2 sentences citing form, opposition weakness, attacking shape, set-piece role, kick-chase). Spread the picks across edge (wing/centre), middle (back-row/lock crash), and spine (fullback/half) where the matchup supports it. Don't pick all from the favourite — go where the tries actually land.
- For EACH team also list 1-2 "avoid" players — trap names the public will pile into who are poor value this week (out of form, bad matchup, used as decoy, not getting touches). Each with a 1-sentence reason.
- summary: 2-3 sentences on the overall tryscoring picture — total tries expected, which edge leaks, who carries the kicking game.

FINALLY, generate the "bets" object — EXACTLY FOUR betting slips, one per risk tier (low, medium, high, ultra). Every slip MUST be a same-game multi derived from the SAME unified match simulation you produced for the simulation block. The slip engine prioritises HIT RATE (win frequency) — not maximum payout optimisation. Slips are converged consensus picks across script + PAIS + TTCP + matchup + value, NOT padded for fake odds.

CORE RULES — every tier:
- Each leg must be supported by AT LEAST one of: the simulation profile, a ranked tryscorer (PAIS/TTCP/matchupExploit/scriptFit), a recommendedPlay with positive edge, or the weaknessExploit / gameFlow analysis.
- Same-game multi correlation must be moderate (not strict, not loose). Stronger script = tighter correlation; weaker script = slightly more diversified legs.
- NEVER include contradictory legs (e.g. "home to win" + "away leads at half" without supporting HT/FT). NEVER duplicate logical markets (e.g. winner + winning-margin where the margin already implies the winner — pick ONE).
- Quote LIVE BOOKIE ODDS prices EXACTLY for any leg that matches a listed market.
- combinedOdds MUST equal product(legs) within ±5%.
- Default stake is "$10" per slip — the user can override in the UI.
- Each slip records 'hitRateScore' (0-100, where 100 = simulation strongly converges on every leg) and 'scriptAlignment' (one short phrase naming the simulation lever, e.g. "second-half flood + dominant right-edge").
- NEVER force bets in low-confidence games — if the simulation does not support the tier, drop a leg rather than reach. Lower legCount + cleaner picks > more legs + weak picks.
- Build the slips so the implied combined odds make sense for the tier (LOW lands often / smaller payout, ULTRA rare hit / large payout). Do NOT artificially inflate odds.

TIER SPECIFICATIONS:

1. low (LOW RISK — high hit rate, modest payout):
   - 2-3 legs total.
   - Match outcomes + totals only. Optionally ONE high-confidence player prop max (anytime tryscorer with strong PAIS/TTCP/matchup convergence, price ~1.60-2.30).
   - Focus: safe favourites, high-probability outcomes, concentrated convergence.
   - Target combined odds: roughly 2.5-6.

2. medium (MEDIUM RISK — balanced):
   - 3-6 legs (script-adjusted: drop a leg if the script is weak).
   - Balanced mix: match outcome + 1-2 totals/margins + 1-2 player props (anytime tryscorers).
   - Focus: structured value with moderate upside — every leg passes the convergence test.
   - Target combined odds: roughly 6-25.

3. high (HIGH RISK — correlated aggression):
   - 4-7 legs (script-adjusted).
   - Even mix of match outcomes and player props (including anytime tryscorers, optionally one 2+ tries leg if script supports stacking).
   - Focus: aggressive correlation — every leg points to the SAME script (e.g. dominant team + their margin bucket + their edge tryscorer + their forward-pack 2+ tries when script is "second-half flood").
   - Target combined odds: roughly 25-150.

4. ultra (ULTRA HIGH RISK — extreme variance):
   - 6-10+ legs (script-adjusted; minimum 6).
   - Match-outcome focused: big margins, upsets, extreme totals, HT/FT crosses, multiple 2+ tries legs.
   - Minimal or no reliance on standard anytime tryscorer props — lean on rarer, longer-priced outcomes.
   - Focus: high variance, extreme scenario alignment.
   - Target combined odds: 150+ (no hard cap — let the script dictate).

CRITICAL betting & ODDS-MATH rules:
- USE THE EXACT REAL ODDS PROVIDED ABOVE for h2h, totals, anytime/first/2+ tryscorer markets when the leg matches.
- For markets not in the block (margin buckets, HT/FT, try-count buckets), use realistic AU prices: margin "1-12" ~$1.80-2.20, "13+" ~$1.70-2.10, "1-6" ~$3-4, "7-12" ~$3.50-4.50, "13-24" ~$3-4, "25+" ~$5-9; HT/FT same team ~$2.20-3.50; HT/FT cross ~$8-15; "2+ tries" player-dependent ~$4-15; "3+ tries" ~$15-50.
- DO NOT use handicap / line / spread markets — use winning-margin BUCKETS only.
- Player try markets must use "anytime tryscorer", "first tryscorer", or "2+ tries" / "3+ tries" — NEVER "over 0.5".
- combinedOdds MUST equal the PRODUCT of all leg decimalOdds (within ±5%).
- NEVER invent players — only named squad members above. Prefer players that appear in LIVE BOOKIE ODDS.
- Each slip's 'reasoning' is 2-3 sentences citing the simulation lever, named players, and which markets converge — explain WHY the slip lands AND what would break it.
- Each slip's 'title' is short and informative: e.g. "Storm dominance — 3-leg safe build", "High-correlation right-edge stack", "Ultra: scoring-flood scenario".

The four bets MUST share script DNA — they are different RISK appetites on the SAME match simulation, not four unrelated slip ideas.

==============================================================================
SCRIPT TAB — UNIFIED MATCH SIMULATION ENGINE (HIGH PRIORITY)
==============================================================================
Produce a "simulation" object that powers the Script tab. This is a UNIFIED
match-simulation engine: you simulate ONE match, then derive EVERY market
prediction from that same simulation. Markets are NOT analysed in isolation.
The simulation drives winner, margin, total, HT/FT, anytime tryscorers,
2+ tries, first tryscorer — all consistent with the same script.

CORE PRINCIPLE — the simulation feeds everything. If your simulated profile
says "second-half flood, dominant right-edge attack", then the recommended
plays MUST lean into that (e.g. over the total + right-edge tryscorer +
HT-away/FT-home if the underdog leads at the break). Every play declares
WHICH simulation lever it leans on (scriptAlignment).

Produce these simulation fields:

1. profile — the simulated game shape:
   - tempo: "fast" | "moderate" | "slow" (tied to ruck speed, kicking exchange, weather)
   - tempoNote: 1 sentence on WHY (cite real signal: weather / squad mobility / recent style)
   - dominance: "home" | "away" | "even"
   - dominanceNote: 1 sentence on HOW (cite a specific structural edge)
   - territoryBalance: 1 sentence e.g. "55-45 home — repeat sets through right edge after 50 mins"
   - scoringPattern: "early-burst" | "late-burst" | "spread" | "second-half-flood" | "first-half-flood"
   - scoringPatternNote: 1 sentence on WHEN points come and why (fitness, bench, edge fatigue)
   - edgeAttack: { left, right, middle each one of "high"|"medium"|"low", note (1 sentence) }
   - defensiveZones: 2-4 short phrases naming where each side's defence breaks (be team-specific)
   - expectedTotalRange: { low, high, midpoint } — total points band the simulation expects

2. summary — 2-3 sentences: the match in one analyst read.

3. recommendedPlays — 6-10 cross-market plays, ordered by edgePct desc.
   Cover a MIX of markets (winner, margin, total, HT/FT, anytime tryscorer,
   2+ tries, first tryscorer). For EACH play:
   - market (one of the enum values listed in the schema)
   - pick (clear human-readable e.g. "Storm to win", "Storm 13+ margin", "Over 44.5 total points", "Storm/Storm HT/FT", "Munster anytime tryscorer", "Hughes 2+ tries", "Coates first tryscorer")
   - decimalOdds (use the EXACT real bookie price from LIVE BOOKIE ODDS when listed; null if not)
   - modelProbability (0-100, derived from your simulation — NOT the bookie price)
   - impliedProbability (0-100 — round(100/decimalOdds, 1); 0 if no price)
   - edgePct (modelProbability - impliedProbability — positive = value, negative = avoid)
   - confidence ("high" | "medium" | "low") — based on signal convergence
   - rationale: 1-2 sentences tying back to the simulation profile
   - scriptAlignment: 1 short phrase naming the simulation lever (e.g. "second-half flood", "right-edge attack", "underdog dominance window 40-60min")
   Include at least one negative-edge play marked low confidence (a trap to AVOID), so the user sees which markets the model fades.

4. rankedTryscorers — 4-8 named players (from named squads), ordered by
   totalScore desc. For EACH player:
   - name (named squad only)
   - team ("home" | "away")
   - position
   - market ("anytime" | "first" | "2+") — the BEST market for THIS player
   - decimalOdds (EXACT from LIVE BOOKIE ODDS for that market; null if not)
   - scores object with each component 0-100:
     * pais — Player Attacking Impact (line breaks, busts, metres, assists, last 3-5 game form)
     * ttcp — Team Try Creation Profile fit (edge balance, red-zone usage, role chain)
     * matchupExploit — opposition defensive weakness against this player's lane
     * scriptFit — game script alignment (tempo, dominance, scoring pattern)
     * value — odds inefficiency: model probability vs implied. 100 = huge value, 50 = fair, 0 = badly overbet.
   - totalScore: 0-100 — weighted blend (PAIS 30%, TTCP 20%, matchup 20%, scriptFit 20%, value 10%)
   - confidence ("high" | "medium" | "low") — high requires 4-of-5 components above 60
   - rationale: 1-2 sentences naming convergent signals
   - stackable: true if script supports multiple scorers from this player's team
   ONLY include players supported by multiple aligned signals.

5. correlatedAngle — 1-2 sentences identifying which 2-3 of the recommended
   plays SHARE the same script (e.g. "If the second-half flood lands, over 44.5 + Storm 13+ + Coates anytime all hit together — same simulation").

6. scriptCaveat — 1 sentence on the scenario that breaks the simulation
   (early sin bin, late weather change, key spine injury, blowout flip).

HARD RULES for the simulation block:
- All recommendedPlays AND rankedTryscorers MUST be consistent with profile + summary.
- modelProbability is YOUR number, NOT the implied price.
- USE EXACT bookie prices from LIVE BOOKIE ODDS where listed.
- Tryscorer scores must be honest — explicit weak components are fine.
- Stack only when the simulation supports it (same edge / same scoring window).`,

  ].filter(Boolean).join("\n");

  const toolDef = buildToolDef();
  const messages = [
    { role: "system", content: "You are a sharp NRL betting analyst writing for serious punters. Behave like a professional analyst, NOT a content generator. PRINCIPLES: (1) Every insight must be unique, evidence-based, contextual, decision-relevant, and non-obvious — if removing it costs no betting value, do not write it. (2) Never produce mirror-image content for the two teams; asymmetry is mandatory. (3) Never repeat the same point across sections; each section has a distinct purpose. (4) Prefer one sharp insight over three weak ones — fewer, better, sharper. (5) Use ONLY the data provided — never invent stats, players, or odds. When real bookie odds are provided, quote them EXACTLY. (6) Tie every observation to a specific betting market (h2h, margin bucket, total, HT/FT, anytime/first/2+ tryscorer). You MUST respond by calling emit_insights exactly once with one argument named payload — a raw JSON string for the insights object. No markdown, no code fences. Be terse in prose fields." },
    { role: "user", content: prompt },
  ];

  // Try the Pro model first for the best analysis. If it fails (timeout, rate
  // limit, parse error), retry once with the fast Flash model. Only after both
  // miss do we fall back to the deterministic local summary.
  // Pipeline: AI -> applyRealOdds (real prices) -> dedupeInsights (anti-repetition)
  // -> normaliseInsights (backfill missing fields to fixed counts so cards never
  // render half-empty) -> normaliseBetMath (recompute combined odds + payouts).
  const finish = (parsed: Insights) =>
    normaliseBetMath(
      normaliseInsights(
        dedupeInsights(applyRealOdds(parsed, payload.realOdds, payload.homeName, payload.awayName)),
        payload.homeName,
        payload.awayName,
      ),
    );
  try {
    const parsed = await callGateway(key, MODEL, messages, toolDef, TIMEOUT_MS);
    return finish(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`AI insights: ${MODEL} failed (${msg}); retrying with ${FALLBACK_MODEL}`);
    try {
      const parsed = await callGateway(key, FALLBACK_MODEL, messages, toolDef, 15_000);
      return finish(parsed);
    } catch (e2) {
      const msg2 = e2 instanceof Error ? e2.message : String(e2);
      console.warn(`AI insights: ${FALLBACK_MODEL} also failed (${msg2}); using local fallback`);
      return finish(buildFallbackInsights(payload));
    }
  }
}

function buildRealOddsBlock(realOdds: RealOdds | undefined, home: string, away: string): string {
  if (!realOdds) return "";
  const lines: string[] = ["", "LIVE BOOKIE ODDS (real AU prices — use these exactly when a leg matches):"];
  if (realOdds.h2h.home || realOdds.h2h.away) {
    const h = realOdds.h2h.home ? `${home} $${realOdds.h2h.home.price.toFixed(2)} (${realOdds.h2h.home.book})` : `${home} —`;
    const a = realOdds.h2h.away ? `${away} $${realOdds.h2h.away.price.toFixed(2)} (${realOdds.h2h.away.book})` : `${away} —`;
    lines.push(`- Head-to-head (best price): ${h} | ${a}`);
  }
  if (realOdds.totals.length > 0) {
    const t = realOdds.totals.slice(0, 3).map((x) => `${x.line}: O $${x.over.toFixed(2)} / U $${x.under.toFixed(2)} (${x.book})`).join(" | ");
    lines.push(`- Total points lines: ${t}`);
  }
  if (realOdds.tryscorers.first.length > 0) {
    lines.push(`- First tryscorer: ${realOdds.tryscorers.first.slice(0, 12).map((p) => `${p.player} $${p.price.toFixed(2)}`).join(", ")}`);
  }
  if (realOdds.tryscorers.anytime.length > 0) {
    lines.push(`- Anytime tryscorer: ${realOdds.tryscorers.anytime.slice(0, 16).map((p) => `${p.player} $${p.price.toFixed(2)}`).join(", ")}`);
  }
  if (realOdds.tryscorers.multi.length > 0) {
    lines.push(`- 2+ tries: ${realOdds.tryscorers.multi.slice(0, 10).map((p) => `${p.player} $${p.price.toFixed(2)}`).join(", ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function buildFallbackIntelligence(input: {
  homeName: string;
  awayName: string;
  venue: string;
  homeRow: { played: number; wins: number; losses: number; for: number; against: number; diff: number; points: number } | undefined;
  awayRow: { played: number; wins: number; losses: number; for: number; against: number; diff: number; points: number } | undefined;
  homeFormScore: number;
  awayFormScore: number;
  homeCore: RankedPlayer[];
  awayCore: RankedPlayer[];
  winnerTeam: "home" | "away";
  winnerName: string;
  loserName: string;
  predictedHome: number;
  predictedAway: number;
  wetWeather: boolean;
  windy: boolean;
  weatherSummary?: string;
}): MatchIntelligence {
  const ratingFromRow = (row: typeof input.homeRow, attack: boolean): string => {
    if (!row || row.played === 0) return "average";
    const per = (attack ? row.for : row.against) / row.played;
    if (attack) {
      if (per >= 28) return "elite";
      if (per >= 24) return "strong";
      if (per >= 20) return "above average";
      if (per >= 16) return "average";
      if (per >= 12) return "below average";
      return "struggling";
    } else {
      if (per <= 14) return "elite";
      if (per <= 18) return "strong";
      if (per <= 22) return "above average";
      if (per <= 26) return "average";
      if (per <= 30) return "below average";
      return "struggling";
    }
  };

  const profile = (team: string, row: typeof input.homeRow, formScore: number, players: RankedPlayer[]): TeamProfile => {
    const star = playerName(players[0], team);
    const trend = formScore >= 1.5 ? "trending up with multiple wins in their last five" : formScore <= -1.5 ? "sliding with more losses than wins in the recent window" : "patchy — wins and losses split fairly evenly";
    return {
      identity: `${team} have built around ${star} this season, leaning on shape through the spine and edge involvement to manufacture chances rather than relying on broken-play creativity.`,
      attackRating: ratingFromRow(row, true),
      defenceRating: ratingFromRow(row, false),
      formRead: `${team} are ${trend}. Quality of opposition has been mixed, so the read is more about HOW they have won (or lost) than the bare W-L. The trajectory points to ${formScore >= 0 ? "a side getting more confident in their structure" : "a side still searching for their best 80-minute shape"}.`,
      scoringPattern: `Most of their points come from structured set-piece on the second or third tackle of a fresh set, with edge shape feeding outside backs once the middle has been engaged.`,
      consistency: formScore >= 1.5 ? "Reliable through the middle third when ahead; can drift if their starting set leaks early." : "Volatile — capable of long scoring bursts but prone to 15-minute droughts that flip momentum.",
    };
  };

  const attackingStructure = (team: string, players: RankedPlayer[], side: "home" | "away"): AttackingStructure => {
    const star = playerName(players[0], team);
    const second = playerName(players[1], team);
    return {
      edgeBalance: side === "home"
        ? `${team} skew their attacking volume to the right edge, where ${star} typically aligns and the back-row crash sets up shape plays for the outside backs.`
        : `${team} prefer the left edge through ${star}, working off second-man plays and short balls to the outside back to stretch the defensive line.`,
      setPlayVsBroken: `Tries arrive primarily from structured set-play in the second half of a set; broken-play scoring is a bonus rather than a strategy.`,
      redZoneTendency: `Inside the 20m they look first to a forward run for quick-play, then shift wide to the dominant edge if the middle has been pulled in.`,
      forwardVsBacklineTries: `Backline outscores the forwards roughly two-to-one, with the wingers and centre on the dominant edge being the most frequent finishers.`,
      primaryPlaymakers: players.slice(0, 3).map((p, i) => ({
        name: playerName(p, team),
        role: p.position,
        influence: i === 0
          ? `Lead playmaker — sets the attacking direction and decides when to shift the ball wide.`
          : i === 1
            ? `Secondary distributor and a live running threat off shape; the connector between forwards and backs.`
            : `Edge finisher who profits when the middle gets pulled in by ${star} and ${second}.`,
      })),
    };
  };

  const defensiveWeaknesses = (team: string, side: "home" | "away"): DefensiveWeaknesses => ({
    missedTackleZones: side === "home"
      ? ["Left centre channel after a quick play-the-ball", "Inside shoulder of the second-rower on shape plays"]
      : ["Right edge under repeat-set pressure", "Around the ruck when the marker is slow to set"],
    edgeFragility: side === "home"
      ? `${team}'s left edge has been the softer side this year — slow to slide on second-phase ball, leaving the centre isolated against shape.`
      : `${team}'s right edge over-commits on first-receiver runs and gets caught narrow when the ball goes to the back of the shape.`,
    lineSpeedRuckIssues: `Line speed drops in the third quarter as the bench rotates through, opening windows for unders runs and short balls into the line.`,
    positionalMismatches: side === "home"
      ? ["Smaller centre vs power forward on a centre carry", "Winger vs second-rower in a kick-return"]
      : ["Hooker vs lock from a fast play-the-ball", "Fullback isolated on a cross-field kick to the far wing"],
    pressurePoints: `Under sustained pressure (back-to-back sets in their own 30m) the structure thins around the ruck and the markers start drifting — that is when most of their tries against come.`,
  });

  const halftimeShape = input.predictedHome === input.predictedAway ? "level" : input.predictedHome > input.predictedAway ? `${input.homeName} narrowly ahead` : `${input.awayName} narrowly ahead`;

  const gameScript: GameScriptPhase[] = [
    { window: "First 20", read: `Expect a tight territory exchange — both packs will look to win the kicking battle and force errors from a fresh defensive line. Early scores are likely to come from a forced error rather than structured shape.` },
    { window: "Second 20", read: `${input.winnerName} should start to impose set quality, controlling field position through completions. The first sustained period of repeat-set pressure decides whether the half stays close or stretches.` },
    { window: "Halftime", read: `Score shape projects ${halftimeShape}; momentum sits with whichever side won the back end of the half rather than the early scoreboard.` },
    { window: "40-60", read: `This is the fatigue window. Bench rotations through the middle determine ruck speed; the side that wins the post-halftime restart and stacks two completed sets back-to-back usually breaks the game open here.` },
    { window: "60-80", read: `${input.winnerName} are best placed to manage the closing 20 — controlling the ball through the middle, kicking long, and using ${playerName((input.winnerTeam === "home" ? input.homeCore : input.awayCore)[0], input.winnerName)} to ice key sets.` },
  ];

  const playerInfluence: PlayerInfluencer[] = [
    ...input.homeCore.slice(0, 3).map((p, i): PlayerInfluencer => ({
      name: playerName(p, input.homeName),
      team: "home",
      role: i === 0 ? "Tempo controller" : i === 1 ? "Edge finisher" : "Forward momentum",
      expectedImpact: i === 0
        ? `Sets the attacking direction for ${input.homeName} and decides whether they play wide early or build through forward carries.`
        : i === 1
          ? `Live finishing option once ${input.homeName}'s shape gets to the edges in good ball — the most likely scorer when their structure clicks.`
          : `Provides the post-contact metres ${input.homeName} need to play on the front foot and dictate field position.`,
    })),
    ...input.awayCore.slice(0, 3).map((p, i): PlayerInfluencer => ({
      name: playerName(p, input.awayName),
      team: "away",
      role: i === 0 ? "Tempo controller" : i === 1 ? "Edge finisher" : "Defensive anchor",
      expectedImpact: i === 0
        ? `Controls ${input.awayName}'s attacking shape and the kicking game out of trouble — the swing factor in any away win script.`
        : i === 1
          ? `Most likely ${input.awayName} scorer if they get repeat-set pressure on the dominant edge.`
          : `Anchors ${input.awayName}'s defensive line through the middle third; if he gets pulled out, their structure tends to thin.`,
    })),
  ];

  const weatherFactor = input.wetWeather
    ? `Forecast rain at ${input.venue} compresses attacking width and rewards middle-dominant packs — expect a lower-tempo, error-filled contest.`
    : input.windy
      ? `Wind at ${input.venue} affects the kicking exchange and makes contestable bombs harder to win.`
      : `Conditions at ${input.venue} should support full-tempo footy with no major weather disruption.`;

  const contextualFactors: string[] = [
    weatherFactor,
    `Venue: ${input.venue} — historically a ${input.winnerTeam === "home" ? "home-friendly" : "neutral"} ground that rewards sides that own the middle third.`,
    `Squad changes and late mail can swing the spine connection — watch the team-list confirmation an hour before kick-off for any positional reshuffles.`,
  ];

  return {
    matchOverview: `${input.homeName} host ${input.awayName} at ${input.venue} in a contest that projects as a structural battle through the middle. ${input.winnerName} hold the slightly stronger profile on current form and points-differential, but the gap is not large enough to rule out a tight result. Expect a typical NRL scoring environment with most points coming from set-piece structure rather than broken-play chaos.`,
    teamProfile: {
      home: profile(input.homeName, input.homeRow, input.homeFormScore, input.homeCore),
      away: profile(input.awayName, input.awayRow, input.awayFormScore, input.awayCore),
    },
    attackingStructure: {
      home: attackingStructure(input.homeName, input.homeCore, "home"),
      away: attackingStructure(input.awayName, input.awayCore, "away"),
    },
    defensiveWeaknesses: {
      home: defensiveWeaknesses(input.homeName, "home"),
      away: defensiveWeaknesses(input.awayName, "away"),
    },
    keyMatchups: [
      {
        area: `${input.homeName} right edge attack vs ${input.awayName} left edge defence`,
        homeSide: `${input.homeName} run their highest-volume shape down this channel through ${playerName(input.homeCore[0], input.homeName)}.`,
        awaySide: `${input.awayName}'s left edge has been their softer defensive side and tends to slide late on second-phase ball.`,
        edge: "home",
        why: `If ${input.homeName} get clean ball on this edge in the second half, this is where the structural advantage shows up first.`,
      },
      {
        area: `Forward pack collisions through the middle third`,
        homeSide: `${input.homeName}'s starting middle aims to win the gain-line off the kick return and control set quality.`,
        awaySide: `${input.awayName}'s pack relies on bench rotation through the third quarter to keep their line speed up.`,
        edge: "even",
        why: `Whichever pack wins the post-halftime restart usually wins the next 20-minute scoring window.`,
      },
      {
        area: `Spine connection and kicking game`,
        homeSide: `${playerName(input.homeCore[0], input.homeName)} drives the attacking direction and the kicking exchange when ${input.homeName} are in their own half.`,
        awaySide: `${playerName(input.awayCore[0], input.awayName)} carries the same load for ${input.awayName} but needs his forwards to give him a platform first.`,
        edge: input.winnerTeam,
        why: `The spine that wins the kicking exchange wins field position and dictates where the game is played.`,
      },
    ],
    gameScript,
    playerInfluence,
    historicalContext: ``,
    contextualFactors,
    rareEventNote: `An early sin bin or a key spine injury inside the first 20 minutes would shift the script materially — worth tracking once teams are confirmed.`,
    insightSummary: `This game is most likely decided by which side wins the back-end of the first half and the post-halftime restart. ${input.winnerName} have the stronger structural profile to do that, but ${input.loserName} stay live if they can win the kicking exchange and force ${input.winnerName} into messy completions out of their own half.`,
  };
}

function buildFallbackInsights(payload: {
  homeName: string;
  awayName: string;
  venue: string;
  homeRecentForm: { result: string; summary: string; score: string }[];
  awayRecentForm: { result: string; summary: string; score: string }[];
  homePosition?: string;
  awayPosition?: string;
  homeSquad: { firstName: string; lastName: string; position: string; isCaptain?: boolean }[];
  awaySquad: { firstName: string; lastName: string; position: string; isCaptain?: boolean }[];
  ladder: { nickname: string; played: number; wins: number; losses: number; for: number; against: number; diff: number; points: number }[];
  oddsSummary: string;
  realOdds?: RealOdds;
  weatherSummary?: string;
}): Insights {
  const homeRow = payload.ladder.find((l) => l.nickname === payload.homeName);
  const awayRow = payload.ladder.find((l) => l.nickname === payload.awayName);
  const priceMap = buildPriceLookup(payload.realOdds);
  const weather = (payload.weatherSummary ?? "").toLowerCase();
  const wetWeather = /(rain|shower|storm|wet)/.test(weather);
  const windy = /wind/.test(weather);

  const homeFormScore = recentFormScore(payload.homeRecentForm);
  const awayFormScore = recentFormScore(payload.awayRecentForm);
  const homeRating = teamRating(homeRow, homeFormScore, payload.realOdds?.h2h.home?.price, true);
  const awayRating = teamRating(awayRow, awayFormScore, payload.realOdds?.h2h.away?.price, false);

  const predictedHome = projectScore(homeRow, awayRow, homeFormScore, true, wetWeather, windy);
  const predictedAway = projectScore(awayRow, homeRow, awayFormScore, false, wetWeather, windy);

  let homeScore = predictedHome;
  let awayScore = predictedAway;
  const winnerTeam: "home" | "away" = homeRating >= awayRating ? "home" : "away";
  if (homeScore === awayScore) {
    if (winnerTeam === "home") homeScore += 2;
    else awayScore += 2;
  }
  const winnerName = winnerTeam === "home" ? payload.homeName : payload.awayName;
  const loserName = winnerTeam === "home" ? payload.awayName : payload.homeName;
  const marginValue = Math.abs(homeScore - awayScore);
  const marginBucket = marginValue <= 6 ? "1-6" : marginValue <= 12 ? "7-12" : "13+";
  const totalLine = payload.realOdds?.totals[0]?.line ?? 44.5;
  const totalPoints = homeScore + awayScore;
  const totalPick: "over" | "under" = totalPoints >= totalLine ? "over" : "under";
  const confidence = clamp(Math.round(56 + Math.abs(homeRating - awayRating) * 4), 52, 81);

  const homeAttackers = rankAttackers(payload.homeSquad, priceMap);
  const awayAttackers = rankAttackers(payload.awaySquad, priceMap);
  const homeCore = padPlayers(homeAttackers, payload.homeName);
  const awayCore = padPlayers(awayAttackers, payload.awayName);
  const winnerCore = winnerTeam === "home" ? homeCore : awayCore;
  const loserCore = winnerTeam === "home" ? awayCore : homeCore;

  const firstPickPlayer = winnerCore.find((p) => p.prices.first != null) ?? winnerCore[0] ?? loserCore[0];
  const multiPickPlayer = winnerCore.find((p) => p.prices.multi != null) ?? winnerCore[1] ?? winnerCore[0] ?? loserCore[0];
  const anytimePicks = [winnerCore[0], winnerCore[1], loserCore[0]].filter(Boolean).slice(0, 3);

  const halftimeHome = Math.max(4, Math.round(homeScore * 0.48));
  const halftimeAway = Math.max(4, Math.round(awayScore * 0.48));
  const halftimeLeader: "home" | "away" | "draw" = halftimeHome === halftimeAway
    ? "draw"
    : halftimeHome > halftimeAway
      ? "home"
      : "away";
  const htftPick = `${halftimeLeader === "draw" ? "Draw" : halftimeLeader === "home" ? payload.homeName : payload.awayName} / ${winnerName}`;

  const homeExploit = buildWeaknessExploit(payload.homeName, payload.awayName, homeCore, wetWeather, "home", homeFormScore, awayFormScore, payload.homePosition, payload.awayPosition);
  const awayExploit = buildWeaknessExploit(payload.awayName, payload.homeName, awayCore, wetWeather, "away", awayFormScore, homeFormScore, payload.awayPosition, payload.homePosition);
  const bookieWant = payload.realOdds?.h2h.home && payload.realOdds?.h2h.away
    ? payload.realOdds.h2h.home.price < payload.realOdds.h2h.away.price
      ? `${payload.awayName} to muddy the game up or pinch it late — it breaks up the public favourite multis built around ${payload.homeName}.`
      : `${payload.homeName} to muddy the game up or pinch it late — it breaks up the public favourite multis built around ${payload.awayName}.`
    : `${loserName} to turn this into a low-event upset — that is the cleaner result for the book.`;
  const bookieFear = `${winnerName} winning in the script everyone can see: result plus points plus the obvious edge tryscorers.`;
  const liability = `${winnerName} head-to-head and the headline anytime names carry the clearest public exposure.`;

  const anytimeBetPlayers = [winnerCore[0], winnerCore[1], loserCore[0], loserCore[1]].filter(Boolean).slice(0, 4);
  const firstTryName = playerName(firstPickPlayer, winnerName);
  const multiTryName = playerName(multiPickPlayer, winnerName);
  const preferredWinner = `${winnerName} — the cleaner TV story is a marketable side staying relevant, keeping the broadcast talking points alive into next week.`;

  return {
    intelligence: buildFallbackIntelligence({
      homeName: payload.homeName,
      awayName: payload.awayName,
      venue: payload.venue,
      homeRow,
      awayRow,
      homeFormScore,
      awayFormScore,
      homeCore,
      awayCore,
      winnerTeam,
      winnerName,
      loserName,
      predictedHome: homeScore,
      predictedAway: awayScore,
      wetWeather,
      windy,
      weatherSummary: payload.weatherSummary,
    }),
    simulation: buildFallbackSimulation({
      homeName: payload.homeName,
      awayName: payload.awayName,
      winnerName,
      loserName,
      winnerTeam,
      homeScore,
      awayScore,
      marginValue,
      marginBucket,
      totalLine,
      totalPick,
      htftPick,
      winnerCore,
      loserCore,
      anytimeBetPlayers,
      firstPickPlayer,
      multiPickPlayer,
      winnerPrice: winnerTeam === "home" ? payload.realOdds?.h2h.home?.price : payload.realOdds?.h2h.away?.price,
      loserPrice: winnerTeam === "home" ? payload.realOdds?.h2h.away?.price : payload.realOdds?.h2h.home?.price,
      totalOverPrice: payload.realOdds?.totals[0]?.over,
      totalUnderPrice: payload.realOdds?.totals[0]?.under,
      wetWeather,
      windy,
    }),
    predictedScore: { home: homeScore, away: awayScore },
    winner: {
      team: winnerTeam,
      confidence,
      reasoning: `${winnerName} rate slightly better on current form, field position profile and game control, with ${winnerTeam === "home" ? "home turf" : "the stronger market lean"} giving them the final edge.`,
    },
    margin: {
      value: marginValue,
      bucket: marginBucket,
      reasoning: marginValue <= 6
        ? `The matchup projects as a grind rather than a blowout, so a one-score finish is the live lane.`
        : `The stronger side should win enough territory and set starts to separate over 80 minutes.`,
    },
    total: {
      line: totalLine,
      pick: totalPick,
      reasoning: `${wetWeather || windy ? "Weather trims some fluency, " : "Both teams still have enough strike to score, "}${totalPoints >= totalLine ? "so the game still leans over the main total." : "so the safer read is a touch under the main total."}`,
    },
    htft: {
      pick: htftPick,
      reasoning: `${winnerName} look the more stable side through the middle third, which should show up before the benches fully empty out.`,
      confidence: clamp(confidence - 4, 50, 78),
    },
    firstTryscorer: {
      pick: firstTryName,
      reasoning: `${firstTryName} profiles as the cleanest first-strike candidate through early shift ball and red-zone usage.`,
    },
    anytimeTryscorers: anytimePicks.map((p) => ({
      pick: playerName(p, winnerName),
      reasoning: `${playerName(p, winnerName)} sits in a high-touch scoring lane and matches up well with the edge pressure expected in this game.`,
    })),
    multiTryscorer: {
      pick: multiTryName,
      reasoning: `${multiTryName} is the best long-shot double candidate if the favourite owns territory and repeat sets.`,
      confidence: clamp(confidence - 12, 38, 68),
    },
    keysToVictory: {
      home: buildKeysToVictory(payload.homeName, payload.awayName, homeCore, wetWeather),
      away: buildKeysToVictory(payload.awayName, payload.homeName, awayCore, wetWeather),
    },
    keyFactors: [
      `${winnerName}'s kick-pressure game should decide who starts sets on the front foot.`,
      `${wetWeather ? "Ball security and discipline in greasy conditions." : "Edge execution off shape and quick ruck speed."}`,
      `${loserName} need to shorten the game and avoid inviting repeat sets.`,
      `The middle-third battle should decide whether the match stays live late or swings one way early.`,
    ],
    weaknessExploit: {
      home: homeExploit,
      away: awayExploit,
    },
    bets: buildFallbackBets({
      winnerName,
      loserName,
      marginBucket,
      totalLine,
      totalPick,
      htftPick,
      firstTryName,
      multiTryName,
      winnerPrice: winnerTeam === "home" ? payload.realOdds?.h2h.home?.price : payload.realOdds?.h2h.away?.price,
      loserPrice: winnerTeam === "home" ? payload.realOdds?.h2h.away?.price : payload.realOdds?.h2h.home?.price,
      gameScriptAnytimeA: playerName(winnerCore[0], winnerName),
      gameScriptAnytimeB: playerName(loserCore[0], loserName),
      anytimePlayers: anytimeBetPlayers.map((p, i) => ({ name: playerName(p, i < 2 ? winnerName : loserName), price: p.prices.anytime ?? estimateAnytimeOdds(i) })),
      firstTryPrice: firstPickPlayer?.prices.first ?? 9,
      multiTryPrice: multiPickPlayer?.prices.multi ?? 4.5,
    }),
    gameFlow: {
      openingTen: `${payload.homeName} should start with the cleaner territory game, while ${payload.awayName} look to absorb early pressure and play off yardage errors.`,
      firstHalf: `${winnerName} project to win the kick battle early and turn that into repeat looks at the line. ${loserName} can stay in touch if they complete well, but they likely spend more of the half defending exits and edge shifts.`,
      halftimeScore: { home: halftimeHome, away: halftimeAway },
      halftimeLeader,
      secondHalf: `${loserName} should have a push once benches settle, but ${winnerName} still profile as the side more likely to finish sets cleanly and turn pressure into points.`,
      momentumSwings: [
        `10-20min: ${winnerName} build field position through repeat-set pressure.`,
        `35-50min: ${loserName} lift off quicker yardage and bench energy.`,
        `60-72min: ${winnerName} regain control through territory and composure.`,
      ],
      halftimeDouble: {
        pick: htftPick,
        reasoning: `${winnerName} look the more consistent side across both halves, even if the middle period gets messy.`,
        confidence: clamp(confidence - 5, 50, 76),
      },
      closing: marginValue <= 6
        ? `Expect a live final 10 minutes with territory swings deciding whether the favourite covers or just escapes.`
        : `${winnerName} should be the side finishing stronger if they get to the last 10 with scoreboard control.`,
    },
    tryscorerScript: {
      home: buildTryscorerTeamBlock(payload.homeName, homeCore, payload.awayName),
      away: buildTryscorerTeamBlock(payload.awayName, awayCore, payload.homeName),
      summary: `${winnerName} have the stronger scoring profile, but both teams still show edge-tryscorer routes if the middle battle opens up. ${wetWeather ? "Greasy conditions lower the ceiling a touch and favour cleaner finishers." : "Dry-weather shape puts the outside backs right in the frame."}`,
    },
    script: {
      headToHead: `${payload.homeName} carry the venue edge at ${payload.venue}, while ${payload.awayName} come in needing to match that early energy. The matchup still looks more like a territory and composure game than a pure shootout.`,
      formAnalysis: `${payload.homeName} recent form reads ${formTag(homeFormScore)}, while ${payload.awayName} look ${formTag(awayFormScore)}. Ladder profile, points differential and market lean all hint that the margin for error is slimmer for ${loserName}.`,
      xFactor: `${playerName(winnerCore[0], winnerName)} is the cleanest swing piece — if that edge gets good ball, the scoreboard pressure follows quickly.`,
      psychological: `${winnerName} enter with the steadier external read, while ${loserName} need this to avoid chasing the game script from behind. ${payload.homePosition ? `${payload.homeName} are playing from ${payload.homePosition} on the ladder. ` : ""}${payload.awayPosition ? `${payload.awayName} sit ${payload.awayPosition}, so every point matters in the table squeeze. ` : ""}${payload.venue} should give the game enough atmosphere to matter late if it stays within a score.`,
      milestones: [
        `${payload.homeName} need the two points to sharpen their ladder trajectory from ${payload.homePosition ?? "their current spot"}.`,
        `${payload.awayName} can shift the outside noise quickly with a composed result from ${payload.awayPosition ?? "their current ladder position"}.`,
        `The spine battle is the big statement piece — whichever side controls the tempo will own the storyline afterward.`,
      ],
      bookieScript: {
        wantToWin: bookieWant,
        wantToLose: bookieFear,
        liability,
      },
      matchFix: {
        preferredWinner,
        ratingsAngle: `The dream broadcast script is ${winnerName} taking control, ${loserName} making one serious late push, and the game still being alive deep into the final 10. Close finishes hold viewers; clean narrative beats drive the post-game chatter.`,
        refereeNudges: [
          `A couple of early 50/50 ruck calls lean toward ${winnerName} when field position is up for grabs.`,
          `The bunker finds just enough daylight on the marquee finisher if the grounding is messy.`,
          `${winnerName} get the timely six-again right when momentum needs a reset.`,
        ],
        narrativeMoment: `${playerName(winnerCore[0], winnerName)} landing the headline play late is the neatest TV finish.`,
        conspiracyRating: clamp(42 + (marginValue <= 6 ? 12 : 4) + (payload.realOdds ? 4 : 0), 25, 72),
      },
    },
  };
}

function buildFallbackSimulation(input: {
  homeName: string;
  awayName: string;
  winnerName: string;
  loserName: string;
  winnerTeam: "home" | "away";
  homeScore: number;
  awayScore: number;
  marginValue: number;
  marginBucket: string;
  totalLine: number;
  totalPick: "over" | "under";
  htftPick: string;
  winnerCore: RankedPlayer[];
  loserCore: RankedPlayer[];
  anytimeBetPlayers: RankedPlayer[];
  firstPickPlayer: RankedPlayer | undefined;
  multiPickPlayer: RankedPlayer | undefined;
  winnerPrice?: number | null;
  loserPrice?: number | null;
  totalOverPrice?: number | null;
  totalUnderPrice?: number | null;
  wetWeather: boolean;
  windy: boolean;
}): MatchSimulation {
  const totalPoints = input.homeScore + input.awayScore;
  const tempo: SimulationProfile["tempo"] = input.wetWeather ? "slow" : input.windy ? "moderate" : totalPoints >= 46 ? "fast" : "moderate";
  const dominance: SimulationProfile["dominance"] = input.marginValue <= 6 ? "even" : input.winnerTeam;
  const scoringPattern: SimulationProfile["scoringPattern"] = input.marginValue >= 13
    ? "second-half-flood"
    : input.marginValue <= 4
      ? "spread"
      : "late-burst";

  const totalMid = Math.round(totalPoints);
  const totalLow = Math.max(20, totalMid - 8);
  const totalHigh = totalMid + 8;

  const winnerOdds = input.winnerPrice ?? 1.72;
  const loserOdds = input.loserPrice ?? 2.35;
  const overOdds = input.totalOverPrice ?? 1.92;
  const underOdds = input.totalUnderPrice ?? 1.92;

  const winnerImplied = round1(100 / winnerOdds);
  const loserImplied = round1(100 / loserOdds);
  const overImplied = round1(100 / overOdds);
  const underImplied = round1(100 / underOdds);

  const winnerModel = clamp(winnerImplied + (input.marginValue >= 12 ? 6 : 2), 35, 88);
  const loserModel = 100 - winnerModel;
  const overModel = input.totalPick === "over" ? clamp(overImplied + 7, 30, 78) : clamp(overImplied - 6, 25, 70);
  const underModel = 100 - overModel;

  const marginOdds = input.marginBucket === "1-6" ? 3.4 : input.marginBucket === "7-12" ? 3.8 : 2.1;
  const marginImplied = round1(100 / marginOdds);
  const marginModel = clamp(marginImplied + 5, 18, 55);

  const htftOdds = input.htftPick.split(" / ")[0] === input.htftPick.split(" / ")[1] ? 2.6 : 9.0;
  const htftImplied = round1(100 / htftOdds);
  const htftModel = clamp(htftImplied + 4, 12, 50);

  const a0 = input.anytimeBetPlayers[0];
  const a1 = input.anytimeBetPlayers[1] ?? a0;
  const a2 = input.anytimeBetPlayers[2] ?? a0;
  const winnerName = input.winnerName;
  const loserName = input.loserName;

  const buildPlay = (
    market: MarketPlay["market"],
    pick: string,
    decimalOdds: number | null,
    modelProb: number,
    rationale: string,
    scriptAlignment: string,
  ): MarketPlay => {
    const implied = decimalOdds ? round1(100 / decimalOdds) : 0;
    const edge = round1(modelProb - implied);
    const conf: MarketPlay["confidence"] = edge >= 8 ? "high" : edge >= 2 ? "medium" : "low";
    return { market, pick, decimalOdds, modelProbability: round1(modelProb), impliedProbability: implied, edgePct: edge, confidence: conf, rationale, scriptAlignment };
  };

  const recommendedPlays: MarketPlay[] = [
    buildPlay("match-winner", `${winnerName} to win`, winnerOdds, winnerModel,
      `${winnerName} project to win the territory and completion battle through the middle third — the simulation gives them the dominance lever.`,
      `dominance: ${input.winnerTeam}`),
    buildPlay("winning-margin", `${winnerName} ${input.marginBucket} margin`, marginOdds, marginModel,
      `Margin bucket aligns with the simulated scoreline and the ${scoringPattern.replace(/-/g, " ")} scoring pattern.`,
      `scoring pattern: ${scoringPattern}`),
    buildPlay("total-points", `${input.totalPick === "over" ? "Over" : "Under"} ${input.totalLine} total points`,
      input.totalPick === "over" ? overOdds : underOdds, input.totalPick === "over" ? overModel : underModel,
      `Simulation expects total points in the ${totalLow}-${totalHigh} band — ${input.totalPick === "over" ? "above" : "below"} the line tilts our way.`,
      `total band: ${totalLow}-${totalHigh}`),
    buildPlay("ht-ft", `${input.htftPick} HT/FT`, htftOdds, htftModel,
      `HT/FT correlates with the simulated halftime split and full-time winner.`,
      `script: HT shape`),
    a0 && buildPlay("anytime-tryscorer", `${playerName(a0, winnerName)} anytime tryscorer`,
      a0.prices.anytime ?? estimateAnytimeOdds(0),
      clamp(round1(100 / (a0.prices.anytime ?? estimateAnytimeOdds(0))) + 6, 30, 78),
      `${playerName(a0, winnerName)} sits in the dominant edge attack lane the simulation expects to crack open.`,
      `edge attack ${input.winnerTeam === "home" ? "right" : "left"}`),
    a1 && buildPlay("anytime-tryscorer", `${playerName(a1, winnerName)} anytime tryscorer`,
      a1.prices.anytime ?? estimateAnytimeOdds(1),
      clamp(round1(100 / (a1.prices.anytime ?? estimateAnytimeOdds(1))) + 4, 30, 75),
      `Secondary finishing option once ${winnerName}'s structure gets to the edges.`,
      `script alignment: secondary scoring`),
    input.multiPickPlayer && buildPlay("2-plus-tries", `${playerName(input.multiPickPlayer, winnerName)} 2+ tries`,
      input.multiPickPlayer.prices.multi ?? 4.5,
      clamp(round1(100 / (input.multiPickPlayer.prices.multi ?? 4.5)) + 3, 12, 45),
      `If the simulated ${scoringPattern.replace(/-/g, " ")} lands, the dominant finisher is in line for a double.`,
      `scoring pattern: ${scoringPattern}`),
    input.firstPickPlayer && buildPlay("first-tryscorer", `${playerName(input.firstPickPlayer, winnerName)} first tryscorer`,
      input.firstPickPlayer.prices.first ?? 9,
      clamp(round1(100 / (input.firstPickPlayer.prices.first ?? 9)) + 2, 6, 22),
      `Most likely first-strike candidate based on red-zone usage and simulated early territory.`,
      `early-script edge`),
    // A trap to fade — the loser at very short margin
    buildPlay("winning-margin", `${loserName} 1-12 margin`, 4.5, 15,
      `Simulation does not support ${loserName} winning by a narrow margin — too many variables need to flip.`,
      `negative — fade`),
  ].filter(Boolean) as MarketPlay[];

  recommendedPlays.sort((a, b) => b.edgePct - a.edgePct);

  // Ranked tryscorers
  const buildRanked = (p: RankedPlayer, team: "home" | "away", teamName: string, idx: number, isWinner: boolean): RankedTryscorer => {
    const market: RankedTryscorer["market"] = p.prices.first != null && idx === 0 ? "first" : p.prices.multi != null && idx === 1 && isWinner ? "2+" : "anytime";
    const price = market === "first" ? p.prices.first : market === "2+" ? p.prices.multi : p.prices.anytime;
    const positionWeight = p.position === "Winger" ? 88 : p.position === "Fullback" ? 82 : p.position === "Centre" ? 74 : p.position === "2nd Row" ? 68 : 55;
    const pais = clamp(positionWeight + (idx === 0 ? 8 : 0) - (idx >= 3 ? 8 : 0), 30, 95);
    const ttcp = clamp(positionWeight - 5 + (isWinner ? 6 : 0), 30, 92);
    const matchupExploit = clamp(60 + (isWinner ? 12 : -4) - idx * 4, 25, 90);
    const scriptFit = clamp(55 + (isWinner ? 14 : -2) - idx * 3, 25, 90);
    const value = price ? clamp(50 + (3 - price) * 8, 20, 90) : 50;
    const totalScore = round1(pais * 0.30 + ttcp * 0.20 + matchupExploit * 0.20 + scriptFit * 0.20 + value * 0.10);
    const componentsAbove60 = [pais, ttcp, matchupExploit, scriptFit, value].filter((v) => v >= 60).length;
    const conf: RankedTryscorer["confidence"] = componentsAbove60 >= 4 ? "high" : componentsAbove60 >= 2 ? "medium" : "low";
    return {
      name: playerName(p, teamName),
      team,
      position: p.position,
      market,
      decimalOdds: price ?? null,
      scores: { pais, ttcp, matchupExploit, scriptFit, value },
      totalScore,
      confidence: conf,
      rationale: `${playerName(p, teamName)} aligns with the simulated ${input.winnerTeam === team ? "dominant" : "secondary"} attack — ${p.position.toLowerCase()} role fits the ${scoringPattern.replace(/-/g, " ")} script.`,
      stackable: isWinner && idx <= 2,
    };
  };

  const ranked: RankedTryscorer[] = [
    ...input.winnerCore.slice(0, 3).map((p, i) => buildRanked(p, input.winnerTeam, winnerName, i, true)),
    ...input.loserCore.slice(0, 2).map((p, i) => buildRanked(p, input.winnerTeam === "home" ? "away" : "home", loserName, i, false)),
  ].sort((a, b) => b.totalScore - a.totalScore);

  return {
    profile: {
      tempo,
      tempoNote: input.wetWeather
        ? `Forecast rain compresses the kicking exchange and slows the ruck — expect a low-tempo grind.`
        : input.windy
          ? `Wind affects the bombs and forces both halves to vary their kicking game — moderate tempo.`
          : `Both packs profile to play full-tempo footy with quick play-the-balls if discipline holds.`,
      dominance,
      dominanceNote: dominance === "even"
        ? `Neither side has a clear structural edge — the dominance lever is up for grabs in the third quarter.`
        : `${winnerName} project to control field position via cleaner completions and a stronger kicking exchange.`,
      territoryBalance: dominance === "even"
        ? `Roughly 50-50 — the side that wins the post-halftime restart owns the middle 20.`
        : `~55-45 ${input.winnerTeam} — repeat sets through the dominant edge after the half-hour mark.`,
      scoringPattern,
      scoringPatternNote: scoringPattern === "second-half-flood"
        ? `Most points arrive after the 50th minute as bench rotations open windows.`
        : scoringPattern === "spread"
          ? `Tries spread evenly across both halves — no single dominant scoring window.`
          : `Late-burst scoring — the closing 20 decide the cover.`,
      edgeAttack: {
        left: input.winnerTeam === "away" ? "high" : "medium",
        right: input.winnerTeam === "home" ? "high" : "medium",
        middle: "medium",
        note: `${winnerName} skew their attacking volume to the ${input.winnerTeam === "home" ? "right" : "left"} edge through the lead playmaker.`,
      },
      defensiveZones: [
        `${loserName} fragile on the ${input.winnerTeam === "home" ? "left" : "right"} edge under second-phase pressure.`,
        `${winnerName} most exposed when forced to defend back-to-back sets in their own 30m.`,
        input.wetWeather ? `Both back-threes vulnerable on contestable bombs in greasy conditions.` : `Ruck around the markers when fatigue spikes in the third quarter.`,
      ],
      expectedTotalRange: { low: totalLow, high: totalHigh, midpoint: totalMid },
    },
    summary: `Simulation expects a ${tempo}-tempo contest with ${winnerName} controlling territory and turning that into the cleaner scoring window late. Total points project in the ${totalLow}-${totalHigh} band, and the ${input.winnerTeam === "home" ? "right" : "left"}-edge attack is the lever that unlocks the value tryscorers.`,
    recommendedPlays,
    rankedTryscorers: ranked,
    correlatedAngle: `${winnerName} to win, ${winnerName} ${input.marginBucket} margin, and the top-ranked tryscorer all lean on the same simulated dominance — if the script lands, they hit together.`,
    scriptCaveat: `An early sin bin or a key spine injury inside the first 20 minutes would flip the dominance lever and reset the simulation.`,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildFallbackBets(input: {
  winnerName: string;
  loserName: string;
  marginBucket: string;
  totalLine: number;
  totalPick: "over" | "under";
  htftPick: string;
  firstTryName: string;
  multiTryName: string;
  winnerPrice?: number | null;
  loserPrice?: number | null;
  gameScriptAnytimeA: string;
  gameScriptAnytimeB: string;
  anytimePlayers: { name: string; price: number }[];
  firstTryPrice: number;
  multiTryPrice: number;
}): BetPlay[] {
  const totalPickLabel = `${input.totalPick === "over" ? "Over" : "Under"} ${input.totalLine} total points`;
  const totalOddsApprox = 1.9;
  const marginOdds = input.marginBucket === "1-6" ? 3.4 : input.marginBucket === "7-12" ? 3.8 : 2.1;
  const winnerPrice = input.winnerPrice ?? 1.72;
  const loserPrice = input.loserPrice ?? 2.35;
  const a0 = input.anytimePlayers[0];
  const a1 = input.anytimePlayers[1] ?? a0;
  const a2 = input.anytimePlayers[2] ?? a0;
  const a3 = input.anytimePlayers[3] ?? a1;
  const safeAnytime = (p?: { name: string; price: number }, fallbackPrice = 2.4) => p ?? { name: input.gameScriptAnytimeA, price: fallbackPrice };
  const aA = safeAnytime(a0, 2.0);
  const aB = safeAnytime(a1, 2.4);
  const aC = safeAnytime(a2, 2.8);
  const aD = safeAnytime(a3, 3.0);
  const multiB = Math.max(input.multiTryPrice * 0.9, 4.5);
  const multiC = Math.max(input.multiTryPrice * 1.15, 6);

  // Convergence — fallback assumes a moderate, even script unless margin tells us otherwise.
  const scriptStrength = input.marginBucket === "13+" || input.marginBucket === "13-24" || input.marginBucket === "25+" ? "strong" : "moderate";

  return [
    {
      category: "low",
      title: `${input.winnerName} — safe build`,
      legs: [
        { pick: `${input.winnerName} to win`, decimalOdds: winnerPrice },
        { pick: totalPickLabel, decimalOdds: totalOddsApprox },
        { pick: `${aA.name} anytime tryscorer`, decimalOdds: aA.price },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$10",
      potentialReturn: "$0.00",
      reasoning: `${input.winnerName} are the cleanest base read in the simulation, and ${aA.name} sits in the dominant attacking lane. Total leg leans on the projected scoring environment — concentrated on hit-rate over payout.`,
      hitRateScore: scriptStrength === "strong" ? 78 : 70,
      scriptAlignment: `dominance + total convergence`,
    },
    {
      category: "medium",
      title: `${input.winnerName} script-aligned 4-leg`,
      legs: [
        { pick: `${input.winnerName} to win`, decimalOdds: winnerPrice },
        { pick: totalPickLabel, decimalOdds: totalOddsApprox },
        { pick: `${aA.name} anytime tryscorer`, decimalOdds: aA.price },
        { pick: `${aB.name} anytime tryscorer`, decimalOdds: aB.price },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$10",
      potentialReturn: "$0.00",
      reasoning: `Balanced multi: the favourite + total combine for the safety rails, and two anytime tryscorers in the same edge attack lane do the heavy lifting on the multiplier. Drops if ${input.winnerName} can't impose territory.`,
      hitRateScore: scriptStrength === "strong" ? 62 : 54,
      scriptAlignment: `dominance + edge attack stack`,
    },
    {
      category: "high",
      title: `Correlated stack — ${input.winnerName} dominance`,
      legs: [
        { pick: `${input.winnerName} to win`, decimalOdds: winnerPrice },
        { pick: `${input.winnerName} winning margin ${input.marginBucket}`, decimalOdds: marginOdds },
        { pick: totalPickLabel, decimalOdds: totalOddsApprox },
        { pick: `${aA.name} anytime tryscorer`, decimalOdds: aA.price },
        { pick: `${aB.name} anytime tryscorer`, decimalOdds: aB.price },
        { pick: `${input.multiTryName} 2+ tries`, decimalOdds: input.multiTryPrice },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$10",
      potentialReturn: "$0.00",
      reasoning: `Aggressive same-game stack — every leg points at the same script: ${input.winnerName} controlling territory, hitting the margin bucket, and ${input.multiTryName} cashing in twice when the dominant edge cracks open. Lands together or not at all.`,
      hitRateScore: scriptStrength === "strong" ? 42 : 32,
      scriptAlignment: `dominance + margin + try-flow correlation`,
    },
    {
      category: "ultra",
      title: `Ultra — extreme script outcome`,
      legs: [
        { pick: `${input.winnerName} winning margin 13+`, decimalOdds: 1.95 },
        { pick: `${input.winnerName} winning margin ${input.marginBucket === "13+" ? "13-24" : input.marginBucket}`, decimalOdds: marginOdds },
        { pick: input.htftPick, decimalOdds: 2.6 },
        { pick: totalPickLabel, decimalOdds: totalOddsApprox },
        { pick: `${aA.name} 2+ tries`, decimalOdds: multiB },
        { pick: `${aB.name} 2+ tries`, decimalOdds: multiC },
        { pick: `${input.multiTryName} 2+ tries`, decimalOdds: input.multiTryPrice },
      ],
      combinedOdds: 1,
      estimatedOdds: "$0.00",
      stake: "$10",
      potentialReturn: "$0.00",
      reasoning: `Extreme variance scenario — needs ${input.winnerName} to fully impose the script, with multiple finishers cashing doubles. Big margins + HT/FT + stacked 2+ tries — the rare game where everything aligns.`,
      hitRateScore: scriptStrength === "strong" ? 14 : 8,
      scriptAlignment: `extreme dominance + scoring flood`,
    },
  ];
}

function buildTryscorerTeamBlock(team: string, players: RankedPlayer[], opponent: string) {
  const picks = players.slice(0, 4).map((p, index) => {
    const market: "first" | "2+" | "anytime" = p.prices.first != null && index === 0
      ? "first"
      : p.prices.multi != null && index === 1
        ? "2+"
        : "anytime";

    return {
      name: playerName(p, team),
      market,
      price: market === "first" ? p.prices.first : market === "2+" ? p.prices.multi : p.prices.anytime,
      reasoning: `${playerName(p, team)} sits in a live ${p.position.toLowerCase()} scoring lane against ${opponent}'s likely edge and kick-pressure issues.`,
    };
  });

  const avoid = players.slice(-2).map((p) => ({
    name: playerName(p, team),
    reasoning: `${playerName(p, team)} projects to need low-percentage touches rather than volume chances in this script.`,
  }));

  return { picks, avoid };
}

function buildWeaknessExploit(
  team: string,
  opponent: string,
  players: RankedPlayer[],
  wetWeather: boolean,
  side: "home" | "away" = "home",
  teamForm = 0,
  oppForm = 0,
  teamPos?: number | string,
  oppPos?: number | string,
) {
  const watch = players.slice(0, 3);
  const isFavoured = teamForm >= oppForm;
  const ladderEdge = (Number(teamPos) || 99) < (Number(oppPos) || 99);
  const star = playerName(players[0], team);
  const second = playerName(players[1], team);

  // Vary opening pressure point per side so the two cards never read the same.
  const edgeFocus = side === "home"
    ? `${opponent}'s right edge has been the soft channel — slow to slide on second-phase ball after fatigue sets in`
    : `${opponent}'s left-edge defence is over-committing on first-receiver runs and leaving outside backs isolated`;
  const middleFocus = side === "home"
    ? `${opponent}'s ruck speed drops noticeably in the third quarter, opening windows for shape plays`
    : `${opponent}'s middle defenders are conceding metres post-contact, especially against forwards on second-man plays`;
  const kickFocus = wetWeather
    ? `${opponent}'s back three have wobbled under contestable kicks in greasy conditions`
    : side === "home"
      ? `${opponent}'s yardage exits are leaking under high-ball pressure on the right`
      : `${opponent}'s left winger has been targeted on bombs and short kick-chases`;

  const targetAreas = side === "home"
    ? ["Right-edge 20m channel after repeat sets", "Inside ball off quick play-the-balls", wetWeather ? "Grubbers in-goal under pressure" : "Bomb chase on right wing"]
    : ["Left-edge short side from scrum", "Forward shape off second-man play", wetWeather ? "Boot the back three early" : "Cross-field kick to left winger"];

  const tacticalPlan = isFavoured
    ? `${team} should weaponise field position with ${star} pulling the strings — milk repeat sets, then unload ${side === "home" ? "right-edge shape" : "left-edge raids"} once ${opponent}'s middle starts retreating. ${ladderEdge ? "Ladder pressure is on the visitors' side, so " + team + " can afford to be patient and play the long script." : "Lean on " + second + " to break the line in the third quarter when " + opponent + "'s defensive read slows."}`
    : `${team} need to flip the script early — front-load energy through ${star} carries and force ${opponent} into messy completions before ${opponent}'s structure settles. ${wetWeather ? "Conditions help an underdog: complete high, kick long and live in their half." : "Use " + second + " on early-shift ball to test " + opponent + "'s edge connection before they get into rhythm."}`;

  return {
    opponentWeaknesses: [edgeFocus, middleFocus, kickFocus],
    targetAreas,
    tacticalPlan,
    playersToWatch: watch.map((p, i) => ({
      name: playerName(p, team),
      role: p.position,
      why: i === 0
        ? `${playerName(p, team)} is the lead playmaker for ${team} and the most likely to convert ${opponent}'s lapses into direct points.`
        : i === 1
          ? `${playerName(p, team)} should get high volume off shape and matches up well against ${opponent}'s read-defence issues.`
          : `${playerName(p, team)} adds late-set finishing power and is a live tryscoring option once ${opponent}'s edge fatigues.`,
    })),
  };
}

function buildKeysToVictory(team: string, opponent: string, players: RankedPlayer[], wetWeather: boolean): string[] {
  return [
    `Win the kick-and-chase cycle so ${opponent} are starting too many sets inside their own half.`,
    `Feed ${playerName(players[0], team)} with early touches on shape rather than chasing miracle offloads.`,
    wetWeather ? `Respect the conditions: complete high, kick long and make ${opponent} work out of bad ball.` : `Turn pressure into repeat sets instead of overplaying the offload once ${opponent} bend.`,
  ];
}

type RankedPlayer = {
  firstName: string;
  lastName: string;
  position: string;
  isCaptain?: boolean;
  prices: { first: number | null; anytime: number | null; multi: number | null };
  score: number;
};

function rankAttackers(
  squad: { firstName: string; lastName: string; position: string; isCaptain?: boolean }[],
  priceMap: Map<string, { first: number | null; anytime: number | null; multi: number | null }>,
): RankedPlayer[] {
  const weights: Record<string, number> = {
    Fullback: 92,
    Winger: 95,
    Centre: 82,
    "Five-Eighth": 74,
    Halfback: 71,
    Hooker: 58,
    Prop: 42,
    "2nd Row": 76,
    Lock: 68,
    Interchange: 34,
    Reserve: 20,
  };

  return squad
    .map((p) => {
      const prices = priceMap.get(normName(`${p.firstName} ${p.lastName}`)) ?? { first: null, anytime: null, multi: null };
      const priceBoost = prices.anytime ? Math.max(0, 20 - prices.anytime * 3) : 0;
      const multiBoost = prices.multi ? Math.max(0, 12 - prices.multi) : 0;
      return {
        ...p,
        prices,
        score: (weights[p.position] ?? 40) + priceBoost + multiBoost + (p.isCaptain ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function padPlayers(players: RankedPlayer[], team: string): RankedPlayer[] {
  if (players.length >= 4) return players;
  const padded = [...players];
  while (padded.length < 4) {
    padded.push({
      firstName: team,
      lastName: `Edge ${padded.length + 1}`,
      position: "Back",
      prices: { first: null, anytime: null, multi: null },
      score: 0,
    });
  }
  return padded;
}

function buildPriceLookup(realOdds: RealOdds | undefined) {
  const map = new Map<string, { first: number | null; anytime: number | null; multi: number | null }>();
  if (!realOdds) return map;

  for (const p of realOdds.tryscorers.first) {
    const key = normName(p.player);
    map.set(key, { ...(map.get(key) ?? { first: null, anytime: null, multi: null }), first: p.price });
  }
  for (const p of realOdds.tryscorers.anytime) {
    const key = normName(p.player);
    map.set(key, { ...(map.get(key) ?? { first: null, anytime: null, multi: null }), anytime: p.price });
  }
  for (const p of realOdds.tryscorers.multi) {
    const key = normName(p.player);
    map.set(key, { ...(map.get(key) ?? { first: null, anytime: null, multi: null }), multi: p.price });
  }
  return map;
}

function playerName(player: Pick<RankedPlayer, "firstName" | "lastName"> | undefined, fallbackTeam: string) {
  if (!player) return fallbackTeam;
  return `${player.firstName} ${player.lastName}`.trim();
}

function normName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function recentFormScore(form: { result: string }[]) {
  return form.slice(0, 5).reduce((acc, item) => {
    const result = (item.result ?? "").toLowerCase();
    if (result.startsWith("w")) return acc + 1.2;
    if (result.startsWith("d")) return acc + 0.4;
    if (result.startsWith("l")) return acc - 1;
    return acc;
  }, 0);
}

function teamRating(
  row: { played: number; for: number; against: number; diff: number; points: number } | undefined,
  formScore: number,
  h2hPrice: number | undefined,
  homeAdvantage: boolean,
) {
  const played = Math.max(1, row?.played ?? 1);
  const attack = (row?.for ?? 20 * played) / played;
  const defence = (row?.against ?? 20 * played) / played;
  const diffBoost = (row?.diff ?? 0) / played;
  const marketBoost = h2hPrice ? (2.6 - Math.min(h2hPrice, 4.5)) * 1.8 : 0;
  return attack * 0.22 - defence * 0.16 + diffBoost * 0.18 + formScore * 1.5 + marketBoost + (homeAdvantage ? 2.4 : 0);
}

function projectScore(
  row: { played: number; for: number; against: number } | undefined,
  opp: { played: number; for: number; against: number } | undefined,
  formScore: number,
  homeAdvantage: boolean,
  wetWeather: boolean,
  windy: boolean,
) {
  const played = Math.max(1, row?.played ?? 1);
  const oppPlayed = Math.max(1, opp?.played ?? 1);
  const attack = (row?.for ?? 22 * played) / played;
  const oppDefence = (opp?.against ?? 22 * oppPlayed) / oppPlayed;
  const weatherDrop = wetWeather ? 3.5 : 0;
  const windDrop = windy ? 1.5 : 0;
  return clamp(Math.round(((attack + oppDefence) / 2) + formScore + (homeAdvantage ? 1.5 : 0) - weatherDrop - windDrop), 8, 36);
}

function formTag(score: number) {
  if (score >= 2.5) return "sharp";
  if (score >= 0.5) return "steady";
  if (score <= -2) return "under pressure";
  return "patchy";
}

function estimateAnytimeOdds(index: number) {
  return [1.95, 2.25, 2.75, 3.1][index] ?? 3.4;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// After the AI returns, walk every leg and replace estimated odds with the
// real bookie price whenever the pick can be matched. This guarantees what
// users see lines up with TAB / Sportsbet within the same ballpark.
function applyRealOdds(ins: Insights, realOdds: RealOdds | undefined, home: string, away: string): Insights {
  if (!realOdds) return ins;

  const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const tryMap = new Map<string, { first?: number; anytime?: number; multi?: number }>();
  for (const p of realOdds.tryscorers.first) {
    const k = norm(p.player); tryMap.set(k, { ...(tryMap.get(k) ?? {}), first: p.price });
  }
  for (const p of realOdds.tryscorers.anytime) {
    const k = norm(p.player); tryMap.set(k, { ...(tryMap.get(k) ?? {}), anytime: p.price });
  }
  for (const p of realOdds.tryscorers.multi) {
    const k = norm(p.player); tryMap.set(k, { ...(tryMap.get(k) ?? {}), multi: p.price });
  }

  const homeKey = norm(home);
  const awayKey = norm(away);
  const h2hHome = realOdds.h2h.home?.price;
  const h2hAway = realOdds.h2h.away?.price;
  const bestTotal = realOdds.totals[0];

  const lookup = (pickRaw: unknown): number | null => {
    const pick = norm(pickRaw);
    if (!pick) return null;

    // h2h winner
    if (/\b(to win|win( the match)?|h2h|head to head|moneyline)\b/.test(pick) || /^[a-z ]+ win$/i.test(pick.trim())) {
      if (pick.includes(homeKey) && h2hHome) return h2hHome;
      if (pick.includes(awayKey) && h2hAway) return h2hAway;
    }

    // total points
    if (bestTotal && (pick.includes("over") || pick.includes("under"))) {
      const m = pick.match(/(\d+(?:\.\d+)?)/);
      if (m) {
        const line = Number(m[1]);
        if (Math.abs(line - bestTotal.line) <= 1) {
          return pick.includes("over") ? bestTotal.over : bestTotal.under;
        }
      }
    }

    // tryscorer markets — find the player name inside the pick
    const isFirst = /\bfirst tryscorer|\bfirst try|\bfts\b/.test(pick);
    const isMulti = /\b2\+|\bdouble\b|\bhat[- ]?trick\b|\b3\+|\bmulti/.test(pick);
    const isAnytime = /\banytime|\bats\b|\bto score (a try|anytime)/.test(pick) || (!isFirst && !isMulti && /tryscorer|try$/i.test(pick));

    for (const [name, prices] of tryMap) {
      if (pick.includes(name) || pick.includes(name.split(" ").slice(-1)[0])) {
        if (isFirst && prices.first) return prices.first;
        if (isMulti && prices.multi) return prices.multi;
        if (isAnytime && prices.anytime) return prices.anytime;
        // fallback: pick whichever exists if market type unclear
        if (prices.anytime) return prices.anytime;
        if (prices.first) return prices.first;
        if (prices.multi) return prices.multi;
      }
    }
    return null;
  };

  const fixLegs = (legs: BetLeg[]): BetLeg[] =>
    (legs ?? []).map((l) => {
      const safePick = String(l?.pick ?? "");
      const safeOdds = Math.max(1.01, Number(l?.decimalOdds) || 1.01);
      const real = lookup(safePick);
      return { pick: safePick, decimalOdds: real ?? safeOdds };
    });

  if (Array.isArray(ins.bets)) {
    ins.bets = ins.bets.map((b) => ({ ...b, legs: fixLegs(b.legs) }));
  }
  return ins;
}


async function callGateway(
  key: string,
  model: string,
  messages: any[],
  toolDef: any,
  timeoutMs: number,
): Promise<Insights> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      signal: ac.signal,
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        messages,
        tools: [toolDef],
        tool_choice: { type: "function", function: { name: "emit_insights" } },
      }),
    });
  } catch (e) {
    clearTimeout(t);
    if (ac.signal.aborted) throw new Error(`AI insights timed out after ${timeoutMs / 1000}s on ${model}`);
    throw e;
  }
  clearTimeout(t);

  if (res.status === 429) throw new Error("AI rate limit exceeded; try again shortly");
  if (res.status === 402) throw new Error("AI credits exhausted; add credits in Settings → Workspace → Usage");
  if (!res.ok) throw new Error(`AI gateway HTTP ${res.status} on ${model}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as any;
  const choice = data.choices?.[0];
  const call = choice?.message?.tool_calls?.[0];
  const argStr = call?.function?.arguments;
  if (!argStr) {
    const finish = choice?.finish_reason || choice?.native_finish_reason || "unknown";
    console.error(`AI insights: no tool_call from ${model}`, { finish, content: choice?.message?.content?.slice(0, 300) });
    throw new Error(`no structured output from ${model} (finish: ${finish})`);
  }
  return parseInsightsFromToolArgs(argStr, model);
}

function buildToolDef() {
  return {
    type: "function",
    function: {
      name: "emit_insights",
      description: "Return structured NRL match insights inside one JSON string field named payload.",
      parameters: {
        type: "object",
        properties: {
          payload: {
            type: "string",
            description: "A raw JSON string for the FULL insights object requested in the prompt. No markdown fences. The JSON inside payload must include: intelligence (matchOverview, seasonOverview {home, away — each with record, ladderPosition, pointsDifferential, statTrends, vsTopVsBottom, homeAwaySplit, formTrajectory, trajectoryNote, identity}, keysToVictoryAnalyst {home: 3 items, away: 3 items — each {key, targetsWeakness, reasoning}}, strengths {home: 3 items, away: 3 items — each {title, detail, impact}}, weaknesses {home: 3 items, away: 3 items — each {title, detail, howToTarget}}, playersToWatch {home: 5 items (3 backs + 1 half + 1 forward), away: 5 items — each {name, position, bucket, form, role, matchup}}, teamProfile, attackingStructure, defensiveWeaknesses, keyMatchups, gameScript [5 phases], playerInfluence, historicalContext, contextualFactors, rareEventNote, insightSummary), simulation (profile {tempo, tempoNote, dominance, dominanceNote, territoryBalance, scoringPattern, scoringPatternNote, edgeAttack {left, right, middle, note}, defensiveZones, expectedTotalRange {low, high, midpoint}}, summary, recommendedPlays [6-10 with market, pick, decimalOdds, modelProbability, impliedProbability, edgePct, confidence, rationale, scriptAlignment], rankedTryscorers [4-8 with name, team, position, market, decimalOdds, scores {pais, ttcp, matchupExploit, scriptFit, value}, totalScore, confidence, rationale, stackable], correlatedAngle, scriptCaveat), predictedScore, winner, margin, total, htft, firstTryscorer, anytimeTryscorers, multiTryscorer, keysToVictory, keyFactors, weaknessExploit, bets (EXACTLY 4 entries — one per category 'low'|'medium'|'high'|'ultra' — each with category, title, legs[{pick, decimalOdds}], combinedOdds, estimatedOdds, stake, potentialReturn, reasoning, hitRateScore, scriptAlignment), gameFlow, tryscorerScript, and script."
          },
        },
        required: ["payload"],
        additionalProperties: false,
      },
    },
  };
}

function parseInsightsFromToolArgs(argStr: string, model: string): Insights {
  const stripCodeFences = (value: string) => value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsedArgs = JSON.parse(argStr) as { payload?: unknown } | Insights;

    if (parsedArgs && typeof parsedArgs === "object" && "payload" in parsedArgs && typeof parsedArgs.payload === "string") {
      return JSON.parse(stripCodeFences(parsedArgs.payload)) as Insights;
    }

    return parsedArgs as Insights;
  } catch (e) {
    console.error(`AI insights: JSON.parse failed on ${model}`, { len: argStr.length, tail: argStr.slice(-200) });
    throw new Error(`malformed JSON from ${model}`);
  }
}

// Recompute combinedOdds = product(legs) and potentialReturn = stake × combinedOdds.
// Guards against AI arithmetic mistakes — what we render always adds up.
function normaliseBetMath(ins: Insights): Insights {
  const parseStake = (s: unknown) => Number(String(s ?? "").replace(/[^0-9.]/g, "")) || 0;
  const fmtOdds = (n: number) => `$${n.toFixed(2)}`;
  const fmtMoney = (n: number) => {
    if (n >= 1000) return `$${Math.round(n).toLocaleString("en-AU")}`;
    return `$${n.toFixed(2)}`;
  };

  const fixMulti = <T extends { legs: BetLeg[]; stake: string; combinedOdds?: number }>(b: T) => {
    const legs = (b.legs || []).map((l) => ({
      pick: String(l.pick || ""),
      decimalOdds: Math.max(1.01, Number(l.decimalOdds) || 1.01),
    }));
    const combined = legs.reduce((acc, l) => acc * l.decimalOdds, 1);
    const stakeNum = parseStake(b.stake);
    const ret = stakeNum * combined;
    return { ...b, legs, combinedOdds: combined, _return: ret };
  };

  const defaultStakes: Partial<Record<BetCategoryKey, string>> = {
    low: "$10",
    medium: "$10",
    high: "$10",
    ultra: "$10",
  };
  const betOrder: BetCategoryKey[] = ["low", "medium", "high", "ultra"];

  if (Array.isArray(ins.bets)) {
    // Group by category — keep ONE slip per tier (the first valid one).
    const byCat = new Map<BetCategoryKey, BetPlay>();
    ins.bets.forEach((b, index) => {
      const cat = betOrder.includes(b?.category as BetCategoryKey)
        ? (b.category as BetCategoryKey)
        : betOrder[index] ?? "medium";
      if (byCat.has(cat)) return; // first one wins
      const stake = b.stake || defaultStakes[cat] || "$10";
      const fixed = fixMulti({ ...b, stake });
      byCat.set(cat, {
        category: cat,
        title: b.title || "",
        reasoning: b.reasoning || "",
        legs: fixed.legs,
        combinedOdds: fixed.combinedOdds,
        estimatedOdds: fmtOdds(fixed.combinedOdds),
        stake,
        potentialReturn: fmtMoney(fixed._return),
        hitRateScore: typeof b.hitRateScore === "number" ? Math.max(0, Math.min(100, Math.round(b.hitRateScore))) : undefined,
        scriptAlignment: typeof b.scriptAlignment === "string" ? b.scriptAlignment : undefined,
        legCount: fixed.legs.length,
      });
    });
    ins.bets = betOrder.map((c) => byCat.get(c)).filter(Boolean) as BetPlay[];
  }

  return ins;
}
