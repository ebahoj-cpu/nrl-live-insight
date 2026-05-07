// End-of-season projected ladder. Builds on:
//   - current live NRL ladder (truth source for played/wins/points/diff)
//   - remaining fixtures (NRL.com draw)
//   - prediction_snapshots (locked pre-kickoff predictions per match)
//   - fallback heuristic for any remaining game with no snapshot
//
// Pure projection — does NOT mutate live ladder data.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { NrlLadderRow, NrlFixture } from "./nrl";

export type ProjectedLadderRow = {
  position: number;
  teamId: number;
  nickname: string;
  themeKey: string;
  played: number;
  wins: number;
  losses: number;
  drawn: number;
  byes: number;
  points: number;
  for: number;
  against: number;
  diff: number;
  // delta vs live ladder
  livePosition: number;
  movement: number; // positive = climbed, negative = dropped
  // confidence: high if all remaining games for this team had snapshots, else low
  confidence: "high" | "medium" | "low";
  // count of remaining games estimated via fallback (no snapshot)
  estimatedGames: number;
};

type SnapshotRow = {
  match_id: string;
  predicted_winner: string | null; // home nickname or away nickname or "draw"
  predicted_margin_band: string | null; // "1-12" | "13+"
  predicted_score_home: number | null;
  predicted_score_away: number | null;
  home_team: string;
  away_team: string;
};

async function fetchSnapshotsForMatches(matchIds: string[]): Promise<Map<string, SnapshotRow>> {
  const out = new Map<string, SnapshotRow>();
  if (matchIds.length === 0) return out;
  try {
    const { data, error } = await supabaseAdmin
      .from("prediction_snapshots" as never)
      .select("match_id, predicted_winner, predicted_margin_band, predicted_score_home, predicted_score_away, home_team, away_team")
      .in("match_id" as never, matchIds as never);
    if (error || !data) return out;
    for (const r of data as unknown as SnapshotRow[]) out.set(r.match_id, r);
  } catch (e) {
    console.warn("fetchSnapshotsForMatches failed:", e);
  }
  return out;
}

function isFinished(state: string): boolean {
  return /^(FullTime|Final|Completed)$/i.test(state);
}

// Fallback: pick winner from current ladder position (higher = better).
// Margin estimate: 8 if ladder gap small, 14 if large. Score: 22-14 / 26-12.
function fallbackPrediction(
  fixture: NrlFixture,
  byTeamId: Map<number, NrlLadderRow>,
): { winnerId: number | null; homeScore: number; awayScore: number } {
  const home = byTeamId.get(fixture.homeTeam.teamId);
  const away = byTeamId.get(fixture.awayTeam.teamId);
  if (!home || !away) {
    return { winnerId: fixture.homeTeam.teamId, homeScore: 20, awayScore: 16 };
  }
  // Home advantage nudge of 1 ladder spot
  const homeRank = home.position - 1;
  const awayRank = away.position;
  const homeWins = homeRank <= awayRank;
  const gap = Math.abs(home.position - away.position);
  const big = gap >= 6;
  if (homeWins) {
    return big
      ? { winnerId: home.teamId, homeScore: 26, awayScore: 12 }
      : { winnerId: home.teamId, homeScore: 22, awayScore: 16 };
  }
  return big
    ? { winnerId: away.teamId, homeScore: 12, awayScore: 26 }
    : { winnerId: away.teamId, homeScore: 16, awayScore: 22 };
}

function nicknameToTeamId(name: string | null, fixture: NrlFixture): number | null {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  if (n === "draw") return null;
  if (fixture.homeTeam.nickName.toLowerCase() === n) return fixture.homeTeam.teamId;
  if (fixture.awayTeam.nickName.toLowerCase() === n) return fixture.awayTeam.teamId;
  return null;
}

