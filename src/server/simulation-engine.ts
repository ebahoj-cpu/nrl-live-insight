// ============================================================================
// Monte Carlo simulation engine.
//
// Replaces the small `model/simulation.ts` proof-of-concept with a richer
// engine that:
//   - uses a seeded RNG for reproducibility
//   - simulates per-team try counts (Poisson) with team strength + home edge
//   - assigns each try to a player based on edge-channel + attacking
//     involvement weights
//   - models conversions (binomial) + extras (penalty / field goals)
//   - models halftime split (~45% of total points expected pre-half on average)
//   - tracks margin bands, upsets, blowouts, HT/FT permutations
//   - returns per-player first / anytime / multi-try probabilities
//
// All randomness flows through a Mulberry32 PRNG seeded by SimulationInput.seed
// so the same input always yields the same output (critical for tests + cache).
// ============================================================================

import type {
  PlayerFeature,
  PlayerProbability,
  SimulationInput,
  SimulationSummary,
  TeamFeatures,
  RefereeFeatures,
} from "./simulation-types";
import { computeConfidence } from "./confidence";
import { calibrateProbabilities } from "./probability-calibration";
import { buildModelDrivers } from "./model-driver-explainer";

const ADVANCED_MODEL_VERSION = 4;

// ---------- Seeded RNG (Mulberry32) ----------
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Distributions ----------
function poisson(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0; let p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  }
  // Normal approximation
  const u = rng() || 1e-9;
  const v = rng() || 1e-9;
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

function binomial(n: number, p: number, rng: () => number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}

// ---------- Lambda calculations ----------
// Convert team features into expected try count for THIS match.
function expectedTries(attack: TeamFeatures, defence: TeamFeatures, isHome: boolean, ref?: RefereeFeatures, weatherTempo?: number, extraTotalLift = 0): number {
  const base = (attack.triesPerGame * 0.6) + (defence.triesAgainstPerGame * 0.4);
  const formDelta = (attack.recentForm - defence.recentForm) * 0.1;
  const tempoDelta = ((attack.metresPerGame - defence.metresPerGame) / 1500) * 0.08;
  const rprDelta = ((attack.ruckPressureRating - 50) / 100) * 0.12;
  const fatigueDelta = ((defence.fatigueIndex - 50) / 100) * 0.08;
  const homeDelta = isHome ? 0.05 : -0.02;
  const weatherDelta = weatherTempo ? -Math.max(0, -weatherTempo) * 0.1 : 0;
  const refDelta = ref ? (ref.totalsTendency * 0.05) : 0;
  const extraLift = Math.max(-0.08, Math.min(0.08, extraTotalLift));
  return Math.max(0.3, base * (1 + formDelta + tempoDelta + rprDelta + fatigueDelta + homeDelta + weatherDelta + refDelta + extraLift));
}

// ---------- Player attacking weights ----------
// Weight table mapping a player's attacking involvement to their probability
// of being the try-scorer when their team scores. Forwards capped lower.
function playerScoreWeight(p: PlayerFeature): number {
  const positionMult = (() => {
    const pos = (p.position || "").toLowerCase();
    if (pos.includes("wing")) return 1.6;
    if (pos.includes("fullback")) return 1.4;
    if (pos.includes("centre")) return 1.3;
    if (pos.includes("five-eighth") || pos.includes("halfback")) return 1.0;
    if (pos.includes("hooker")) return 0.8;
    if (pos.includes("lock")) return 0.7;
    if (pos.includes("second-row") || pos.includes("back-row")) return 0.85;
    if (pos.includes("prop")) return 0.5;
    return 0.9;
  })();
  const involvement =
    p.triesPerGame * 1.2
    + p.lineBreaksPerGame * 0.6
    + p.tryAssistsPerGame * 0.3
    + p.tackleBreaksPerGame * 0.05
    + 0.05; // baseline so no player is impossible
  return involvement * positionMult * p.availabilityProb;
}

function buildWeights(players: PlayerFeature[]): { weights: number[]; total: number } {
  const weights = players.map(playerScoreWeight);
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  return { weights, total };
}

function pickWeightedIndex(weights: number[], total: number, rng: () => number): number {
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r <= acc) return i;
  }
  return weights.length - 1;
}

