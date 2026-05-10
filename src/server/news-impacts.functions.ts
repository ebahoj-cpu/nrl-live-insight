// Public server functions for the News Impact Injection layer.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  insertImpact, listInjectedArticleIds, invalidateInsightsForMatches,
  classifyImpactArea, classifyStrength, detectTeams,
  type ImpactType, type ImpactStrength,
} from "./news-impacts";
import { fetchDraw } from "./nrl";

const InjectInput = z.object({
  article_id: z.string().min(1).max(2000),
  title: z.string().min(1).max(500),
  url: z.string().url(),
  source: z.string().max(200).optional(),
  published_at: z.string().optional(),
  summary: z.string().max(4000).optional(),
  // Optional caller-provided impact metadata (from the article-summary AI).
  impact_type: z.enum(["positive", "negative", "neutral"]).optional(),
  impact_note: z.string().max(2000).optional(),
  timeframe: z.enum(["short", "mid", "long"]).optional(),
  timeframe_note: z.string().max(500).optional(),
  // Optional manual overrides.
  teams_override: z.array(z.string()).max(10).optional(),
  fixtures_override: z.array(z.string()).max(20).optional(),
});

function currentSeason() { return new Date().getUTCFullYear(); }

// How far ahead a timeframe should reach for fixture matching, in days.
const TIMEFRAME_HORIZON_DAYS: Record<"short" | "mid" | "long", number> = {
  short: 8,    // this round only
  mid: 28,     // ~3-4 rounds
  long: 200,   // rest of season
};

export const injectNewsImpact = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => InjectInput.parse(i))
  .handler(async ({ data }) => {
    const fullText = `${data.title} ${data.summary ?? ""} ${data.timeframe_note ?? ""}`.trim();
    const teams = data.teams_override?.length ? data.teams_override : detectTeams(fullText);
    const area = classifyImpactArea(fullText);
    const strength = classifyStrength(fullText, /* hasNamedPlayer */ false, teams.length > 0);
    const impactType: ImpactType = data.impact_type ?? "neutral";
    const impactStrength: ImpactStrength = strength;
    const timeframe: "short" | "mid" | "long" = data.timeframe ?? "short";
    const horizonMs = TIMEFRAME_HORIZON_DAYS[timeframe] * 24 * 60 * 60_000;

    // Resolve fixtures: explicit override OR upcoming matches involving the
    // team(s) within the timeframe horizon.
    let fixtures: string[] = data.fixtures_override ?? [];
    let expiresAt: string | null = null;
    if (fixtures.length === 0 && teams.length > 0) {
      try {
        const season = currentSeason();
        const draw = await fetchDraw(season);
        const now = Date.now();
        const horizon = now + horizonMs;
        const matched = draw.filter((f) => {
          const ko = Date.parse(f.kickoffUtc);
          const inWindow = ko > now - 4 * 60 * 60_000 && ko <= horizon;
          const teamHit = teams.some((t) => {
            const tl = t.toLowerCase();
            return f.homeTeam.nickName.toLowerCase() === tl || f.awayTeam.nickName.toLowerCase() === tl;
          });
          return inWindow && teamHit;
        });
        fixtures = matched.map((f) => f.matchId);
        const lastKickoff = matched.reduce((mx, f) => Math.max(mx, Date.parse(f.kickoffUtc)), 0);
        if (lastKickoff > 0) expiresAt = new Date(lastKickoff + 6 * 60 * 60_000).toISOString();
      } catch (e) { console.warn("inject: fixture lookup failed", e); }
    }
    if (!expiresAt) {
      // Fallback expiry from timeframe so impacts naturally age out.
      expiresAt = new Date(Date.now() + horizonMs).toISOString();
    }

    const tfLabel = timeframe === "long" ? "Long-term" : timeframe === "mid" ? "Mid-term" : "Short-term";
    const baseNote = data.impact_note ?? `${impactType} ${area} signal from "${data.title}"`;
    const adjustment_summary = `[${tfLabel}] ${baseNote}${data.timeframe_note ? ` — ${data.timeframe_note}` : ""}`;

    const inserted = await insertImpact({
      article_id: data.article_id,
      title: data.title,
      url: data.url,
      source: data.source ?? null,
      published_at: data.published_at ?? null,
      teams_affected: teams,
      players_affected: [],
      fixtures_affected: fixtures,
      impact_type: impactType,
      impact_area: area,
      impact_strength: impactStrength,
      timeframe,
      model_adjustment: adjustment_summary,
      adjustment_summary,
      expires_at: expiresAt,
    });

    let invalidated = 0;
    if (fixtures.length > 0) invalidated = await invalidateInsightsForMatches(fixtures);

    return {
      ok: !!inserted,
      impact: inserted,
      detected: { teams, area, strength: impactStrength, fixtures, timeframe },
      invalidated,
      needsFixtureChoice: fixtures.length === 0,
    };
  });

export const listInjectedArticles = createServerFn({ method: "GET" })
  .handler(async (): Promise<string[]> => {
    return listInjectedArticleIds();
  });
