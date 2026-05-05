// Deterministic Game Script generator.
//
// Produces a short, sharp, betting-focused script of HOW the match will play
// out and the betting angles each phase creates. No AI, no narrative filler.
// Reads the same inputs as the insights engine so it stays consistent with
// the Bets tab — never contradicts a deterministic pick.
//
// Mode rules (enforced in this file):
//   early  → no player names, no try-scorer leans, append "early model" note
//   squad  → player names allowed, no first-tryscorer lean
//   market → can reference player markets (anytime)
//   final  → strongest script — late changes + final lineups

import type { DeterministicInsights, EngineInputs } from "./insights-engine";
import type { TeamSeasonStats } from "./season-stats";
import { getTeam } from "./season-stats";
import type { ModelMode, ModelConfidence } from "./model-mode";

export type EdgeConfidence = "proxy" | "market-supported" | "unclear";

export type ScriptPayload = {
  mode: ModelMode;
  confidence: ModelConfidence;
  summary: string;            // 2-3 short lines
  phases: {
    first20: string;
    twenty40: string;
    forty60: string;
    sixty80: string;
  };
  edges: {
    left: string;
    right: string;
    middle: string;
    leftConfidence: EdgeConfidence;
    rightConfidence: EdgeConfidence;
  };
  betting: {
    winnerLean: string;
    marginLean: string;
    totalLean: string;
    tryscorerLean: string;
  };
  earlyNote?: string;
};

export function generateScript(inp: EngineInputs, engine: DeterministicInsights): ScriptPayload {
  const mode = engine.mode;
  const confidence = engine.confidence;

  const home = teamOr(inp, inp.homeNickname);
  const away = teamOr(inp, inp.awayNickname);
  const winnerHome = engine.matchWinner.team === "home";
  const winnerNick = engine.matchWinner.nickname;
  const loserNick = winnerHome ? inp.awayNickname : inp.homeNickname;
  const winnerStats = winnerHome ? home : away;
  const loserStats = winnerHome ? away : home;

  const projectedTotal = engine.predictedScore.home + engine.predictedScore.away;
  const projectedMargin = Math.abs(engine.predictedScore.home - engine.predictedScore.away);
  const blowout = projectedMargin >= 13;
  const tightLine = projectedMargin <= 6;

  // ---------- 1. Game Script Summary (2-3 short lines) ----------
  const summary = buildSummary(winnerNick, loserNick, winnerStats, loserStats, projectedMargin, blowout);

  // ---------- 2-5. Phase scripts ----------
  const first20 = buildFirst20(winnerNick, loserNick, winnerStats, loserStats, projectedTotal, engine);
  const twenty40 = build2040(winnerNick, loserNick, winnerStats, loserStats, engine);
  const forty60 = build4060(winnerNick, loserNick, winnerStats, projectedTotal, engine);
  const sixty80 = build6080(winnerNick, loserNick, projectedMargin, engine);

  // ---------- 6-8. Edge scripts ----------
  const lineupReady = mode !== "early";
  const homeEdge = (side: "left" | "right") => lineupReady ? edgePlayer(inp, "home", side) : null;
  const awayEdge = (side: "left" | "right") => lineupReady ? edgePlayer(inp, "away", side) : null;

  const marketSupportsName = (name: string | null): boolean => {
    if (!name) return false;
    if (mode !== "market" && mode !== "final") return false;
    const first = engine.firstTryscorer?.name;
    const any = engine.topAnytimeOverall?.map((p) => p.name) ?? [];
    return (first && first === name) || any.includes(name);
  };

  const left = buildEdge("left", inp, mode, winnerNick, winnerStats, loserStats, homeEdge("left"), awayEdge("left"), winnerHome, lineupReady, marketSupportsName);
  const right = buildEdge("right", inp, mode, winnerNick, winnerStats, loserStats, homeEdge("right"), awayEdge("right"), winnerHome, lineupReady, marketSupportsName);
  const middle = buildMiddle(winnerNick, loserNick, winnerStats, loserStats, projectedMargin, projectedTotal);

  // ---------- 9. Betting translation ----------
  const winnerLean = winnerNick;
  const marginLean = `${winnerNick} ${engine.margin.bucket}`;
  const totalLean = `${engine.totalPoints.lean === "over" ? "Over" : "Under"} ${engine.totalPoints.line}`;
  let tryscorerLean: string;
  if (mode === "early") {
    tryscorerLean = "Update after Tuesday team lists";
  } else if (mode === "squad") {
    const top = engine.topAnytimeOverall?.[0]?.name;
    tryscorerLean = top ? `${top} anytime — first tryscorer locked until player markets open` : "Awaiting market for first tryscorer";
  } else {
    const first = engine.firstTryscorer?.name;
    const any = engine.topAnytimeOverall?.[0]?.name;
    if (first && first !== "Awaiting team list" && !/^awaiting/i.test(first)) {
      tryscorerLean = `${first} first / ${any ?? first} anytime`;
    } else if (any) {
      tryscorerLean = `${any} anytime`;
    } else {
      tryscorerLean = "No qualifying tryscorer pick";
    }
  }

  return {
    mode,
    confidence,
    summary,
    phases: { first20, twenty40, forty60, sixty80 },
    edges: { left, right, middle },
    betting: { winnerLean, marginLean, totalLean, tryscorerLean },
    earlyNote: mode === "early"
      ? "Early model — player-specific script updates after Tuesday 7pm team lists."
      : undefined,
  };

  // tightLine reserved for future tighten-up logic
  void tightLine;
}

