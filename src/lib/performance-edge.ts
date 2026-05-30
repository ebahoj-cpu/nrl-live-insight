// =============================================================================
// PERFORMANCE EDGE — 2026 LEAN REWRITE
//
// Surfaces only four skills (Attack, Defence, Handling, Temperament) on top
// of the three context bars (Experience, Form, Energy).
//
// Final formula per skill:
//   final = clamp( base × energyModifier × formModifier + experienceBonus, 0, 100 )
//
//   - Energy modifier:      +12% / +5% / 0% / -8% / -15%
//   - Form modifier:        +18% / +8% / 0% / -8% / -15%
//   - Experience bonus:     flat +0..+8 points (Veteran gets the biggest boost)
// =============================================================================

import type { PlayerSeasonStats } from "@/server/player-profile";

export type SkillKey = "attack" | "defence" | "handling" | "temperament";

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
  experience: { tier: ExperienceTier; pct: number; caps: number; bonus: number };
  overall: number;
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}
function perGame(total: number, apps: number): number {
  return apps > 0 ? total / apps : 0;
}

// ==================== BASE SKILL CALCULATIONS (0..100) ====================

// Attack: tries + try assists + line breaks + tackle busts + metres (normalised).
// Calibrated so a top-tier attacking back (~1 try, 0.5 TA, 1 LB, 3 TB, 150m) ≈ 90.
function baseAttack(s: PlayerSeasonStats): number {
  const apps = Math.max(1, s.appearances);
  const score =
    perGame(s.tries, apps) * 22 +
    perGame(s.tryAssists, apps) * 18 +
    perGame(s.lineBreaks, apps) * 16 +
    perGame(s.tackleBreaks, apps) * 9 +
    perGame(s.totalRunMetres, apps) / 6; // 150m → 25 pts
  return clamp(score);
}

// Defence: pure tackle efficiency, weighted slightly by volume.
function baseDefence(s: PlayerSeasonStats): number {
  const made = s.tacklesMade;
  const missed = s.tacklesMissed;
  const denom = made + missed;
  if (denom === 0) return 50;
  const efficiency = made / denom;            // 0..1
  const volume = clamp(perGame(made, Math.max(1, s.appearances)) / 30, 0, 1); // 30+/g ≈ max
  return clamp(efficiency * 80 + volume * 20);
}

// Handling: try assists + line break assists + offloads minus errors.
function baseHandling(s: PlayerSeasonStats): number {
  const apps = Math.max(1, s.appearances);
  const positive =
    perGame(s.tryAssists, apps) * 20 +
    perGame(s.lineBreakAssists, apps) * 14 +
    perGame(s.offloads, apps) * 12;
  const errors = perGame(s.errors, apps) * 14;
  return clamp(50 + positive - errors);
}

// Temperament: discipline indicator. Lower penalties (and errors when penalty
// data is missing) → much higher score.
// Falls back gracefully when NRL.com doesn't expose penaltiesConceded.
function baseTemperament(s: PlayerSeasonStats): number {
  const apps = Math.max(1, s.appearances);
  const penalties = (s as { penaltiesConceded?: number }).penaltiesConceded ?? null;
  if (penalties != null) {
    const pen = perGame(penalties, apps);
    // 0 pen/g = 100, 1 pen/g = 72, 2 pen/g = 44, 3 pen/g = 16
    return clamp(100 - pen * 28);
  }
  // Fallback: use handling errors as a discipline proxy.
  const errPg = perGame(s.errors, apps);
  return clamp(95 - errPg * 18);
}

// ==================== CONTEXT BARS ====================

function calculateEnergy(s: PlayerSeasonStats): { tier: EnergyTier; modifier: number; minutesPerGame: number | null } {
  const appearances = Math.max(1, s.appearances ?? 0);
  const mpg = s.minutesPerGame ?? 65;

  let tier: EnergyTier;
  if (appearances <= 5 || mpg < 50) tier = "Supercharged";
  else if (mpg < 65) tier = "High";
  else if (mpg <= 78) tier = "Moderate";
  else if (mpg <= 84) tier = "Tired";
  else tier = "Fatigued";

  const modifier =
    tier === "Supercharged" ? 1.12 :
    tier === "High"         ? 1.05 :
    tier === "Moderate"     ? 1.00 :
    tier === "Tired"        ? 0.92 : 0.85;

  return { tier, modifier, minutesPerGame: mpg };
}

function calculateForm(s: PlayerSeasonStats): { tier: FormTier; modifier: number } {
  const apps = Math.max(1, s.appearances);
  const formScore =
    perGame(s.tries, apps) * 30 +
    perGame(s.lineBreaks, apps) * 22 +
    perGame(s.tackleBreaks, apps) * 10 +
    perGame(s.offloads, apps) * 9 +
    perGame(s.totalRunMetres, apps) / 6 +
    perGame(s.tacklesMade, apps) / 3;

  let tier: FormTier;
  if (formScore > 130) tier = "Red Hot";
  else if (formScore > 95) tier = "Good Form";
  else if (formScore > 65) tier = "Average";
  else if (formScore > 45) tier = "Below Average";
  else tier = "Cold";

  const modifier =
    tier === "Red Hot"       ? 1.18 :
    tier === "Good Form"     ? 1.08 :
    tier === "Average"       ? 1.00 :
    tier === "Below Average" ? 0.92 : 0.85;

  return { tier, modifier };
}