export function projectLadder(
  liveLadder: NrlLadderRow[],
  remainingFixtures: NrlFixture[],
  snapshots: Map<string, SnapshotRow>,
): ProjectedLadderRow[] {
  // Working copy keyed by teamId
  type Working = NrlLadderRow & { livePosition: number; estimatedGames: number; remainingGames: number };
  const work = new Map<number, Working>();
  for (const r of liveLadder) {
    work.set(r.teamId, { ...r, livePosition: r.position, estimatedGames: 0, remainingGames: 0 });
  }

  for (const fx of remainingFixtures) {
    if (isFinished(fx.matchState)) continue;
    const home = work.get(fx.homeTeam.teamId);
    const away = work.get(fx.awayTeam.teamId);
    if (!home || !away) continue;
    home.remainingGames += 1;
    away.remainingGames += 1;

    const snap = snapshots.get(fx.matchId);
    let winnerId: number | null = null;
    let isDraw = false;
    let homeScore: number;
    let awayScore: number;
    let estimated = false;

    if (snap && (snap.predicted_score_home != null && snap.predicted_score_away != null)) {
      homeScore = snap.predicted_score_home;
      awayScore = snap.predicted_score_away;
      if (homeScore === awayScore) isDraw = true;
      else winnerId = homeScore > awayScore ? fx.homeTeam.teamId : fx.awayTeam.teamId;
    } else if (snap && snap.predicted_winner) {
      const wid = nicknameToTeamId(snap.predicted_winner, fx);
      const margin = snap.predicted_margin_band === "13+" ? 16 : 8;
      const baseTotal = 40;
      const winScore = Math.round((baseTotal + margin) / 2);
      const loseScore = Math.round((baseTotal - margin) / 2);
      if (wid === fx.homeTeam.teamId) { homeScore = winScore; awayScore = loseScore; winnerId = wid; }
      else if (wid === fx.awayTeam.teamId) { homeScore = loseScore; awayScore = winScore; winnerId = wid; }
      else {
        const fb = fallbackPrediction(fx, work);
        homeScore = fb.homeScore; awayScore = fb.awayScore; winnerId = fb.winnerId;
        estimated = true;
      }
    } else {
      const fb = fallbackPrediction(fx, work);
      homeScore = fb.homeScore; awayScore = fb.awayScore; winnerId = fb.winnerId;
      estimated = true;
    }

    home.played += 1; away.played += 1;
    home.for += homeScore; home.against += awayScore;
    away.for += awayScore; away.against += homeScore;

    if (isDraw) {
      home.drawn += 1; away.drawn += 1;
      home.points += 1; away.points += 1;
    } else if (winnerId === fx.homeTeam.teamId) {
      home.wins += 1; home.points += 2;
      away.losses += 1;
    } else if (winnerId === fx.awayTeam.teamId) {
      away.wins += 1; away.points += 2;
      home.losses += 1;
    }

    if (estimated) { home.estimatedGames += 1; away.estimatedGames += 1; }
  }

  for (const r of work.values()) r.diff = r.for - r.against;

  const sorted = Array.from(work.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return b.for - a.for;
  });

  return sorted.map((r, i): ProjectedLadderRow => {
    const newPos = i + 1;
    const totalRemain = r.remainingGames || 1;
    const estRatio = r.estimatedGames / totalRemain;
    const confidence: ProjectedLadderRow["confidence"] =
      r.remainingGames === 0 ? "high" : estRatio === 0 ? "high" : estRatio < 0.5 ? "medium" : "low";
    return {
      position: newPos,
      teamId: r.teamId,
      nickname: r.nickname,
      themeKey: r.themeKey,
      played: r.played,
      wins: r.wins,
      losses: r.losses,
      drawn: r.drawn,
      byes: r.byes,
      points: r.points,
      for: r.for,
      against: r.against,
      diff: r.diff,
      livePosition: r.livePosition,
      movement: r.livePosition - newPos,
      confidence,
      estimatedGames: r.estimatedGames,
    };
  });
}
