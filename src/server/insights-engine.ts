// Deterministic NRL fixture insights engine.
//
// Pure function: takes a season snapshot + match-specific context, returns the
// 8 betting market cards with structured analyst-style copy. No AI, no
// randomness, no probabilities/percentages in the output text.
//
// Inputs:
//   - homeNickname / awayNickname
//   - season snapshot (player + team aggregates)
//   - ladder rows for both teams (NRL.com ladder for true position)
//   - venue / kickoff / weather
//   - named squads from the match-detail page (player IDs that map to season
//     player stats — used for try-scoring ranking)
//   - live tryscorer odds (used as a sanity floor + price display only)

import type { SeasonSnapshot, TeamSeasonStats, PlayerSeasonStats } from "./season-stats";
import { getTeam, getTeamPlayers } from "./season-stats";
import type { NrlLadderRow, NrlPlayer } from "./nrl";
import type { TryscorerMarkets } from "./odds";
import type { ModelMode, ModelConfidence } from "./model-mode";

export type EngineInputs = {
  homeNickname: string;
  awayNickname: string;
  homeThemeKey: string;
  awayThemeKey: string;
  homeSquad: NrlPlayer[];
  awaySquad: NrlPlayer[];
  ladder: NrlLadderRow[];
  snapshot: SeasonSnapshot;
  weather?: { tempC: number; condition: string; windKph: number; precipMm: number; groundCondition: string } | null;
  tryscorers?: TryscorerMarkets | null;
  venue?: string;
  // Timing-aware mode. Defaults to "final" for back-compat with callers that
  // haven't been updated yet, but new callers should always pass it.
  mode?: ModelMode;
  confidence?: ModelConfidence;
};

export type EnginePlayerPick = {
  name: string;
  team: string;
  position: string;
  reasoning: string;
  price: number | null; // best live anytime price if available
};

export type DeterministicInsights = {
  generatedAt: string;
  // Timing-aware mode this payload was generated under.
  mode: ModelMode;
  confidence: ModelConfidence;
  // 1
  matchWinner: { team: "home" | "away"; nickname: string; reasoning: string };
  // 2
  margin: { bucket: "1-12" | "13+"; reasoning: string };
  // 3
  predictedScore: { home: number; away: number; reasoning: string };
  // 4
  totalPoints: { line: number; lean: "over" | "under"; reasoning: string };
  // 5
  htft: { pick: string; reasoning: string };
  // 6
  firstTryscorer: EnginePlayerPick;
  // 7
  rankedTryscorers: { first: EnginePlayerPick; second: EnginePlayerPick; third: EnginePlayerPick };
  // 8
  topAnytime: EnginePlayerPick[]; // length 5 (legacy: combined)
  topAnytimeHome: EnginePlayerPick[]; // length 3
  topAnytimeAway: EnginePlayerPick[]; // length 3
  topAnytimeOverall: EnginePlayerPick[]; // length 3 — highest likely across both teams (legacy)
  forwardPicks: EnginePlayerPick[]; // length 4 — 2 per team, forwards / outside top 6 anytime
  // Try-assist boards (3 per team) — playmakers most likely to provide try assists
  tryAssistsHome: EnginePlayerPick[]; // length 3
  tryAssistsAway: EnginePlayerPick[]; // length 3
  // 9 — Player to score 2+ tries (double)
  playerDouble: EnginePlayerPick;
  // 10 — Predicted outcome narrative with 3 anytime tryscorer picks
  predictedOutcome: {
    summary: string;
    picks: EnginePlayerPick[]; // 3 anytime tryscorers with bespoke reasoning
  };
};

// ---------- Public API ----------

