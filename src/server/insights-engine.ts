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
  topAnytime: EnginePlayerPick[]; // length 5
};

// ---------- Public API ----------

export function generateDeterministicInsights(inp: EngineInputs): DeterministicInsights {
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
  const ranking = rankTryscorers(inp, home, away, winnerSide, projectedMargin);
  const top5 = ranking.slice(0, 5);

  // ---- 6. First Tryscorer ----
  // Bias toward opening-set involvement: weight firstTries + firstTeamTries
  const firstScored = ranking
    .map((r) => ({ ...r, openingScore: r._openingBoost + r.score * 0.3 }))
    .sort((a, b) => b.openingScore - a.openingScore);
  const firstPick = firstScored[0] ?? top5[0];

  // ---- 7. First / Second / Third Tryscorer ----
  const ranked123 = pickRanked123(ranking, firstPick);

  return {
    generatedAt: new Date().toISOString(),
    matchWinner,
    margin,
    predictedScore,
    totalPoints,
    htft,
    firstTryscorer: stripInternal(firstPick, "First-touch threat — opening-set carries and short-side strike role keep the early try in their lane."),
    rankedTryscorers: {
      first: stripInternal(ranked123[0], "First scorer of the match — opening sets and edge usage favour an early involvement."),
      second: stripInternal(ranked123[1], "Second-try profile — secondary attacking lane in the opening half hour."),
      third: stripInternal(ranked123[2], "Third-try profile — emerges as the contest opens up after the early exchanges."),
    },
    topAnytime: top5.map((r) => stripInternal(r, r.reasoning)),
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
    // Squad may be empty for upcoming fixtures (team lists not announced yet).
    // Fall back to: every season player on this team regardless of named squad.
    const candidates = squad.length > 0
      ? squad.map((p) => {
          const pid = (p as any).playerId as number | undefined;
          // We don't have playerId on the NrlPlayer type; match by name
          const seasonRow = byName.get(normName(`${p.firstName} ${p.lastName}`)) ?? (pid ? byId.get(pid) : undefined);
          return { name: `${p.firstName} ${p.lastName}`.trim(), position: p.position || seasonRow?.position || "", season: seasonRow };
        })
      : Array.from(byName.values()).map((s) => ({ name: s.name, position: s.position, season: s }));

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
