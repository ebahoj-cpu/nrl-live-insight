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
import { fetchDraw, fetchLadder, fetchMatchDetails, type NrlFixture, type NrlLadderRow, type NrlMatchDetails, type NrlPlayer } from "./nrl";
import { getTeamLists } from "./nrl-data-store";
import { buildEstimatedOdds, fetchNrlOdds, fetchTryscorerOdds, bestH2H, type OddsEvent, type TryscorerMarkets } from "./odds";
import { fetchNews, type NewsItem } from "./news";
import { getSeasonSnapshot, getTeam, type SeasonSnapshot, type TeamSeasonStats } from "./season-stats";
import { findTeam, ALL_TEAMS } from "@/lib/teams";
import { readAnySharedInsights } from "./insights-store";
import { readOddsCacheEntry, readOddsCacheStaleEntry, writeOddsCache } from "./odds-store";
import type { Insights } from "./ai-insights";
import { generateDeterministicInsights, type DeterministicInsights } from "./insights-engine";
import { getOrBuildContext } from "./scout/scout-service";
import { deriveSessionId, getActiveModifiers, pushModifier } from "./scout/scout-memory";
import {
  parseNewsInjection,
  pickTopDrivers,
  formatConfidence,
  formatValueLine,
  formatRiskWarning,
  toneScrub,
} from "./scout/scout-reasoning";
import type { ScoutMatchContext } from "./scout/scout-contracts";

// Race a promise against a timeout, returning a fallback if it doesn't beat the clock.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(fallback); });
  });
}

// ───────────────────────── Web search tool ─────────────────────────
// Uses DuckDuckGo's no-key HTML endpoint. Cached per query for 10min.
async function runWebSearch(query: string, maxResults = 5): Promise<string> {
  const q = String(query || "").trim();
  if (!q) return "No query provided.";
  const n = Math.max(1, Math.min(8, Number(maxResults) || 5));
  const cacheKey = `scout:websearch:v1:${n}:${q.toLowerCase()}`;
  return cached(cacheKey, 10 * 60_000, async () => {
    try {
      const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const res = await withTimeout(
        fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; LineBreak-Scout/1.0)",
            Accept: "text/html",
          },
        }),
        7000,
        null as any,
      );
      if (!res || !res.ok) return `Web search failed (${res ? res.status : "timeout"}).`;
      const html = await res.text();
      const results: { title: string; url: string; snippet: string }[] = [];
      // Match each result block.
      const blockRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = blockRe.exec(html)) && results.length < n) {
        let href = m[1];
        // DDG wraps links: /l/?uddg=<encoded>
        const wrapped = href.match(/[?&]uddg=([^&]+)/);
        if (wrapped) { try { href = decodeURIComponent(wrapped[1]); } catch {} }
        const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
        const title = strip(m[2]);
        const snippet = strip(m[3]);
        if (title && href.startsWith("http")) results.push({ title, url: href, snippet });
      }
      if (results.length === 0) return `No web results for "${q}".`;
      return results
        .map((r, i) => {
          const domain = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return r.url; } })();
          return `${i + 1}. ${r.title} — ${domain}\n   ${r.snippet}\n   ${r.url}`;
        })
        .join("\n\n");
    } catch (err) {
      return `Web search error: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
}

async function buildFreshWebContext(messages: ChatMessage[]): Promise<string> {
  const userText = latestUserText(messages);
  const isSmallTalk = /^(hi|hey|hello|thanks|thank you|cheers)\b/i.test(userText);
  const mentioned = detectMentionedTeams(messages);
  const hasNamedEntity = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/.test(userText);
  if (isSmallTalk || (!needsFreshWebCheck(userText) && mentioned.length === 0 && !hasNamedEntity)) return "";
  const suffix = mentioned.length ? ` ${mentioned.join(" ")}` : "";
  const queries = [
    `site:nrl.com ${userText}${suffix}`,
    `NRL latest ${userText}${suffix}`,
  ];
  const results = await Promise.all(queries.map((q) => runWebSearch(q, 4)));
  return [
    "## FRESH WEB CHECK — current external context; use only to fill gaps or update time-sensitive info, cite domains inline",
    ...results.map((r, i) => `### Search ${i + 1}: ${queries[i]}\n${r}`),
  ].join("\n\n");
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
const EMPTY_TRYSCORER_RETRY_MS = 30 * 60_000;
const SEASON_ROUNDS = 27;
type ChatMessage = z.infer<typeof Message>;

function latestUserText(messages: ChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content.trim() ?? "";
}

function needsFreshWebCheck(text: string): boolean {
  return /\b(up\s*to\s*date|latest|today|tonight|now|current|fresh|late mail|lineups?|squads?|teams?|players?|plays?|playing|club|roster|injur(?:y|ies|ed)|ruled out|named|available|transfers?|signed|moved|weather|nrl\.com|stats?|history|snap(?:shot)?|missing)\b/i.test(text);
}

function needsDeepAppData(text: string): boolean {
  return /\b(bet|bets|betting|multi|sgm|same game|tip|tips|pick|picks|value|edge|odds|market|markets|lineups?|squads?|team lists?|try\s*scorer|tryscorer|anytime|first try|today|tonight)\b/i.test(text);
}

async function fetchScoutOdds(): Promise<OddsEvent[]> {
  const fresh = await readOddsCacheEntry<OddsEvent[]>("odds:nrl").catch(() => null);
  if (fresh?.payload?.length) return fresh.payload;
  const live = await cached(`odds:nrl`, TTL.odds, () => fetchNrlOdds()).catch(() => [] as OddsEvent[]);
  if (live.length) return live;
  const stale = await readOddsCacheStaleEntry<OddsEvent[]>("odds:nrl").catch(() => null);
  return stale?.payload?.length ? stale.payload : [];
}

function normaliseTeamNick(input: string): string {
  return findTeam(input)?.nickname ?? input;
}

function detectMentionedTeams(messages: ChatMessage[]): string[] {
  const text = messages
    .filter((m) => m.role === "user")
    .slice(-8)
    .map((m) => m.content.toLowerCase())
    .join("\n");
  const hits = ALL_TEAMS.filter((t) => {
    const names = [t.nickname, t.name, t.themeKey.replace(/-/g, " ")].map((x) => x.toLowerCase());
    return names.some((name) => new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text));
  }).map((t) => t.nickname);
  return Array.from(new Set(hits));
}