export function generateDeterministicInsights(inp: EngineInputs): DeterministicInsights {
  const mode: ModelMode = inp.mode ?? "final";
  const confidence: ModelConfidence = inp.confidence ?? (mode === "early" ? "low" : mode === "squad" ? "medium" : "high");
  const home = getTeamOrSynthetic(inp.snapshot, inp.homeNickname);
  const away = getTeamOrSynthetic(inp.snapshot, inp.awayNickname);
  const homeLadder = inp.ladder.find((r) => r.nickname.toLowerCase() === inp.homeNickname.toLowerCase()) ?? null;
  const awayLadder = inp.ladder.find((r) => r.nickname.toLowerCase() === inp.awayNickname.toLowerCase()) ?? null;

  // ---- Net team rating ----
  const ratingHome = teamRating(home, homeLadder, true);
  const ratingAway = teamRating(away, awayLadder, false);
  const netRating = ratingHome - ratingAway; // >0 favours home

  // ---- Predicted score ----
  // Each team's expected = avg(own PPG-for, opponent PPG-against), shifted by
  // ±2 for home advantage and net rating.
  const expHome = blendPoints(home.ppgFor, away.ppgAgainst) + 2 + clamp(netRating * 0.5, -3, 3);
  const expAway = blendPoints(away.ppgFor, home.ppgAgainst) - 2 + clamp(-netRating * 0.5, -3, 3);
  const predHome = Math.max(6, Math.round(expHome));
  const predAway = Math.max(6, Math.round(expAway));
  const projectedTotal = predHome + predAway;
  const projectedMargin = Math.abs(predHome - predAway);

  const winnerSide: "home" | "away" = predHome >= predAway ? "home" : "away";
  const winnerNick = winnerSide === "home" ? inp.homeNickname : inp.awayNickname;
  const loserNick = winnerSide === "home" ? inp.awayNickname : inp.homeNickname;
  const winnerStats = winnerSide === "home" ? home : away;
  const loserStats = winnerSide === "home" ? away : home;

  // ---- 1. Match Winner ----
  const matchWinner = {
    team: winnerSide,
    nickname: winnerNick,
    reasoning: buildWinnerReason(winnerNick, loserNick, winnerStats, loserStats, netRating, winnerSide === "home"),
  };

  // ---- 2. Winning Margin ----
  const marginBucket: "1-12" | "13+" = projectedMargin >= 13 ? "13+" : "1-12";
  const margin = {
    bucket: marginBucket,
    reasoning: buildMarginReason(winnerNick, loserNick, projectedMargin, winnerStats, loserStats),
  };

  // ---- 3. Predicted Score ----
  const predictedScore = {
    home: predHome,
    away: predAway,
    reasoning: `${inp.homeNickname} project to ${predHome} from a season scoring profile of ${home.ppgFor.toFixed(1)} per game against opposition leaking ${away.ppgAgainst.toFixed(1)}. ${inp.awayNickname} land on ${predAway} working against a defence conceding ${home.ppgAgainst.toFixed(1)}.`,
  };

  // ---- 4. Total Points (Over/Under) ----
  // Reference line: nearest .5 to combined match averages
  const combinedAvg = (home.ppgFor + home.ppgAgainst + away.ppgFor + away.ppgAgainst) / 2;
  const refLine = roundToHalf(combinedAvg || projectedTotal);
  const lean: "over" | "under" = projectedTotal > refLine ? "over" : "under";
  // Weather suppression: heavy rain pushes towards under
  const heavyRain = (inp.weather?.precipMm ?? 0) > 4 || (inp.weather?.groundCondition ?? "").toLowerCase().includes("wet");
  const finalLean: "over" | "under" = heavyRain && lean === "over" && projectedTotal - refLine < 4 ? "under" : lean;
  const totalPoints = {
    line: refLine,
    lean: finalLean,
    reasoning: buildTotalReason(projectedTotal, refLine, finalLean, home, away, heavyRain),
  };

  // ---- 5. Halftime / Fulltime ----
  const htft = computeHtFt(inp.homeNickname, inp.awayNickname, home, away, winnerSide, projectedMargin);

  // ---- Player engine: try-scoring ranking ----
  // EARLY mode: no squads → no tryscorer picks. Return placeholder cards.
  const ranking = mode === "early" ? [] : rankTryscorers(inp, home, away, winnerSide, projectedMargin);
  const top5 = ranking.slice(0, 5);
  const homeRanked = ranking.filter((r) => r.team.toLowerCase() === inp.homeNickname.toLowerCase()).slice(0, 3);
  const awayRanked = ranking.filter((r) => r.team.toLowerCase() === inp.awayNickname.toLowerCase()).slice(0, 3);

  // ---- 6. First Tryscorer ----
  // Bias toward opening-set involvement: weight firstTries + firstTeamTries
  const firstScored = ranking
    .map((r) => ({ ...r, openingScore: r._openingBoost + r.score * 0.3 }))
    .sort((a, b) => b.openingScore - a.openingScore);
  const firstPick = firstScored[0] ?? top5[0];

  // ---- 7. First / Second / Third Tryscorer ----
  const ranked123 = pickRanked123(ranking, firstPick);

  // ---- 9. Player Double (2+ tries) ----
  // Highest finalScore weighted by triesPerMatch and blowout boost — prioritise
  // players with multi-try seasons in scoring positions, ideally on the winning
  // side of a projected blowout.
  const doubleScored = ranking
    .map((r) => {
      const isWinnerTeam = r.team.toLowerCase() === (winnerSide === "home" ? inp.homeNickname : inp.awayNickname).toLowerCase();
      const blowout = projectedMargin >= 14 ? 1.25 : 1.0;
      const winnerLift = isWinnerTeam ? 1.15 : 0.95;
      // Bias to high tries-per-match and finishing positions
      const tpm = (ranking.length && (r as any)) ? 0 : 0; // placeholder for type
      return { row: r, doubleScore: r.score * blowout * winnerLift };
    })
    .sort((a, b) => b.doubleScore - a.doubleScore);
  const doublePick = doubleScored[0]?.row;
  const doubleReason = doublePick
    ? `${(doublePick.name.split(/\s+/).pop() || doublePick.name)} carries the highest multi-try ceiling on the card — ${doublePick.team}'s scoring shape and matchup volume project them through the line more than once.`
    : "Awaiting team list for double-try profiling.";

  // ---- 10. Predicted Outcome ----
  // Pick 3 anytime tryscorers — prioritise 2 from the projected winner, 1 from
  // the loser (the most likely opposition scorer). Falls back to the top of
  // the combined ranking when one side has no candidates.
  const winnerHome = winnerSide === "home";
  const winnerList = winnerHome ? homeRanked : awayRanked;
  const loserList = winnerHome ? awayRanked : homeRanked;
  const outcomePicksRows: RankedRow[] = [];
  if (winnerList[0]) outcomePicksRows.push(winnerList[0]);
  if (winnerList[1]) outcomePicksRows.push(winnerList[1]);
  if (loserList[0]) outcomePicksRows.push(loserList[0]);
  // Top up from overall ranking if we still need more
  for (const r of ranking) {
    if (outcomePicksRows.length >= 3) break;
    if (!outcomePicksRows.find((x) => x.name === r.name)) outcomePicksRows.push(r);
  }
  const outcomePicks = outcomePicksRows.slice(0, 3).map((r) => {
    const isWinnerTeam = r.team.toLowerCase() === winnerNick.toLowerCase();
    const reason = buildOutcomePickReason(r, isWinnerTeam, winnerHome ? (r.team.toLowerCase() === inp.homeNickname.toLowerCase()) : (r.team.toLowerCase() === inp.awayNickname.toLowerCase()), inp, winnerNick, projectedMargin);
    return stripInternal(r, reason);
  });
  const predictedOutcome = {
    summary: buildOutcomeSummary(inp, winnerNick, loserNick, predHome, predAway, projectedMargin, winnerStats, loserStats, winnerHome),
    picks: outcomePicks,
  };

  return {
    generatedAt: new Date().toISOString(),
    mode,
    confidence,
    matchWinner,
    margin,
    predictedScore,
    totalPoints,
    htft,
    // First tryscorer requires market-grade signal (player odds released).
    // In early/squad mode, surface a placeholder so the UI never invents a name.
    firstTryscorer: (mode === "market" || mode === "final")
      ? stripInternal(firstPick, "First-touch threat — opening-set carries and short-side strike role keep the early try in their lane.")
      : stripInternal(undefined, "Awaiting market — first tryscorer locked until bookies release player odds."),
    rankedTryscorers: {
      first: stripInternal(ranked123[0], "First scorer of the match — opening sets and edge usage favour an early involvement."),
      second: stripInternal(ranked123[1], "Second-try profile — secondary attacking lane in the opening half hour."),
      third: stripInternal(ranked123[2], "Third-try profile — emerges as the contest opens up after the early exchanges."),
    },
    topAnytime: top5.map((r) => stripInternal(r, r.reasoning)),
    topAnytimeHome: homeRanked.map((r) => stripInternal(r, r.reasoning)),
    topAnytimeAway: awayRanked.map((r) => stripInternal(r, r.reasoning)),
    topAnytimeOverall: ranking.slice(0, 3).map((r) => stripInternal(r, r.reasoning)),
    forwardPicks: pickForwardPicks(ranking, homeRanked, awayRanked, inp).map((r) => stripInternal(r, buildForwardPickReason(r))),
    tryAssistsHome: pickTryAssists(inp, "home").map((r) => stripInternal(r, r.reasoning)),
    tryAssistsAway: pickTryAssists(inp, "away").map((r) => stripInternal(r, r.reasoning)),
    playerDouble: stripInternal(doublePick, doubleReason),
    predictedOutcome,
  };
}

