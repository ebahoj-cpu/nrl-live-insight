// Scout — the AI chatbot brain of LINEBREAK. Wires in:
//   • Live odds: H2H, line (spread), totals + best tryscorer markets
//   • Team lists / late mail (ins, outs, blurb) per fixture
//   • Season form: PPG for/against, HT lead → win rate, last 5 results
//   • Head-to-head history from the match-centre payload
//   • Ladder, fixtures, recent news headlines
// Heavy lifting is cached so chat turns stay snappy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cached, staleWhileRevalidate, TTL } from "./cache";
import { fetchDraw, fetchLadder, fetchMatchDetails, type NrlMatchDetails } from "./nrl";
import { buildEstimatedOdds, fetchNrlOdds, fetchTryscorerOdds, bestH2H, type OddsEvent } from "./odds";
import { fetchNews, type NewsItem } from "./news";
import { getSeasonSnapshot, getTeam, type TeamSeasonStats } from "./season-stats";
import { findTeam } from "@/lib/teams";
import { readAnySharedInsights } from "./insights-store";
import type { Insights } from "./ai-insights";

// Race a promise against a timeout, returning a fallback if it doesn't beat the clock.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(fallback); });
  });
}

const Message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});
const Input = z.object({
  messages: z.array(Message).min(1).max(40),
});

const NOW_SEASON = () => new Date().getUTCFullYear();
const CTX_TTL = 5 * 60_000;            // 5 min – whole context bundle
const FIXTURE_TTL = 10 * 60_000;       // 10 min – per-match deep data
const TRYSCORER_TTL = 15 * 60_000;     // 15 min – player markets

// Find the matching odds event for a fixture (by nicknames either direction)
function matchOddsEvent(
  odds: OddsEvent[],
  homeNick: string,
  awayNick: string,
): OddsEvent | undefined {
  const h = findTeam(homeNick)?.nickname ?? homeNick;
  const a = findTeam(awayNick)?.nickname ?? awayNick;
  return odds.find((e) =>
    (e.homeNickname === h && e.awayNickname === a) ||
    (e.homeNickname === a && e.awayNickname === h),
  );
}

// Compact a team's season profile for the prompt.
function teamLine(t: TeamSeasonStats | null, label: string): string {
  if (!t || t.played === 0) return `${label}: no season data`;
  const last5 = t.last5.map((r) => r.result).join("");
  return `${label} (${t.wins}-${t.losses}-${t.draws}): PF ${t.ppgFor.toFixed(1)} / PA ${t.ppgAgainst.toFixed(1)} per game · HT-lead ${(t.htLeadRate*100).toFixed(0)}% · HT-lead→W ${(t.htConversionRate*100).toFixed(0)}% · last5 ${last5 || "—"}`;
}

// Pull best line / total markets from the first bookmaker that offers them.
function pickLineTotal(ev: OddsEvent | undefined, homeNick: string | null, awayNick: string | null) {
  if (!ev) return { line: "", total: "" };
  let line = "", total = "";
  for (const b of ev.bookmakers) {
    if (!line) {
      const m = b.markets.find((x) => x.key === "spreads");
      if (m && m.outcomes.length >= 2) {
        const ho = m.outcomes.find((o) => findTeam(o.name)?.nickname === homeNick);
        const ao = m.outcomes.find((o) => findTeam(o.name)?.nickname === awayNick);
        if (ho && ao && ho.point != null && ao.point != null) {
          const sign = (n: number) => n > 0 ? `+${n}` : `${n}`;
          line = `${homeNick} ${sign(ho.point)} (${ho.price}) / ${awayNick} ${sign(ao.point)} (${ao.price}) [${b.title}]`;
        }
      }
    }
    if (!total) {
      const m = b.markets.find((x) => x.key === "totals");
      if (m && m.outcomes.length >= 2) {
        const over = m.outcomes.find((o) => /over/i.test(o.name));
        const under = m.outcomes.find((o) => /under/i.test(o.name));
        if (over && under && over.point != null) {
          total = `O/U ${over.point}: O ${over.price} / U ${under.price} [${b.title}]`;
        }
      }
    }
    if (line && total) break;
  }
  return { line, total };
}

