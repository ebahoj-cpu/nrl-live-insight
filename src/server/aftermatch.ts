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
import { recordResultAndScore } from "./prediction-tracking";

const TABLE = "match_aftermatch";
const VERSION = "v3-structured";
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

export type AftermatchComparison = {
  team: {
    winner: { predicted: string; actual: string; correct: boolean };
    margin: { predicted: string; actual: string; actualMargin: number; correct: boolean };
    total: { predictedLine: number | null; predictedLean: "over" | "under" | null; actual: number; correct: boolean | null };
    htft: { predicted: string | null; actualWinner: string; partial: boolean | null };
    score: { predicted: string | null; actual: string; combinedError: number | null; close: boolean };
  };
  script: {
    tempo: { predicted: "slow" | "controlled" | "open" | null; actual: "slow" | "controlled" | "open"; correct: boolean | null };
    flow: { predicted: "tight" | "blowout" | null; actual: "tight" | "blowout"; correct: boolean | null };
    dominantTeam: { predicted: string | null; actual: string; correct: boolean | null };
    edge: { predicted: "left" | "right" | "middle" | null; actual: "left" | "right" | "middle" | null; correct: boolean | null };
  };
  players: {
    firstTry: { predicted: string | null; actual: string | null; correct: boolean };
    anytimeHits: number;        // number of distinct predicted players who scored
    anytimeChecked: number;     // number of distinct predicted players considered
    namedHits: { name: string; scored: number }[];
    namedMisses: string[];
  };
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
  comparison: AftermatchComparison;
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
  const script = (insights as unknown as { script?: import("./script-engine").ScriptPayload } | null)?.script ?? null;

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

    // HT/FT intentionally excluded from hit-rate scoring: we don't currently
    // capture HT scores reliably, so it can never be a verified "hit". It is
    // still surfaced in the structured `comparison.team.htft` block for
    // display, but does NOT contribute to the hits/total tally.
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
  // Aggregate by player so the same name doesn't appear as both "hit" (Anytime)
  // AND "miss" (First Tryscorer) — that misrepresents the read. A player who
  // scored at least once is a TRYSCORER hit; First Tryscorer becomes a separate
  // partial note when they scored but weren't first.
  const byPlayer = new Map<string, { name: string; scored: number; markets: string[] }>();
  for (const t of tryscorerHits) {
    const k = normName(t.name);
    const existing = byPlayer.get(k);
    if (existing) {
      existing.markets.push(t.predictedAs);
      existing.scored = Math.max(existing.scored, t.scored);
    } else {
      byPlayer.set(k, { name: t.name, scored: t.scored, markets: [t.predictedAs] });
    }
  }
  const landed = [...byPlayer.values()].filter((p) => p.scored >= 1);
  const blanked = [...byPlayer.values()].filter((p) => p.scored === 0);
  if (landed.length) consistencies.push(`Tryscorer picks landed: ${landed.map((p) => `${p.name} (${p.scored})`).join(", ")}.`);
  if (blanked.length) inconsistencies.push(`Tryscorer picks missed (no try): ${blanked.map((p) => p.name).join(", ")}.`);
  // First-tryscorer specifically: note when our pick scored but wasn't first.
  const firstPickName = pickName(det?.firstTryscorer);
  if (firstPickName) {
    const fp = byPlayer.get(normName(firstPickName));
    if (fp && fp.scored >= 1) {
      // they scored — first tryscorer was technically a miss but Anytime hit.
      // Only annotate if not already covered.
      inconsistencies.push(`First Tryscorer (${firstPickName}): scored ${fp.scored} but wasn't first on the board.`);
    }
  }

  // ---------- Build structured comparison block ----------
  const predTotalLine = det?.totalPoints?.line ?? null;
  const predTotalLean = det?.totalPoints?.lean ?? null;
  const totalCorrect: boolean | null = predTotalLine != null && predTotalLean
    ? ((predTotalLean === "over" && actualTotal > predTotalLine) || (predTotalLean === "under" && actualTotal <= predTotalLine))
    : null;

  const ph = det?.predictedScore?.home;
  const pa = det?.predictedScore?.away;
  const combinedError = (typeof ph === "number" && typeof pa === "number")
    ? Math.abs(ph - homeScore) + Math.abs(pa - awayScore) : null;

  // Tempo from actual: total points relative to predicted line, fallback 42
  const tempoLine = predTotalLine ?? 42;
  const actualTempo: "slow" | "controlled" | "open" =
    actualTotal >= tempoLine + 8 ? "open" : actualTotal <= tempoLine - 8 ? "slow" : "controlled";
  const predTempo: "slow" | "controlled" | "open" | null = predTotalLean === "over"
    ? "open" : predTotalLean === "under" ? "slow" : (predTotalLean ? "controlled" : null);

  const actualFlow: "tight" | "blowout" = actualMargin >= 13 ? "blowout" : "tight";
  const predFlow: "tight" | "blowout" | null = det?.margin?.bucket
    ? (det.margin.bucket === "13+" ? "blowout" : "tight") : null;

  // Dominant team = projected winner from script/det
  const predDominant = det?.matchWinner?.nickname ?? null;
  const actualDominant = actualWinnerNick === "Draw" ? "Draw" : actualWinnerNick;

  // Edge prediction: from script edges (left/right confidence) — pick the side
  // whose confidence is "market-supported" else the projected one. Actual edge
  // not reliably parseable, so left null unless tryscorer landed in named edge
  const predEdge: "left" | "right" | "middle" | null = script
    ? (script.edges.leftConfidence === "market-supported" ? "left"
       : script.edges.rightConfidence === "market-supported" ? "right" : null)
    : null;

  // First try
  const actualFirstTry = recap?.firstTry?.name ?? null;
  const firstPredName = pickName(det?.firstTryscorer);
  const firstCorrect = !!(firstPredName && actualFirstTry && normName(firstPredName) === normName(actualFirstTry));

  const namedHits = [...byPlayer.values()].filter((p) => p.scored >= 1)
    .map((p) => ({ name: p.name, scored: p.scored }));
  const namedMisses = [...byPlayer.values()].filter((p) => p.scored === 0).map((p) => p.name);

  const comparison: AftermatchComparison = {
    team: {
      winner: { predicted: det?.matchWinner?.nickname ?? "—", actual: actualWinnerNick, correct: !!(det?.matchWinner?.nickname && det.matchWinner.nickname === actualWinnerNick) },
      margin: {
        predicted: String(det?.margin?.bucket ?? "—").replace("–", "-"),
        actual: actualMargin === 0 ? "Draw" : actualMargin <= 12 ? "1-12" : "13+",
        actualMargin,
        correct: !!(det?.margin?.bucket && (actualMargin === 0 ? false : (actualMargin <= 12 ? "1-12" : "13+") === det.margin.bucket)),
      },
      total: { predictedLine: predTotalLine, predictedLean: predTotalLean, actual: actualTotal, correct: totalCorrect },
      htft: {
        predicted: det?.htft?.pick ?? null,
        actualWinner: actualWinnerNick,
        partial: det?.htft?.pick ? det.htft.pick.endsWith(actualWinnerNick) : null,
      },
      score: {
        predicted: (typeof ph === "number" && typeof pa === "number") ? `${ph}-${pa}` : null,
        actual: `${homeScore}-${awayScore}`,
        combinedError,
        close: combinedError != null && combinedError <= 10,
      },
    },
    script: {
      tempo: { predicted: predTempo, actual: actualTempo, correct: predTempo ? predTempo === actualTempo : null },
      flow: { predicted: predFlow, actual: actualFlow, correct: predFlow ? predFlow === actualFlow : null },
      dominantTeam: { predicted: predDominant, actual: actualDominant, correct: predDominant ? predDominant === actualDominant : null },
      edge: { predicted: predEdge, actual: null, correct: null },
    },
    players: {
      firstTry: { predicted: firstPredName, actual: actualFirstTry, correct: firstCorrect },
      anytimeHits: namedHits.length,
      anytimeChecked: byPlayer.size,
      namedHits,
      namedMisses,
    },
  };

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
    comparison,
    summary: "", // filled by AI step
  };
}

