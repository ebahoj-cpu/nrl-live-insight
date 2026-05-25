// ============================================================================
// Personal (account-specific) article injections.
//
// IMPORTANT: These injections are PERSONAL — they only affect the signed-in
// user's view of a match's Insights / simulation. They are NEVER applied to
// the shared cached insights served to other users.
//
// Premium-only. The RLS policy + a check inside the server function both
// gate creation behind profiles.is_premium.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---- Shapes ---------------------------------------------------------------

export type UserArticleInjection = {
  id: string;
  user_id: string;
  match_id: string;
  article_id: string;
  article_url: string;
  article_title: string;
  article_source: string | null;
  injected_insight: string;
  impact_summary: string;
  impact_direction: "positive" | "negative" | "neutral";
  impact_strength: "low" | "medium" | "high";
  delta_expected_points: number | null;
  delta_attack: number | null;
  delta_defence: number | null;
  delta_tempo: number | null;
  delta_player_try_rate: number | null;
  affected_team: string | null;
  affected_player: string | null;
  created_at: string;
};

const CreateInput = z.object({
  matchIds: z.array(z.string().min(1).max(120)).min(1).max(15),
  article: z.object({
    id: z.string().min(1).max(2000),
    url: z.string().url(),
    title: z.string().min(1).max(500),
    source: z.string().max(200).optional(),
  }),
  injected_insight: z.string().min(1).max(2000),
  impact_summary: z.string().min(1).max(400),
  impact_direction: z.enum(["positive", "negative", "neutral"]).default("neutral"),
  impact_strength: z.enum(["low", "medium", "high"]).default("medium"),
  affected_team: z.string().max(80).optional(),
  affected_player: z.string().max(120).optional(),
});

// Map qualitative impact to small numeric deltas. Kept conservative so
// personal injections nudge — never override — the model.
function deltasFor(direction: "positive" | "negative" | "neutral", strength: "low" | "medium" | "high") {
  if (direction === "neutral") return { points: 0, attack: 0, defence: 0, tempo: 0, tryRate: 0 };
  const mag = strength === "high" ? 1 : strength === "medium" ? 0.6 : 0.3;
  const sign = direction === "positive" ? 1 : -1;
  return {
    points: sign * mag * 3.5,   // ± up to 3.5 expected points for the team
    attack: sign * mag * 0.06,  // ± 6% multiplicative
    defence: -sign * mag * 0.04, // negative news weakens defence
    tempo: sign * mag * 0.04,
    tryRate: sign * mag * 0.12, // ± 12% on per-player try rate (capped)
  };
}

// ---- Server functions ----------------------------------------------------

export const createUserInjection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Premium gate (RLS also enforces this — belt + braces).
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_premium")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.is_premium) {
      throw new Error("Premium required to inject personal article insights.");
    }

    const d = deltasFor(data.impact_direction, data.impact_strength);
    const rows = data.matchIds.map((matchId) => ({
      user_id: userId,
      match_id: matchId,
      article_id: data.article.id,
      article_url: data.article.url,
      article_title: data.article.title,
      article_source: data.article.source ?? null,
      injected_insight: data.injected_insight,
      impact_summary: data.impact_summary,
      impact_direction: data.impact_direction,
      impact_strength: data.impact_strength,
      delta_expected_points: d.points,
      delta_attack: d.attack,
      delta_defence: d.defence,
      delta_tempo: d.tempo,
      delta_player_try_rate: d.tryRate,
      affected_team: data.affected_team ?? null,
      affected_player: data.affected_player ?? null,
    }));

    const { data: inserted, error } = await supabase
      .from("user_article_injections" as never)
      .insert(rows as never)
      .select();
    if (error) throw new Error(error.message);
    return { ok: true, inserted: (inserted as unknown as UserArticleInjection[]) ?? [] };
  });

export const listUserInjectionsForMatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ matchId: z.string().min(1).max(120) }).parse(i))
  .handler(async ({ data, context }): Promise<UserArticleInjection[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("user_article_injections" as never)
      .select("*")
      .eq("user_id" as never, userId as never)
      .eq("match_id" as never, data.matchId as never)
      .order("created_at" as never, { ascending: false } as never);
    if (error) throw new Error(error.message);
    return (rows as unknown as UserArticleInjection[]) ?? [];
  });

export const listUserInjectionArticleIds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ article_id: string; match_id: string }>> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_article_injections" as never)
      .select("article_id, match_id")
      .eq("user_id" as never, userId as never);
    if (error) throw new Error(error.message);
    return (data as unknown as Array<{ article_id: string; match_id: string }>) ?? [];
  });

export const deleteUserInjection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_article_injections" as never)
      .delete()
      .eq("id" as never, data.id as never)
      .eq("user_id" as never, userId as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