// Compact one-liner squad list — same starters/bench shown on the match page.
function formatSquad(players: { firstName: string; lastName: string; position: string; jerseyNumber?: number; isCaptain?: boolean }[] | undefined, label: string): string {
  if (!players || players.length === 0) return `${label} squad: not yet named`;
  const sorted = [...players].sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99));
  const starters = sorted.filter((p) => (p.jerseyNumber ?? 99) <= 13);
  const bench = sorted.filter((p) => (p.jerseyNumber ?? 99) > 13 && (p.jerseyNumber ?? 99) <= 17);
  const fmt = (p: typeof sorted[number]) => `${p.jerseyNumber ?? "?"}. ${p.firstName} ${p.lastName}${p.isCaptain ? " (C)" : ""}`;
  const parts: string[] = [];
  parts.push(`${label} starting 13: ${starters.map(fmt).join(", ") || "—"}`);
  if (bench.length) parts.push(`${label} bench: ${bench.map(fmt).join(", ")}`);
  return parts.join("\n");
}

// Pull the SAME AI insights the user sees on the match page (winner pick,
// margin, predicted score, totals lean, HT/FT, top tryscorers, top recommended
// plays). This guarantees Scout's chat answers stay aligned with the Insights tab.
async function summarizeStoredInsights(matchId: string, homeNick: string, awayNick: string): Promise<string> {
  const stored = await readAnySharedInsights(matchId).catch(() => null);
  if (!stored) return "";
  const i: Insights = stored.payload;
  const winnerNick = i.winner.team === "home" ? homeNick : awayNick;
  const lines: string[] = [];
  lines.push(`App-Insights pick: ${winnerNick} (${i.winner.confidence}% conf), margin ${i.margin.bucket}, score ${homeNick} ${i.predictedScore.home}–${i.predictedScore.away} ${awayNick}`);
  lines.push(`Total: ${i.total.pick.toUpperCase()} ${i.total.line} · HT/FT: ${i.htft.pick}`);
  if (i.firstTryscorer?.pick) lines.push(`First-tryscorer pick: ${i.firstTryscorer.pick}`);
  const anytimes = (i.anytimeTryscorers ?? []).slice(0, 5).map((p) => p.pick).filter(Boolean);
  if (anytimes.length) lines.push(`Anytime tryscorer picks: ${anytimes.join(", ")}`);
  if (i.multiTryscorer?.pick) lines.push(`2+ tries pick: ${i.multiTryscorer.pick}`);
  const plays = (i.simulation?.recommendedPlays ?? []).slice(0, 5).map((p) =>
    `${p.pick}${p.decimalOdds ? ` @${p.decimalOdds}` : ""} (${p.confidence}, edge ${p.edgePct.toFixed(0)}%)`,
  );
  if (plays.length) lines.push(`Top recommended plays: ${plays.join(" | ")}`);
  return lines.join("\n");
}