async function fetchSeasonDraw(season: number): Promise<NrlFixture[]> {
  const rounds = await Promise.all(
    Array.from({ length: SEASON_ROUNDS }, (_, i) => i + 1).map((round) =>
      cached(`scout:fixtures:${season}:round:${round}:v1`, 6 * 60 * 60_000, () => fetchDraw(season, round))
        .catch(() => [] as NrlFixture[]),
    ),
  );
  const byId = new Map<string, NrlFixture>();
  for (const f of rounds.flat()) byId.set(f.matchId, f);
  return Array.from(byId.values());
}

async function resolveTargetFixtures(season: number, baseFixtures: NrlFixture[], messages: ChatMessage[]): Promise<NrlFixture[]> {
  const mentioned = detectMentionedTeams(messages);
  if (mentioned.length === 0) return [];
  const allFixtures = await fetchSeasonDraw(season).catch(() => baseFixtures);
  const now = Date.now();
  const queryText = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content.toLowerCase()).join("\n");
  const wantsPast = /\b(last|previous|past|result|score|happened|actual|review|recap|after)\b/.test(queryText);
  const wantsFuture = /\b(next|tonight|today|upcoming|playing|before|preview|lineup|odds|tips?|bets?)\b/.test(queryText);
  const contains = (f: NrlFixture, nick: string) =>
    normaliseTeamNick(f.homeTeam.nickName) === nick || normaliseTeamNick(f.awayTeam.nickName) === nick;
  let matches = mentioned.length >= 2
    ? allFixtures.filter((f) => mentioned.every((team) => contains(f, team)))
    : allFixtures.filter((f) => contains(f, mentioned[0]));
  if (wantsPast && !wantsFuture) matches = matches.filter((f) => /full\s*time|fulltime|final|completed/i.test(f.matchState) || Date.parse(f.kickoffUtc) < now);
  if (wantsFuture && !wantsPast) matches = matches.filter((f) => !/full\s*time|fulltime|final|completed/i.test(f.matchState) && Date.parse(f.kickoffUtc) >= now - 4 * 3600_000);
  return matches
    .sort((a, b) => Math.abs(Date.parse(a.kickoffUtc) - now) - Math.abs(Date.parse(b.kickoffUtc) - now))
    .slice(0, 3);
}

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

// Normalised name set used to verify a player actually plays for a club this round.
// Bookmaker tryscorer markets occasionally lag behind transfers and list ex-players
// against the wrong club — we strip anyone not on the named match-day squad.
function normPlayerName(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}
function squadNameSet(players: { firstName: string; lastName: string }[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const p of players ?? []) {
    const full = normPlayerName(`${p.firstName} ${p.lastName}`);
    if (!full) continue;
    out.add(full);
    const last = full.split(/\s+/).pop();
    if (last) out.add(last);
  }
  return out;
}
function playerInSquad(name: string, squadSet: Set<string>): boolean {
  if (squadSet.size === 0) return true; // no squad named yet → don't filter
  const k = normPlayerName(name);
  if (squadSet.has(k)) return true;
  const last = k.split(/\s+/).pop();
  return !!last && squadSet.has(last);
}

function formatStatValue(v: { value: number; numerator?: number; denominator?: number }, type: string, units?: string): string {
  if (type === "Percentage") return `${v.value.toFixed(0)}%`;
  if (type === "PercentageAndFraction") return v.numerator != null && v.denominator != null
    ? `${v.value.toFixed(0)}% (${v.numerator}/${v.denominator})`
    : `${v.value.toFixed(0)}%`;
  if (type === "Range") return `${v.value.toFixed(2)}${units ? ` ${units.toLowerCase()}` : ""}`;
  return `${v.value % 1 === 0 ? v.value.toFixed(0) : v.value.toFixed(1)}`;
}

function summarizeStatsTab(details: NrlMatchDetails, ladder: NrlLadderRow[]): string {
  const homeNick = details.homeTeam.nickName;
  const awayNick = details.awayTeam.nickName;
  const homeRow = ladder.find((r) => normaliseTeamNick(r.nickname) === normaliseTeamNick(homeNick));
  const awayRow = ladder.find((r) => normaliseTeamNick(r.nickname) === normaliseTeamNick(awayNick));
  const lines: string[] = ["APP STATS TAB (same stats shown in-app):"];
  if (homeRow && awayRow) {
    lines.push(`Ladder side by side: ${homeNick} #${homeRow.position}, ${homeRow.wins}-${homeRow.losses}, PF ${homeRow.for}, PA ${homeRow.against}, diff ${homeRow.diff}, ${homeRow.points}pts | ${awayNick} #${awayRow.position}, ${awayRow.wins}-${awayRow.losses}, PF ${awayRow.for}, PA ${awayRow.against}, diff ${awayRow.diff}, ${awayRow.points}pts`);
  }
  const homeForm = details.homeTeam.recentForm.slice(0, 5).map((r) => `${r.result} ${r.score}`).join("; ");
  const awayForm = details.awayTeam.recentForm.slice(0, 5).map((r) => `${r.result} ${r.score}`).join("; ");
  if (homeForm || awayForm) lines.push(`Form shown: ${homeNick}: ${homeForm || "—"} | ${awayNick}: ${awayForm || "—"}`);
  for (const group of details.statGroups ?? []) {
    const stats = (group.stats ?? []).slice(0, 12).map((s) => {
      const hv = formatStatValue(s.homeValue, s.type, s.units);
      const av = formatStatValue(s.awayValue, s.type, s.units);
      const leader = s.homeValue.isLeader ? homeNick : s.awayValue.isLeader ? awayNick : "even";
      return `${s.title}: ${homeNick} ${hv} / ${awayNick} ${av}${leader !== "even" ? ` (${leader} leads)` : ""}`;
    });
    if (stats.length) lines.push(`${group.title}: ${stats.join("; ")}`);
  }
  return lines.join("\n");
}

