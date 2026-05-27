// =============================================================================
// PERFORMANCE EDGE — our original 7-skill player rating model.
//
// Goal: turn raw NRL season stats into a 0-100 score per skill, then surface
// that as a descriptive word + coloured progress bar in the player modal.
//
// MODEL PIPELINE
// --------------
//   final = clamp(baseSkill * energyModifier * formModifier, 0, 99)
//
//   baseSkill (0-100): position-aware function of real season per-game stats.
//                      Each skill normalises its raw inputs against a hard
//                      "elite" ceiling (e.g. 25 tackles/game = 100 for a
//                      forward's Defence) so a value of 50 = league-average.
//   energyModifier:    season average minutes per game -> ±15%.
//   formModifier:      last 4-6 game form vs season -> ±18%.
//
// POSITION WEIGHTS
// ----------------
//   We map every NRL position to one of four groups: "forward", "spine",
//   "back", "edge". Each skill has a weight per group that boosts/dampens
//   the raw base score so a wing's Defence isn't punished against a prop's
//   ceiling and vice versa.
//
// DESCRIPTIVE WORDS
// -----------------
//   85+  Marvelous   75-84 Superior   65-74 Good      55-64 Moderate
//   45-54 Average    35-44 Below Avg  <35  Poor
//
// Everything in this file is pure and dependency-free so it can run on the
// server (inside the player profile server fn) or directly in the client.
// =============================================================================

import type { PlayerSeasonStats } from "@/server/player-profile";

export type SkillKey =
  | "attack" | "agility" | "defence"
  | "handling" | "strength" | "kicking";

export type SkillRating = {
  key: SkillKey;
  label: string;
  base: number;        // 0-100 before modifiers
  final: number;       // 0-100 after modifiers
  word: string;
  tone: "great" | "good" | "ok" | "low";
};

export type EnergyTier = "Supercharged" | "High" | "Moderate" | "Tired" | "Fatigued";
export type FormTier = "Red Hot" | "Good Form" | "Average" | "Below Average" | "Cold";
export type ExperienceTier =
  | "ROOKIE" | "EMERGING" | "ESTABLISHED" | "SEASONED"
  | "VETERAN" | "STALWART" | "LEGEND";

export type PerformanceEdge = {
  skills: SkillRating[];
  energy: { tier: EnergyTier; modifier: number; minutesPerGame: number | null };
  form: { tier: FormTier; modifier: number };
  experience: { tier: ExperienceTier; pct: number; caps: number };
  overall: number;
};

// ---------- Position grouping --------------------------------------------
type PositionGroup = "forward" | "spine" | "back" | "edge";

function groupForPosition(position: string | null | undefined): PositionGroup {
  const p = (position ?? "").toLowerCase();
  if (/(prop|lock|hooker|second.row|backrow|back-row|back row)/.test(p)) return "forward";
  if (/(halfback|five.eighth|fiveeighth|five-eighth|fullback)/.test(p)) return "spine";
  if (/(wing|centre|center)/.test(p)) return "back";
  if (/(edge)/.test(p)) return "edge";
  return "forward";
}

// weights: multiplier applied to the base 0-100 score. 1.0 = neutral.
const WEIGHTS: Record<SkillKey, Record<PositionGroup, number>> = {
  attack:   { forward: 0.85, spine: 1.15, back: 1.10, edge: 1.00 },
  agility:  { forward: 0.85, spine: 1.05, back: 1.20, edge: 1.05 },
  defence:  { forward: 1.10, spine: 0.95, back: 0.90, edge: 1.05 },
  handling: { forward: 0.95, spine: 1.15, back: 1.00, edge: 1.00 },
  strength: { forward: 1.20, spine: 0.85, back: 0.90, edge: 1.10 },
  kicking:  { forward: 0.30, spine: 1.30, back: 0.40, edge: 0.40 },
};

// ---------- Base skill calculators ---------------------------------------
// Each returns a 0-100 number. Inputs are PER-GAME averages where possible.

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function perGame(total: number, apps: number): number {
  return apps > 0 ? total / apps : 0;
}