function buildFallbackSummary(p: AftermatchPayload): string {
  const c = p.comparison;
  const teamCorrect = [c.team.winner.correct, c.team.margin.correct, c.team.total.correct === true].filter(Boolean).length;
  const scriptCorrect = [c.script.tempo.correct === true, c.script.flow.correct === true, c.script.dominantTeam.correct === true].filter(Boolean).length;
  const playerHits = c.players.anytimeHits;
  const allWrong = !c.team.winner.correct && !c.team.margin.correct && c.team.total.correct !== true && scriptCorrect === 0 && playerHits === 0;

  const s1 = c.team.winner.correct
    ? (c.team.margin.correct
        ? `Strong team read — winner and ${c.team.margin.predicted} margin both landed.`
        : `Winner call landed (${c.team.winner.actual}) but margin band missed (predicted ${c.team.margin.predicted}, actual ${c.team.margin.actual}).`)
    : (c.team.margin.correct
        ? `Winner call missed but the ${c.team.margin.predicted} margin band still came through.`
        : `Winner and margin both missed — final ${p.finalScore.home}-${p.finalScore.away}.`);

  let s2: string;
  if (c.script.dominantTeam.correct && c.script.flow.correct === false) {
    s2 = `Game script read was correct but execution differed — ${c.script.flow.actual === "blowout" ? "the contest opened up wider than projected" : "it stayed tighter than projected"}.`;
  } else if (scriptCorrect >= 2) {
    s2 = `Game script aligned on tempo, flow and dominant team.`;
  } else if (c.script.tempo.correct === false) {
    s2 = c.script.tempo.actual === "open" ? "Game opened up more than expected." : "Tempo stayed controlled against the projected flow.";
  } else {
    s2 = "Script read was mixed — flow and dominant team didn't fully line up.";
  }

  let s3: string;
  if (c.players.firstTry.correct) {
    s3 = `Player markets nailed first tryscorer (${c.players.firstTry.actual})${playerHits ? ` and returned ${playerHits} anytime hit${playerHits === 1 ? "" : "s"}` : ""}.`;
  } else if (playerHits > 0) {
    s3 = `Player markets returned ${playerHits} anytime hit${playerHits === 1 ? "" : "s"} (${c.players.namedHits.map((x) => x.name).join(", ")}) — first tryscorer missed.`;
  } else if (c.players.anytimeChecked > 0) {
    s3 = "Attacking reads were correct, execution missed — none of the named tryscorer picks crossed.";
  } else {
    s3 = "No player markets were locked pre-match.";
  }

  let s4: string;
  if (allWrong) {
    s4 = "Carry into this week: rebuild from live signals — the pre-match read missed across team, script and players.";
  } else if (c.team.score.close) {
    s4 = "Carry into this week: score projection stayed close to the final result — trust the structure where form and matchup align.";
  } else if (teamCorrect >= 2) {
    s4 = "Carry into this week: trust the team-level read but stay cautious on player markets.";
  } else {
    s4 = "Carry into this week: lean on the parts that worked and verify with live odds before locking picks.";
  }

  return `${s1} ${s2} ${s3} ${s4}`;
}

