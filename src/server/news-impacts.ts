// News Impact Injection — manually-approved news items act as confidence
// modifiers on the deterministic prediction engine. They never replace picks;
// they only nudge confidence and append short notes to Insights/Script/Bets.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { findTeam } from "@/lib/teams";

export type ImpactType = "positive" | "negative" | "neutral";
export type ImpactStrength = "low" | "medium" | "high";
export type ImpactArea =
  | "winner" | "margin" | "total" | "tryscorer"
  | "lineup" | "fatigue" | "weather" | "scoring_trend"
  | "discipline" | "injury" | "form";

export type NewsImpactRow = {
  id: string;
  article_id: string;
  title: string;
  url: string;
  source: string | null;
  published_at: string | null;
  teams_affected: string[];
  players_affected: string[];
  fixtures_affected: string[];
  impact_type: ImpactType;
  impact_area: ImpactArea;
  impact_strength: ImpactStrength;
  model_adjustment: string | null;
  adjustment_summary: string | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
};

export type NewsImpactApplied = {
  article_id: string;
  title: string;
  impact_area: ImpactArea;
  impact_strength: ImpactStrength;
  impact_type: ImpactType;
  adjustment_summary: string;
};

// ---------- Detection helpers ----------

const AREA_KEYWORDS: { area: ImpactArea; words: RegExp }[] = [
  { area: "injury",        words: /\b(injur|hamstring|acl|knee|ankle|concuss|hia|out for|sidelined|ruled out|suspect)\b/i },
  { area: "lineup",        words: /\b(team list|line[- ]?up|named|recall|return|debut|axed|dropped|reshuffle|bench|squad)\b/i },
  { area: "discipline",    words: /\b(suspend|judiciary|charged|ban|fined|sin bin|send[- ]off)\b/i },
  { area: "fatigue",       words: /\b(short turnaround|fatigu|five[- ]day|backed up|three games in)\b/i },
  { area: "weather",       words: /\b(rain|storm|wet|wind|gale|cyclone|heat|humidity)\b/i },
  { area: "scoring_trend", words: /\b(high[- ]scoring|free[- ]flowing|tryfest|points|attacking form|leaky|defensive struggles|conceding)\b/i },
  { area: "form",          words: /\b(in form|red[- ]hot|on a roll|losing streak|slump|bounce[- ]back|rolling|hot|cold)\b/i },
  { area: "tryscorer",     words: /\b(try ?scorer|tries|hat[- ]trick|double|finishing|wing|fullback|centre)\b/i },
  { area: "margin",        words: /\b(blowout|thrash|comfortable|close one|tight|nail[- ]biter|upset)\b/i },
  { area: "total",         words: /\b(over\b|under\b|total|points line|low[- ]scoring|defensive grind)\b/i },
  { area: "winner",        words: /\b(favourite|underdog|to win|expected to|tipped to)\b/i },
];

export function classifyImpactArea(text: string): ImpactArea {
  for (const k of AREA_KEYWORDS) if (k.words.test(text)) return k.area;
  return "form";
}

export function classifyStrength(text: string, hasNamedPlayer: boolean, hasNamedTeam: boolean): ImpactStrength {
  if (!hasNamedTeam && !hasNamedPlayer) return "low";
  const strong = /\b(ruled out|out for season|suspended for|major|huge|massive|won't play|will miss)\b/i.test(text);
  if (strong) return "high";
  if (hasNamedPlayer) return "medium";
  return "low";
}

// Detect NRL clubs mentioned in title/summary.
export function detectTeams(text: string): string[] {
  const found = new Set<string>();
  const lower = ` ${text.toLowerCase()} `;
  // crude pass: nicknames + full names from the TEAMS list
  const NICKS = ["Broncos","Raiders","Bulldogs","Sharks","Dolphins","Titans","Sea Eagles","Storm","Knights","Cowboys","Eels","Panthers","Rabbitohs","Dragons","Roosters","Warriors","Wests Tigers"];
  for (const n of NICKS) if (lower.includes(` ${n.toLowerCase()} `)) found.add(n);
  // canonical via findTeam
  for (const fragment of text.split(/[\s,—–-]+/)) {
    const t = findTeam(fragment); if (t) found.add(t.nickname);
  }
  return Array.from(found);
}

// ---------- DB IO ----------

export async function insertImpact(row: Omit<NewsImpactRow, "id" | "created_at" | "active"> & { active?: boolean }): Promise<NewsImpactRow | null> {
  const { data, error } = await supabaseAdmin
    .from("news_model_impacts" as never)
    .insert({
      article_id: row.article_id,
      title: row.title,
      url: row.url,
      source: row.source,
      published_at: row.published_at,
      teams_affected: row.teams_affected,
      players_affected: row.players_affected,
      fixtures_affected: row.fixtures_affected,
      impact_type: row.impact_type,
      impact_area: row.impact_area,
      impact_strength: row.impact_strength,
      model_adjustment: row.model_adjustment,
      adjustment_summary: row.adjustment_summary,
      active: row.active ?? true,
      expires_at: row.expires_at,
    } as never)
    .select()
    .maybeSingle();
  if (error) {
    console.warn("insertImpact failed:", error.message);
    return null;
  }
  return data as unknown as NewsImpactRow;
}

export async function listActiveImpacts(): Promise<NewsImpactRow[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("news_model_impacts" as never)
    .select("*")
    .eq("active" as never, true as never)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (error) { console.warn("listActiveImpacts failed:", error.message); return []; }
  return (data as unknown as NewsImpactRow[]) ?? [];
}

export async function listInjectedArticleIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("news_model_impacts" as never)
    .select("article_id")
    .eq("active" as never, true as never);
  if (error) return [];
  return Array.from(new Set((data as unknown as { article_id: string }[]).map((r) => r.article_id)));
}