// ---------- Builders ----------

function buildSummary(w: string, l: string, ws: TeamSeasonStats, ls: TeamSeasonStats, mg: number, blowout: boolean): string {
  const territory = ws.ppgAgainst < ls.ppgAgainst ? `${w} should control territory` : `${l} need to win the territory battle to stay close`;
  const flow = blowout
    ? `If ${w} lead at the break the 13+ margin becomes live.`
    : mg >= 8
      ? `Projects close into the back half before ${w} pull clear.`
      : `Projects close throughout — one-score finish is in play.`;
  return `${territory} early through completion and field position. ${l} need broken-play scoring to stay in touch. ${flow}`;
}

function buildFirst20(w: string, _l: string, ws: TeamSeasonStats, _ls: TeamSeasonStats, _projTotal: number, engine: DeterministicInsights): string {
  const fastStart = ws.htLeadRate >= 0.55;
  const angle = engine.totalPoints.lean === "under"
    ? `Early unders lean unless transition tries open the contest.`
    : `Over lean lives if either side breaks the line inside the opening sets.`;
  const tempo = fastStart
    ? `${w} project to start strong — repeat sets and pressure kicks back the front-foot script.`
    : `Expect a controlled, attritional opening — neither side has a strong fast-start profile.`;
  return `${tempo} ${angle}`;
}

function build2040(w: string, l: string, ws: TeamSeasonStats, ls: TeamSeasonStats, engine: DeterministicInsights): string {
  const wConvert = ws.htLeadRate >= 0.55 && ws.htConversionRate >= 0.7;
  const lFade = ls.htLeadRate >= 0.55 && ls.htConversionRate < 0.55;
  const htFt = engine.htft.pick;
  if (wConvert) {
    return `${w} project to lead at the break and rarely surrender it — ${htFt} HT/FT angle stays live.`;
  }
  if (lFade) {
    return `${l} can start fast but fade — comeback double (${htFt}) becomes the value HT/FT angle.`;
  }
  return `Half tightens before the break — sides trade territory. HT/FT only lives if ${w} string back-to-back sets late in the half.`;
}

function build4060(w: string, l: string, ws: TeamSeasonStats, projTotal: number, engine: DeterministicInsights): string {
  const sof = ws.scoringEfficiency >= 4.5;
  const bench = sof
    ? `${w}'s bench rotation backs second-half scoring`
    : `Neither bench projects to swing momentum hard`;
  const totalAngle = engine.totalPoints.lean === "over"
    ? `Total points pushes toward ${engine.totalPoints.line} — over lives if early sets land.`
    : `Total points sits below ${engine.totalPoints.line} unless fatigue cracks ${l}'s edge defence.`;
  return `${bench}. Defensive drop-off through the middle 20 opens scoring lanes — projection sits at ${projTotal} combined. ${totalAngle}`;
}

