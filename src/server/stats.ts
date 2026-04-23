// NRL.com per-match stats aggregator.
// Pulls a team's last N played match data files, extracts the canonical stat
// groups, computes season totals + per-game averages + last-3 trend. Cached.

import { cached, TTL } from "./cache";

const UA = "Mozilla/5.0 (compatible; LineBreak/1.0)";

// Canonical stat fields we surface (mapped from NRL.com `statGroups[].stats[].title`).
// Keep aligned with NRL Match Centre vocabulary.
export const STAT_FIELDS = [
  "All Runs",
  "All Run Metres",
  "Post Contact Metres",
  "Line Breaks",
  "Tackle Breaks",
  "Tackles Made",
  "Missed Tackles",
  "Offloads",
  "Kicking Metres",
  "Errors",
  "Penalties Conceded",
  "Possession %",
  "Completion Rate",
  "Effective Tackle %",
] as const;

export type StatField = (typeof STAT_FIELDS)[number];

export type StatPoint = { matchUrl: string; value: number };

export type AggregatedStat = {
  field: StatField;
  total: number;
  avg: number;          // per-game average across sample
  last3Avg: number;     // average across last 3 played matches
  last5Avg: number;
  trend: "up" | "down" | "flat"; // last3 vs prior
  samples: number;      // games included
  points: StatPoint[];  // per-match values, newest first
};

export type TeamStats = {
  teamSide: "home" | "away";
  matchesAnalysed: string[];     // match urls included
  stats: AggregatedStat[];
};

export type StatsBundle = {
  home: TeamStats;
  away: TeamStats;
  generatedAt: string;
};

// Upcoming-match `stats.groups` shape: { title, stats: [{ title, homeValue:{value}, awayValue:{value} }] }
// Played-match same shape, used for actual match results.
type RawGroup = { title: string; stats: { title: string; homeValue?: { value: number }; awayValue?: { value: number } }[] };