function experienceTierFromCaps(caps: number): { tier: ExperienceTier; pct: number; bonus: number } {
  const pct = Math.max(2, Math.min(100, (caps / 250) * 100));
  let tier: ExperienceTier;
  if (caps <= 20) tier = "ROOKIE";
  else if (caps <= 50) tier = "EMERGING";
  else if (caps <= 75) tier = "ESTABLISHED";
  else if (caps <= 100) tier = "SEASONED";
  else if (caps <= 150) tier = "VETERAN";
  else if (caps <= 200) tier = "STALWART";
  else tier = "LEGEND";
  // Flat bonus added to final skill score (Veteran peaks at +8).
  const bonus =
    tier === "ROOKIE"      ? 0 :
    tier === "EMERGING"    ? 3 :
    tier === "ESTABLISHED" ? 4 :
    tier === "SEASONED"    ? 6 :
    tier === "VETERAN"     ? 8 :
    tier === "STALWART"    ? 7 : 7;
  return { tier, pct, bonus };
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

// Back-compat exports (used elsewhere historically — keep stable).
export function energyTier(minutesPerGame: number | null): EnergyTier {
  if (minutesPerGame == null) return "Moderate";
  if (minutesPerGame >= 80) return "Fatigued";
  if (minutesPerGame >= 70) return "Tired";
  if (minutesPerGame >= 60) return "Moderate";
  if (minutesPerGame >= 50) return "High";
  return "Supercharged";
}
export function formTier(recentMultiplier: number): FormTier {
  if (recentMultiplier >= 1.15) return "Red Hot";
  if (recentMultiplier >= 1.05) return "Good Form";
  if (recentMultiplier >= 0.95) return "Average";
  if (recentMultiplier >= 0.85) return "Below Average";
  return "Cold";
}

// ==================== LEADERBOARD BOOSTS ====================
// Top-5 finishes nudge the relevant skill base + form modifier upwards.

type LeaderboardEntry = { title: string; rank: number };

function rankBonus(rank: number): number {
  if (rank <= 0) return 0;
  return Math.max(0, 18 - (rank - 1) * 3); // #1=18, #2=15, #3=12, #4=9, #5=6
}

function skillsForCategory(title: string): SkillKey[] {
  const t = title.toLowerCase();
  if (t.includes("try assist")) return ["attack", "handling"];
  if (t.includes("try")) return ["attack"];
  if (t.includes("line break assist")) return ["handling"];
  if (t.includes("line break") || t.includes("linebreak")) return ["attack"];
  if (t.includes("tackle break") || t.includes("bust")) return ["attack"];
  if (t.includes("offload")) return ["handling"];
  if (t.includes("run metre") || t.includes("metres")) return ["attack"];
  if (t.includes("tackle") && !t.includes("missed")) return ["defence"];
  if (t.includes("error")) return ["temperament"];
  return [];
}

function applyLeaderboardBoost(
  baseByKey: Record<SkillKey, number>,
  rankings: LeaderboardEntry[] | undefined,
): { boosted: Record<SkillKey, number>; formBonus: number } {
  const boosted = { ...baseByKey };
  if (!rankings || rankings.length === 0) return { boosted, formBonus: 1.0 };
  let bestRank = 99;
  let topFiveHits = 0;
  for (const r of rankings) {
    const bonus = rankBonus(r.rank);
    if (bonus <= 0) continue;
    topFiveHits++;
    if (r.rank < bestRank) bestRank = r.rank;
    for (const k of skillsForCategory(r.title)) {
      boosted[k] = clamp(boosted[k] + bonus);
    }
  }
  let formBonus = 1.0;
  if (bestRank === 1) formBonus = 1.15;
  else if (bestRank <= 3) formBonus = 1.10;
  else if (topFiveHits > 0) formBonus = 1.05;
  return { boosted, formBonus };
}

// ==================== MAIN ====================

const SKILL_LABELS: Record<SkillKey, string> = {
  attack: "Attack",
  defence: "Defence",
  handling: "Handling",
  temperament: "Temperament",
};
const KEYS: SkillKey[] = ["attack", "defence", "handling", "temperament"];

export function computePerformanceEdge(args: {
  position: string | null | undefined;
  seasonStats: PlayerSeasonStats;
  careerAppearances?: number;
  recentMultiplier?: number;
  rankings?: LeaderboardEntry[];
}): PerformanceEdge {
  const s = args.seasonStats;
  const energy = calculateEnergy(s);
  const baseForm = calculateForm(s);
  const caps = args.careerAppearances ?? 0;
  const exp = experienceTierFromCaps(caps);

  const rawBases: Record<SkillKey, number> = {
    attack:      baseAttack(s),
    defence:     baseDefence(s),
    handling:    baseHandling(s),
    temperament: baseTemperament(s),
  };

  const { boosted, formBonus } = applyLeaderboardBoost(rawBases, args.rankings);

  // Re-tier form once leaderboard bonus is folded in.
  const boostedFormMod = clamp(baseForm.modifier * formBonus, 0.5, 1.4);
  const form: PerformanceEdge["form"] = {
    tier:
      boostedFormMod >= 1.15 ? "Red Hot" :
      boostedFormMod >= 1.05 ? "Good Form" :
      boostedFormMod >= 0.95 ? "Average" :
      boostedFormMod >= 0.88 ? "Below Average" : "Cold",
    modifier: boostedFormMod,
  };

  const skills: SkillRating[] = KEYS.map((key) => {
    const base = boosted[key];
    // Temperament reflects discipline — energy/form shouldn't swing it as much.
    const final = key === "temperament"
      ? clamp(base + exp.bonus * 0.5)
      : clamp(base * energy.modifier * form.modifier + exp.bonus);
    const { word, tone } = describe(final);
    return { key, label: SKILL_LABELS[key], base: Math.round(base), final: Math.round(final), word, tone };
  });

  const overall = Math.round(skills.reduce((a, x) => a + x.final, 0) / skills.length);

  return {
    skills,
    energy,
    form,
    experience: { tier: exp.tier, pct: exp.pct, caps, bonus: exp.bonus },
    overall,
  };
}
