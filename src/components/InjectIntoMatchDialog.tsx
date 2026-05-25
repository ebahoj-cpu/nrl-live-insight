// ============================================================================
// InjectIntoMatchDialog — premium-only News tab action.
//
// Lets the signed-in premium user choose one or more upcoming fixtures and
// inject this article's AI-derived insight into THEIR PERSONAL view of
// those matches. Never affects other users.
// ============================================================================
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Target, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getCurrentRoundFixtures } from "@/server/index.functions";
import { createUserInjection } from "@/server/user-injections.functions";
import type { ArticleSummary } from "@/server/news-summary.functions";

type ArticleMeta = {
  id: string;
  title: string;
  link: string;
  source: string;
};

export function InjectIntoMatchDialog({
  open, onClose, article, summary,
}: { open: boolean; onClose: () => void; article: ArticleMeta; summary: ArticleSummary }) {
  const { session, isPremium } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fixturesQ = useQuery({
    queryKey: ["fixtures-for-injection"],
    queryFn: () => getCurrentRoundFixtures({ data: {} }),
    enabled: open && !!session && isPremium,
    staleTime: 5 * 60_000,
  });

  const fixtures = useMemo(() => {
    const list = fixturesQ.data?.fixtures ?? [];
    const now = Date.now();
    return list.filter((f: any) => Date.parse(f.kickoffUtc) > now - 60 * 60_000);
  }, [fixturesQ.data]);

  const inject = useMutation({
    mutationFn: () => createUserInjection({
      data: {
        matchIds: Array.from(selected),
        article: { id: article.id, url: article.link, title: article.title, source: article.source },
        injected_insight: `${summary.summary} ${summary.bettingImpact.note}`.trim(),
        impact_summary: summary.bettingImpact.note.slice(0, 280),
        impact_direction: summary.bettingImpact.direction,
        impact_strength: summary.bettingImpact.timeframe === "short" ? "high" : summary.bettingImpact.timeframe === "mid" ? "medium" : "low",
      },
    }),
    onSuccess: () => {
      // Invalidate any "your injections" view that might be open
      qc.invalidateQueries({ queryKey: ["user-injections"] });
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:max-w-md max-h-[85vh] bg-surface border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-4 border-b border-border">
          <Target className="h-4 w-4 text-accent" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-accent font-bold">Inject into match</div>
            <div className="text-xs text-muted-foreground line-clamp-1">{article.title}</div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-foreground/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!session || !isPremium ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Personal injections are a Premium feature.
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-border bg-accent/5">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                This insight is <b className="text-foreground">personal</b> — it only changes <em>your</em> view of the
                selected matches. It won't affect other users.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {fixturesQ.isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading fixtures…
                </div>
              ) : fixtures.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No upcoming fixtures.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {fixtures.map((f: any) => {
                    const isSel = selected.has(f.matchId);
                    return (
                      <li key={f.matchId}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(f.matchId)) n.delete(f.matchId); else n.add(f.matchId);
                              return n;
                            });
                          }}
                          className={`w-full text-left p-3 flex items-center gap-3 hover:bg-surface-2 transition ${isSel ? "bg-accent/10" : ""}`}
                        >
                          <div className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 ${isSel ? "bg-accent border-accent" : "border-border"}`}>
                            {isSel && <Check className="h-3.5 w-3.5 text-accent-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold truncate">
                              {f.homeTeam?.nickName} vs {f.awayTeam?.nickName}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {new Date(f.kickoffUtc).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {f.venue ?? ""}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="p-4 border-t border-border flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground flex-1">
                {selected.size} match{selected.size === 1 ? "" : "es"} selected
              </span>
              <button
                type="button"
                onClick={() => inject.mutate()}
                disabled={selected.size === 0 || inject.isPending}
                className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-full bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
              >
                {inject.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
                {inject.isPending ? "Injecting…" : "Inject insight"}
              </button>
            </div>
            {inject.isError && (
              <div className="px-4 pb-3 text-[11px] text-danger">{(inject.error as Error).message}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