// ---------- Internal scoring rows (carry intermediate values we strip later) ----------
type RankedRow = EnginePlayerPick & {
  score: number;
  _openingBoost: number;
};

function stripInternal(r: RankedRow | undefined, fallbackReason: string): EnginePlayerPick {
  if (!r) {
    return { name: "Awaiting team list", team: "", position: "", reasoning: fallbackReason, price: null };
  }
  return { name: r.name, team: r.team, position: r.position, reasoning: r.reasoning || fallbackReason, price: r.price };
}

function pickRanked123(ranking: RankedRow[], firstPick: RankedRow | undefined): [RankedRow | undefined, RankedRow | undefined, RankedRow | undefined] {
  const out: RankedRow[] = [];
  const seen = new Set<string>();
  if (firstPick) { out.push(firstPick); seen.add(firstPick.name.toLowerCase()); }
  for (const r of ranking) {
    if (out.length >= 3) break;
    if (seen.has(r.name.toLowerCase())) continue;
    out.push(r); seen.add(r.name.toLowerCase());
  }
  return [out[0], out[1], out[2]];
}

// ---------- Try-scoring ranker ----------
function rankTryscorers(inp: EngineInputs, home: TeamSeasonStats, away: TeamSeasonStats, winnerSide: "home" | "away", projectedMargin: number): RankedRow[] {
  const homePlayers = getTeamPlayers(inp.snapshot, inp.homeNickname);
  const awayPlayers = getTeamPlayers(inp.snapshot, inp.awayNickname);
  const homePlayersById = new Map(homePlayers.map((p) => [p.playerId, p]));
  const awayPlayersById = new Map(awayPlayers.map((p) => [p.playerId, p]));
  const homePlayersByName = new Map(homePlayers.map((p) => [normName(p.name), p]));
  const awayPlayersByName = new Map(awayPlayers.map((p) => [normName(p.name), p]));

  // Live anytime prices keyed by full name + last name
  const priceByKey = new Map<string, number>();
  for (const t of inp.tryscorers?.anytime ?? []) {
    const full = normName(t.player);
    priceByKey.set(full, t.price);
    const last = full.split(/\s+/).pop();
    if (last && !priceByKey.has(last)) priceByKey.set(last, t.price);
  }
  const priceFor = (name: string): number | null => {
    const k = normName(name);
    if (priceByKey.has(k)) return priceByKey.get(k)!;
    const last = k.split(/\s+/).pop();
    if (last && priceByKey.has(last)) return priceByKey.get(last)!;
    return null;
  };

  const rows: RankedRow[] = [];

  const considerSquad = (squad: NrlPlayer[], teamNick: string, teamSeason: TeamSeasonStats, oppSeason: TeamSeasonStats, isWinner: boolean, byId: Map<number, PlayerSeasonStats>, byName: Map<string, PlayerSeasonStats>) => {
    // Hard rule: never produce tryscorer picks for a team without a named squad.
    // The mode gate above already skips this in EARLY mode; this guards SQUAD+
    // calls where one side's lineup hasn't dropped yet.
    if (squad.length === 0) return;
    const candidates = squad.map((p) => {
      const pid = (p as any).playerId as number | undefined;
      const seasonRow = byName.get(normName(`${p.firstName} ${p.lastName}`)) ?? (pid ? byId.get(pid) : undefined);
      return { name: `${p.firstName} ${p.lastName}`.trim(), position: p.position || seasonRow?.position || "", season: seasonRow };
    });

    for (const c of candidates) {
      const s = c.season;
      const tries = s?.tries ?? 0;
      const firstTries = s?.firstTries ?? 0;
      const firstTeamTries = s?.firstTeamTries ?? 0;
      const firstHalfTries = s?.firstHalfTries ?? 0;
      const tpm = s?.triesPerMatch ?? 0;

      // Position weighting: outside backs + edge forwards get a structural boost
      const posWeight = positionScoringWeight(c.position);

      // Team scoring environment
      const teamFactor = teamSeason.scoringEfficiency / Math.max(2, oppSeason.scoringEfficiency || 2);
      // Winner of match gets a small boost (more opportunities to score)
      const winnerBoost = isWinner ? 1.05 : 0.97;
      // Margin boost: blowouts pile on tries from outside backs
      const blowoutBoost = projectedMargin >= 16 ? 1.04 : 1.0;

      const baseScore = (tries * 1.0 + firstHalfTries * 0.4 + firstTeamTries * 0.3) * posWeight * teamFactor * winnerBoost * blowoutBoost;
      const price = priceFor(c.name);
      // Sanity floor: if bookies have priced them <$8 anytime, give a small lift
      const oddsFloor = price && price > 0 && price < 8 ? 0.6 : 0;
      const finalScore = baseScore + oddsFloor;
      // Opening-try boost — for first-tryscorer ordering only
      const openingBoost = (firstTries * 1.0 + firstTeamTries * 0.6 + firstHalfTries * 0.25) * posWeight + (price && price < 11 ? 0.4 : 0);

      // Filter: must have either a try this season OR be in a try-scoring position (1,2,3,4,5,11,12,13)
      const isScoringPosition = posWeight >= 1.0;
      if (tries === 0 && !isScoringPosition && !price) continue;

      rows.push({
        name: c.name,
        team: teamNick,
        position: c.position,
        score: finalScore,
        _openingBoost: openingBoost,
        price,
        reasoning: buildPlayerReason(c.name, teamNick, c.position, tries, tpm, firstTries, firstTeamTries, isWinner, projectedMargin),
      });
    }
  };

  considerSquad(inp.homeSquad, inp.homeNickname, home, away, winnerSide === "home", homePlayersById, homePlayersByName);
  considerSquad(inp.awaySquad, inp.awayNickname, away, home, winnerSide === "away", awayPlayersById, awayPlayersByName);

  rows.sort((a, b) => b.score - a.score);
  // Dedupe by normalised name
  const dedup: RankedRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = normName(r.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    dedup.push(r);
  }
  return dedup;
}