function summarizeDeterministicInsights(det: DeterministicInsights, homeNick: string, awayNick: string): string {
  const lines: string[] = ["APP INSIGHTS TAB (exact deterministic cards shown in-app):"];
  lines.push(`Match winner: ${det.matchWinner.nickname} · ${det.matchWinner.reasoning}`);
  lines.push(`Winning margin: ${det.margin.bucket} · ${det.margin.reasoning}`);
  lines.push(`Predicted score: ${homeNick} ${det.predictedScore.home}–${det.predictedScore.away} ${awayNick} · ${det.predictedScore.reasoning}`);
  lines.push(`Points over/under: ${det.totalPoints.lean.toUpperCase()} ${det.totalPoints.line} · ${det.totalPoints.reasoning}`);
  lines.push(`HT/FT: ${det.htft.pick} · ${det.htft.reasoning}`);
  lines.push(`First tryscorer: ${det.firstTryscorer.name} (${det.firstTryscorer.team}${det.firstTryscorer.price ? ` @${det.firstTryscorer.price}` : ""})`);
  if (det.playerDouble?.name) lines.push(`2+ tries: ${det.playerDouble.name} (${det.playerDouble.team}${det.playerDouble.price ? ` @${det.playerDouble.price}` : ""})`);
  const outcomePicks = (det.predictedOutcome?.picks ?? []).map((p) => `${p.name}${p.price ? ` @${p.price}` : ""}`).join(", ");
  if (det.predictedOutcome?.summary) lines.push(`Predicted outcome: ${det.predictedOutcome.summary}${outcomePicks ? ` Picks: ${outcomePicks}` : ""}`);
  const topHome = (det.topAnytimeHome ?? []).map((p) => `${p.name}${p.price ? ` @${p.price}` : ""}`).join(", ");
  const topAway = (det.topAnytimeAway ?? []).map((p) => `${p.name}${p.price ? ` @${p.price}` : ""}`).join(", ");
  if (topHome || topAway) lines.push(`Top anytime: ${homeNick}: ${topHome || "—"} | ${awayNick}: ${topAway || "—"}`);
  return lines.join("\n");
}

