// ============================================================================
// YourInjectedInsights — premium-only, ACCOUNT-SPECIFIC overlay.
//
// Shown on a match's Insights tab. Lists personal article injections that
// the signed-in user has applied to this match, with delete affordance.
// These NEVER affect other users — see src/server/user-injections.functions.ts.
// ============================================================================
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Sparkles, TrendingUp, TrendingDown, Minus, X, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  listUserInjectionsForMatch,
  deleteUserInjection,
  type UserArticleInjection,
} from "@/server/user-injections.functions";

export function YourInjectedInsights({ matchId }: { matchId: string }) {
  const { session, isPremium } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["user-injections", matchId],
    queryFn: () => listUserInjectionsForMatch({ data: { matchId } }),
    enabled: !!session && isPremium,
    staleTime: 30_000,
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteUserInjection({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-injections", matchId] }),
  });

  if (!session || !isPremium) return null;
  const items = q.data ?? [];
  if (q.isLoading) {
    return (
      <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your injected insights…
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-bold text-accent mb-3">
        <Sparkles className="h-3.5 w-3.5" />
        Your Injected Insights
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/40">
          Personal · {items.length}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        These are private to your account — they only influence YOUR simulation view for this match.
      </p>
      <ul className="space-y-2">
        {items.map((it) => <InjectionRow key={it.id} item={it} onDelete={() => del.mutate(it.id)} deleting={del.isPending && del.variables === it.id} />)}
      </ul>
    </div>
  );
}

function InjectionRow({ item, onDelete, deleting }: { item: UserArticleInjection; onDelete: () => void; deleting: boolean }) {
  const tone =
    item.impact_direction === "positive"
      ? { Icon: TrendingUp, cls: "text-accent border-accent/40 bg-accent/10" }
      : item.impact_direction === "negative"
        ? { Icon: TrendingDown, cls: "text-danger border-danger/40 bg-danger/10" }
        : { Icon: Minus, cls: "text-muted-foreground border-border bg-surface-2" };
  const Icon = tone.Icon;
  return (
    <li className={`rounded-xl border p-3 ${tone.cls}`}>
      <div className="flex items-start gap-2">
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black uppercase tracking-wider">News-adjusted</span>
            <span className="text-[10px] uppercase tracking-wider opacity-70">· {item.impact_strength}</span>
            {item.affected_player && (
              <span className="text-[10px] font-bold opacity-80">· {item.affected_player}</span>
            )}
            {item.affected_team && !item.affected_player && (
              <span className="text-[10px] font-bold opacity-80">· {item.affected_team}</span>
            )}
          </div>
          <div className="text-xs font-bold mt-1 text-foreground/90">{item.impact_summary}</div>
          <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{item.injected_insight}</div>
          <a
            href={item.article_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-accent transition mt-1.5"
          >
            <ExternalLink className="h-3 w-3" />
            {item.article_source ?? "Source"} · {item.article_title}
          </a>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title="Remove this injection"
          className="shrink-0 p-1 rounded-full hover:bg-foreground/10 disabled:opacity-50"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </div>
    </li>
  );
}