// Build a deep per-fixture brief: odds, lineups, ins/outs, H2H, top tryscorers.
async function buildFixtureBrief(
  matchId: string,
  homeNick: string,
  awayNick: string,
  oddsAll: OddsEvent[],
): Promise<string> {
  const details = await cached<NrlMatchDetails | null>(
    `scout:fix:${matchId}`,
    FIXTURE_TTL,
    async () => fetchMatchDetails(matchId).catch(() => null),
  );
  const ev = matchOddsEvent(oddsAll, homeNick, awayNick);
  const tryscorer = ev
    ? await cached(`scout:try:${ev.id}`, TRYSCORER_TTL, () => fetchTryscorerOdds(ev.id).catch(() => null))
    : null;

  const lines: string[] = [];
  lines.push(`### ${homeNick} v ${awayNick}`);
  if (details) {
    lines.push(`Venue: ${details.venue}, ${details.venueCity} · Round ${details.roundNumber}`);
  }

  // Markets
  if (ev) {
    const h2h = bestH2H(ev);
    const homeRef = ev.homeNickname;
    const awayRef = ev.awayNickname;
    const homeBest = (homeRef === homeNick) ? h2h.home : h2h.away;
    const awayBest = (homeRef === homeNick) ? h2h.away : h2h.home;
    if (homeBest && awayBest) {
      lines.push(`H2H best: ${homeNick} ${homeBest.price} (${homeBest.book}) / ${awayNick} ${awayBest.price} (${awayBest.book})`);
    }
    const { line, total } = pickLineTotal(ev, homeRef, awayRef);
    if (line) lines.push(`Line: ${line}`);
    if (total) lines.push(`Total: ${total}`);
  } else {
    lines.push(`Markets: not yet posted`);
  }

  // Tryscorer top picks (compact — top 6 anytime + top 4 first)
  if (tryscorer && tryscorer.hasAny) {
    const fav = tryscorer.anytime.slice(0, 6).map((t) => `${t.player} ${t.price}`).join(", ");
    const first = tryscorer.first.slice(0, 4).map((t) => `${t.player} ${t.price}`).join(", ");
    if (fav) lines.push(`Anytime favs: ${fav}`);
    if (first) lines.push(`First-tryscorer favs: ${first}`);
  } else {
    lines.push(`Tryscorer markets: not posted yet`);
  }

  // Team lists / late mail
  if (details?.teamNews?.home) {
    const tn = details.teamNews.home;
    if (tn.ins.length || tn.outs.length || tn.blurb) {
      lines.push(`${homeNick} ins: ${tn.ins.slice(0, 6).join(", ") || "—"} | outs: ${tn.outs.slice(0, 6).join(", ") || "—"}`);
      if (tn.blurb) lines.push(`${homeNick} late mail: ${tn.blurb.slice(0, 200)}`);
    }
  }
  if (details?.teamNews?.away) {
    const tn = details.teamNews.away;
    if (tn.ins.length || tn.outs.length || tn.blurb) {
      lines.push(`${awayNick} ins: ${tn.ins.slice(0, 6).join(", ") || "—"} | outs: ${tn.outs.slice(0, 6).join(", ") || "—"}`);
      if (tn.blurb) lines.push(`${awayNick} late mail: ${tn.blurb.slice(0, 200)}`);
    }
  }

  // Squads (1-13 + bench) — same lineup that's rendered on the match page.
  if (details?.homeTeam?.players?.length) {
    lines.push(formatSquad(details.homeTeam.players, homeNick));
  }
  if (details?.awayTeam?.players?.length) {
    lines.push(formatSquad(details.awayTeam.players, awayNick));
  }

  // Recent form per side (last 5 from match-centre)
  if (details) {
    const homeForm = details.homeTeam.recentForm.slice(0, 5).map((r) => `${r.result}(${r.score})`).join(" ");
    const awayForm = details.awayTeam.recentForm.slice(0, 5).map((r) => `${r.result}(${r.score})`).join(" ");
    if (homeForm) lines.push(`${homeNick} last5: ${homeForm}`);
    if (awayForm) lines.push(`${awayNick} last5: ${awayForm}`);
  }

  // Head-to-head history (the match-centre 'history' block when present)
  const hist = details?.history;
  if (hist) {
    const recent: any[] = (hist.matches ?? hist.recent ?? hist.results ?? []) as any[];
    if (Array.isArray(recent) && recent.length) {
      const head = recent.slice(0, 5).map((m: any) => {
        const hs = m.homeScore ?? m.home?.score;
        const as = m.awayScore ?? m.away?.score;
        const hn = m.homeTeam?.nickName ?? m.home?.nickName ?? "?";
        const an = m.awayTeam?.nickName ?? m.away?.nickName ?? "?";
        const yr = (m.kickoffUtc ?? m.startTime ?? "").slice(0, 4);
        return `${hn} ${hs ?? "?"}–${as ?? "?"} ${an}${yr ? ` (${yr})` : ""}`;
      }).join("; ");
      if (head) lines.push(`H2H last 5: ${head}`);
    } else if (typeof hist.summary === "string") {
      lines.push(`H2H: ${hist.summary.slice(0, 200)}`);
    }
  }

  // App Insights summary — mirrors what the user sees on the Insights tab so
  // Scout's chat answers stay consistent with the on-app projections.
  const insightsSummary = await summarizeStoredInsights(matchId, homeNick, awayNick).catch(() => "");
  if (insightsSummary) {
    lines.push(insightsSummary);
  }

  return lines.join("\n");
}