// ---------- Engine ----------
export function runSimulation(input: SimulationInput): SimulationSummary {
  const rng = makeRng(input.seed);
  const { homeFeatures, awayFeatures, homePlayers, awayPlayers, referee, weatherTempoModifier, iterations } = input;

  // Phase 4: aggregate bounded total lift from advanced models. Each input is
  // already capped at its source; here we re-clamp the combined value.
  const refTotalPts = input.refereeProfile?.totalPointsModifier ?? 0;
  const ruckTotalPts = input.ruckTempoProfile?.totalPointsModifier ?? 0;
  const fatigueTotalPts = input.fatigueProfile?.totalPointsModifier ?? 0;
  const h2hTotalPts = input.headToHead?.totalModifier ?? 0;
  // Convert points-per-game into a multiplicative lift on lambda (very small).
  const totalPtsCombined = Math.max(-6, Math.min(6, refTotalPts + ruckTotalPts + fatigueTotalPts + h2hTotalPts));
  const extraLift = totalPtsCombined / 100; // ±0.06 max

  const lambdaHome = expectedTries(homeFeatures, awayFeatures, true, referee, weatherTempoModifier, extraLift);
  const lambdaAway = expectedTries(awayFeatures, homeFeatures, false, referee, weatherTempoModifier, extraLift);

  const homeWeights = buildWeights(homePlayers);
  const awayWeights = buildWeights(awayPlayers);

  // Per-player counters
  const homeAnyHits = new Array<number>(homePlayers.length).fill(0);
  const homeMultiHits = new Array<number>(homePlayers.length).fill(0);
  const homeFirstHits = new Array<number>(homePlayers.length).fill(0);
  const awayAnyHits = new Array<number>(awayPlayers.length).fill(0);
  const awayMultiHits = new Array<number>(awayPlayers.length).fill(0);
  const awayFirstHits = new Array<number>(awayPlayers.length).fill(0);
  // Expected tries accumulator
  const homeExpTries = new Array<number>(homePlayers.length).fill(0);
  const awayExpTries = new Array<number>(awayPlayers.length).fill(0);

  // Outcome counters
  let homeWins = 0, awayWins = 0, draws = 0;
  let upsets = 0, blowouts = 0;
  let band112 = 0, band13 = 0;
  let totalScoreSum = 0, totalMarginSum = 0;
  let homeScoreSum = 0, awayScoreSum = 0;
  // For over/under at the rounded line (computed after expected total settles)
  const totals: number[] = new Array(iterations);
  // HT/FT bucket counter
  const htft = new Map<string, number>();

  // Pre-compute expected favourite to flag upsets
  const preFavouriteHome = lambdaHome > lambdaAway;

  for (let iter = 0; iter < iterations; iter++) {
    const homeTries = poisson(lambdaHome, rng);
    const awayTries = poisson(lambdaAway, rng);
    const homeConv = binomial(homeTries, homeFeatures.conversionRate, rng);
    const awayConv = binomial(awayTries, awayFeatures.conversionRate, rng);
    const homeExtras = rng() < 0.55 ? 2 : 0;
    const awayExtras = rng() < 0.55 ? 2 : 0;

    // Assign tries to players
    const perPlayerHome = new Array<number>(homePlayers.length).fill(0);
    const perPlayerAway = new Array<number>(awayPlayers.length).fill(0);
    let firstScorerHomeIdx = -1;
    let firstScorerAwayIdx = -1;
    let firstScorerSide: "home" | "away" | null = null;

    for (let t = 0; t < homeTries; t++) {
      const idx = pickWeightedIndex(homeWeights.weights, homeWeights.total, rng);
      perPlayerHome[idx]++;
      if (firstScorerSide === null) { firstScorerSide = "home"; firstScorerHomeIdx = idx; }
    }
    for (let t = 0; t < awayTries; t++) {
      const idx = pickWeightedIndex(awayWeights.weights, awayWeights.total, rng);
      perPlayerAway[idx]++;
      // First-try selection: if home didn't score yet OR away "scored first"
      // (modelled with a 50/50 ordering when both teams scored), assign here.
      if (firstScorerSide === null) { firstScorerSide = "away"; firstScorerAwayIdx = idx; }
      else if (firstScorerSide === "home" && rng() < 0.45) {
        // Small chance the away try landed before the home one chronologically.
        firstScorerSide = "away"; firstScorerAwayIdx = idx;
      }
    }

    for (let i = 0; i < homePlayers.length; i++) {
      const c = perPlayerHome[i];
      homeExpTries[i] += c;
      if (c >= 1) homeAnyHits[i]++;
      if (c >= 2) homeMultiHits[i]++;
    }
    for (let i = 0; i < awayPlayers.length; i++) {
      const c = perPlayerAway[i];
      awayExpTries[i] += c;
      if (c >= 1) awayAnyHits[i]++;
      if (c >= 2) awayMultiHits[i]++;
    }
    if (firstScorerSide === "home" && firstScorerHomeIdx >= 0) homeFirstHits[firstScorerHomeIdx]++;
    if (firstScorerSide === "away" && firstScorerAwayIdx >= 0) awayFirstHits[firstScorerAwayIdx]++;

    const homePts = homeTries * 4 + homeConv * 2 + homeExtras;
    const awayPts = awayTries * 4 + awayConv * 2 + awayExtras;
    const total = homePts + awayPts;
    const margin = homePts - awayPts;

    totals[iter] = total;
    totalScoreSum += total;
    totalMarginSum += margin;
    homeScoreSum += homePts;
    awayScoreSum += awayPts;

    if (margin > 0) homeWins++;
    else if (margin < 0) awayWins++;
    else draws++;

    const am = Math.abs(margin);
    if (am === 0) { /* draw */ }
    else if (am <= 12) band112++;
    else { band13++; blowouts++; }

    // Upset = the pre-game favourite lost decisively
    if (am >= 1) {
      if (preFavouriteHome && margin < 0) upsets++;
      else if (!preFavouriteHome && margin > 0) upsets++;
    }

    // HT/FT — split: each team's HT score = binomial(fullPts, 0.45)
    const homeHt = Math.round(homePts * (0.4 + rng() * 0.1));
    const awayHt = Math.round(awayPts * (0.4 + rng() * 0.1));
    const htWinner = homeHt > awayHt ? "home" : homeHt < awayHt ? "away" : "draw";
    const ftWinner = margin > 0 ? "home" : margin < 0 ? "away" : "draw";
    const key = `${htWinner}/${ftWinner}`;
    htft.set(key, (htft.get(key) ?? 0) + 1);
  }

  const N = iterations;
  const expectedTotal = totalScoreSum / N;
  const expectedMargin = totalMarginSum / N;
  const expectedHomeScore = homeScoreSum / N;
  const expectedAwayScore = awayScoreSum / N;
  const totalLine = Math.round(expectedTotal * 2) / 2;
  let overCount = 0;
  for (const t of totals) if (t > totalLine) overCount++;

  const homeWinProb = homeWins / N;
  const awayWinProb = awayWins / N;
  const drawProb = draws / N;
  const decided = Math.max(1, homeWins + awayWins);

  const playerProbabilities: PlayerProbability[] = [
    ...homePlayers.map((p, i): PlayerProbability => ({
      playerId: p.playerId,
      name: p.name,
      teamNickname: p.teamNickname,
      position: p.position,
      firstTryProb: homeFirstHits[i] / N,
      anytimeProb: homeAnyHits[i] / N,
      multiTryProb: homeMultiHits[i] / N,
      expectedTries: homeExpTries[i] / N,
    })),
    ...awayPlayers.map((p, i): PlayerProbability => ({
      playerId: p.playerId,
      name: p.name,
      teamNickname: p.teamNickname,
      position: p.position,
      firstTryProb: awayFirstHits[i] / N,
      anytimeProb: awayAnyHits[i] / N,
      multiTryProb: awayMultiHits[i] / N,
      expectedTries: awayExpTries[i] / N,
    })),
  ];

  const htftProbabilities: Record<string, number> = {};
  for (const [k, v] of htft.entries()) htftProbabilities[k] = v / N;

  // Confidence
  const conf = computeConfidence({
    coverage: input.coverage,
    modelProbability: Math.max(homeWinProb, awayWinProb),
    iterations,
    squadsNamed: input.modelMode !== "early",
    marketAvailable: input.modelMode === "market" || input.modelMode === "final",
    hasOfficials: !!input.referee,
  });

  return {
    matchId: input.matchId,
    iterations,
    seed: input.seed,
    homeWinProb,
    awayWinProb,
    drawProb,
    expectedHomeScore,
    expectedAwayScore,
    expectedTotal,
    totalLine,
    overProbAtLine: overCount / N,
    expectedMargin,
    marginBands: {
      draw: drawProb,
      "1-12": band112 / decided,
      "13+": band13 / decided,
    },
    upsetProb: upsets / N,
    blowoutProb: blowouts / N,
    htftProbabilities,
    playerProbabilities: playerProbabilities.sort((a, b) => b.anytimeProb - a.anytimeProb),
    confidence: conf.tier,
    coverage: input.coverage,
    generatedAt: new Date().toISOString(),
  };
}