// Filter impacts that should apply to a given fixture.
export function impactsForFixture(args: {
  impacts: NewsImpactRow[];
  matchId: string;
  homeNickname: string;
  awayNickname: string;
}): NewsImpactRow[] {
  const { impacts, matchId, homeNickname, awayNickname } = args;
  const teamSet = new Set([homeNickname.toLowerCase(), awayNickname.toLowerCase()]);
  return impacts.filter((imp) => {
    if (imp.fixtures_affected?.includes(matchId)) return true;
    if (!imp.teams_affected || imp.teams_affected.length === 0) return false;
    return imp.teams_affected.some((t) => teamSet.has(t.toLowerCase()));
  });
}

// Convert area + type to a confidence delta (clamped ±0.15 per impact).
export function confidenceDelta(imp: NewsImpactRow): number {
  const base = imp.impact_strength === "high" ? 0.12 : imp.impact_strength === "medium" ? 0.07 : 0.03;
  const sign = imp.impact_type === "positive" ? 1 : imp.impact_type === "negative" ? -1 : 0;
  return base * sign;
}

// Apply impacts to a deterministic insights + script + bets payload in-place
// (caller passes a JSON-cloned copy). Returns the list of applied entries to
// store under `newsImpactsApplied`.
export function applyImpacts(payload: Record<string, unknown>, impacts: NewsImpactRow[]): NewsImpactApplied[] {
  const applied: NewsImpactApplied[] = [];
  if (impacts.length === 0) return applied;

  const det = (payload.deterministic as Record<string, unknown> | undefined) ?? null;
  const script = (payload.script as Record<string, unknown> | undefined) ?? null;
  const bets = Array.isArray(payload.bets) ? (payload.bets as Array<Record<string, unknown>>) : null;

  for (const imp of impacts) {
    const summary = imp.adjustment_summary || imp.model_adjustment || `${imp.impact_type} ${imp.impact_area} signal`;
    const note = `News impact: ${summary}`;
    const delta = confidenceDelta(imp);

    if (det) {
      const target =
        imp.impact_area === "total" ? "totalPoints" :
        imp.impact_area === "winner" ? "matchWinner" :
        imp.impact_area === "margin" ? "margin" :
        imp.impact_area === "tryscorer" ? "firstTryscorer" : null;
      if (target && det[target] && typeof det[target] === "object") {
        const t = det[target] as { reasoning?: string };
        t.reasoning = `${t.reasoning ?? ""} ${note}`.trim();
      }
    }

    if (script) {
      const phases = script.phases as Record<string, string> | undefined;
      const betting = script.betting as Record<string, string> | undefined;
      if (phases && (imp.impact_area === "scoring_trend" || imp.impact_area === "total")) {
        phases.first20 = `${phases.first20 ?? ""} ${note}`.trim();
      }
      if (phases && imp.impact_area === "fatigue") {
        phases.sixty80 = `${phases.sixty80 ?? ""} ${note}`.trim();
      }
      if (betting) {
        const slot =
          imp.impact_area === "total" ? "totalLean" :
          imp.impact_area === "winner" ? "winnerLean" :
          imp.impact_area === "margin" ? "marginLean" :
          imp.impact_area === "tryscorer" ? "tryscorerLean" : null;
        if (slot && betting[slot] != null) {
          betting[slot] = `${betting[slot]} · ${note}`;
        }
      }
    }

    if (bets) {
      for (const b of bets) {
        const align = (b.scriptAlignment as string | undefined) ?? "";
        const matches =
          (imp.impact_area === "total" && /total/i.test(align)) ||
          (imp.impact_area === "winner" && /head|winner/i.test(align)) ||
          (imp.impact_area === "margin" && /margin/i.test(align)) ||
          (imp.impact_area === "tryscorer" && /tryscorer/i.test(align));
        if (!matches) continue;
        const cur = typeof b.hitRateScore === "number" ? b.hitRateScore : 50;
        const nudged = Math.max(5, Math.min(95, Math.round(cur + delta * 100)));
        b.hitRateScore = nudged;
        const reason = (b.reasoning as string | undefined) ?? "";
        b.reasoning = `${reason} News: ${summary}`.trim();
      }
    }

    applied.push({
      article_id: imp.article_id,
      title: imp.title,
      impact_area: imp.impact_area,
      impact_strength: imp.impact_strength,
      impact_type: imp.impact_type,
      adjustment_summary: summary,
    });
  }

  (payload as Record<string, unknown>).newsImpactsApplied = applied;
  return applied;
}

// Invalidate cached match_insights rows so the next read regenerates with
// the freshly injected impacts applied.
export async function invalidateInsightsForMatches(matchIds: string[]): Promise<number> {
  if (matchIds.length === 0) return 0;
  // Cache rows are keyed as "{matchId}::{PROMPT_VERSION}" — match by prefix.
  let total = 0;
  for (const mid of matchIds) {
    const { error, count } = await supabaseAdmin
      .from("match_insights" as never)
      .delete({ count: "exact" })
      .like("match_id" as never, `${mid}::%` as never);
    if (!error && typeof count === "number") total += count;
  }
  return total;
}