// Pull the SAME AI insights the user sees on the match page (winner pick,
// margin, predicted score, totals lean, HT/FT, top tryscorers, top recommended
// plays). This guarantees Scout's chat answers stay aligned with the Insights tab.
async function summarizeStoredInsights(matchId: string, homeNick: string, awayNick: string): Promise<string> {
  const stored = await readAnySharedInsights(matchId).catch(() => null);
  if (!stored) return "";
  const i: Insights = stored.payload;
  const det = (i as unknown as { deterministic?: DeterministicInsights }).deterministic;
  if (det) return summarizeDeterministicInsights(det, homeNick, awayNick);
  if (!i.winner || !i.predictedScore || !i.total || !i.htft) return "";
  const winnerNick = i.winner.team === "home" ? homeNick : awayNick;
  const lines: string[] = [];
  lines.push(`APP INSIGHTS TAB: ${winnerNick} (${i.winner.confidence}% conf), margin ${i.margin?.bucket}, score ${homeNick} ${i.predictedScore.home}–${i.predictedScore.away} ${awayNick}`);
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

async function fetchFreshTryscorerMarkets(eventId: string): Promise<TryscorerMarkets | null> {
  const cacheKey = `tryscorers:${eventId}`;
  const fresh = await readOddsCacheEntry<TryscorerMarkets>(cacheKey).catch(() => null);
  if (fresh?.payload?.hasAny) return fresh.payload;
  const emptyIsFresh = fresh && Date.now() - Date.parse(fresh.generatedAt) < EMPTY_TRYSCORER_RETRY_MS;
  if (emptyIsFresh) return fresh.payload;
  const live = await cached(`scout:try:${eventId}`, TRYSCORER_TTL, () => fetchTryscorerOdds(eventId)).catch(() => null);
  if (live) await writeOddsCache(cacheKey, live, TRYSCORER_TTL).catch(() => {});
  if (live?.hasAny) return live;
  const stale = await readOddsCacheStaleEntry<TryscorerMarkets>(cacheKey).catch(() => null);
  return stale?.payload?.hasAny ? stale.payload : live;
}

// Build a deep per-fixture brief: odds, lineups, ins/outs, H2H, top tryscorers.
async function buildFixtureBrief(
  matchId: string,
  homeNick: string,
  awayNick: string,
  oddsAll: OddsEvent[],
  ladder: NrlLadderRow[],
  snap: SeasonSnapshot | null,
): Promise<string> {
  const details = await cached<NrlMatchDetails | null>(
    `scout:fix:${matchId}`,
    FIXTURE_TTL,
    async () => fetchMatchDetails(matchId).catch(() => null),
  );

  // LATE-MAIL FRESHNESS: always pull the absolute freshest official team lists,
  // bypassing every cache layer, so any in-week lineup change (named squad,
  // 24h confirmation, 1h late mail) is reflected immediately in Scout. The
  // aggressive TTL in nrl-data-store keeps NRL.com load reasonable; this just
  // ensures Scout never serves a stale roster.
  const freshTeamLists = await withTimeout(
    getTeamLists({
      matchId,
      kickoffUtc: details?.kickoffUtc,
      forceRefresh: true,
    }).catch(() => null),
    5000,
    null,
  );
  if (details && freshTeamLists) {
    const mergePlayers = (existing: NrlPlayer[] | undefined, list: typeof freshTeamLists.home | null): NrlPlayer[] | undefined => {
      if (!list || !list.isNamed || !list.players?.length) return existing;
      const captainById = new Map<number, boolean>();
      for (const p of existing ?? []) {
        // Preserve captain flag by matching firstName+lastName since playerId
        // isn't on NrlPlayer; fall back to no captain marking otherwise.
      }
      const captainNames = new Set(
        (existing ?? []).filter((p) => p.isCaptain).map((p) => `${p.firstName} ${p.lastName}`.toLowerCase()),
      );
      const existingHead = new Map(
        (existing ?? []).map((p) => [`${p.firstName} ${p.lastName}`.toLowerCase(), p.headImage] as const),
      );
      return list.players.map<NrlPlayer>((p) => {
        const key = `${p.firstName} ${p.lastName}`.toLowerCase();
        return {
          firstName: p.firstName,
          lastName: p.lastName,
          position: p.position,
          jerseyNumber: p.jerseyNumber,
          headImage: p.headshotUrl ?? existingHead.get(key),
          isCaptain: captainNames.has(key),
        };
      });
    };
    const home = mergePlayers(details.homeTeam.players, freshTeamLists.home);
    const away = mergePlayers(details.awayTeam.players, freshTeamLists.away);
    if (home) details.homeTeam.players = home;
    if (away) details.awayTeam.players = away;
  }

  const ev = matchOddsEvent(oddsAll, homeNick, awayNick);
  const tryscorer = ev
    ? await fetchFreshTryscorerMarkets(ev.id)
    : null;

  const lines: string[] = [];
  lines.push(`### ${homeNick} v ${awayNick}`);
  if (details) {
    lines.push(`Venue: ${details.venue}, ${details.venueCity} · Round ${details.roundNumber}`);
    const hasScore = typeof details.homeTeam.score === "number" && typeof details.awayTeam.score === "number";
    if (hasScore) lines.push(`Status: ${details.matchState} · Actual score: ${homeNick} ${details.homeTeam.score}–${details.awayTeam.score} ${awayNick}`);
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

  // Build squad allowlists from the OFFICIAL match-day squads (same lineup
  // shown on the app's Lineup tab). Bookmaker tryscorer markets sometimes
  // contain ex-players who have transferred — we strip them so Scout never
  // recommends a player on the wrong club.
  const homeSquadSet = squadNameSet(details?.homeTeam?.players);
  const awaySquadSet = squadNameSet(details?.awayTeam?.players);
  const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();
  const homeRoster = (details?.homeTeam?.players ?? []).map(fullName).filter(Boolean);
  const awayRoster = (details?.awayTeam?.players ?? []).map(fullName).filter(Boolean);

  // Determine which squad a tryscorer market entry belongs to. If a name only
  // matches one squad, assign it. If it matches both (rare, common surnames)
  // we keep it but tag ambiguously. If neither, drop it as a transfer/stale entry.
  const classifyPlayer = (name: string): "home" | "away" | null => {
    const inHome = playerInSquad(name, homeSquadSet);
    const inAway = playerInSquad(name, awaySquadSet);
    if (inHome && !inAway) return "home";
    if (inAway && !inHome) return "away";
    if (inHome && inAway) return "home"; // ambiguous — pick one rather than drop
    return null;
  };
  const filterMarket = <T extends { player: string }>(arr: T[] | undefined): { kept: T[]; dropped: string[] } => {
    const kept: T[] = [];
    const dropped: string[] = [];
    for (const t of arr ?? []) {
      // If neither squad has been named yet, don't filter — preserve markets.
      if (homeSquadSet.size === 0 && awaySquadSet.size === 0) { kept.push(t); continue; }
      if (classifyPlayer(t.player)) kept.push(t);
      else dropped.push(t.player);
    }
    return { kept, dropped };
  };

  // Tryscorer top picks — filtered to current rostered players only.
  if (tryscorer && tryscorer.hasAny) {
    const anyF = filterMarket(tryscorer.anytime);
    const firstF = filterMarket(tryscorer.first);
    const tag = (p: { player: string; price: number }) => {
      const side = classifyPlayer(p.player);
      const team = side === "home" ? homeNick : side === "away" ? awayNick : "?";
      return `${p.player} [${team}] ${p.price}`;
    };
    const fav = anyF.kept.slice(0, 8).map(tag).join(", ");
    const first = firstF.kept.slice(0, 4).map(tag).join(", ");
    if (fav) lines.push(`Anytime favs (filtered to named squads): ${fav}`);
    if (first) lines.push(`First-tryscorer favs (filtered to named squads): ${first}`);
    const allDropped = [...new Set([...anyF.dropped, ...firstF.dropped])];
    if (allDropped.length) lines.push(`IGNORED stale market entries (not in current squads): ${allDropped.join(", ")}`);
  } else {
    lines.push(`Tryscorer markets: live player prices are unavailable from the odds feed; do NOT say markets or lineups are unreleased — use named squads and app tryscorer projections.`);
  }

  // Team lists / late mail
  if (details?.homeTeam?.players?.length || details?.awayTeam?.players?.length) {
    lines.push("Lineups: released — official squad lists are loaded below from the app Lineup tab / NRL.com match centre.");
  }
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

  // ROSTER ALLOWLIST — explicit list of every player Scout is allowed to
  // attribute to each club for this fixture. Anything outside these lists
  // must NOT appear in a player recommendation, tryscorer pick, or analysis.
  if (homeRoster.length) lines.push(`ROSTER ALLOWLIST — ${homeNick} (only these players play for ${homeNick} this match): ${homeRoster.join(", ")}`);
  if (awayRoster.length) lines.push(`ROSTER ALLOWLIST — ${awayNick} (only these players play for ${awayNick} this match): ${awayRoster.join(", ")}`);

  if (details) {
    lines.push(summarizeStatsTab(details, ladder));
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
  // Scout's chat answers stay consistent with the on-app projections. Capped at
  // 2s so a slow DB round-trip can't stall the per-fixture brief.
  const insightsSummary = await withTimeout(
    summarizeStoredInsights(matchId, homeNick, awayNick).catch(() => ""),
    2000,
    "",
  );
  if (insightsSummary) {
    lines.push(insightsSummary);
  } else if (details && snap) {
    const deterministic = generateDeterministicInsights({
      homeNickname: details.homeTeam.nickName,
      awayNickname: details.awayTeam.nickName,
      homeThemeKey: details.homeTeam.themeKey,
      awayThemeKey: details.awayTeam.themeKey,
      homeSquad: details.homeTeam.players,
      awaySquad: details.awayTeam.players,
      ladder,
      snapshot: snap,
      weather: null,
      tryscorers: tryscorer as TryscorerMarkets | null,
      venue: details.venue,
    });
    lines.push(summarizeDeterministicInsights(deterministic, homeNick, awayNick));
  }

  return lines.join("\n");
}

// Shared block builder: takes the lightweight inputs (fixtures, ladder, odds,
// news, season snapshot) and the per-fixture briefs (which may be empty on the
// fast path) and produces the full SNAPSHOT string. Always includes the
// authoritative GROUND-TRUTH fixtures + byes block so Scout's grounding rules
// hold regardless of whether deep briefs are ready yet.
function assembleSnapshot(args: {
  season: number;
  fixtures: Awaited<ReturnType<typeof fetchDraw>>;
  ladder: Awaited<ReturnType<typeof fetchLadder>>;
  odds: OddsEvent[];
  news: NewsItem[];
  snap: Awaited<ReturnType<typeof getSeasonSnapshot>> | null;
  briefs: string[];
  briefsAreDeep: boolean;
  targetBriefs?: string[];
}): string {
  const { season, fixtures, ladder, odds, news, snap, briefs, briefsAreDeep, targetBriefs = [] } = args;
  const nowMs = Date.now();
  const notFinished = fixtures.filter((f) => !/full\s*time|fulltime/i.test(f.matchState));
  const currentRoundFixtures = notFinished.filter((f) => f.isCurrentRound);
  const currentRoundNum = currentRoundFixtures[0]?.roundNumber;
  const fromCurrent = currentRoundNum != null
    ? notFinished.filter((f) => f.roundNumber === currentRoundNum) : [];
  const fromNext = currentRoundNum != null
    ? notFinished.filter((f) => f.roundNumber === currentRoundNum + 1) : [];
  const pool = (fromCurrent.length ? [...fromCurrent, ...fromNext] : notFinished)
    .filter((f) => {
      const t = f.kickoffUtc ? Date.parse(f.kickoffUtc) : NaN;
      return isNaN(t) || t > nowMs - 4 * 3600_000;
    })
    .sort((a, b) => {
      const ra = a.roundNumber || 0; const rb = b.roundNumber || 0;
      if (ra !== rb) return ra - rb;
      const ta = a.kickoffUtc ? Date.parse(a.kickoffUtc) : Number.MAX_SAFE_INTEGER;
      const tb = b.kickoffUtc ? Date.parse(b.kickoffUtc) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  const upcoming = pool.slice(0, 10);

  const playingTeamIds = new Set<number>();
  for (const f of fromCurrent) {
    playingTeamIds.add(f.homeTeam.teamId);
    playingTeamIds.add(f.awayTeam.teamId);
  }
  const byeNicknames = currentRoundNum != null
    ? ladder.filter((r) => !playingTeamIds.has(r.teamId)).map((r) => r.nickname) : [];

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

  const teamProfiles = snap
    ? ladder.slice(0, 17).map((r) => teamLine(getTeam(snap, r.nickname), r.nickname)).join("\n")
    : "(season stats unavailable)";

  const ladderLines = ladder.slice(0, 17).map((r) =>
    `${r.position}. ${r.nickname} — ${r.played}P ${r.wins}W ${r.losses}L, ${r.points}pts, diff ${r.diff}`,
  ).join("\n");

  const newsLines = news.slice(0, 15).map((n) =>
    `- [${n.source}] ${n.title}${n.summary ? ` — ${n.summary.slice(0, 140)}` : ""}`,
  ).join("\n");

  // If briefs aren't deep yet, render lightweight per-fixture lines from odds/season-form
  // so Scout still has odds + form per matchup on the fast path.
  const lightBriefs = upcoming.map((f) => {
    const homeNick = f.homeTeam.nickName;
    const awayNick = f.awayTeam.nickName;
    const ev = matchOddsEvent(odds, homeNick, awayNick);
    const out: string[] = [`### ${homeNick} v ${awayNick}`];
    if (f.venue) out.push(`Venue: ${f.venue} · Round ${f.roundNumber ?? "?"}`);
    if (ev) {
      const h2h = bestH2H(ev);
      const homeBest = (ev.homeNickname === homeNick) ? h2h.home : h2h.away;
      const awayBest = (ev.homeNickname === homeNick) ? h2h.away : h2h.home;
      if (homeBest && awayBest) {
        out.push(`H2H best: ${homeNick} ${homeBest.price} (${homeBest.book}) / ${awayNick} ${awayBest.price} (${awayBest.book})`);
      }
      const { line, total } = pickLineTotal(ev, ev.homeNickname, ev.awayNickname);
      if (line) out.push(`Line: ${line}`);
      if (total) out.push(`Total: ${total}`);
    }
    if (snap) {
      const ht = getTeam(snap, homeNick);
      const at = getTeam(snap, awayNick);
      if (ht) out.push(teamLine(ht, homeNick));
      if (at) out.push(teamLine(at, awayNick));
    }
    return out.join("\n");
  });
  const briefsBlock = briefsAreDeep && briefs.length
    ? briefs.join("\n\n")
    : (lightBriefs.join("\n\n") || "(no upcoming fixtures found)");

  const roundLabel = currentRoundNum != null ? `Round ${currentRoundNum}` : "Current round";
  const byesLine = currentRoundNum != null
    ? (byeNicknames.length ? byeNicknames.join(", ") : "(none)")
    : "(round boundary unclear)";
  const depthNote = briefsAreDeep
    ? "(deep: lineups, late mail, app-insights, tryscorers)"
    : "(quick: odds + season form only — deep briefs warming in background)";

  return [
    `# NRL App Data · season ${season} · ${roundLabel} · generated ${new Date().toISOString()} ${depthNote}`,
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
    "## Upcoming fixtures (briefs)",
    briefsBlock,
    targetBriefs.length ? "" : null,
    targetBriefs.length ? "## USER-REQUESTED MATCH BRIEFS — use these first when relevant" : null,
    targetBriefs.length ? targetBriefs.join("\n\n") : null,
    "",
    "## Recent news headlines",
    newsLines || "(none)",
  ].filter((x): x is string => x != null).join("\n");
}

// Fast path: only the cheap data sources (fixtures + ladder + cached odds + news + season snapshot).
// Returns the full SNAPSHOT with lightweight per-fixture lines. Always includes
// GROUND-TRUTH fixtures + byes so chat answers stay correctly grounded even
// when deep briefs aren't ready yet.
async function buildFastContext(): Promise<string> {
  const season = NOW_SEASON();
  const [fixtures, ladder, liveOdds, news, snap] = await Promise.all([
    cached(`scout:fixtures:${season}:v2-official`, 60_000, () => fetchDraw(season)),
    cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => []),
    fetchScoutOdds(),
    cached("news:all", 15 * 60_000, () => fetchNews()).catch(() => [] as NewsItem[]),
    getSeasonSnapshot(season).catch(() => null),
  ]);
  if (!fixtures.length) throw new Error("Official NRL fixtures unavailable");
  const odds = liveOdds.length ? liveOdds : buildEstimatedOdds(fixtures, ladder);
  return assembleSnapshot({ season, fixtures, ladder, odds, news, snap, briefs: [], briefsAreDeep: false });
}

// Deep path: fast context + per-fixture deep briefs (lineups, late mail,
// tryscorers, H2H, app-insights). Concurrency-capped + per-fixture timeout so
// one slow upstream can't stall the whole snapshot.
async function buildDeepContext(): Promise<string> {
  const season = NOW_SEASON();
  const [fixtures, ladder, liveOdds, news, snap] = await Promise.all([
    cached(`scout:fixtures:${season}:v2-official`, 60_000, () => fetchDraw(season)),
    cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => []),
    fetchScoutOdds(),
    cached("news:all", 15 * 60_000, () => fetchNews()).catch(() => [] as NewsItem[]),
    getSeasonSnapshot(season).catch(() => null),
  ]);
  if (!fixtures.length) throw new Error("Official NRL fixtures unavailable");
  const odds = liveOdds.length ? liveOdds : buildEstimatedOdds(fixtures, ladder);

  // Re-derive the same upcoming list assembleSnapshot uses so deep briefs line up.
  const nowMs = Date.now();
  const notFinished = fixtures.filter((f) => !/full\s*time|fulltime/i.test(f.matchState));
  const currentRoundFixtures = notFinished.filter((f) => f.isCurrentRound);
  const currentRoundNum = currentRoundFixtures[0]?.roundNumber;
  const fromCurrent = currentRoundNum != null
    ? notFinished.filter((f) => f.roundNumber === currentRoundNum) : [];
  const fromNext = currentRoundNum != null
    ? notFinished.filter((f) => f.roundNumber === currentRoundNum + 1) : [];
  const pool = (fromCurrent.length ? [...fromCurrent, ...fromNext] : notFinished)
    .filter((f) => {
      const t = f.kickoffUtc ? Date.parse(f.kickoffUtc) : NaN;
      return isNaN(t) || t > nowMs - 4 * 3600_000;
    })
    .sort((a, b) => {
      const ra = a.roundNumber || 0; const rb = b.roundNumber || 0;
      if (ra !== rb) return ra - rb;
      const ta = a.kickoffUtc ? Date.parse(a.kickoffUtc) : Number.MAX_SAFE_INTEGER;
      const tb = b.kickoffUtc ? Date.parse(b.kickoffUtc) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  const upcoming = pool.slice(0, 10);

  // Concurrency-cap deep briefs — NRL.com rate-limits when hammered with 10 in
  // parallel and any one slow request stalls the whole Promise.all. 4 in flight
  // at a time + 8s per-fixture timeout keeps the worst case bounded at ~20s.
  const CONCURRENCY = 4;
  const briefs: string[] = new Array(upcoming.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= upcoming.length) return;
      const f = upcoming[i];
      briefs[i] = await withTimeout(
        buildFixtureBrief(f.matchId, f.homeTeam.nickName, f.awayTeam.nickName, odds, ladder, snap),
        8000,
        `### ${f.homeTeam.nickName} v ${f.awayTeam.nickName}\n(deep brief still loading)`,
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, upcoming.length) }, worker));

  return assembleSnapshot({ season, fixtures, ladder, odds, news, snap, briefs, briefsAreDeep: true });
}

async function buildTargetBriefsContext(messages: ChatMessage[]): Promise<string> {
  const season = NOW_SEASON();
  const [fixtures, ladder, liveOdds, snap] = await Promise.all([
    cached(`scout:fixtures:${season}:v2-official`, 60_000, () => fetchDraw(season)).catch(() => [] as NrlFixture[]),
    cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => [] as NrlLadderRow[]),
    fetchScoutOdds(),
    getSeasonSnapshot(season).catch(() => null),
  ]);
  const targets = await resolveTargetFixtures(season, fixtures, messages);
  if (!targets.length) return "";
  const odds = liveOdds.length ? liveOdds : buildEstimatedOdds(fixtures, ladder);
  const briefs = await Promise.all(targets.map((f) => withTimeout(
    buildFixtureBrief(f.matchId, f.homeTeam.nickName, f.awayTeam.nickName, odds, ladder, snap),
    12_000,
    `### ${f.homeTeam.nickName} v ${f.awayTeam.nickName}\n(targeted app brief did not finish loading)`,
  )));
  return [
    "## USER-REQUESTED MATCH BRIEFS — exact app data for named teams/matches; use this before generic/current-round context",
    ...briefs,
  ].join("\n\n");
}

// Render a ScoutMatchContext bundle into a compact text block for the LLM.
function formatIntelligenceBundle(ctx: ScoutMatchContext): string {
  const out: string[] = [];
  out.push(`### ${ctx.match.homeNickname} v ${ctx.match.awayNickname} — intelligence`);
  if (ctx.simulation.method !== "absent") {
    const s = ctx.simulation;
    out.push(`Sim (${s.method}, ${s.iterations} iters): expected ${ctx.match.homeNickname} ${s.expectedHomeScore.toFixed(1)}–${s.expectedAwayScore.toFixed(1)} ${ctx.match.awayNickname} (total ${s.expectedTotal.toFixed(1)})`);
    out.push(`Win probs: ${ctx.match.homeNickname} ${(s.homeWinProb*100).toFixed(0)}% / draw ${(s.drawProb*100).toFixed(0)}% / ${ctx.match.awayNickname} ${(s.awayWinProb*100).toFixed(0)}%`);
    out.push(`Margin bands: draw ${(s.marginBands.draw*100).toFixed(0)}%, 1-12 ${(s.marginBands["1-12"]*100).toFixed(0)}%, 13+ ${(s.marginBands["13+"]*100).toFixed(0)}% · O/U ${s.totalLine}: over ${(s.overProbAtLine*100).toFixed(0)}%`);
  } else {
    out.push(`Sim: absent (${ctx.simulation.reason}) — Scout falls back to deterministic heuristics for this match.`);
  }
  if (ctx.calibration.applied) {
    out.push(`Calibration: ${ctx.calibration.method ?? "blended"}${ctx.calibration.blendWeight != null ? ` (w=${ctx.calibration.blendWeight.toFixed(2)})` : ""}`);
  }
  out.push(formatConfidence(ctx.confidence.tier, ctx.confidence.reasons));
  const drivers = pickTopDrivers(ctx.drivers, 3);
  if (drivers.length) out.push(`Top drivers: ${drivers.map((d) => d.label).join("; ")}`);
  if (ctx.bets.length) {
    out.push("Value bets (EV>0, sorted):");
    for (const b of ctx.bets.slice(0, 6)) out.push(`  • ${formatValueLine(b)}`);
  } else {
    out.push("Value bets: none above threshold this run.");
  }
  const risk = formatRiskWarning(ctx.correlationWarnings);
  if (risk) out.push(risk);
  if (ctx.modifiersApplied.length) {
    out.push(`Active news modifiers: ${ctx.modifiersApplied.map((m) => `${m.kind}:${m.description.slice(0, 60)}`).join(" | ")}`);
  }
  if (ctx.dataGaps.length) {
    out.push(`Data gaps: ${ctx.dataGaps.slice(0, 4).join("; ")}`);
  }
  return out.join("\n");
}

export const scoutChat = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<{ reply: string }> => {
    try {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    // ── Scout intelligence layer ────────────────────────────────────────────
    // Session-scoped news modifiers + per-fixture ScoutMatchContext bundle.
    // This block is additive — failures fall back to the existing context.
    const sessionId = deriveSessionId(data.messages);
    const latestUser = latestUserText(data.messages);
    const parsedMod = parseNewsInjection(latestUser);
    if (parsedMod) {
      try { pushModifier(sessionId, parsedMod); } catch (e) { console.warn("[scout] pushModifier failed", e); }
    }

    let intelligenceBlock = "";
    try {
      const season = NOW_SEASON();
      const [fixtures, ladder, liveOdds, snap] = await Promise.all([
        cached(`scout:fixtures:${season}:v2-official`, 60_000, () => fetchDraw(season)).catch(() => [] as NrlFixture[]),
        cached(`ladder:${season}`, TTL.ladder, () => fetchLadder(season)).catch(() => [] as NrlLadderRow[]),
        fetchScoutOdds(),
        getSeasonSnapshot(season).catch(() => null),
      ]);
      const targets = await resolveTargetFixtures(season, fixtures, data.messages).catch(() => [] as NrlFixture[]);
      if (targets.length) {
        const oddsAll = liveOdds.length ? liveOdds : buildEstimatedOdds(fixtures, ladder);
        const ctxs = await Promise.all(targets.slice(0, 3).map(async (f) => {
          const ev = matchOddsEvent(oddsAll, f.homeTeam.nickName, f.awayTeam.nickName) ?? null;
          const tryscorer = ev
            ? await fetchFreshTryscorerMarkets(ev.id)
            : null;
          const modifiers = getActiveModifiers(sessionId, f.matchId);
          return withTimeout(
            getOrBuildContext({
              matchId: f.matchId,
              homeNickname: f.homeTeam.nickName,
              awayNickname: f.awayTeam.nickName,
              kickoffUtc: f.kickoffUtc,
              venue: f.venue,
              status: f.matchState,
              odds: ev,
              tryscorers: tryscorer,
              modifiers,
            }).catch(() => null),
            6000,
            null as ScoutMatchContext | null,
          );
        }));
        const blocks = ctxs.filter((c): c is ScoutMatchContext => !!c).map(formatIntelligenceBundle);
        if (blocks.length) {
          intelligenceBlock = [
        "## SCOUT INTELLIGENCE — simulation/value bundles for named matches; use for probabilities, but use USER-REQUESTED MATCH BRIEFS for lineup and player-market availability",
            ...blocks,
          ].join("\n\n");
        }
      }
    } catch (e) {
      console.warn("[scout] intelligence layer failed:", e);
    }
    // ────────────────────────────────────────────────────────────────────────


    // Two-tier context for snappy first reply + accurate steady-state:
    //   • DEEP context (lineups, late mail, app-insights, tryscorers per fixture)
    //     is built in the background and cached. Once warm, every reply uses it.
    //   • FAST context (fixtures + ladder + odds + season form) is the fallback
    //     for the very first cold-cache request so users don't wait 60-120s for
    //     NRL.com round-trips. It STILL contains the authoritative GROUND TRUTH
    //     fixtures + byes block, so all grounding rules still hold.
    const DEEP_KEY = "scout:context:v16-lineups-players-grounded";
    let context: string;
    try {
      const [fastFallback, targetContext, freshWebContext] = await Promise.all([
        buildFastContext(),
        buildTargetBriefsContext(data.messages),
        buildFreshWebContext(data.messages),
      ]);
      const requiresDeepData = needsDeepAppData(latestUserText(data.messages));
      const roundContext = requiresDeepData
        ? await withTimeout(buildDeepContext(), 35_000, fastFallback)
        : await staleWhileRevalidate<string>(
            DEEP_KEY,
            CTX_TTL,
            buildDeepContext,
            fastFallback,
          );
      context = [roundContext, targetContext, intelligenceBlock, freshWebContext].filter(Boolean).join("\n\n");
    } catch (e) {
      console.error("[scout] context build failed:", e);
      throw new Error("Scout can't verify the latest official fixtures right now — try again shortly.");
    }
    if (!context.includes("## GROUND TRUTH")) {
      throw new Error("Scout can't verify the latest official fixtures right now — try again shortly.");
    }

    const system = [
      "You are SCOUT — a sharp, friendly NRL betting analyst inside LINEBREAK. Sporty, confident, plain-spoken Aussie tone.",
      "",
      "GROUND TRUTH PROTOCOL — read this BEFORE every reply:",
      "• If the app data has no GROUND TRUTH fixtures, say you can't verify the latest fixtures right now, then use web_search for current public info. Do not answer from memory.",
      "• The 'GROUND TRUTH — Round Fixtures' block is the authoritative source for who plays who this round. The 'USER-REQUESTED MATCH BRIEFS' block is authoritative for specifically named teams/matches, including completed games outside the current round.",
      "• The 'GROUND TRUTH — Teams on the BYE this round' line lists every team NOT playing. If a user asks about a team on that bye list, say so directly — do not invent a fixture for them.",
      "• Before naming any matchup, scan the fixtures list and USER-REQUESTED MATCH BRIEFS for BOTH team names. If you can't find both teams together, correct the user.",
      "• Never infer an opponent from ladder proximity, odds order, alphabetical order, or memory. The fixtures list is the only source of truth.",
      "• When a user names a team, first check USER-REQUESTED MATCH BRIEFS for that team, then the fixture list for their current/next opponent. If they're on the bye list and no requested brief exists, say so — don't guess.",
      "• When recommending a pick, name BOTH teams in the matchup so it's unambiguous (e.g. 'Broncos H2H @2.15 vs Cowboys' — never just 'Broncos H2H').",
      "• If a team is on the bye list, do NOT include them in picks/recommendations.",
      "",
      "DATA YOU HAVE in APP DATA below — never ask for it, never claim you lack it:",
      "• Authoritative round fixtures (home v away, venue, kickoff)",
      "• Live ladder with W-L, points, points-diff",
      "• Live odds across multiple bookies: H2H best, line/spread, totals (O/U)",
      "• Tryscorer markets per fixture (anytime + first-tryscorer favs) — if listed under a fixture, USE THEM",
      "• Full SQUADS per fixture (starting 13 + bench, jersey numbers, captains) — if listed, USE THEM",
      "• Lineups / late mail per fixture (ins, outs, blurb) — if listed under a fixture, USE THEM",
      "• APP STATS TAB per fixture: the same side-by-side ladder/form/statGroups shown on the match page Stats tab — use this before external stats.",
      "• Season form per team: W-L-D, PPG for/against, HT-lead %, HT→W conversion %, last-5",
      "• Per-fixture recent form (last-5 of each side) and head-to-head history",
      "• APP INSIGHTS TAB per fixture: the exact deterministic cards shown on the match page Insights tab (winner, margin, predicted score, total, HT/FT, tryscorers, predicted outcome). When asked to check the Insights tab or app projection, cite this block directly — do not replace it with your own prediction.",
      "• Recent news headlines",
      "",
      "DATA RULES for missing fields:",
      "• If a fixture has squad blocks or roster lines, lineups ARE released — never say lineups/team sheets are unavailable.",
      "• If a fixture has no ins/outs lines but does have squad blocks, say late-mail ins/outs are not shown, not that lineups are unreleased.",
      "• If a fixture says live player prices are unavailable, do NOT say tryscorer markets haven't been released. Say player prices are unavailable from the feed, then use named squads + app tryscorer projections.",
      "• If no squad block is shown for a fixture → say the squad hasn't been named yet.",
      "• Otherwise NEVER claim you lack data that IS in APP DATA. Read the relevant fixture block carefully before answering.",
      "",
      "EXTERNAL STATS — only when the answer is NOT in USER-REQUESTED MATCH BRIEFS / app Stats / app Insights / lineups:",
      "• Use NRL.com-derived knowledge where possible: player, team, fixture and historical stats.",
      "• If you cannot verify an exact external number from app data or web_search, be explicit about uncertainty instead of fabricating precision.",
      "• NEVER override app data with memory. App data is the source of truth for fixtures, lineups, odds, ladder, app stats and app insights.",
      "",
      "DATA NOT ALWAYS AVAILABLE IN APP DATA — verify with web_search when asked for exact current numbers:",
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
      "• Quote exact prices/lines from APP DATA only. Never invent prices, players, or matchups.",
      "• Every pick must reference a matchup that exists in the GROUND TRUTH fixtures list or USER-REQUESTED MATCH BRIEFS.",
      "• If USER-REQUESTED MATCH BRIEFS are present, use them first even if the match is already completed or not in the current round.",
      "• No disclaimers, no 'bet responsibly' (UI handles that).",
      "",
      "WEB SEARCH:",
      "• Never use the words snapshot, context, or Snapchat in the answer. Those are internal/mistaken wording. If app data is thin or stale, search the web and answer with sourced current information.",
      "• For any question about whether a player currently plays for a team, is named, injured, transferred, or available, search the web unless the relevant ROSTER ALLOWLIST already proves it.",
      "• You have a `web_search` tool. Use it whenever app data lacks the info needed (breaking news, late mail, weather, head-to-head history, player form outside what's provided, anything time-sensitive).",
      "• Prefer trusted NRL sources: nrl.com, foxsports.com.au, smh.com.au, theroar.com.au, zerotackle.com, leagueunlimited.com, official club sites.",
      "• After searching, cite source domains inline like (nrl.com) so the user can sanity-check.",
      "• Don't search for things already in APP DATA (lineups, odds, insights, ladder, stats) — that data is already authoritative.",
      "",
      "VOICE — never expose internal mechanics:",
      "• Never mention or name internal systems, checks, lists, blocks, tools or data structures: e.g. 'ROSTER ALLOWLIST', 'APP DATA', 'fixture brief', 'allowlist', 'web_search', 'ground truth', 'system prompt', 'IGNORED stale market entries', 'snapshot', 'context block'.",
      "• You can describe HOW you think (model edge, predicted scores, simulations, form, momentum, matchups, venue, ladder, recent results) — never WHAT backend pieces you're reading.",
      "• Speak as an analyst with access to live lineups, odds, stats and simulations — not as a bot describing its data feeds.",
      "",
      "ROSTER ALLOWLIST RULE — CRITICAL, applies to EVERY player you name (NEVER mention this rule or the word 'allowlist' to the user):",
      "• Each fixture brief contains 'ROSTER ALLOWLIST — <Team>' lines listing the ONLY players who play for that team in this match. This reflects the current squad shown on the app's Lineup tab.",
      "• Before naming any player as a tryscorer / pick / threat / option for a team, verify their name appears in that team's ROSTER ALLOWLIST for the relevant fixture.",
      "• If a player is NOT in the allowlist for the team you're attributing them to, DO NOT mention them — they have transferred, are injured, or are not in this squad. Pick the next eligible name from the allowlist instead.",
      "• Bookmaker tryscorer markets sometimes lag transfers. The 'IGNORED stale market entries' line lists names already filtered out — never resurrect them.",
      "• If the squad has not been named yet (no ROSTER ALLOWLIST present, or 'squad: not yet named'), say lineups aren't released yet rather than guessing players.",
      "",
      "=== APP DATA ===",
      context,
      "=== END APP DATA ===",
    ].join("\n");

    const tools = [
      {
        type: "function",
        function: {
          name: "web_search",
          description:
            "Search the public web for live NRL information (news, late team changes, weather, injuries, head-to-head history, anything time-sensitive). Returns ranked snippets with source URLs. Only use when the in-app app data doesn't already cover it.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query, e.g. 'Broncos late mail Round 5 2025'" },
              max_results: { type: "number", description: "How many results to return (1–8). Default 5.", minimum: 1, maximum: 8 },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
    ];

    const convo: any[] = [
      { role: "system", content: system },
      ...data.messages,
    ];

    // Tool-call loop — up to 4 rounds so Scout can chain searches.
    let reply: string | undefined;
    for (let round = 0; round < 4; round++) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: convo,
          tools,
        }),
      });

      if (res.status === 429) throw new Error("Scout is busy — too many requests. Try again shortly.");
      if (res.status === 402) throw new Error("AI credits exhausted — top up in Settings → Workspace → Usage.");
      if (!res.ok) throw new Error(`AI gateway error (${res.status})`);

      const json = await res.json() as any;
      const msg = json?.choices?.[0]?.message;
      if (!msg) throw new Error("Scout returned no message");

      const toolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
      if (toolCalls && toolCalls.length > 0) {
        // Push assistant turn that issued the calls
        convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
        // Resolve each tool call
        for (const tc of toolCalls) {
          let result: string;
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            if (tc.function.name === "web_search") {
              result = await runWebSearch(args.query, args.max_results);
            } else {
              result = `Unknown tool: ${tc.function.name}`;
            }
          } catch (err) {
            result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
          }
          convo.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        continue;
      }

      reply = typeof msg.content === "string" ? msg.content : undefined;
      break;
    }

    if (!reply) throw new Error("Scout returned no reply");
    const scrubbed = toneScrub(reply, { hasBets: intelligenceBlock.includes("Value bets (EV>0") });
    return { reply: scrubbed };
    } catch (e) {
      console.error("[scout] handler error:", e);
      throw e instanceof Error ? e : new Error(String(e));
    }
  });
