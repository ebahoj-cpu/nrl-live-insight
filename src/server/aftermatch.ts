// Aftermatch comparison engine.
//
// Once a match is FullTime, compares the deterministic insights generated
// before kick-off against the actual NRL.com result + tryscorer recap.
// Persists the result in `match_aftermatch` so each visitor sees the same
// payload and we only run the AI summariser once per match.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { NrlMatchDetails, NrlMatchRecap } from "./nrl";
import type { Insights } from "./ai-insights";
import type { DeterministicInsights, EnginePlayerPick } from "./insights-engine";

const TABLE = "match_aftermatch";
const VERSION = "v1";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const AI_TIMEOUT_MS = 25_000;

export type AftermatchHit = {
  market: string;             // human label, e.g. "Match Winner"
  predicted: string;
  actual: string;
  status: "hit" | "miss" | "partial";
  detail?: string;            // short note ("predicted 24-18, actual 22-20")
};

export type AftermatchPlayerHit = {
  name: string;
  predictedAs: string;        // "First", "Anytime", "2+"
  scored: number;             // tries actually scored
  status: "hit" | "miss";
};

export type AftermatchPayload = {
  version: string;
  generatedAt: string;
  matchId: string;
  homeNickname: string;
  awayNickname: string;
  finalScore: { home: number; away: number };
  hits: AftermatchHit[];
  tryscorerHits: AftermatchPlayerHit[];
  scoreLine: { hits: number; total: number };
  consistencies: string[];
  inconsistencies: string[];
  summary: string;            // short AI paragraph
};

function key(matchId: string): string {
  return `${matchId}::${VERSION}`;
}

export async function readAftermatch(matchId: string): Promise<AftermatchPayload | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload, expires_at")
      .eq("match_id" as never, key(matchId) as never)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { payload: unknown; expires_at: string };
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    return row.payload as AftermatchPayload;
  } catch {
    return null;
  }
}

async function writeAftermatch(matchId: string, payload: AftermatchPayload): Promise<void> {
  try {
    // 365-day TTL — past matches don't change.
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60_000);
    const { error } = await supabaseAdmin
      .from(TABLE as never)
      .upsert(
        {
          match_id: key(matchId),
          payload: payload as unknown as Record<string, unknown>,
          generated_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        } as never,
        { onConflict: "match_id" },
      );
    if (error) console.warn("writeAftermatch failed:", error.message);
  } catch (e) {
    console.warn("writeAftermatch threw:", e);
  }
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");
}

function flatTryscorers(recap: NrlMatchRecap | null): { name: string; team: "home" | "away"; count: number }[] {
  if (!recap) return [];
  const out: { name: string; team: "home" | "away"; count: number }[] = [];
  for (const t of recap.homeTryscorers ?? []) out.push({ name: t.name, team: "home", count: t.count });
  for (const t of recap.awayTryscorers ?? []) out.push({ name: t.name, team: "away", count: t.count });
  return out;
}

function pickName(p?: EnginePlayerPick | null): string | null {
  if (!p?.name) return null;
  return p.name;
}

function scoredCount(name: string, scorers: { name: string; count: number }[]): number {
  const k = normName(name);
  for (const s of scorers) if (normName(s.name) === k) return s.count;
  return 0;
}