// ---------- Helpers / scoring functions ----------

function getTeamOrSynthetic(snap: SeasonSnapshot, nick: string): TeamSeasonStats {
  return getTeam(snap, nick) ?? {
    nickname: nick, themeKey: "",
    played: 0, pointsFor: 22, pointsAgainst: 22, triesFor: 4, triesAgainst: 4,
    htLeads: 0, htDraws: 0, htTrails: 0, htLeadAndWon: 0,
    wins: 0, losses: 0, draws: 0,
    ppgFor: 22, ppgAgainst: 22, scoringEfficiency: 4,
    htConversionRate: 0.65, htLeadRate: 0.5, last5: [],
  };
}

function teamRating(t: TeamSeasonStats, ladder: NrlLadderRow | null, isHome: boolean): number {
  // Net points-per-game differential (≈ -10..+10 across the comp)
  const diff = t.ppgFor - t.ppgAgainst;
  // Ladder positional weight: top sides get small bump (position 1 → +1.5, 17 → -1.5)
  const ladderShift = ladder ? (9 - ladder.position) * 0.18 : 0;
  // Recent form shift (last 5)
  const formShift = t.last5.reduce((s, r) => s + (r.result === "W" ? 0.4 : r.result === "L" ? -0.4 : 0), 0);
  const homeAdv = isHome ? 1.5 : 0;
  return diff + ladderShift + formShift + homeAdv;
}

