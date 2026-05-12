// ============================================================================
// Simulation feature builder. Defensive — every metric has a sensible neutral
// default; missing fields lower confidence rather than refusing to run.
// ============================================================================

import type {
  TeamFeatures,
  PlayerFeature,
  SimulationInput,
  EdgeChannel,
} from "./simulation-types";
import type { SourceCoverage, NormalisedTeamStats, NormalisedHistoricalMatch, NormalisedMatchOfficial } from "./nrl-data-types";
import { makeCoverage } from "./source-coverage";
import type { TeamSeasonStats, PlayerSeasonStats, SeasonSnapshot } from "./season-stats";
import { getTeam, getTeamPlayers } from "./season-stats";
import type { NrlPlayer } from "./nrl";
import type { ModelMode } from "./model-mode";
import { buildHeadToHead } from "./head-to-head-model";
import { buildRefereeProfile } from "./referee-model";
import { buildFatigueProfile } from "./fatigue-model";
import { buildRuckTempoProfile } from "./ruck-tempo-model";
import { buildEdgeAttackProfile } from "./edge-attack-model";
import { buildMomentumProfile } from "./momentum-wave-model";

const LEAGUE_AVG = {
  pointsForPerGame: 22,
  metresPerGame: 1500,
  completionRate: 0.78,
  errorsPerGame: 10,
  penaltiesPerGame: 6,
  tackleBreaksPerGame: 28,
  lineBreaksPerGame: 6,
  triesPerGame: 4,
  postContactMetresPerGame: 500,
};

