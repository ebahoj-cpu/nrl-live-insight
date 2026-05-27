// =============================================================================
// PERFORMANCE EDGE — MAJOR 2026 OVERHAUL
// Now realistic, calibrated against current NRL leaders, forwards get fair Attack,
// Energy is no longer overly punitive, Form reacts to hot streaks.
// =============================================================================

import type { PlayerSeasonStats } from "@/server/player-profile";

export type SkillKey = "attack" | "agility" | "defence" | "handling" | "strength" | "kicking";

export type SkillRating = {
  key: SkillKey;
  label: string;
  base: number;
  final: number;
  word: string;
  tone: "great" | "good" | "ok" | "low";
};

export type EnergyTier = "Supercharged" | "High" | "Moderate" | "Tired" | "Fatigued";
export type FormTier = "Red Hot" | "Good Form" | "Average" | "Below Average" | "Cold";
export type ExperienceTier = "ROOKIE" | "EMERGING" | "ESTABLISHED" | "SEASONED" | "VETERAN" | "STALWART" | "LEGEND";

export type PerformanceEdge = {
  skills: SkillRating[];
  energy: { tier: EnergyTier; modifier: number; minutesPerGame: number | null };
  form: { tier: FormTier; modifier: number };
  experience: { tier: ExperienceTier; pct: number; caps: number };
  overall: number;
};

// Position grouping (unchanged)
type PositionGroup = "forward" | "spine" | "back" | "edge";
function groupForPosition(position: string | null | undefined): PositionGroup {
  const p = (position ?? "").toLowerCase();
  if (/(prop|lock|hooker|second.row|backrow|back-row|back row)/.test(p)) return "forward";
  if (/(halfback|five.eighth|fiveeighth|five-eighth|fullback)/.test(p)) return "spine";
  if (/(wing|centre|center)/.test(p)) return "back";
  if (/(edge)/.test(p)) return "edge";
  return "forward";
}