export function buildDeterministicAftermatch(args: {
  matchId: string;
  details: NrlMatchDetails;
  recap: NrlMatchRecap | null;
  insights: Insights | null;
}): AftermatchPayload | null {
  const { details, recap, insights } = args;
  const det = (insights as unknown as { deterministic?: DeterministicInsights } | null)?.deterministic ?? null;

  const homeScore = details.homeTeam.score;
  const awayScore = details.awayTeam.score;
  if (typeof homeScore !== "number" || typeof awayScore !== "number") return null;

  const homeNick = details.homeTeam.nickName;
  const awayNick = details.awayTeam.nickName;
  const actualWinnerNick = homeScore > awayScore ? homeNick : homeScore < awayScore ? awayNick : "Draw";
  const actualMargin = Math.abs(homeScore - awayScore);
  const actualTotal = homeScore + awayScore;

  const hits: AftermatchHit[] = [];

  if (det) {
    // Match winner
    const predWinnerNick = det.matchWinner?.nickname ?? "";
    hits.push({
      market: "Match Winner",
      predicted: predWinnerNick || "—",
      actual: actualWinnerNick,
      status: predWinnerNick && predWinnerNick === actualWinnerNick ? "hit" : "miss",
    });

    // Margin bucket (1-12 vs 13+)
    const predBucket = String(det.margin?.bucket ?? "").replace("–", "-");
    const actualBucket = actualMargin === 0 ? "Draw" : actualMargin <= 12 ? "1-12" : "13+";
    hits.push({
      market: "Winning Margin",
      predicted: predBucket || "—",
      actual: `${actualBucket} (${actualMargin})`,
      status: predBucket && actualBucket === predBucket ? "hit" : "miss",
    });

    // Predicted score — exact = hit, within 8 combined = partial
    const ph = det.predictedScore?.home;
    const pa = det.predictedScore?.away;
    if (typeof ph === "number" && typeof pa === "number") {
      const diff = Math.abs(ph - homeScore) + Math.abs(pa - awayScore);
      hits.push({
        market: "Predicted Score",
        predicted: `${ph}-${pa}`,
        actual: `${homeScore}-${awayScore}`,
        status: diff === 0 ? "hit" : diff <= 10 ? "partial" : "miss",
        detail: `Combined error ${diff} pts`,
      });
    }

    // Total points line
    const line = det.totalPoints?.line;
    const lean = det.totalPoints?.lean;
    if (typeof line === "number" && lean) {
      const wentOver = actualTotal > line;
      const correct = (lean === "over" && wentOver) || (lean === "under" && !wentOver);
      hits.push({
        market: `Total Points (${lean.toUpperCase()} ${line})`,
        predicted: `${lean.toUpperCase()} ${line}`,
        actual: `${actualTotal} pts`,
        status: correct ? "hit" : "miss",
      });
    }

    // HT/FT — we don't have HT score from recap reliably; mark unknown if absent.
    if (det.htft?.pick) {
      hits.push({
        market: "HT/FT",
        predicted: det.htft.pick,
        actual: actualWinnerNick === "Draw" ? "Draw final" : `${actualWinnerNick} won`,
        status: det.htft.pick.endsWith(actualWinnerNick) ? "partial" : "miss",
        detail: "HT score not tracked — assessed on FT only",
      });
    }
  }

  // Tryscorer hits
  const tryscorerHits: AftermatchPlayerHit[] = [];
  const allScorers = flatTryscorers(recap);
  if (det) {
    const checks: { name: string | null; market: string }[] = [
      { name: pickName(det.firstTryscorer), market: "First Tryscorer" },
      { name: pickName(det.rankedTryscorers?.first), market: "Top Anytime #1" },
      { name: pickName(det.rankedTryscorers?.second), market: "Top Anytime #2" },
      { name: pickName(det.rankedTryscorers?.third), market: "Top Anytime #3" },
      { name: pickName(det.playerDouble), market: "2+ Tries" },
    ];
    for (const p of (det.predictedOutcome?.picks ?? []).slice(0, 3)) {
      checks.push({ name: p?.name ?? null, market: "Predicted Anytime" });
    }
    const seen = new Set<string>();
    for (const c of checks) {
      if (!c.name) continue;
      const k = `${normName(c.name)}::${c.market}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const scored = scoredCount(c.name, allScorers);
      const need2 = c.market === "2+ Tries";
      const isHit = need2 ? scored >= 2 : scored >= 1;
      tryscorerHits.push({
        name: c.name,
        predictedAs: c.market,
        scored,
        status: isHit ? "hit" : "miss",
      });
    }
  }

  const hitCount = hits.filter((h) => h.status === "hit").length
    + tryscorerHits.filter((t) => t.status === "hit").length;
  const totalCount = hits.length + tryscorerHits.length;

  const consistencies: string[] = [];
  const inconsistencies: string[] = [];
  for (const h of hits) {
    if (h.status === "hit") consistencies.push(`${h.market}: predicted ${h.predicted}, got ${h.actual}.`);
    else if (h.status === "miss") inconsistencies.push(`${h.market}: predicted ${h.predicted}, actual ${h.actual}.`);
  }
  const tryHits = tryscorerHits.filter((t) => t.status === "hit");
  const tryMiss = tryscorerHits.filter((t) => t.status === "miss");
  if (tryHits.length) consistencies.push(`Tryscorer picks landed: ${tryHits.map((t) => `${t.name} (${t.scored})`).join(", ")}.`);
  if (tryMiss.length) inconsistencies.push(`Tryscorer picks missed: ${tryMiss.map((t) => t.name).join(", ")}.`);

  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    matchId: args.matchId,
    homeNickname: homeNick,
    awayNickname: awayNick,
    finalScore: { home: homeScore, away: awayScore },
    hits,
    tryscorerHits,
    scoreLine: { hits: hitCount, total: totalCount },
    consistencies,
    inconsistencies,
    summary: "", // filled by AI step
  };
}

async function summariseWithAI(payload: AftermatchPayload): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return "";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const sys = "You are a sharp NRL analyst. In 2-3 short sentences, summarise where the pre-match insights matched the actual result and where they diverged. Be specific (cite markets, players, or score). Plain prose, no bullets, no headings, no betting hype, no emojis.";
    const user = [
      `Match: ${payload.homeNickname} vs ${payload.awayNickname} — final ${payload.finalScore.home}-${payload.finalScore.away}.`,
      `Score: ${payload.scoreLine.hits}/${payload.scoreLine.total} predictions correct.`,
      payload.consistencies.length ? `Consistencies:\n- ${payload.consistencies.join("\n- ")}` : "Consistencies: none.",
      payload.inconsistencies.length ? `Inconsistencies:\n- ${payload.inconsistencies.join("\n- ")}` : "Inconsistencies: none.",
    ].join("\n\n");
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: 220,
      }),
    });
    if (!res.ok) return "";
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    return (j.choices?.[0]?.message?.content ?? "").trim();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

export async function ensureAftermatch(args: {
  matchId: string;
  details: NrlMatchDetails;
  recap: NrlMatchRecap | null;
  insights: Insights | null;
}): Promise<AftermatchPayload | null> {
  // Only generate once the match is finished.
  const finished = /^(FullTime|Final|Completed)$/i.test(args.details.matchState);
  if (!finished) return null;

  const cached = await readAftermatch(args.matchId);
  if (cached && cached.summary) return cached;

  const built = buildDeterministicAftermatch(args);
  if (!built) return null;

  const summary = await summariseWithAI(built);
  built.summary = summary || (
    built.consistencies.length
      ? `The model nailed ${built.scoreLine.hits} of ${built.scoreLine.total} key calls — strongest on ${built.consistencies[0].split(":")[0]}. ${built.inconsistencies[0] ?? ""}`.trim()
      : `The model struggled this week (${built.scoreLine.hits}/${built.scoreLine.total} correct).`
  );
  await writeAftermatch(args.matchId, built);
  return built;
}

// ---------- Carry-forward "Last Week's Lessons" ----------

export type TeamLesson = {
  matchId: string;
  opponentNickname: string;
  finalScore: { team: number; opponent: number };
  result: "W" | "L" | "D";
  scoreLine: { hits: number; total: number };
  topConsistencies: string[];   // up to 3
  topInconsistencies: string[]; // up to 3
  summary: string;
};

// Find the most recent finished match for `nickname` (other than `excludeMatchId`)
// and shape its aftermatch payload as a lesson card. Returns null if not found.
export async function getLastLessonForTeam(args: {
  nickname: string;
  excludeMatchId: string;
}): Promise<TeamLesson | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload, generated_at")
      .order("generated_at" as never, { ascending: false })
      .limit(80);
    if (error || !data) return null;
    const rows = data as { payload: AftermatchPayload }[];
    const target = args.nickname.trim().toLowerCase();
    for (const row of rows) {
      const p = row.payload;
      if (!p) continue;
      if (p.matchId === args.excludeMatchId) continue;
      const isHome = p.homeNickname?.trim().toLowerCase() === target;
      const isAway = p.awayNickname?.trim().toLowerCase() === target;
      if (!isHome && !isAway) continue;
      const teamScore = isHome ? p.finalScore.home : p.finalScore.away;
      const oppScore = isHome ? p.finalScore.away : p.finalScore.home;
      const opponentNickname = isHome ? p.awayNickname : p.homeNickname;
      const result: "W" | "L" | "D" = teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "D";
      return {
        matchId: p.matchId,
        opponentNickname,
        finalScore: { team: teamScore, opponent: oppScore },
        result,
        scoreLine: p.scoreLine,
        topConsistencies: (p.consistencies ?? []).slice(0, 3),
        topInconsistencies: (p.inconsistencies ?? []).slice(0, 3),
        summary: p.summary ?? "",
      };
    }
    return null;
  } catch {
    return null;
  }
}
