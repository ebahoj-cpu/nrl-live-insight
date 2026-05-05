// Hard Earned History — derives a per-team work-rate signal from each team's
// recent completed matches (using stats already captured in SeasonSnapshot).
// Produces a confidence modifier consumed by the insights, script and bets
// engines. Pure function. No AI, no network.
//
// Source data: TeamMatchStats (NRL.com stat groups, harvested by season-stats.ts)
// Output: TeamHardEarned (last 1/3/5 averages, trend, fatigue, bounce-back,
//         false-positive flags) and a MatchHardEarnedReport for two teams.

import type { SeasonSnapshot, TeamMatchStats } from "./season-stats";
import { getTeam } from "./season-stats";

export type HardEarnedTrend = "improving" | "stable" | "declining";

export type TeamHardEarned = {
  nickname: string;
  matchesUsed: number;
  // Raw rolling averages of the per-match score (positive = high work-rate)
  lastMatchScore: number | null;
  last3Avg: number | null;
  last5Avg: number | null;
  // Normalised 0-100 rating (50 = league-average effort, with bonuses /
  // penalties for opponent edge, error rate and fatigue)
  rating: number;
  trend: HardEarnedTrend;
  // Derived flags — empty string when not triggered, short label otherwise
  fatigueRisk: string;        // e.g. "High workload + 5-day turnaround"
  bounceBackSignal: string;   // e.g. "Strong-effort loss last round"
  falsePositiveSignal: string; // e.g. "Win flattered by low grind"
  // Coverage notes — which inputs were estimated vs raw
  estimatedFields: string[];
};

export type MatchHardEarnedReport = {
  home: TeamHardEarned;
  away: TeamHardEarned;
  grindAdvantageTeam: "home" | "away" | "even";
  // Bets confidence modifier in [-25..+25] applied to the model's chosen
  // winner. Positive = supports the model. Negative = caution.
  confidenceAdjustment: number;
  // Short paragraph the Insights / Script tabs render verbatim.
  summary: string;
  // Bets-specific guidance lines — read by bets-engine.ts
  bets: {
    winnerDelta: number;       // ±15 max
    margin13PlusDelta: number; // ±15
    margin1to12Delta: number;  // ±10
    underDelta: number;        // ±10
    overDelta: number;         // ±10
    note: string;
  };
};

// ---------- Score formula ----------
// hardEarnedScore =
//   runs * 2
//   + runMetres / 10
//   + postContactMetres / 10
//   + tackles
//   + tackleBreaks
//   + offloads
//   + supports
//   + decoys
//   + chargeDowns
//   + lineEngagements
//   - missedTackles
//   - errors * 4
//   - penaltiesConceded * 4
//   - sinBins * 8
//
// runMetres / postContactMetres are divided by 10 to keep them on the same
// order of magnitude as the integer fields (typical run-metres = 1500–2000).

function rawScore(m: TeamMatchStats): number {
  const v = (n?: number) => (typeof n === "number" ? n : 0);
  return (
    v(m.runs) * 2
    + v(m.runMetres) / 10
    + v(m.postContactMetres) / 10
    + v(m.tackles)
    + v(m.tackleBreaks)
    + v(m.offloads)
    + v(m.supports)
    + v(m.decoys)
    + v(m.chargeDowns)
    + v(m.lineEngagements)
    - v(m.missedTackles)
    - v(m.errors) * 4
    - v(m.penaltiesConceded) * 4
    - v(m.sinBins) * 8
  );
}