function blendPoints(ownFor: number, oppAgainst: number): number {
  if (ownFor === 0 && oppAgainst === 0) return 22;
  if (ownFor === 0) return oppAgainst;
  if (oppAgainst === 0) return ownFor;
  return (ownFor + oppAgainst) / 2;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function positionScoringWeight(pos: string): number {
  const p = (pos || "").toLowerCase();
  if (/wing/.test(p)) return 1.45;
  if (/full\s*back/.test(p)) return 1.30;
  if (/centre/.test(p)) return 1.20;
  if (/five\s*eighth|stand\s*off/.test(p)) return 1.05;
  if (/half/.test(p)) return 0.95;
  if (/lock/.test(p)) return 0.90;
  if (/back\s*row|second\s*row/.test(p)) return 0.95;
  if (/hooker/.test(p)) return 0.80;
  if (/prop/.test(p)) return 0.55;
  return 0.85;
}

function normName(n: string): string {
  return (n || "").toLowerCase().replace(/[^a-z\s']/g, "").trim();
}

// ---------- Reasoning generators (concise, no percentages, no probability words) ----------

function buildWinnerReason(winnerNick: string, loserNick: string, w: TeamSeasonStats, l: TeamSeasonStats, netRating: number, isHome: boolean): string {
  const ppgGap = (w.ppgFor - l.ppgFor).toFixed(1);
  const def = (l.ppgAgainst - w.ppgAgainst).toFixed(1);
  const venueLine = isHome ? `, with home ground reinforcing the edge` : `, controlling the contest on the road`;
  const formLine = recentFormLine(w);
  if (Math.abs(netRating) > 4) {
    return `${winnerNick} project as the stronger side with a ${ppgGap}+ point swing in attacking output and a ${def}-point cushion through the middle${venueLine}. ${formLine}`;
  }
  return `${winnerNick} hold the structural edge over ${loserNick} through better scoring balance and tighter defensive shape${venueLine}. ${formLine}`;
}

function recentFormLine(t: TeamSeasonStats): string {
  if (t.last5.length === 0) return "";
  const wins = t.last5.filter((r) => r.result === "W").length;
  const recent = t.last5.map((r) => r.result).join("");
  return `Form line ${recent} reads ${wins} wins from the last ${t.last5.length}.`;
}

function buildMarginReason(w: string, l: string, mg: number, ws: TeamSeasonStats, ls: TeamSeasonStats): string {
  if (mg >= 16) return `${w} project to pull clear once they break ${l}'s line speed, with the scoring profile pointing to a 13+ result rather than a tight finish.`;
  if (mg >= 13) return `Margin model leans toward 13+ — ${w}'s scoring rate over ${ls.ppgAgainst.toFixed(0)}-point defences suggests they extend rather than settle for a one-score contest.`;
  return `Tight band — both sides operate inside one score on neutral matchups, and ${w}'s edge here is structural rather than blowout-shaped.`;
}

function buildTotalReason(projTotal: number, line: number, lean: "over" | "under", h: TeamSeasonStats, a: TeamSeasonStats, heavyRain: boolean): string {
  const combined = (h.ppgFor + a.ppgFor + h.ppgAgainst + a.ppgAgainst) / 2;
  if (heavyRain && lean === "under") return `Wet conditions shrink the kicking and edge games — projection sits at ${projTotal} but rain risk drags below the ${line} line.`;
  if (lean === "over") return `Combined match output trends to ${combined.toFixed(0)} per game — the ${line} line sits below the natural scoring rate of both sides.`;
  return `Combined output averages ${combined.toFixed(0)} — the ${line} line sits above how these two scoring profiles typically combine.`;
}

function computeHtFt(homeNick: string, awayNick: string, h: TeamSeasonStats, a: TeamSeasonStats, winnerSide: "home" | "away", margin: number): { pick: string; reasoning: string } {
  const winNick = winnerSide === "home" ? homeNick : awayNick;
  const winStats = winnerSide === "home" ? h : a;
  const loseStats = winnerSide === "home" ? a : h;
  const loseNick = winnerSide === "home" ? awayNick : homeNick;

  // Strong front-running side wins HT and full
  const winnerLeadsHalves = winStats.htLeadRate >= 0.55 && winStats.htConversionRate >= 0.7;
  // Loser is a known fast starter that fades — comeback double
  const loserStartsFast = loseStats.htLeadRate >= 0.55 && loseStats.htConversionRate < 0.55;

  if (winnerLeadsHalves && margin >= 8) {
    return {
      pick: `${winNick} / ${winNick}`,
      reasoning: `${winNick} have led at the break in over half their fixtures and converted those leads into wins consistently — the model double walks them through both halves.`,
    };
  }
  if (loserStartsFast && margin <= 12) {
    return {
      pick: `${loseNick} / ${winNick}`,
      reasoning: `${loseNick} project to start fast through opening-set field position, but ${winNick}'s second-half scoring profile reels them in for the comeback double.`,
    };
  }
  // Default: winner / winner if comfortable margin, otherwise even-leaning
  if (margin >= 10) {
    return {
      pick: `${winNick} / ${winNick}`,
      reasoning: `${winNick}'s scoring rate stretches the contest in both halves — most likely path is they lead at the break and don't relinquish.`,
    };
  }
  return {
    pick: `${winNick} / ${winNick}`,
    reasoning: `${winNick} carry a thin but consistent edge across both halves — front-foot start expected to convert into a tight overall win.`,
  };
}

function buildPlayerReason(name: string, teamNick: string, position: string, tries: number, tpm: number, firstTries: number, firstTeamTries: number, isWinner: boolean, margin: number): string {
  const last = name.split(/\s+/).pop() || name;
  const role = positionRole(position);
  const env = isWinner && margin >= 12 ? "in a contest projecting to open up late" : "in a contest projecting to flow through structured attack";
  if (tries === 0) {
    return `${last} brings ${role.toLowerCase()} on the ${teamNick} edge — touch volume in this matchup makes them a live involvement risk ${env}.`;
  }
  if (firstTries >= 1 || firstTeamTries >= 2) {
    return `${last} carries an opening-set scoring profile (${firstTries} first try${firstTries === 1 ? "" : "s"}, ${firstTeamTries} team-opening try${firstTeamTries === 1 ? "" : "s"} this season) ${env}.`;
  }
  if (tpm >= 0.7) {
    return `${last} averages ${tpm.toFixed(2)} tries per match this season — high-volume ${role.toLowerCase()} role for ${teamNick} on a primary scoring lane.`;
  }
  return `${last} sits on ${tries} tr${tries === 1 ? "y" : "ies"} this season as ${teamNick}'s ${role.toLowerCase()} — matchup positioning keeps them in the scoring conversation ${env}.`;
}

function positionRole(position: string): string {
  const p = (position || "").toLowerCase();
  if (/wing/.test(p)) return "Outside finisher";
  if (/full\s*back/.test(p)) return "Last-line strike runner";
  if (/centre/.test(p)) return "Edge centre";
  if (/five\s*eighth|stand\s*off/.test(p)) return "Second receiver";
  if (/half/.test(p)) return "Halfback strike";
  if (/lock/.test(p)) return "Middle support";
  if (/back\s*row|second\s*row/.test(p)) return "Edge forward";
  if (/hooker/.test(p)) return "Dummy-half threat";
  if (/prop/.test(p)) return "Middle carry";
  return "Attacking option";
}

function buildOutcomeSummary(inp: EngineInputs, winnerNick: string, loserNick: string, predHome: number, predAway: number, margin: number, ws: TeamSeasonStats, ls: TeamSeasonStats, winnerHome: boolean): string {
  const venue = winnerHome ? `at home` : `on the road`;
  const formW = ws.last5.length ? ws.last5.map((r) => r.result).join("") : "limited form sample";
  const formL = ls.last5.length ? ls.last5.map((r) => r.result).join("") : "limited form sample";
  const shape = margin >= 14 ? `pulling clear in the back half` : margin >= 8 ? `controlling the contest after the break` : `edging it in a tight finish`;
  return `${winnerNick} project to win ${predHome}–${predAway} ${venue}, ${shape}. Form line ${formW} versus ${loserNick}'s ${formL} reinforces the lean — ${winnerNick} score ${ws.ppgFor.toFixed(1)} per game and concede ${ws.ppgAgainst.toFixed(1)}, against ${loserNick}'s ${ls.ppgFor.toFixed(1)} for / ${ls.ppgAgainst.toFixed(1)} against. The three try-scoring picks below back that script.`;
}

function buildOutcomePickReason(r: RankedRow, isWinnerTeam: boolean, _isHomeTeam: boolean, inp: EngineInputs, winnerNick: string, margin: number): string {
  const last = r.name.split(/\s+/).pop() || r.name;
  const team = getTeam(inp.snapshot, r.team);
  const role = positionRole(r.position);
  const formStr = team?.last5?.length ? team.last5.map((x) => x.result).join("") : "";
  const sideTag = isWinnerTeam
    ? `on the ${winnerNick} attacking side projected to dominate field position`
    : `as ${r.team}'s most likely answer when they get into ${winnerNick}'s 20`;
  const blowoutTag = margin >= 14 && isWinnerTeam ? ` and a projected blowout multiplies their late-set looks` : "";
  const formTag = formStr ? ` ${r.team}'s ${formStr} form line ${formStr.includes("W") ? "supports" : "still leaves"} the matchup volume` : "";
  return `${last} (${role.toLowerCase()}) lines up ${sideTag}${blowoutTag}.${formTag}`;
}


// Forward Picks: 2 per team, prioritising forwards (or anyone outside the
// per-team top 3) with the highest score — these are the next-best scorers
// behind the headline anytime board.
function pickForwardPicks(
  ranking: RankedRow[],
  homeTop: RankedRow[],
  awayTop: RankedRow[],
  inp: EngineInputs,
): RankedRow[] {
  const topNames = new Set([...homeTop, ...awayTop].map((r) => r.name));
  const isForward = (pos: string) => /prop|hook|lock|second\s*row|back\s*row/i.test(pos || "");

  const pickForTeam = (teamNick: string): RankedRow[] => {
    const teamRows = ranking.filter((r) => r.team.toLowerCase() === teamNick.toLowerCase());
    // Tier 1: forwards not already in the top board
    const forwardsOutside = teamRows.filter((r) => isForward(r.position) && !topNames.has(r.name));
    // Tier 2: any non-top players (in case there aren't enough forward candidates)
    const anyOutside = teamRows.filter((r) => !topNames.has(r.name) && !forwardsOutside.find((x) => x.name === r.name));
    return [...forwardsOutside, ...anyOutside].slice(0, 2);
  };

  return [...pickForTeam(inp.homeNickname), ...pickForTeam(inp.awayNickname)];
}

function buildForwardPickReason(r: RankedRow): string {
  const last = r.name.split(/\s+/).pop() || r.name;
  const role = positionRole(r.position);
  const isFwd = /prop|hook|lock|second\s*row|back\s*row/i.test(r.position || "");
  if (isFwd) {
    return `${last} brings the ${role.toLowerCase()} forward threat for ${r.team} — short-range carries and goal-line involvements make them the next try-scoring lane if the headline outside backs are shut down.`;
  }
  return `${last} rates as ${r.team}'s next-best scoring option behind the headline anytime board — secondary attacking touches keep them live if the top picks don't convert.`;
}

// Try-assist picks: 3 per team. There's no direct try-assist stat in the
// snapshot, so we rank named-squad playmakers by positional priority
// (Halfback > Hooker > Five-Eighth > Fullback > Lock), then break ties by
// captaincy and lower jersey number (seniority). Falls back to season tries
// for the same player as a secondary signal of attacking involvement.
function pickTryAssists(inp: EngineInputs, side: "home" | "away"): RankedRow[] {
  const teamNick = side === "home" ? inp.homeNickname : inp.awayNickname;
  const squad = side === "home" ? inp.homeSquad : inp.awaySquad;
  const players = getTeamPlayers(inp.snapshot, teamNick);
  const byName = new Map(players.map((p) => [normName(p.name), p]));

  const POSITION_RANK: Record<string, number> = {
    halfback: 100,
    hooker: 88,
    "five-eighth": 86,
    fiveeighth: 86,
    "stand off": 86,
    standoff: 86,
    fullback: 78,
    lock: 60,
  };
  const posScore = (pos: string): number => {
    const p = (pos || "").toLowerCase().replace(/\s+/g, " ").trim();
    for (const key of Object.keys(POSITION_RANK)) {
      if (p.includes(key)) return POSITION_RANK[key];
    }
    return 0;
  };

  const candidates = squad
    .map((sp) => {
      const fullName = `${sp.firstName} ${sp.lastName}`.trim();
      const stats = byName.get(normName(fullName));
      const ps = posScore(sp.position);
      if (ps === 0) return null;
      // Higher score = better playmaker pick. Add captain bonus + jersey
      // seniority + a small lift for season tries (proxy for attacking touches).
      const score =
        ps +
        (sp.isCaptain ? 6 : 0) +
        (sp.jerseyNumber ? Math.max(0, 18 - sp.jerseyNumber) * 0.4 : 0) +
        Math.min(8, (stats?.tries ?? 0) * 0.5);
      const role = positionRole(sp.position);
      const last = sp.lastName || fullName;
      const triesNote = stats && stats.tries > 0
        ? ` Has ${stats.tries} tr${stats.tries === 1 ? "y" : "ies"} of own this season — stays involved at the line.`
        : "";
      const reasoning = `${last} (${role.toLowerCase()}) drives ${teamNick}'s shape — ball-playing role and goal-line involvements make them the lead try-assist option in their zone.${triesNote}`;
      const row: RankedRow = {
        name: fullName,
        team: teamNick,
        position: sp.position,
        reasoning,
        price: null,
        score,
        _openingBoost: 0,
      };
      return row;
    })
    .filter((r): r is RankedRow => r !== null)
    .sort((a, b) => b.score - a.score);

  return candidates.slice(0, 3);
}