// Improved weights — forwards now get better Attack credit
const WEIGHTS: Record<SkillKey, Record<PositionGroup, number>> = {
  attack:   { forward: 1.15, spine: 1.15, back: 1.10, edge: 1.00 },
  agility:  { forward: 0.90, spine: 1.05, back: 1.25, edge: 1.10 },
  defence:  { forward: 1.10, spine: 0.95, back: 0.90, edge: 1.05 },
  handling: { forward: 1.00, spine: 1.15, back: 1.00, edge: 1.00 },
  strength: { forward: 1.25, spine: 0.85, back: 0.90, edge: 1.15 },
  kicking:  { forward: 0.30, spine: 1.30, back: 0.40, edge: 0.40 },
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function perGame(total: number, apps: number): number {
  return apps > 0 ? total / apps : 0;
}

// ==================== IMPROVED BASE SKILLS ====================
function baseAttack(s: PlayerSeasonStats): number {
  const tries = perGame(s.tries, s.appearances);
  const assists = perGame(s.tryAssists, s.appearances);
  const breaks = perGame(s.lineBreaks + 0.5 * s.lineBreakAssists, s.appearances);
  const metres = perGame(s.totalRunMetres, s.appearances);
  const pcm = perGame(s.postContactMetres, s.appearances);
  const tb = perGame(s.tackleBreaks, s.appearances);

  const score = (tries * 25) + (assists * 20) + (breaks * 20) + (metres / 20) + (pcm / 40) + (tb * 8);
  return clamp(score);
}

function baseAgility(s: PlayerSeasonStats): number {
  const breaks = perGame(s.lineBreaks, s.appearances);
  const tb = perGame(s.tackleBreaks, s.appearances);
  const metres = perGame(s.totalRunMetres, s.appearances);
  const score = breaks * 45 + tb * 25 + (metres / 15) * 1.5;
  return clamp(score);
}

function baseDefence(s: PlayerSeasonStats): number {
  const made = s.tacklesMade;
  const missed = s.tacklesMissed;
  const rate = made + missed > 0 ? made / (made + missed) : 0.85;
  const perGameTackles = perGame(made, s.appearances);
  const score = rate * 55 + (perGameTackles / 28) * 45;
  return clamp(score);
}

function baseHandling(s: PlayerSeasonStats): number {
  const offloads = perGame(s.offloads, s.appearances);
  const errors = perGame(s.errors, s.appearances);
  return clamp(55 + (offloads - errors) * 18);
}

function baseStrength(s: PlayerSeasonStats): number {
  const tb = perGame(s.tackleBreaks, s.appearances);
  const pcm = perGame(s.postContactMetres, s.appearances);
  const score = (tb / 4.5) * 50 + (pcm / 45) * 50;
  return clamp(score);
}

function baseKicking(s: PlayerSeasonStats): number {
  if (s.averageKickingMetres <= 0 && s.goals <= 0 && s.fieldGoals <= 0 && s.forcedDropOuts <= 0) return 10;
  const km = s.averageKickingMetres;
  const dropOuts = perGame(s.forcedDropOuts, s.appearances);
  const score = (km / 320) * 55 + dropOuts * 25 + (s.goals > 0 ? 20 : 0);
  return clamp(score);
}

// ==================== ENERGY — NOW SMART FOR LOW-GAME PLAYERS ====================
function calculateEnergy(s: PlayerSeasonStats): { tier: EnergyTier; modifier: number; minutesPerGame: number | null } {
  const appearances = Math.max(1, s.appearances ?? 0);
  const mpg = s.minutesPerGame ?? 65;

  let baseMod = 1.0;
  // Workload tiers (most starters land on Moderate/High)
  if (mpg < 45) baseMod = 1.22;           // bench / very fresh
  else if (mpg < 65) baseMod = 1.12;      // rotational
  else if (mpg <= 78) baseMod = 1.02;     // normal starter
  else if (mpg <= 82) baseMod = 0.98;     // slightly heavy
  else baseMod = 0.94;                    // very heavy load

  // ── SMART GAMES-MISSED LOGIC ──
  // Players with very few games (e.g. Ponga 2-3 games) treated as FRESH returners
  let missedPenalty: number;
  if (appearances <= 5) {
    missedPenalty = 1.18;                 // fresh returnee bonus
  } else {
    const gamesMissed = Math.max(0, 27 - appearances);
    missedPenalty = Math.max(0.92, 1 - (gamesMissed / 27) * 0.10); // very gentle
  }

  // Hot form players feel fresher (inline form heuristic to avoid circular dep)
  const triesPerGame = perGame(s.tries, s.appearances);
  const breaksPerGame = perGame(s.lineBreaks, s.appearances);
  const metresPerGame = perGame(s.totalRunMetres, s.appearances);
  const tbPerGame = perGame(s.tackleBreaks, s.appearances);
  const formScore = (triesPerGame * 35) + (breaksPerGame * 25) + (metresPerGame / 12) + (tbPerGame * 12);
  const formBonus = formScore > 80 ? 1.08 : 1.0;

  let finalMod = baseMod * missedPenalty * formBonus;
  finalMod = clamp(finalMod, 0.88, 1.25);

  // Tier — majority of the roster should now be Moderate or better
  const tier: EnergyTier =
    finalMod > 1.14 ? "Supercharged" :
    finalMod > 1.07 ? "High" :
    finalMod > 0.97 ? "Moderate" :
    finalMod > 0.92 ? "Tired" : "Fatigued";

  return { tier, modifier: finalMod, minutesPerGame: mpg };
}

// ==================== FORM ====================
function calculateForm(s: PlayerSeasonStats): { tier: FormTier; modifier: number } {
  const triesPerGame = perGame(s.tries, s.appearances);
  const breaksPerGame = perGame(s.lineBreaks, s.appearances);
  const metresPerGame = perGame(s.totalRunMetres, s.appearances);
  const tbPerGame = perGame(s.tackleBreaks, s.appearances);

  const formScore = (triesPerGame * 35) + (breaksPerGame * 25) + (metresPerGame / 12) + (tbPerGame * 12);

  let tier: FormTier = "Average";
  let mod = 1.0;

  if (formScore > 110) { tier = "Red Hot"; mod = 1.22; }
  else if (formScore > 80) { tier = "Good Form"; mod = 1.12; }
  else if (formScore > 55) { tier = "Average"; mod = 1.00; }
  else if (formScore > 35) { tier = "Below Average"; mod = 0.88; }
  else { tier = "Cold"; mod = 0.78; }

  return { tier, modifier: mod };
}

// ==================== EXPERIENCE ====================
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

function experienceModifier(tier: ExperienceTier, skill: SkillKey): number {
  const boost = { ROOKIE: 0, EMERGING: 0.5, ESTABLISHED: 1.2, SEASONED: 2.2, VETERAN: 3.2, STALWART: 4.2, LEGEND: 5 }[tier] / 100;
  if (skill === "defence" || skill === "handling") return 1 + boost * 1.3;
  return 1 + boost * 0.4;
}

export function describe(score: number): { word: string; tone: SkillRating["tone"] } {
  if (score >= 85) return { word: "Marvelous", tone: "great" };
  if (score >= 75) return { word: "Superior", tone: "great" };
  if (score >= 65) return { word: "Good", tone: "good" };
  if (score >= 55) return { word: "Moderate", tone: "ok" };
  if (score >= 45) return { word: "Average", tone: "ok" };
  if (score >= 35) return { word: "Below Avg", tone: "low" };
  return { word: "Poor", tone: "low" };
}

// Kept exports for backwards compatibility with any external imports
export function energyTier(minutesPerGame: number | null): EnergyTier {
  if (minutesPerGame == null) return "Moderate";
  if (minutesPerGame >= 70) return "Supercharged";
  if (minutesPerGame >= 60) return "High";
  if (minutesPerGame >= 50) return "Moderate";
  if (minutesPerGame >= 40) return "Tired";
  return "Fatigued";
}

export function formTier(recentMultiplier: number): FormTier {
  if (recentMultiplier >= 1.25) return "Red Hot";
  if (recentMultiplier >= 1.10) return "Good Form";
  if (recentMultiplier >= 0.90) return "Average";
  if (recentMultiplier >= 0.75) return "Below Average";
  return "Cold";
}

// ==================== MAIN ====================
export function computePerformanceEdge(args: {
  position: string | null | undefined;
  seasonStats: PlayerSeasonStats;
  careerAppearances?: number;
  recentMultiplier?: number;
}): PerformanceEdge {
  const group = groupForPosition(args.position);
  const s = args.seasonStats;
  const energy = calculateEnergy(s);
  const form = calculateForm(s);
  const caps = args.careerAppearances ?? 0;
  const exp = experienceTierFromCaps(caps);

  const SKILL_BASES = [
    { key: "attack" as const,   label: "Attack",        base: baseAttack(s) },
    { key: "agility" as const,  label: "Agility/Speed", base: baseAgility(s) },
    { key: "defence" as const,  label: "Defence",       base: baseDefence(s) },
    { key: "handling" as const, label: "Handling",      base: baseHandling(s) },
    { key: "strength" as const, label: "Strength",      base: baseStrength(s) },
    { key: "kicking" as const,  label: "Kicking",       base: baseKicking(s) },
  ];

  const skills: SkillRating[] = SKILL_BASES.map(({ key, label, base }) => {
    const weighted = clamp(base * WEIGHTS[key][group]);
    const expMod = experienceModifier(exp.tier, key);
    const final = clamp(weighted * energy.modifier * form.modifier * expMod);
    const { word, tone } = describe(final);
    return { key, label, base: Math.round(weighted), final: Math.round(final), word, tone };
  });

  const overall = Math.round(skills.reduce((a, x) => a + x.final, 0) / skills.length);

  return {
    skills,
    energy,
    form,
    experience: { tier: exp.tier, pct: exp.pct, caps },
    overall,
  };
}
