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
  // Optional manual overrides.
  teams_override: z.array(z.string()).max(10).optional(),
  fixtures_override: z.array(z.string()).max(20).optional(),
});

function currentSeason() { return new Date().getUTCFullYear(); }

export const injectNewsImpact = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => InjectInput.parse(i))
  .handler(async ({ data }) => {
    const fullText = `${data.title} ${data.summary ?? ""}`.trim();
    const teams = data.teams_override?.length ? data.teams_override : detectTeams(fullText);
    const area = classifyImpactArea(fullText);
    const strength = classifyStrength(fullText, /* hasNamedPlayer */ false, teams.length > 0);
    const impactType: ImpactType = data.impact_type ?? "neutral";
    const impactStrength: ImpactStrength = strength;

    // Resolve fixtures: explicit override OR upcoming matches involving the team.
    let fixtures: string[] = data.fixtures_override ?? [];
    let expiresAt: string | null = null;
    if (fixtures.length === 0 && teams.length > 0) {
      try {
        const season = currentSeason();
        const draw = await fetchDraw(season);
        const now = Date.now();
        const matched = draw.filter((f) => {
          const inFuture = Date.parse(f.kickoffUtc) > now - 4 * 60 * 60_000;
          const teamHit = teams.some((t) => {
            const tl = t.toLowerCase();
            return f.homeTeam.nickName.toLowerCase() === tl || f.awayTeam.nickName.toLowerCase() === tl;
          });
          return inFuture && teamHit;
        });
        fixtures = matched.map((f) => f.matchId);
        const lastKickoff = matched.reduce((mx, f) => Math.max(mx, Date.parse(f.kickoffUtc)), 0);
        if (lastKickoff > 0) expiresAt = new Date(lastKickoff + 6 * 60 * 60_000).toISOString();
      } catch (e) { console.warn("inject: fixture lookup failed", e); }
    }

    const adjustment_summary = data.impact_note ?? `${impactType} ${area} signal from "${data.title}"`;

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
      model_adjustment: adjustment_summary,
      adjustment_summary,
      expires_at: expiresAt,
    });

    let invalidated = 0;
    if (fixtures.length > 0) invalidated = await invalidateInsightsForMatches(fixtures);

    return {
      ok: !!inserted,
      impact: inserted,
      detected: { teams, area, strength: impactStrength, fixtures },
      invalidated,
      needsFixtureChoice: fixtures.length === 0,
    };
  });

export const listInjectedArticles = createServerFn({ method: "GET" })
  .handler(async (): Promise<string[]> => {
    return listInjectedArticleIds();
  });
