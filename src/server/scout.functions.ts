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
    // Common shapes: { matches: [...] } or { stats: [...] }. Extract last few results.
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

  return lines.join("\n");
}

async function buildScoutContext(): Promise<string> {
  const season = NOW_SEASON();
  const [fixtures, ladder, liveOdds, news, snap] = await Promise.all([
    cached(`fixtures:${season}:current`, TTL.fixtures, () => fetchDraw(season)).catch(() => []),
    cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => []),
    cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds()).catch(() => []),
    cached("news:all", 15 * 60_000, () => fetchNews()).catch(() => [] as NewsItem[]),
    getSeasonSnapshot(season).catch(() => null),
  ]);
  const odds = liveOdds.length ? liveOdds : buildEstimatedOdds(fixtures, ladder);

  // Pick the next chronological 8 fixtures that haven't finished yet.
  const nowMs = Date.now();
  const upcoming = fixtures
    .filter((f) => !/full\s*time|fulltime/i.test(f.matchState))
    .filter((f) => {
      const t = f.kickoffUtc ? Date.parse(f.kickoffUtc) : NaN;
      // keep if kickoff unknown, in the future, or within last 4h (live)
      return isNaN(t) || t > nowMs - 4 * 3600_000;
    })
    .sort((a, b) => {
      const ta = a.kickoffUtc ? Date.parse(a.kickoffUtc) : Number.MAX_SAFE_INTEGER;
      const tb = b.kickoffUtc ? Date.parse(b.kickoffUtc) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    })
    .slice(0, 6);

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

  return [
    `# NRL Snapshot · season ${season} · generated ${new Date().toISOString()}`,
    "",
    "## GROUND TRUTH — Current Round Fixtures (authoritative who-plays-who)",
    groundTruthFixtures,
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

// A tiny instant-fallback snapshot for the very first cold request, so users
// never wait on the full context build. SWR will replace it on the next turn.
async function buildMinimalContext(): Promise<string> {
  const season = NOW_SEASON();
  const ladder = await cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => []);
  const ladderLines = ladder.slice(0, 17).map((r) =>
    `${r.position}. ${r.nickname} — ${r.played}P ${r.wins}W ${r.losses}L, ${r.points}pts`,
  ).join("\n");
  return `# NRL quick snapshot · season ${season}\n\n## Ladder\n${ladderLines || "(unavailable)"}`;
}

export const scoutChat = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    try {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    // Stale-while-revalidate: if we have any cached snapshot (even expired),
    // use it instantly and refresh in the background. Otherwise, build a
    // minimal snapshot now (just the ladder) and queue the full one.
    const fallback = await buildMinimalContext().catch(() => "(snapshot unavailable)");
    const context = await staleWhileRevalidate(
      "scout:context:v7",
      CTX_TTL,
      buildScoutContext,
      fallback,
    ).catch((e) => { console.error("[scout] context build failed:", e); return fallback; });

    const system = [
      "You are SCOUT — a sharp, friendly NRL betting analyst inside LINEBREAK. Sporty, confident, plain-spoken Aussie tone.",
      "",
      "GROUND TRUTH PROTOCOL — read this BEFORE every reply:",
      "• The 'GROUND TRUTH — Current Round Fixtures' block is the ONLY authoritative source for who plays who this round.",
      "• Before naming any matchup, cross-reference it against that fixtures list. Never infer an opponent from ladder proximity, odds order, or memory.",
      "• If a user mentions a matchup that isn't in the fixtures list (e.g. 'Knights v Dolphins' when it's actually 'Storm v Dolphins'), correct them politely and use the real fixture.",
      "• When recommending a pick, name BOTH teams in the matchup so it's unambiguous (e.g. 'Broncos H2H @2.15 vs Cowboys' — never just 'Broncos H2H').",
      "• If a team isn't playing this round per the fixtures list, do NOT include them in picks/recommendations.",
      "",
      "DATA YOU HAVE in SNAPSHOT below — never ask for it, never claim you lack it:",
      "• Authoritative round fixtures (home v away, venue, kickoff)",
      "• Live ladder",
      "• Live odds: H2H best, line/spread, totals across all bookies",
      "• Season form per team: W-L-D, PPG for/against, HT-lead %, HT→W conversion %, last-5",
      "• Recent news headlines",
      "",
      "DATA YOU DO NOT HAVE — never invent:",
      "• Late mail / ins-outs / tryscorer markets (not in this snapshot — say markets/lineups not yet posted if asked)",
      "• Multi-season historical logs (current season only)",
      "• Play-by-play stats, possession %, completions",
      "If a question needs missing data, give the sharpest read possible from what IS in SNAPSHOT — do not list what you lack.",
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