function baseAttack(s: PlayerSeasonStats): number {
  const tries = perGame(s.tries, s.appearances);
  const assists = perGame(s.tryAssists, s.appearances);
  const breaks = perGame(s.lineBreaks + 0.5 * s.lineBreakAssists, s.appearances);
  const metres = perGame(s.totalRunMetres, s.appearances);
  // weighted composite, normalised vs elite season
  const score = tries * 30 + assists * 22 + breaks * 18 + metres / 25;
  return clamp(score);
}

function baseAgility(s: PlayerSeasonStats): number {
  const breaks = perGame(s.lineBreaks, s.appearances);
  const breakouts = perGame(s.tackleBreaks, s.appearances);
  const mpr = s.totalRunMetres > 0 ? s.totalRunMetres / Math.max(1, s.totalRunMetres / 9) : 0;
  const score = breaks * 40 + breakouts * 10 + (mpr - 8) * 8;
  return clamp(score);
}

function baseDefence(s: PlayerSeasonStats): number {
  const made = s.tacklesMade;
  const missed = s.tacklesMissed;
  const rate = made + missed > 0 ? made / (made + missed) : 0.85;
  const perGameTackles = perGame(made, s.appearances);
  // 92% efficiency + 30 tackles/game = peak
  const score = rate * 60 + (perGameTackles / 30) * 40;
  return clamp(score);
}

function baseHandling(s: PlayerSeasonStats): number {
  const offloads = perGame(s.offloads, s.appearances);
  const errors = perGame(s.errors, s.appearances);
  const net = offloads - errors;
  // baseline 55 (league avg), each net offload/game = +15 pts, capped
  return clamp(55 + net * 15);
}

function baseStrength(s: PlayerSeasonStats): number {
  const breaks = perGame(s.tackleBreaks, s.appearances);
  const pcm = perGame(s.postContactMetres, s.appearances);
  // elite: 5 tackle busts + 50 post-contact metres / game
  const score = (breaks / 5) * 55 + (pcm / 50) * 45;
  return clamp(score);
}

function baseKicking(s: PlayerSeasonStats): number {
  if (s.averageKickingMetres <= 0 && s.goals <= 0 && s.fieldGoals <= 0 && s.forcedDropOuts <= 0) {
    return 10;     // non-kicker baseline (still shows on chart)
  }
  const km = s.averageKickingMetres;
  const dropOuts = perGame(s.forcedDropOuts, s.appearances);
  // goal kicking %: derive from goals + points if possible
  const score = (km / 350) * 50 + dropOuts * 20 + (s.goals > 0 ? 25 : 0) + (s.fieldGoals > 0 ? 5 : 0);
  return clamp(score);
}

// ---------- Modifiers -----------------------------------------------------

export function energyTier(minutesPerGame: number | null): EnergyTier {
  if (minutesPerGame == null) return "Moderate";
  if (minutesPerGame >= 70) return "Supercharged";
  if (minutesPerGame >= 60) return "High";
  if (minutesPerGame >= 50) return "Moderate";
  if (minutesPerGame >= 40) return "Tired";
  return "Fatigued";
}

function calculateEnergy(
  s: PlayerSeasonStats,
): { tier: EnergyTier; modifier: number; minutesPerGame: number | null } {
  const mpg = s.minutesPerGame;
  const gamesMissed = Math.max(0, 27 - (s.appearances ?? 0));

  let baseMod = 1.0;
  if (mpg != null && mpg < 40) baseMod = 1.15;       // fresh / bench
  else if (mpg != null && mpg > 75) baseMod = 0.88;  // heavy workload

  const finalMod = Math.max(0.75, Math.min(1.25, baseMod * (1 - gamesMissed * 0.008)));

  const tier: EnergyTier =
    finalMod > 1.12 ? "Supercharged" :
    finalMod > 1.05 ? "High" :
    finalMod > 0.95 ? "Moderate" :
    finalMod > 0.85 ? "Tired" : "Fatigued";

  return { tier, modifier: finalMod, minutesPerGame: mpg };
}