async function fetchMatchData(url: string): Promise<{
  homeNickName: string; awayNickName: string;
  groups: RawGroup[];
  matchState: string;
} | null> {
  const dataUrl = url.endsWith("/") ? `${url}data` : `${url}/data`;
  try {
    const res = await fetch(dataUrl, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json() as any;
    return {
      homeNickName: j.homeTeam?.nickName ?? "",
      awayNickName: j.awayTeam?.nickName ?? "",
      groups: (j.stats?.groups ?? []) as RawGroup[],
      matchState: j.matchState ?? "",
    };
  } catch { return null; }
}

function extractValue(groups: RawGroup[], side: "home" | "away", field: StatField): number | null {
  for (const g of groups) {
    for (const s of g.stats) {
      if (s.title === field) {
        const v = side === "home" ? s.homeValue?.value : s.awayValue?.value;
        return typeof v === "number" ? v : null;
      }
    }
  }
  return null;
}

function aggregate(values: StatPoint[], field: StatField): AggregatedStat {
  const nums = values.map((v) => v.value);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const avg = (a: number[]) => (a.length === 0 ? 0 : sum(a) / a.length);
  const last3 = nums.slice(0, 3);
  const last5 = nums.slice(0, 5);
  const prior = nums.slice(3, 6);
  const last3Avg = avg(last3);
  const priorAvg = avg(prior);
  const delta = last3Avg - priorAvg;
  const ratioGate = Math.max(1, Math.abs(priorAvg)) * 0.07; // 7% movement to not be "flat"
  const trend: "up" | "down" | "flat" =
    Math.abs(delta) < ratioGate ? "flat" : delta > 0 ? "up" : "down";

  return {
    field,
    total: Number(sum(nums).toFixed(1)),
    avg: Number(avg(nums).toFixed(1)),
    last3Avg: Number(last3Avg.toFixed(1)),
    last5Avg: Number(avg(last5).toFixed(1)),
    trend,
    samples: nums.length,
    points: values,
  };
}

async function aggregateForTeam(
  teamNickname: string,
  recentFormUrls: string[],
  side: "home" | "away",
): Promise<TeamStats> {
  const urls = recentFormUrls.slice(0, 5);
  const datas = await Promise.all(urls.map((u) => fetchMatchData(u)));

  // Per match: figure out which side this team was on
  const perMatch = datas
    .map((d, idx) => d ? { url: urls[idx], data: d } : null)
    .filter((x): x is { url: string; data: NonNullable<typeof datas[number]> } => x !== null);

  const stats: AggregatedStat[] = STAT_FIELDS.map((field) => {
    const points: StatPoint[] = [];
    for (const m of perMatch) {
      const wasHome = m.data.homeNickName === teamNickname;
      const wasAway = m.data.awayNickName === teamNickname;
      if (!wasHome && !wasAway) continue;
      const v = extractValue(m.data.groups, wasHome ? "home" : "away", field);
      if (v != null) points.push({ matchUrl: m.url, value: v });
    }
    return aggregate(points, field);
  });

  return { teamSide: side, matchesAnalysed: perMatch.map((m) => m.url), stats };
}

export async function buildStatsBundle(
  homeNick: string, homeRecentUrls: string[],
  awayNick: string, awayRecentUrls: string[],
): Promise<StatsBundle> {
  const [home, away] = await Promise.all([
    cached(`teamstats:${homeNick}:${homeRecentUrls[0] ?? ""}`, TTL.match,
      () => aggregateForTeam(homeNick, homeRecentUrls, "home")),
    cached(`teamstats:${awayNick}:${awayRecentUrls[0] ?? ""}`, TTL.match,
      () => aggregateForTeam(awayNick, awayRecentUrls, "away")),
  ]);
  return { home, away, generatedAt: new Date().toISOString() };
}

// Comparison helper — for each stat field, compute differential and flag
// the side with a meaningful edge (>=15% gap, >=2 samples each).
export type StatEdge = {
  field: StatField;
  homeAvg: number;
  awayAvg: number;
  diff: number;            // home - away
  edge: "home" | "away" | "even";
  // Higher value is good for these defensive-style fields:
  higherIsBetter: boolean;
  // Insightful framing
  framing: string;
};

const HIGHER_IS_WORSE: Set<StatField> = new Set([
  "Missed Tackles",
  "Errors",
  "Penalties Conceded",
]);

export function compareStats(home: TeamStats, away: TeamStats): StatEdge[] {
  const out: StatEdge[] = [];
  for (const field of STAT_FIELDS) {
    const h = home.stats.find((s) => s.field === field);
    const a = away.stats.find((s) => s.field === field);
    if (!h || !a || h.samples < 1 || a.samples < 1) continue;
    const higherIsBetter = !HIGHER_IS_WORSE.has(field);
    const diff = Number((h.avg - a.avg).toFixed(1));
    const denom = Math.max(1, Math.abs((h.avg + a.avg) / 2));
    const gap = Math.abs(diff) / denom;
    let edge: "home" | "away" | "even" = "even";
    if (gap >= 0.10) {
      const homeBetter = higherIsBetter ? diff > 0 : diff < 0;
      edge = homeBetter ? "home" : "away";
    }
    out.push({
      field, homeAvg: h.avg, awayAvg: a.avg, diff,
      edge, higherIsBetter,
      framing: framingFor(field, edge),
    });
  }
  return out;
}

function framingFor(field: StatField, edge: "home" | "away" | "even"): string {
  if (edge === "even") return "Even";
  switch (field) {
    case "All Run Metres": return "Better forward dominance";
    case "Post Contact Metres": return "Stronger metres after contact";
    case "Line Breaks": return "Sharper attacking line breaks";
    case "Tackle Breaks": return "More tackle busts";
    case "Tackles Made": return "Heavier defensive workload";
    case "Missed Tackles": return "Tighter defensive line";
    case "Offloads": return "More second-phase play";
    case "Kicking Metres": return "Better kicking game";
    case "Errors": return "Cleaner ball handling";
    case "Penalties Conceded": return "More disciplined";
    case "Possession %": return "Controls field position";
    case "Completion Rate": return "More accurate set play";
    case "Effective Tackle %": return "More efficient defence";
    case "All Runs": return "More forward involvement";
  }
  return "Edge";
}