// ---------- Team features ----------
function teamFromSeason(t: TeamSeasonStats | undefined, fallbackNick: string): TeamFeatures {
  if (!t) {
    return {
      nickname: fallbackNick,
      pointsForPerGame: LEAGUE_AVG.pointsForPerGame,
      pointsAgainstPerGame: LEAGUE_AVG.pointsForPerGame,
      triesPerGame: LEAGUE_AVG.triesPerGame,
      triesAgainstPerGame: LEAGUE_AVG.triesPerGame,
      metresPerGame: LEAGUE_AVG.metresPerGame,
      postContactMetresPerGame: LEAGUE_AVG.postContactMetresPerGame,
      completionRate: LEAGUE_AVG.completionRate,
      errorsPerGame: LEAGUE_AVG.errorsPerGame,
      penaltiesPerGame: LEAGUE_AVG.penaltiesPerGame,
      tackleBreaksPerGame: LEAGUE_AVG.tackleBreaksPerGame,
      lineBreaksPerGame: LEAGUE_AVG.lineBreaksPerGame,
      recentForm: 0,
      ruckPressureRating: 50,
      fatigueIndex: 50,
      conversionRate: 0.7,
    };
  }
  // Aggregate run/post-contact metres from per-match stats when available.
  const ms = t.matchStats ?? [];
  const sum = (k: keyof typeof ms[number], def: number) => {
    const vals = ms.map((m) => (m[k] as number | undefined) ?? def).filter((v) => Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : def;
  };

  const runMetresPerGame = sum("runMetres", LEAGUE_AVG.metresPerGame);
  const postContactPerGame = sum("postContactMetres", LEAGUE_AVG.postContactMetresPerGame);
  const errorsPerGame = sum("errors", LEAGUE_AVG.errorsPerGame);
  const penaltiesPerGame = sum("penaltiesConceded", LEAGUE_AVG.penaltiesPerGame);
  const tackleBreaksPerGame = sum("tackleBreaks", LEAGUE_AVG.tackleBreaksPerGame);
  // Completion rate: not in TeamMatchStats. Approximate from errorsPerGame
  // (each error ≈ -1 completion in a ~36-set game) when missing.
  const completionRate = clamp(1 - errorsPerGame / 36, 0.6, 0.95);

  const recentForm = t.last5.length
    ? t.last5.reduce((s, r) => s + (r.result === "W" ? 1 : r.result === "L" ? -1 : 0), 0) / t.last5.length
    : 0;

  // Ruck Pressure Rating: 50 baseline, +postContact-vs-league, +tackleBreaks.
  const rprRaw =
    50
    + (postContactPerGame - LEAGUE_AVG.postContactMetresPerGame) / 8
    + (tackleBreaksPerGame - LEAGUE_AVG.tackleBreaksPerGame) * 0.5;
  const ruckPressureRating = clamp(rprRaw, 20, 90);

  // Fatigue index: bounce off short turnaround (computed in a higher layer
  // when kickoffUtc is known). Default neutral 50 here, raised by error rate.
  const fatigueIndex = clamp(50 + (errorsPerGame - LEAGUE_AVG.errorsPerGame), 30, 80);

  return {
    nickname: t.nickname,
    pointsForPerGame: t.ppgFor || LEAGUE_AVG.pointsForPerGame,
    pointsAgainstPerGame: t.ppgAgainst || LEAGUE_AVG.pointsForPerGame,
    triesPerGame: t.scoringEfficiency || LEAGUE_AVG.triesPerGame,
    triesAgainstPerGame: (t.triesAgainst / Math.max(1, t.played)) || LEAGUE_AVG.triesPerGame,
    metresPerGame: runMetresPerGame,
    postContactMetresPerGame: postContactPerGame,
    completionRate,
    errorsPerGame,
    penaltiesPerGame,
    tackleBreaksPerGame,
    lineBreaksPerGame: LEAGUE_AVG.lineBreaksPerGame,
    recentForm,
    ruckPressureRating,
    fatigueIndex,
    conversionRate: 0.7,
  };
}

// Optionally overlay normalised team stats on top of season aggregates.
function applyNormalisedTeamStats(base: TeamFeatures, n: NormalisedTeamStats | null | undefined): TeamFeatures {
  if (!n) return base;
  return {
    ...base,
    completionRate: n.completionRate || base.completionRate,
    errorsPerGame: n.errorsPerGame || base.errorsPerGame,
    penaltiesPerGame: n.penaltiesPerGame || base.penaltiesPerGame,
    metresPerGame: n.runMetresPerGame || base.metresPerGame,
    postContactMetresPerGame: n.postContactMetresPerGame || base.postContactMetresPerGame,
    tackleBreaksPerGame: n.tackleBreaksPerGame || base.tackleBreaksPerGame,
    lineBreaksPerGame: n.lineBreaksPerGame || base.lineBreaksPerGame,
    triesPerGame: n.triesPerGame || base.triesPerGame,
    triesAgainstPerGame: n.triesAgainstPerGame || base.triesAgainstPerGame,
  };
}

// ---------- Player features ----------
function inferEdgeChannel(position: string, jerseyNumber?: number): EdgeChannel {
  const pos = (position || "").toLowerCase();
  if (jerseyNumber === 2 || jerseyNumber === 3 || pos.includes("right")) return "right";
  if (jerseyNumber === 5 || jerseyNumber === 4 || pos.includes("left")) return "left";
  if (pos.includes("wing") || pos.includes("centre")) {
    // Default unknown wings/centres to alternating; safe neutral assignment.
    return jerseyNumber && jerseyNumber % 2 === 0 ? "right" : "left";
  }
  return "middle";
}

function buildPlayerFeatures(squad: NrlPlayer[], teamNickname: string, byName: Map<string, PlayerSeasonStats>, byId: Map<number, PlayerSeasonStats>): PlayerFeature[] {
  return squad.map((p): PlayerFeature => {
    const fullName = `${p.firstName} ${p.lastName}`.trim();
    const key = fullName.toLowerCase();
    const pid = (p as { playerId?: number }).playerId;
    const stats = byName.get(key) ?? (pid ? byId.get(pid) : undefined);
    const apps = Math.max(1, stats?.matches ?? 1);
    const tries = stats?.tries ?? 0;
    const lineBreaks = stats?.lineBreaks ?? 0;
    const tryAssists = stats?.tryAssists ?? 0;
    const tackleBreaks = stats?.tackleBusts ?? 0;
    return {
      playerId: pid ?? 0,
      name: fullName,
      position: p.position || stats?.position || "",
      teamNickname,
      triesPerGame: tries / apps,
      lineBreaksPerGame: lineBreaks / apps,
      tryAssistsPerGame: tryAssists / apps,
      tackleBreaksPerGame: tackleBreaks / apps,
      edgeChannel: inferEdgeChannel(p.position, p.jerseyNumber),
      availabilityProb: 1, // overridden when injury data present
    };
  });
}

// ---------- Coverage tracker ----------
function buildCoverage(args: { homeStats: TeamSeasonStats | undefined; awayStats: TeamSeasonStats | undefined; homeSquadCount: number; awaySquadCount: number; hasOdds: boolean; hasWeather: boolean }): SourceCoverage {
  const missing: string[] = [];
  if (!args.homeStats?.matchStats?.length) missing.push("home_match_stats");
  if (!args.awayStats?.matchStats?.length) missing.push("away_match_stats");
  if (args.homeSquadCount < 13) missing.push("home_squad");
  if (args.awaySquadCount < 13) missing.push("away_squad");
  if (!args.hasOdds) missing.push("market_odds");
  if (!args.hasWeather) missing.push("weather");
  return makeCoverage({ primary: "nrl.com", sourcesUsed: ["nrl.com"], missingFields: missing });
}

// ---------- Public API ----------
export function buildSimulationInput(args: {
  matchId: string;
  snapshot: SeasonSnapshot;
  homeNickname: string;
  awayNickname: string;
  homeSquad: NrlPlayer[];
  awaySquad: NrlPlayer[];
  modelMode: ModelMode;
  seed?: number;
  iterations?: number;
  // Optional overlays
  normalisedHomeStats?: NormalisedTeamStats | null;
  normalisedAwayStats?: NormalisedTeamStats | null;
  hasOdds?: boolean;
  hasWeather?: boolean;
  weatherTempoModifier?: number;
  // Phase 3 enrichment
  injuries?: { name: string; teamNickname: string; status: "out" | "doubtful" | "test" | "available" }[];
  hasOfficials?: boolean;
  hasNamedTeamLists?: boolean;
  // Phase 4 advanced inputs (all optional).
  history?: NormalisedHistoricalMatch[] | null;
  officials?: NormalisedMatchOfficial[] | null;
  kickoffUtc?: string;
  homeLastMatchUtc?: string | null;
  awayLastMatchUtc?: string | null;
  marketOdds?: { home?: number | null; away?: number | null; draw?: number | null } | null;
  deterministicProb?: { home: number; away: number; draw: number } | null;
  venue?: string | null;
}): SimulationInput {
  const home = getTeam(args.snapshot, args.homeNickname) ?? undefined;
  const away = getTeam(args.snapshot, args.awayNickname) ?? undefined;
  const homeFeatures = applyNormalisedTeamStats(teamFromSeason(home, args.homeNickname), args.normalisedHomeStats);
  const awayFeatures = applyNormalisedTeamStats(teamFromSeason(away, args.awayNickname), args.normalisedAwayStats);

  const homePlayers = getTeamPlayers(args.snapshot, args.homeNickname);
  const awayPlayers = getTeamPlayers(args.snapshot, args.awayNickname);
  const homeByName = new Map(homePlayers.map((p) => [p.name.toLowerCase(), p]));
  const awayByName = new Map(awayPlayers.map((p) => [p.name.toLowerCase(), p]));
  const homeById = new Map(homePlayers.map((p) => [p.playerId, p]));
  const awayById = new Map(awayPlayers.map((p) => [p.playerId, p]));

  let homeFeats = buildPlayerFeatures(args.homeSquad, args.homeNickname, homeByName, homeById);
  let awayFeats = buildPlayerFeatures(args.awaySquad, args.awayNickname, awayByName, awayById);

  // Phase 3: apply injuries → availabilityProb (out=0, doubtful=0.4, test=0.7).
  if (args.injuries?.length) {
    const adj = (feats: PlayerFeature[], nick: string) => feats.map((f) => {
      const inj = args.injuries!.find(
        (i) => i.teamNickname.toLowerCase() === nick.toLowerCase() && i.name.toLowerCase() === f.name.toLowerCase(),
      );
      if (!inj) return f;
      const probMap = { out: 0, doubtful: 0.4, test: 0.7, available: 1 } as const;
      return { ...f, availabilityProb: probMap[inj.status] };
    });
    homeFeats = adj(homeFeats, args.homeNickname);
    awayFeats = adj(awayFeats, args.awayNickname);
  }

  const coverage = buildCoverage({
    homeStats: home ?? undefined,
    awayStats: away ?? undefined,
    homeSquadCount: args.homeSquad.length,
    awaySquadCount: args.awaySquad.length,
    hasOdds: !!args.hasOdds,
    hasWeather: !!args.hasWeather,
  });
  // Note enrichment in coverage.
  if (args.normalisedHomeStats || args.normalisedAwayStats) coverage.sourcesUsed.push("merged");
  if (!args.hasOfficials) coverage.missingFields.push("officials");
  if (args.hasNamedTeamLists === false) coverage.missingFields.push("named_team_lists");

  // Phase 4 advanced profiles.
  const headToHead = buildHeadToHead({
    homeNickname: args.homeNickname, awayNickname: args.awayNickname,
    history: args.history, venue: args.venue ?? null,
  });
  const refereeProfile = buildRefereeProfile(args.officials ?? null);
  const injuriesOutHome = (args.injuries ?? []).filter((i) => i.status === "out" && i.teamNickname.toLowerCase() === args.homeNickname.toLowerCase()).length;
  const injuriesOutAway = (args.injuries ?? []).filter((i) => i.status === "out" && i.teamNickname.toLowerCase() === args.awayNickname.toLowerCase()).length;
  const fatigueProfile = buildFatigueProfile({
    home: { nickname: args.homeNickname, lastMatchUtc: args.homeLastMatchUtc, errorsPerGame: homeFeatures.errorsPerGame, penaltiesPerGame: homeFeatures.penaltiesPerGame, injuriesOut: injuriesOutHome },
    away: { nickname: args.awayNickname, lastMatchUtc: args.awayLastMatchUtc, errorsPerGame: awayFeatures.errorsPerGame, penaltiesPerGame: awayFeatures.penaltiesPerGame, injuriesOut: injuriesOutAway },
    kickoffUtc: args.kickoffUtc,
  });
  const ruckTempoProfile = buildRuckTempoProfile({
    home: { nickname: args.homeNickname, runMetresPerGame: homeFeatures.metresPerGame, postContactMetresPerGame: homeFeatures.postContactMetresPerGame, tackleBreaksPerGame: homeFeatures.tackleBreaksPerGame, completionRate: homeFeatures.completionRate, errorsPerGame: homeFeatures.errorsPerGame, penaltiesPerGame: homeFeatures.penaltiesPerGame, lineBreaksPerGame: homeFeatures.lineBreaksPerGame },
    away: { nickname: args.awayNickname, runMetresPerGame: awayFeatures.metresPerGame, postContactMetresPerGame: awayFeatures.postContactMetresPerGame, tackleBreaksPerGame: awayFeatures.tackleBreaksPerGame, completionRate: awayFeatures.completionRate, errorsPerGame: awayFeatures.errorsPerGame, penaltiesPerGame: awayFeatures.penaltiesPerGame, lineBreaksPerGame: awayFeatures.lineBreaksPerGame },
    weatherTempoModifier: args.weatherTempoModifier,
  });
  const edgeAttackProfile = buildEdgeAttackProfile({
    homePlayers: homeFeats, awayPlayers: awayFeats,
    hasNamedTeamLists: args.hasNamedTeamLists,
  });
  const momentumProfile = buildMomentumProfile({
    homeHtLeadRate: home?.htLeadRate, awayHtLeadRate: away?.htLeadRate,
    homeHtConversionRate: home?.htConversionRate, awayHtConversionRate: away?.htConversionRate,
    homeRecentForm: homeFeatures.recentForm, awayRecentForm: awayFeatures.recentForm,
    fatigue: fatigueProfile, ruckTempo: ruckTempoProfile,
  });

  return {
    matchId: args.matchId,
    homeFeatures,
    awayFeatures,
    homePlayers: homeFeats,
    awayPlayers: awayFeats,
    homeAdvantage: 3,
    weatherTempoModifier: args.weatherTempoModifier,
    seed: args.seed ?? hashSeed(args.matchId),
    iterations: args.iterations ?? 10_000,
    coverage,
    modelMode: args.modelMode,
    headToHead,
    refereeProfile,
    fatigueProfile,
    ruckTempoProfile,
    edgeAttackProfile,
    momentumProfile,
    marketOdds: args.marketOdds ?? null,
    deterministicProb: args.deterministicProb ?? null,
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