function build6080(w: string, _l: string, mg: number, engine: DeterministicInsights): string {
  if (mg >= 14) {
    return `${w} project to extend rather than settle — ${engine.margin.bucket} margin angle is the lean, not the 1-12 squeeze.`;
  }
  if (mg >= 8) {
    return `${w} pull clear late but inside one-score range stays plausible — ${engine.margin.bucket} margin lean over a blowout.`;
  }
  return `Tight finish projected — 1-12 margin is the value lane, blowout angles fade.`;
}

function buildEdge(
  side: "left" | "right",
  inp: EngineInputs,
  winnerNick: string,
  winnerStats: TeamSeasonStats,
  loserStats: TeamSeasonStats,
  homeName: string | null,
  awayName: string | null,
  winnerHome: boolean,
  lineupReady: boolean,
): string {
  const homeAdvantage = winnerStats.scoringEfficiency >= loserStats.scoringEfficiency;
  const winningEdgeTeam = homeAdvantage ? (winnerHome ? inp.homeNickname : inp.awayNickname) : (winnerHome ? inp.awayNickname : inp.homeNickname);
  const dominant = winnerNick === winningEdgeTeam ? winnerNick : winnerNick;
  const sideLabel = side === "left" ? "Left" : "Right";

  if (!lineupReady) {
    return `${dominant}'s ${sideLabel.toLowerCase()} edge profiles as the stronger attacking lane on season scoring shape. Player-specific edge will update after team lists.`;
  }
  const featuredName = winnerHome ? homeName : awayName;
  const oppName = winnerHome ? awayName : homeName;
  if (featuredName) {
    return `${dominant} ${sideLabel.toLowerCase()} edge is the main attacking channel — ${featuredName} the headline anytime tryscorer route through that lane${oppName ? `, with ${oppName} the defensive matchup risk` : ""}.`;
  }
  return `${dominant}'s ${sideLabel.toLowerCase()} edge has the stronger attacking lane on team profile — anytime tryscorer angle lives once the regular winger/centre pairing is confirmed.`;
}

function buildMiddle(w: string, l: string, ws: TeamSeasonStats, ls: TeamSeasonStats, mg: number, projTotal: number): string {
  const possessionEdge = ws.ppgAgainst < ls.ppgAgainst ? w : l;
  const totalAngle = projTotal >= 42 ? `feeds the over total angle` : `caps total points and feeds margin over total`;
  return `${possessionEdge} should win the ruck — middle dominance ${totalAngle}. Backs ${w} ${mg >= 13 ? "13+" : "1-12"} margin rather than backing random middle forwards as tryscorers.`;
}

// ---------- Helpers ----------

function teamOr(inp: EngineInputs, nick: string): TeamSeasonStats {
  return getTeam(inp.snapshot, nick) ?? {
    nickname: nick, themeKey: "",
    played: 0, pointsFor: 22, pointsAgainst: 22, triesFor: 4, triesAgainst: 4,
    htLeads: 0, htDraws: 0, htTrails: 0, htLeadAndWon: 0,
    wins: 0, losses: 0, draws: 0,
    ppgFor: 22, ppgAgainst: 22, scoringEfficiency: 4,
    htConversionRate: 0.65, htLeadRate: 0.5, last5: [],
  };
}

// Pick the named edge player from a squad (jersey number → position).
//   left edge  = #2 (LW), #3 (LC), #11 (left 2nd row)
//   right edge = #5 (RW), #4 (RC), #12 (right 2nd row)
// Returns the headline finisher (winger first, centre fallback) or null.
function edgePlayerName(inp: EngineInputs, team: "home" | "away", side: "left" | "right"): string | null {
  const squad = team === "home" ? inp.homeSquad : inp.awaySquad;
  if (!squad || squad.length === 0) return null;
  const want = side === "left" ? [2, 3, 11] : [5, 4, 12];
  for (const n of want) {
    const p = squad.find((x) => x.jerseyNumber === n);
    if (p) return `${p.firstName} ${p.lastName}`.trim();
  }
  return null;
}
