// Scout — the AI chatbot brain of LINEBREAK. Wires in:
//   • Live odds: H2H, line (spread), totals + best tryscorer markets
//   • Team lists / late mail (ins, outs, blurb) per fixture
//   • Season form: PPG for/against, HT lead → win rate, last 5 results
//   • Head-to-head history from the match-centre payload
//   • Ladder, fixtures, recent news headlines
// Heavy lifting is cached so chat turns stay snappy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cached, TTL } from "./cache";
import { fetchDraw, fetchLadder, fetchMatchDetails, type NrlMatchDetails } from "./nrl";
import { fetchNrlOdds, fetchTryscorerOdds, bestH2H, type OddsEvent } from "./odds";
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
  const [fixtures, ladder, odds, news, snap] = await Promise.all([
    cached(`fixtures:${season}:current`, TTL.fixtures, () => fetchDraw(season)).catch(() => []),
    cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => []),
    cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds()).catch(() => []),
    cached("news:all", 15 * 60_000, () => fetchNews()).catch(() => [] as NewsItem[]),
    getSeasonSnapshot(season).catch(() => null),
  ]);

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
    .slice(0, 8);

  // Build deep briefs in parallel for every upcoming fixture.
  const briefs = await Promise.all(upcoming.map((f) =>
    buildFixtureBrief(f.matchId, f.homeTeam.nickName, f.awayTeam.nickName, odds)
      .catch(() => `### ${f.homeTeam.nickName} v ${f.awayTeam.nickName}\n(brief unavailable)`),
  ));

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
    "## Ladder",
    ladderLines || "(unavailable)",
    "",
    "## Team season profiles",
    teamProfiles,
    "",
    "## Upcoming fixtures (deep briefs — odds, lineups, H2H, tryscorer markets)",
    briefs.join("\n\n") || "(no upcoming fixtures found)",
    "",
    "## Recent news headlines",
    newsLines || "(none)",
  ].join("\n");
}

export const scoutChat = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const context = await cached("scout:context:v2", CTX_TTL, buildScoutContext);

    const system = [
      "You are SCOUT — the in-house NRL betting analyst inside the LINEBREAK app.",
      "",
      "STYLE — non-negotiable:",
      "• Sharp. Concise. Punter-grade. NEVER blabber or pad answers.",
      "• Lead with the call, then 1–2 short reasons. Use bullets, not paragraphs.",
      "• Quote exact prices, lines and bookmakers from the SNAPSHOT.",
      "• Always name the market explicitly (H2H / Line / Total / Anytime Tryscorer / First Tryscorer).",
      "• If a fact (injury, line, tryscorer price) is NOT in the SNAPSHOT, say 'no data' — never invent.",
      "• If markets aren't posted yet, say so and explain when they typically drop (≈24h pre-game once team lists land).",
      "• Close picks with a one-liner responsible-betting reminder ONLY when explicitly suggesting a bet.",
      "",
      "WHAT YOU KNOW (use it ruthlessly):",
      "1. Live odds per fixture: best H2H, line/spread, total points, top anytime + first tryscorer prices.",
      "2. Team lists with ins/outs and late-mail blurb per fixture.",
      "3. Season form: PPG for/against, halftime-lead %, HT→FT conversion %, last 5 results.",
      "4. Head-to-head recent history per fixture.",
      "5. Ladder + recent news headlines.",
      "",
      "ANGLE PLAYBOOK — pattern-match these when answering:",
      "• Value H2H: underdog at 2.20+ with strong PPG-for and a hot last5 (≥3W).",
      "• Line value: favourite giving <6.5 vs an opponent leaking ≥24 PPG-against.",
      "• Total Over: both sides averaging >22 PF and >22 PA, line ≤44.5.",
      "• Total Under: both sides <20 PF, wet-weather venue, line ≥40.5.",
      "• Tryscorer locks: outside backs/fullbacks ≤$2.40 anytime in matches with line ≥10.",
      "• First tryscorer: edge backs at $9+ in close lines (more variance, better price).",
      "• Late-mail edge: a key spine player out → fade that team or hammer their opponent's line.",
      "• Bogey-team angle: H2H last 5 shows ≥4 wins for one side regardless of ladder.",
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
  });