async function buildScoutContext(): Promise<string> {
  const season = NOW_SEASON();
  const [fixtures, ladder, liveOdds, news, snap] = await Promise.all([
    cached(`scout:fixtures:${season}:v2-official`, 60_000, () => fetchDraw(season)),
    cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => []),
    cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds()).catch(() => []),
    cached("news:all", 15 * 60_000, () => fetchNews()).catch(() => [] as NewsItem[]),
    getSeasonSnapshot(season).catch(() => null),
  ]);
  if (!fixtures.length) throw new Error("Official NRL fixtures unavailable");
  const odds = liveOdds.length ? liveOdds : buildEstimatedOdds(fixtures, ladder);

  // Lock to the CURRENT round (per NRL.com's isCurrentRound flag) so a live
  // matchup never gets crowded out by future-round fixtures sneaking in by
  // kickoff sort. Fall back to "next 8 chronological" only if NRL hasn't
  // flagged a current round yet.
  const nowMs = Date.now();
  const notFinished = fixtures.filter((f) => !/full\s*time|fulltime/i.test(f.matchState));
  const currentRoundFixtures = notFinished.filter((f) => f.isCurrentRound);
  const currentRoundNum = currentRoundFixtures[0]?.roundNumber;
  // Include all fixtures from the current round (so byes are obvious by absence)
  // PLUS any from the next round if the current round is mostly done — gives Scout
  // forward visibility without losing tonight's games.
  const fromCurrent = currentRoundNum != null
    ? notFinished.filter((f) => f.roundNumber === currentRoundNum)
    : [];
  const fromNext = currentRoundNum != null
    ? notFinished.filter((f) => f.roundNumber === currentRoundNum + 1)
    : [];
  const pool = (fromCurrent.length ? [...fromCurrent, ...fromNext] : notFinished)
    .filter((f) => {
      const t = f.kickoffUtc ? Date.parse(f.kickoffUtc) : NaN;
      return isNaN(t) || t > nowMs - 4 * 3600_000;
    })
    .sort((a, b) => {
      const ra = a.roundNumber || 0;
      const rb = b.roundNumber || 0;
      if (ra !== rb) return ra - rb;
      const ta = a.kickoffUtc ? Date.parse(a.kickoffUtc) : Number.MAX_SAFE_INTEGER;
      const tb = b.kickoffUtc ? Date.parse(b.kickoffUtc) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  const upcoming = pool.slice(0, 10);

  // Compute byes for the current round so Scout can answer "is X playing?" correctly.
  const playingTeamIds = new Set<number>();
  for (const f of fromCurrent) {
    playingTeamIds.add(f.homeTeam.teamId);
    playingTeamIds.add(f.awayTeam.teamId);
  }
  const byeNicknames = currentRoundNum != null
    ? ladder
        .filter((r) => !playingTeamIds.has(r.teamId))
        .map((r) => r.nickname)
    : [];

  // DEEP briefs in parallel — odds + season form + lineups + late mail + tryscorers + H2H.
  // Each per-fixture deep fetch is cached (FIXTURE_TTL/TRYSCORER_TTL) so steady-state
  // chat turns hit cache. Run concurrently with a soft cap; on the rare slow upstream,
  // we still serve the snapshot via the SWR layer.
  const briefs = await Promise.all(
    upcoming.map((f) =>
      buildFixtureBrief(f.matchId, f.homeTeam.nickName, f.awayTeam.nickName, odds)
        .catch((e) => {
          console.error(`[scout] brief failed for ${f.homeTeam.nickName} v ${f.awayTeam.nickName}:`, e);
          const homeNick = f.homeTeam.nickName;
          const awayNick = f.awayTeam.nickName;
          const ev = matchOddsEvent(odds, homeNick, awayNick);
          const lines: string[] = [`### ${homeNick} v ${awayNick}`];
          if (f.venue) lines.push(`Venue: ${f.venue} · Round ${f.roundNumber ?? "?"}`);
          if (ev) {
            const h2h = bestH2H(ev);
            const homeBest = (ev.homeNickname === homeNick) ? h2h.home : h2h.away;
            const awayBest = (ev.homeNickname === homeNick) ? h2h.away : h2h.home;
            if (homeBest && awayBest) {
              lines.push(`H2H best: ${homeNick} ${homeBest.price} (${homeBest.book}) / ${awayNick} ${awayBest.price} (${awayBest.book})`);
            }
            const { line, total } = pickLineTotal(ev, ev.homeNickname, ev.awayNickname);
            if (line) lines.push(`Line: ${line}`);
            if (total) lines.push(`Total: ${total}`);
          }
          if (snap) {
            const ht = getTeam(snap, homeNick);
            const at = getTeam(snap, awayNick);
            if (ht) lines.push(teamLine(ht, homeNick));
            if (at) lines.push(teamLine(at, awayNick));
          }
          return lines.join("\n");
        }),
    ),
  );

  // GROUND-TRUTH fixtures table — explicit "who plays who" so Scout never
  // pairs the wrong opponents based on ladder proximity or odds confusion.
  const fmtKickoff = (iso: string | undefined) => {
    if (!iso) return "TBD";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "TBD";
    return d.toLocaleString("en-AU", {
      weekday: "short", day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit", timeZone: "Australia/Sydney",
    }) + " AEST";
  };
  const groundTruthFixtures = upcoming.length
    ? upcoming.map((f) =>
        `- Round ${f.roundNumber ?? "?"}: **${f.homeTeam.nickName} v ${f.awayTeam.nickName}** — ${f.venue ?? "venue TBD"} · ${fmtKickoff(f.kickoffUtc)}`,
      ).join("\n")
    : "(no upcoming fixtures found)";

  // Per-team season profiles (one line each)
  const teamProfiles = snap
    ? ladder.slice(0, 17).map((r) => teamLine(getTeam(snap, r.nickname), r.nickname)).join("\n")
    : "(season stats unavailable)";

  const ladderLines = ladder.slice(0, 17).map((r) =>
    `${r.position}. ${r.nickname} — ${r.played}P ${r.wins}W ${r.losses}L, ${r.points}pts, diff ${r.diff}`,
  ).join("\n");

  const newsLines = (news as NewsItem[]).slice(0, 15).map((n) =>
    `- [${n.source}] ${n.title}${n.summary ? ` — ${n.summary.slice(0, 140)}` : ""}`,
  ).join("\n");

  const roundLabel = currentRoundNum != null ? `Round ${currentRoundNum}` : "Current round";
  const byesLine = currentRoundNum != null
    ? (byeNicknames.length ? byeNicknames.join(", ") : "(none)")
    : "(round boundary unclear)";

  return [
    `# NRL Snapshot · season ${season} · ${roundLabel} · generated ${new Date().toISOString()}`,
    "",
    `## GROUND TRUTH — ${roundLabel} Fixtures (authoritative who-plays-who)`,
    groundTruthFixtures,
    "",
    `## GROUND TRUTH — Teams on the BYE this round: ${byesLine}`,
    "",
    "## Ladder",
    ladderLines || "(unavailable)",
    "",
    "## Team season profiles",
    teamProfiles,
    "",
    "## Upcoming fixtures (briefs — odds, season form per matchup)",
    briefs.join("\n\n") || "(no upcoming fixtures found)",
    "",
    "## Recent news headlines",
    newsLines || "(none)",
  ].join("\n");
}

export const scoutChat = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    try {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    // Correctness beats speed here: Scout must never answer from a ladder-only
    // fallback, because that caused false bye / matchup calls. Build the full
    // official fixture snapshot on cold cache, then reuse it briefly.
    const context = await cached(
      "scout:context:v11-lineups-insights",
      CTX_TTL,
      buildScoutContext,
    ).catch((e) => { console.error("[scout] context build failed:", e); return "(official NRL snapshot unavailable)"; });
    if (context.includes("official NRL snapshot unavailable") || !context.includes("## GROUND TRUTH")) {
      throw new Error("Scout can't verify the latest official fixtures right now — try again shortly.");
    }

    const system = [
      "You are SCOUT — a sharp, friendly NRL betting analyst inside LINEBREAK. Sporty, confident, plain-spoken Aussie tone.",
      "",
      "GROUND TRUTH PROTOCOL — read this BEFORE every reply:",
      "• If the snapshot says '(official NRL snapshot unavailable)' or has no GROUND TRUTH fixtures, say you can't verify the latest fixtures right now. Do not answer from memory.",
      "• The 'GROUND TRUTH — Round Fixtures' block is the ONLY authoritative source for who plays who this round. The round number is in the snapshot header.",
      "• The 'GROUND TRUTH — Teams on the BYE this round' line lists every team NOT playing. If a user asks about a team on that bye list, say so directly — do not invent a fixture for them.",
      "• Before naming any matchup, scan the fixtures list for BOTH team names. If you can't find both teams together on the same line, the matchup does not exist this round — correct the user.",
      "• Never infer an opponent from ladder proximity, odds order, alphabetical order, or memory. The fixtures list is the only source of truth.",
      "• When a user names a team (e.g. 'Cowboys'), look up that exact team in the fixtures list to find their real opponent THIS round before answering. If they're on the bye list, say 'X are on the bye this round' — don't guess.",
      "• When recommending a pick, name BOTH teams in the matchup so it's unambiguous (e.g. 'Broncos H2H @2.15 vs Cowboys' — never just 'Broncos H2H').",
      "• If a team is on the bye list, do NOT include them in picks/recommendations.",
      "",
      "DATA YOU HAVE in SNAPSHOT below — never ask for it, never claim you lack it:",
      "• Authoritative round fixtures (home v away, venue, kickoff)",
      "• Live ladder with W-L, points, points-diff",
      "• Live odds across multiple bookies: H2H best, line/spread, totals (O/U)",
      "• Tryscorer markets per fixture (anytime + first-tryscorer favs) — if listed under a fixture, USE THEM",
      "• Full SQUADS per fixture (starting 13 + bench, jersey numbers, captains) — if listed, USE THEM",
      "• Lineups / late mail per fixture (ins, outs, blurb) — if listed under a fixture, USE THEM",
      "• Season form per team: W-L-D, PPG for/against, HT-lead %, HT→W conversion %, last-5",
      "• Per-fixture recent form (last-5 of each side) and head-to-head history",
      "• APP-INSIGHTS line per fixture: the same projected winner, margin, predicted score, totals lean, HT/FT, first/anytime tryscorer picks and top recommended plays the user sees on the Insights tab. When asked 'who do we like / what does the app project / what's the prediction', cite this line directly so chat stays consistent with the Insights tab.",
      "• Recent news headlines",
      "",
      "DATA RULES for missing fields:",
      "• If a fixture brief says 'Tryscorer markets: not posted yet' → say markets aren't out yet for that game.",
      "• If a fixture has no ins/outs lines → say lineups aren't released yet for that game.",
      "• If a squad block isn't shown for a fixture → say the squad hasn't been named yet.",
      "• Otherwise NEVER claim you lack data that IS in SNAPSHOT. Read the relevant fixture block carefully before answering.",
      "",
      "EXTERNAL STATS — when the user asks about historical stats, career numbers, or league-wide records that are NOT in the snapshot (e.g. 'how many tries has Reece Walsh scored this season', 'most points in a game', 'all-time meeting record'):",
      "• You MAY draw on widely-known NRL knowledge to give a useful answer.",
      "• Be explicit about uncertainty — say 'as of my last training data' or 'roughly' rather than fabricating exact numbers.",
      "• NEVER override SNAPSHOT data with memory. The snapshot is the source of truth for fixtures, lineups, odds, ladder and current-season form.",
      "",
      "DATA YOU DO NOT HAVE in SNAPSHOT — be honest if asked for exact numbers:",
      "• Live in-game play-by-play, possession %, completions",
      "• Multi-season historical logs beyond the H2H block",
      "",
      "RESPONSE MODE — pick the right format:",
      "1) CONVERSATIONAL — default for chat, opinions, comparisons, who/what/why questions.",
      "   • Natural prose, 1–4 short paragraphs. No bullets. **Bold** key names sparingly.",
      "2) INSIGHTS — only when user asks for picks, bets, value, edges, tips.",
      "   • 5–8 markdown bullets, no intro/outro. Format: `- **TEAM market** \\`@PRICE\\` vs OPPONENT — sharp reason (≤14 words)`",
      "",
      "DATA RULES:",
      "• Quote exact prices/lines from SNAPSHOT only. Never invent prices, players, or matchups.",
      "• Every pick must reference a matchup that exists in the GROUND TRUTH fixtures list.",
      "• No disclaimers, no 'bet responsibly' (UI handles that).",
      "",
      "=== SNAPSHOT ===",
      context,
      "=== END SNAPSHOT ===",
    ].join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          ...data.messages,
        ],
      }),
    });

    if (res.status === 429) throw new Error("Scout is busy — too many requests. Try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted — top up in Settings → Workspace → Usage.");
    if (!res.ok) throw new Error(`AI gateway error (${res.status})`);

    const json = await res.json() as any;
    const reply = json?.choices?.[0]?.message?.content;
    if (!reply || typeof reply !== "string") throw new Error("Scout returned no reply");
    return { reply };
    } catch (e) {
      console.error("[scout] handler error:", e);
      throw e instanceof Error ? e : new Error(String(e));
    }
  });