// Returns which key fields were missing / estimated for a given match so we
// can be transparent in the Insights tab.
function missingFields(m: TeamMatchStats): string[] {
  const missing: string[] = [];
  const has = (k: keyof TeamMatchStats) => typeof m[k] === "number";
  if (!has("runs")) missing.push("runs");
  if (!has("runMetres")) missing.push("runMetres");
  if (!has("tackles")) missing.push("tackles");
  if (!has("missedTackles")) missing.push("missedTackles");
  if (!has("errors")) missing.push("errors");
  return missing;
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function trendFrom(scores: number[]): HardEarnedTrend {
  if (scores.length < 3) return "stable";
  const recent = scores.slice(-3);
  const earlier = scores.slice(0, -3);
  const earlyAvg = earlier.length ? avg(earlier)! : recent[0];
  const recentAvg = avg(recent)!;
  const delta = recentAvg - earlyAvg;
  // Threshold ~5% of earlyAvg, with floor 8 raw points
  const band = Math.max(8, Math.abs(earlyAvg) * 0.05);
  if (delta > band) return "improving";
  if (delta < -band) return "declining";
  return "stable";
}

function shortTurnaround(matchStats: TeamMatchStats[], upcomingKickoffUtc?: string): boolean {
  if (matchStats.length === 0 || !upcomingKickoffUtc) return false;
  const last = matchStats[matchStats.length - 1];
  const lastKo = Date.parse(last.kickoffUtc);
  const next = Date.parse(upcomingKickoffUtc);
  if (!Number.isFinite(lastKo) || !Number.isFinite(next)) return false;
  const days = (next - lastKo) / (24 * 3600_000);
  return days > 0 && days <= 5.5;
}

// ---------- Per-team rating ----------

function computeTeam(
  snap: SeasonSnapshot,
  nickname: string,
  upcomingKickoffUtc?: string,
): TeamHardEarned {
  const team = getTeam(snap, nickname);
  const matches = (team?.matchStats ?? []).slice(-5);
  if (matches.length === 0 || !team) {
    return {
      nickname,
      matchesUsed: 0,
      lastMatchScore: null,
      last3Avg: null,
      last5Avg: null,
      rating: 50,
      trend: "stable",
      fatigueRisk: "",
      bounceBackSignal: "",
      falsePositiveSignal: "",
      estimatedFields: ["no completed matches yet"],
    };
  }

  const scores = matches.map(rawScore);
  const last5Avg = avg(scores)!;
  const last3Avg = avg(scores.slice(-3))!;
  const lastScore = scores[scores.length - 1];
  const trend = trendFrom(scores);

  // League average across all teams in snapshot (same formula)
  const leagueScores: number[] = [];
  for (const t of Object.values(snap.teams)) {
    for (const m of (t.matchStats ?? [])) leagueScores.push(rawScore(m));
  }
  const leagueAvg = leagueScores.length ? avg(leagueScores)! : last5Avg;

  // Opponent edge — last match score vs opponent's same-week score (when known)
  const lastM = matches[matches.length - 1];
  let opponentEdge = 0;
  const opp = getTeam(snap, lastM.opponentNickname);
  const oppMatch = opp?.matchStats?.find((m) => m.matchId === lastM.matchId);
  if (oppMatch) {
    const oppScore = rawScore(oppMatch);
    if (oppScore > 0) {
      // Edge is normalised to ±15 points of rating
      opponentEdge = clamp(((lastScore - oppScore) / Math.max(50, oppScore)) * 30, -15, 15);
    }
  }
  // League edge — last3 vs league average, bounded ±15
  const leagueEdge = clamp(((last3Avg - leagueAvg) / Math.max(50, leagueAvg)) * 30, -15, 15);

  // Error / fatigue penalties
  const lastErrors = (lastM.errors ?? 0) + (lastM.penaltiesConceded ?? 0);
  const errorPenalty = clamp(lastErrors * 1.5, 0, 12);
  const fatigueShortTurn = shortTurnaround(matches, upcomingKickoffUtc);
  const highLastWorkload = lastScore > leagueAvg + 25;
  const fatiguePenalty = fatigueShortTurn && highLastWorkload ? 8 : fatigueShortTurn ? 4 : 0;

  const rating = clamp(50 + opponentEdge + leagueEdge - errorPenalty - fatiguePenalty, 0, 100);

  // ---- Flags ----
  const lastWasLoss = lastM.result === "L";
  const lastWasWin = lastM.result === "W";
  const strongEffort = lastScore > leagueAvg + 15 && (lastM.errors ?? 0) <= 10;
  const weakEffort = lastScore < leagueAvg - 15;

  const bounceBackSignal = lastWasLoss && strongEffort
    ? "Strong-effort loss — bounce-back potential."
    : "";
  const falsePositiveSignal = lastWasWin && weakEffort
    ? "Win flattered by low work-rate."
    : "";
  const fatigueParts: string[] = [];
  if (highLastWorkload) fatigueParts.push("High workload last game");
  if (fatigueShortTurn) fatigueParts.push("short turnaround");
  const fatigueRisk = fatigueParts.length >= 2 ? fatigueParts.join(" + ") : "";

  // Estimated fields (any inputs missing from the most recent match)
  const estimatedFields = Array.from(new Set(matches.flatMap(missingFields)));

  return {
    nickname,
    matchesUsed: matches.length,
    lastMatchScore: lastScore,
    last3Avg,
    last5Avg,
    rating,
    trend,
    fatigueRisk,
    bounceBackSignal,
    falsePositiveSignal,
    estimatedFields,
  };
}

// ---------- Match-level report ----------

export function buildMatchHardEarned(args: {
  snapshot: SeasonSnapshot;
  homeNickname: string;
  awayNickname: string;
  modelWinner: "home" | "away";
  upcomingKickoffUtc?: string;
}): MatchHardEarnedReport {
  const home = computeTeam(args.snapshot, args.homeNickname, args.upcomingKickoffUtc);
  const away = computeTeam(args.snapshot, args.awayNickname, args.upcomingKickoffUtc);

  const ratingDiff = home.rating - away.rating;
  const grindAdvantageTeam: "home" | "away" | "even" =
    Math.abs(ratingDiff) < 4 ? "even" : ratingDiff > 0 ? "home" : "away";

  const winnerSide = args.modelWinner;
  const winner = winnerSide === "home" ? home : away;
  const loser = winnerSide === "home" ? away : home;
  const winnerNick = winner.nickname;
  const loserNick = loser.nickname;

  // ---- Confidence adjustment ----
  let winnerDelta = 0;
  // 1) Hard Earned aligns with model winner
  const heFavoursWinner = (winnerSide === "home" && grindAdvantageTeam === "home")
    || (winnerSide === "away" && grindAdvantageTeam === "away");
  const heFavoursLoser = (winnerSide === "home" && grindAdvantageTeam === "away")
    || (winnerSide === "away" && grindAdvantageTeam === "home");
  if (heFavoursWinner) winnerDelta += 8;
  if (heFavoursLoser) winnerDelta -= 10;
  // 2) Bounce-back / false-positive flags
  if (loser.bounceBackSignal) winnerDelta -= 5;
  if (winner.falsePositiveSignal) winnerDelta -= 5;
  if (winner.bounceBackSignal) winnerDelta += 4;
  if (loser.falsePositiveSignal) winnerDelta += 4;
  // 3) Fatigue
  if (winner.fatigueRisk) winnerDelta -= 6;
  if (loser.fatigueRisk) winnerDelta += 4;
  winnerDelta = clamp(winnerDelta, -25, 25);

  // ---- Margin / total leans ----
  let margin13PlusDelta = 0;
  let margin1to12Delta = 0;
  // Underdog has strong grind → shrink blowout odds
  if (heFavoursLoser) margin13PlusDelta -= 8;
  if (heFavoursLoser) margin1to12Delta += 5;
  // Favourite strong + opponent declining → expand blowout
  if (heFavoursWinner && loser.trend === "declining") margin13PlusDelta += 8;
  if (winner.fatigueRisk) margin13PlusDelta -= 4;

  let underDelta = 0;
  let overDelta = 0;
  // Both teams high grind → tighter contest, lean under
  if (home.rating >= 60 && away.rating >= 60) underDelta += 6;
  // One team grinding, opponent fatigued → late points, lean over
  if ((winner.rating >= 60 && loser.fatigueRisk) || (loser.rating >= 60 && winner.fatigueRisk)) {
    overDelta += 5;
  }

  margin13PlusDelta = clamp(margin13PlusDelta, -15, 15);
  margin1to12Delta = clamp(margin1to12Delta, -10, 10);
  underDelta = clamp(underDelta, -10, 10);
  overDelta = clamp(overDelta, -10, 10);

  // ---- Summary text (used verbatim by Insights/Script tabs) ----
  const lines: string[] = [];
  if (grindAdvantageTeam === "even") {
    lines.push(`Hard Earned form is level — both sides grading similar work-rate over the last ${Math.max(home.matchesUsed, away.matchesUsed)} games.`);
  } else {
    const advNick = grindAdvantageTeam === "home" ? home.nickname : away.nickname;
    lines.push(`Hard Earned form favours ${advNick}.`);
  }
  if (loser.bounceBackSignal) lines.push(`${loserNick}: ${loser.bounceBackSignal}`);
  if (winner.bounceBackSignal) lines.push(`${winnerNick}: ${winner.bounceBackSignal}`);
  if (winner.falsePositiveSignal) lines.push(`${winnerNick}: ${winner.falsePositiveSignal}`);
  if (loser.falsePositiveSignal) lines.push(`${loserNick}: ${loser.falsePositiveSignal}`);
  if (winner.fatigueRisk) lines.push(`${winnerNick}: ${winner.fatigueRisk}.`);
  if (loser.fatigueRisk) lines.push(`${loserNick}: ${loser.fatigueRisk}.`);

  // Impact on prediction
  if (winnerDelta >= 5) {
    lines.push(`Supports the ${winnerNick} model pick.`);
  } else if (winnerDelta <= -5) {
    lines.push(`Tempers confidence in the ${winnerNick} model pick.`);
  }
  if (margin13PlusDelta <= -5) lines.push(`Reduces 13+ blowout edge.`);
  else if (margin13PlusDelta >= 5) lines.push(`Strengthens 13+ blowout edge.`);
  if (underDelta >= 5) lines.push(`Leans under on totals.`);
  if (overDelta >= 5) lines.push(`Leans over / late points.`);

  const summary = lines.join(" ");

  const noteParts: string[] = [];
  if (winnerDelta !== 0) noteParts.push(`winner ${winnerDelta > 0 ? "+" : ""}${winnerDelta}`);
  if (margin13PlusDelta !== 0) noteParts.push(`13+ ${margin13PlusDelta > 0 ? "+" : ""}${margin13PlusDelta}`);
  if (underDelta !== 0) noteParts.push(`under +${underDelta}`);
  if (overDelta !== 0) noteParts.push(`over +${overDelta}`);
  const note = noteParts.length ? `Hard Earned: ${noteParts.join(", ")}` : "Hard Earned: neutral";

  return {
    home,
    away,
    grindAdvantageTeam,
    confidenceAdjustment: winnerDelta,
    summary,
    bets: { winnerDelta, margin13PlusDelta, margin1to12Delta, underDelta, overDelta, note },
  };
}

// ---------- Helpers ----------

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
