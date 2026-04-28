// Scout — the AI chatbot brain of LINEBREAK. Has access to fixtures, ladder,
// odds, news, and per-match insights to answer betting questions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cached, TTL } from "./cache";
import { fetchDraw, fetchLadder } from "./nrl";
import { fetchNrlOdds } from "./odds";
import { fetchAllNews } from "./news";
import { findTeam } from "@/lib/teams";

const Message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});
const Input = z.object({
  messages: z.array(Message).min(1).max(40),
});

function currentSeason() {
  return new Date().getUTCFullYear();
}

// Build a compact, structured snapshot of the league state Scout can reason on.
async function buildScoutContext(): Promise<string> {
  const season = currentSeason();
  const [fixtures, ladder, odds, news] = await Promise.all([
    cached(`fixtures:${season}:current`, TTL.fixtures, () => fetchDraw(season)).catch(() => []),
    cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => []),
    cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds()).catch(() => []),
    cached(`news:all`, 15 * 60_000, () => fetchAllNews()).catch(() => []),
  ]);

  const fxLines = fixtures.slice(0, 12).map((f) => {
    const home = findTeam(f.homeTeam.nickName)?.nickname ?? f.homeTeam.nickName;
    const away = findTeam(f.awayTeam.nickName)?.nickname ?? f.awayTeam.nickName;
    const ev = odds.find((e) => {
      return (e.homeNickname === home && e.awayNickname === away) ||
             (e.homeNickname === away && e.awayNickname === home);
    });
    let oddsBit = "";
    if (ev) {
      const b = ev.bookmakers[0];
      const h2h = b?.markets.find((m) => m.key === "h2h");
      if (h2h) {
        const ho = h2h.outcomes.find((o) => findTeam(o.name)?.nickname === home);
        const ao = h2h.outcomes.find((o) => findTeam(o.name)?.nickname === away);
        if (ho && ao) oddsBit = ` [H2H ${b.title}: ${home} ${ho.price} / ${away} ${ao.price}]`;
      }
    }
    const ko = new Date(f.kickoffUtc).toISOString().replace("T", " ").slice(0, 16);
    return `- R${f.roundNumber} ${home} vs ${away} @ ${f.venue} (${ko} UTC)${oddsBit}`;
  }).join("\n");

  const ladderLines = ladder.slice(0, 17).map((r) =>
    `${r.position}. ${r.nickname} — ${r.played}P ${r.wins}W ${r.losses}L, ${r.points}pts, diff ${r.diff}`
  ).join("\n");

  const newsLines = news.slice(0, 12).map((n) =>
    `- [${n.source}] ${n.title}${n.summary ? ` — ${n.summary.slice(0, 140)}` : ""}`
  ).join("\n");

  return [
    `# NRL Snapshot (season ${season})`,
    "",
    "## Current/Upcoming Fixtures",
    fxLines || "(none available)",
    "",
    "## Ladder",
    ladderLines || "(unavailable)",
    "",
    "## Recent News Headlines",
    newsLines || "(none)",
  ].join("\n");
}

export const scoutChat = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    // Cache the league context for 5 min — every chat turn doesn't need a refetch.
    const context = await cached("scout:context", 5 * 60_000, buildScoutContext);

    const system = [
      "You are SCOUT — the in-house NRL betting analyst inside the LINEBREAK app.",
      "Persona: sharp, concise, friendly, like a seasoned punter who reads everything.",
      "You help users understand teams, players, fixtures, odds and stats so they can make informed bets.",
      "Always ground answers in the SNAPSHOT below. If a fact isn't there, say so plainly — never invent stats, scores, injuries or odds.",
      "Format with short paragraphs, bullet lists and **bold** for key picks. Quote exact odds when available.",
      "When suggesting bets, mention the market (H2H, line, total, anytime tryscorer, etc.) and reasoning. Always remind users to bet responsibly when giving picks.",
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