export function formTier(recentMultiplier: number): FormTier {
  if (recentMultiplier >= 1.25) return "Red Hot";
  if (recentMultiplier >= 1.10) return "Good Form";
  if (recentMultiplier >= 0.90) return "Average";
  if (recentMultiplier >= 0.75) return "Below Average";
  return "Cold";
}

function formModifier(tier: FormTier): number {
  switch (tier) {
    case "Red Hot":       return 1.18;
    case "Good Form":     return 1.08;
    case "Average":       return 1.00;
    case "Below Average": return 0.92;
    case "Cold":          return 0.85;
  }
}

// ---------- Experience ----------------------------------------------------

function experienceTierFromCaps(caps: number): { tier: ExperienceTier; pct: number } {
  const pct = Math.max(2, Math.min(100, (caps / 250) * 100));
  let tier: ExperienceTier;
  if (caps <= 20) tier = "ROOKIE";
  else if (caps <= 50) tier = "EMERGING";
  else if (caps <= 75) tier = "ESTABLISHED";
  else if (caps <= 100) tier = "SEASONED";
  else if (caps <= 150) tier = "VETERAN";
  else if (caps <= 200) tier = "STALWART";
  else tier = "LEGEND";
  return { tier, pct };
}

const EXP_BOOST: Record<ExperienceTier, number> = {
  ROOKIE: 0, EMERGING: 0.5, ESTABLISHED: 1.5, SEASONED: 2.5,
  VETERAN: 3.5, STALWART: 4.5, LEGEND: 5,
};

function experienceModifier(tier: ExperienceTier, skillKey: SkillKey): number {
  const boost = EXP_BOOST[tier] / 100;
  if (skillKey === "defence" || skillKey === "handling") return 1 + boost * 1.2;
  return 1 + boost * 0.3;
}

// ---------- Descriptive word ---------------------------------------------

export function describe(final: number): { word: string; tone: SkillRating["tone"] } {
  if (final >= 85) return { word: "Marvelous", tone: "great" };
  if (final >= 75) return { word: "Superior", tone: "great" };
  if (final >= 65) return { word: "Good", tone: "good" };
  if (final >= 55) return { word: "Moderate", tone: "good" };
  if (final >= 45) return { word: "Average", tone: "ok" };
  if (final >= 35) return { word: "Below Average", tone: "low" };
  return { word: "Poor", tone: "low" };
}

// ---------- Public API ----------------------------------------------------

export function computePerformanceEdge(args: {
  position: string | null | undefined;
  seasonStats: PlayerSeasonStats;
  careerAppearances?: number;
  recentMultiplier?: number;
}): PerformanceEdge {
  const group = groupForPosition(args.position);
  const s = args.seasonStats;
  const energy = calculateEnergy(s);
  const fTier = formTier(args.recentMultiplier ?? 1.0);
  const fMod = formModifier(fTier);
  const caps = args.careerAppearances ?? 0;
  const exp = experienceTierFromCaps(caps);

  const SKILL_BASES: { key: SkillKey; label: string; base: number }[] = [
    { key: "attack",   label: "Attack",        base: baseAttack(s)   },
    { key: "agility",  label: "Agility/Speed", base: baseAgility(s)  },
    { key: "defence",  label: "Defence",       base: baseDefence(s)  },
    { key: "handling", label: "Handling",      base: baseHandling(s) },
    { key: "strength", label: "Strength",      base: baseStrength(s) },
    { key: "kicking",  label: "Kicking",       base: baseKicking(s)  },
  ];

  const skills: SkillRating[] = SKILL_BASES.map(({ key, label, base }) => {
    const weighted = clamp(base * WEIGHTS[key][group]);
    const expMod = experienceModifier(exp.tier, key);
    const final = clamp(weighted * energy.modifier * fMod * expMod);
    const { word, tone } = describe(final);
    return { key, label, base: Math.round(weighted), final: Math.round(final), word, tone };
  });

  const overall = Math.round(skills.reduce((a, x) => a + x.final, 0) / skills.length);

  return {
    skills,
    energy,
    form: { tier: fTier, modifier: fMod },
    experience: { tier: exp.tier, pct: exp.pct, caps },
    overall,
  };
}