async function summariseWithAI(payload: AftermatchPayload): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return "";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const c = payload.comparison;
    const sys = [
      "You are a sharp NRL analyst writing a 'Last Week's Lessons' card.",
      "You MUST compare what the model PREDICTED vs what ACTUALLY happened — never invent results.",
      "Write EXACTLY 3-4 short sentences in plain prose. No bullets, headings, hype, or emojis.",
      "Structure: Sentence 1 = team outcome accuracy (winner/margin/total). Sentence 2 = game script accuracy (tempo, flow, dominant team). Sentence 3 = player market performance (first try + anytime hits). Sentence 4 = key takeaway (begin with 'Carry into this week:').",
      "Rules:",
      "- Do NOT say 'completely missed' unless winner, margin, total AND script are all wrong AND there were no tryscorer hits.",
      "- Reward partial success: correct margin band, close score (combined error <=10), correct dominant team, anytime hits.",
      "- If script was right but result flipped: say 'Game script read was correct but execution differed.'",
      "- If predicted players didn't score but were named anyway: say 'Attacking reads were correct, execution missed.'",
      "- If combined score error <=10: say 'Score projection stayed close to the final result.'",
      "- If tempo wrong open vs controlled: say 'Game opened up more than expected' or 'Tempo stayed controlled'.",
    ].join("\n");
    const user = [
      `Match: ${payload.homeNickname} vs ${payload.awayNickname} — final ${payload.finalScore.home}-${payload.finalScore.away}.`,
      "",
      "TEAM COMPARISON:",
      `- Winner: predicted ${c.team.winner.predicted}, actual ${c.team.winner.actual} → ${c.team.winner.correct ? "CORRECT" : "WRONG"}.`,
      `- Margin band: predicted ${c.team.margin.predicted}, actual ${c.team.margin.actual} (${c.team.margin.actualMargin} pts) → ${c.team.margin.correct ? "CORRECT" : "WRONG"}.`,
      `- Total points: predicted ${c.team.total.predictedLean ?? "—"} ${c.team.total.predictedLine ?? ""}, actual ${c.team.total.actual} → ${c.team.total.correct === null ? "n/a" : c.team.total.correct ? "CORRECT" : "WRONG"}.`,
      `- Predicted score: ${c.team.score.predicted ?? "n/a"}, actual ${c.team.score.actual}${c.team.score.combinedError != null ? ` (combined error ${c.team.score.combinedError})` : ""}${c.team.score.close ? " — CLOSE" : ""}.`,
      `- HT/FT pick: ${c.team.htft.predicted ?? "n/a"} (final winner ${c.team.htft.actualWinner}).`,
      "",
      "SCRIPT COMPARISON:",
      `- Tempo: predicted ${c.script.tempo.predicted ?? "n/a"}, actual ${c.script.tempo.actual} → ${c.script.tempo.correct === null ? "n/a" : c.script.tempo.correct ? "CORRECT" : "WRONG"}.`,
      `- Flow: predicted ${c.script.flow.predicted ?? "n/a"}, actual ${c.script.flow.actual} → ${c.script.flow.correct === null ? "n/a" : c.script.flow.correct ? "CORRECT" : "WRONG"}.`,
      `- Dominant team: predicted ${c.script.dominantTeam.predicted ?? "n/a"}, actual ${c.script.dominantTeam.actual} → ${c.script.dominantTeam.correct === null ? "n/a" : c.script.dominantTeam.correct ? "CORRECT" : "WRONG"}.`,
      `- Predicted attacking edge: ${c.script.edge.predicted ?? "n/a"} (actual edge unmeasured).`,
      "",
      "PLAYER COMPARISON:",
      `- First tryscorer: predicted ${c.players.firstTry.predicted ?? "n/a"}, actual ${c.players.firstTry.actual ?? "n/a"} → ${c.players.firstTry.correct ? "CORRECT" : "WRONG"}.`,
      `- Anytime hits: ${c.players.anytimeHits} of ${c.players.anytimeChecked} predicted players scored.`,
      c.players.namedHits.length ? `- Hits: ${c.players.namedHits.map((p) => `${p.name} (${p.scored})`).join(", ")}.` : "- Hits: none.",
      c.players.namedMisses.length ? `- Missed: ${c.players.namedMisses.join(", ")}.` : "- Missed: none.",
    ].join("\n");
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
        temperature: 0.25,
        max_tokens: 320,
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
  built.summary = summary || buildFallbackSummary(built);

  await writeAftermatch(args.matchId, built);
  // Score the locked pre-kickoff prediction snapshot (idempotent — only runs
  // once per match because both result + score rows are insert-only).
  try {
    await recordResultAndScore({ matchId: args.matchId, details: args.details, recap: args.recap });
  } catch (e) { console.warn("recordResultAndScore failed:", e); }
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
//
// Backfill: if no aftermatch row exists yet for the team's most recent finished
// fixture (which happens when nobody has visited that match page since
// FullTime), generate it on the fly from cached pre-match insights + a fresh
// recap fetch. This guarantees every team has a lessons card once they've
// played.
export async function getLastLessonForTeam(args: {
  nickname: string;
  excludeMatchId: string;
  recentForm?: { url?: string; result?: string }[];
}): Promise<TeamLesson | null> {
  // 1) Try existing aftermatch rows first (fast path).
  const existing = await findLessonInExistingRows(args.nickname, args.excludeMatchId);
  if (existing) return existing;

  // 2) Backfill: walk the team's recentForm URLs (most-recent first) and
  // build aftermatch from the stored pre-match insights for that match.
  const urls = (args.recentForm ?? []).map((r) => r.url).filter((u): u is string => !!u);
  for (const url of urls) {
    try {
      const matchId = url
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .slice(-3)
        .join("/");
      if (!matchId || matchId === args.excludeMatchId) continue;

      // Already in DB?
      const row = await readAftermatch(matchId);
      if (row) {
        return shapeLesson(args.nickname, row);
      }

      // Pull pre-match insights + match details, then build.
      const [{ fetchMatchDetails, fetchMatchRecap }, { readAnySharedInsights }] = await Promise.all([
        import("./nrl"),
        import("./insights-store"),
      ]);
      const [details, recap, insightsRow] = await Promise.all([
        fetchMatchDetails(matchId).catch(() => null),
        fetchMatchRecap(`https://www.nrl.com/draw/nrl-premiership/${matchId}/`).catch(() => null),
        readAnySharedInsights(matchId).catch(() => null),
      ]);
      if (!details) continue;
      const built = await ensureAftermatch({
        matchId,
        details,
        recap,
        insights: insightsRow?.payload ?? null,
      });
      if (built) {
        const shaped = shapeLesson(args.nickname, built);
        if (shaped) return shaped;
      }
    } catch (e) {
      console.warn("[lessons] backfill failed for", url, e);
    }
  }
  return null;
}

async function findLessonInExistingRows(nickname: string, excludeMatchId: string): Promise<TeamLesson | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE as never)
      .select("payload, generated_at")
      .order("generated_at" as never, { ascending: false })
      .limit(80);
    if (error || !data) return null;
    const rows = data as { payload: AftermatchPayload }[];
    const target = nickname.trim().toLowerCase();
    for (const row of rows) {
      const p = row.payload;
      if (!p) continue;
      if (p.matchId === excludeMatchId) continue;
      const isHome = p.homeNickname?.trim().toLowerCase() === target;
      const isAway = p.awayNickname?.trim().toLowerCase() === target;
      if (!isHome && !isAway) continue;
      return shapeLesson(nickname, p);
    }
    return null;
  } catch {
    return null;
  }
}

function shapeLesson(nickname: string, p: AftermatchPayload): TeamLesson | null {
  const target = nickname.trim().toLowerCase();
  const isHome = p.homeNickname?.trim().toLowerCase() === target;
  const isAway = p.awayNickname?.trim().toLowerCase() === target;
  if (!isHome && !isAway) return null;
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
