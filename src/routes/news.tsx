import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { getNews } from "@/server/news.functions";
import { summariseArticle, type ArticleSummary } from "@/server/news-summary.functions";
import { ExternalLink, Sparkles, TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { findTeam } from "@/lib/teams";
import { TeamLogo } from "@/components/TeamLogo";

// Publisher logos for known sources (matched case-insensitively, substring).
const PUBLISHER_LOGOS: { match: RegExp; src: string; alt: string }[] = [
  { match: /nrl\.com|^nrl$/i, src: "https://www.nrl.com/.theme/nrl/logo.svg", alt: "NRL" },
  { match: /sydney morning herald|smh/i, src: "https://www.google.com/s2/favicons?domain=smh.com.au&sz=128", alt: "Sydney Morning Herald" },
];

function findPublisherLogo(source: string) {
  return PUBLISHER_LOGOS.find((p) => p.match.test(source)) ?? null;
}

const newsQO = () => queryOptions({
  queryKey: ["news"],
  queryFn: () => getNews({ data: {} }),
});

export const Route = createFileRoute("/news")({
  head: () => ({
    meta: [
      { title: "NRL News — LINEBREAK" },
      { name: "description", content: "Latest NRL headlines, injuries, and team updates from trusted rugby league sources." },
      { property: "og:title", content: "NRL News — LINEBREAK" },
      { property: "og:description", content: "Live NRL news feed from NRL.com, ABC Sport, and The Roar." },
    ],
  }),
  loader: ({ context: { queryClient } }) => {
    void queryClient.ensureQueryData(newsQO());
  },
  component: NewsPage,
  errorComponent: ({ error }) => (
    <div className="py-16 text-center">
      <p className="text-danger font-semibold">News unavailable</p>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
    </div>
  ),
});

function NewsPage() {
  return (
    <Suspense fallback={
      <div className="pt-8 space-y-3">
        <div className="h-8 w-48 bg-surface rounded mb-4 animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 bg-surface rounded animate-pulse" />)}
      </div>
    }>
      <NewsFeed />
    </Suspense>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function NewsFeed() {
  const items = useSuspenseQuery(newsQO()).data;
  return (
    <div className="pt-8">
      <header className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.25em] text-accent font-bold">Live Feed</div>
        <h1 className="font-display font-extrabold text-lg sm:text-xl tracking-tight mt-1">NRL News</h1>
        <p className="text-xs text-muted-foreground mt-2">{items.length} stories · auto-refreshed</p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-10 text-center text-muted-foreground text-sm">
          No news available right now.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => (
            <NewsCard key={n.id} item={n} />
          ))}
        </ul>
      )}
    </div>
  );
}

type NewsItemProps = {
  item: {
    id: string;
    title: string;
    link: string;
    source: string;
    publishedUtc: string;
    image?: string;
    summary?: string;
  };
};

type PanelMode = "summary" | "impact";

function NewsCard({ item: n }: NewsItemProps) {
  const [mode, setMode] = useState<PanelMode | null>(null);

  const toggle = (next: PanelMode) => setMode((cur) => (cur === next ? null : next));

  return (
    <li>
      <div className="flex gap-3 rounded-2xl border border-border bg-surface hover:bg-surface-2 transition p-3 group">
        {n.image ? (
          <img
            src={n.image}
            alt=""
            loading="lazy"
            className="h-20 w-20 sm:h-24 sm:w-24 shrink-0 rounded-xl object-cover bg-surface-2"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (() => {
          const team = findTeam(n.source);
          const pub = !team ? findPublisherLogo(n.source) : null;
          return (
            <div className="h-20 w-20 sm:h-24 sm:w-24 shrink-0 rounded-xl bg-surface-2 flex items-center justify-center p-2">
              {team ? (
                <TeamLogo themeKey={team.themeKey} name={team.nickname} size={64} />
              ) : pub ? (
                <img src={pub.src} alt={pub.alt} className="max-h-full max-w-full object-contain" loading="lazy" />
              ) : (
                <span className="text-accent font-black text-xl">{n.source.charAt(0)}</span>
              )}
            </div>
          );
        })()}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-accent">
            <span>{n.source}</span>
            <span className="text-muted-foreground">· {timeAgo(n.publishedUtc)}</span>
          </div>
          <a
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <h2 className="font-extrabold text-sm sm:text-base mt-1 leading-snug line-clamp-3 group-hover:text-accent transition">
              {n.title}
            </h2>
          </a>
          {n.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 hidden sm:block">{n.summary}</p>
          )}
          <div className="mt-auto pt-2 flex items-center gap-3 flex-wrap">
            <a
              href={n.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-accent transition"
            >
              <ExternalLink className="h-3 w-3" /> Open article
            </a>
            <button
              type="button"
              onClick={() => toggle("summary")}
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition"
            >
              <Sparkles className="h-3 w-3" /> {mode === "summary" ? "Hide" : "Article"} Summary
            </button>
            <button
              type="button"
              onClick={() => toggle("impact")}
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition"
            >
              <TrendingUp className="h-3 w-3" /> {mode === "impact" ? "Hide" : "Impact on"} Insights
            </button>
          </div>
        </div>
      </div>

      {mode && (
        <ArticleSummaryPanel url={n.link} title={n.title} source={n.source} mode={mode} />
      )}
    </li>
  );
}

function ArticleSummaryPanel({ url, title, source, mode }: { url: string; title: string; source: string; mode: PanelMode }) {
  const q = useQuery({
    queryKey: ["article-summary", url],
    queryFn: () => summariseArticle({ data: { url, title, source } }),
    staleTime: 24 * 60 * 60_000,
    retry: 1,
  });

  const heading = mode === "impact" ? "Impact on Insights" : "Article Summary";
  const HeadingIcon = mode === "impact" ? TrendingUp : Sparkles;
  const loadingText = mode === "impact" ? "Assessing betting impact…" : "Reading the article…";

  return (
    <div className="mt-2 ml-3 rounded-2xl border border-accent/30 bg-accent/5 p-4 animate-in fade-in slide-in-from-top-1">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-bold text-accent mb-3">
        <HeadingIcon className="h-3.5 w-3.5" />
        {heading}
      </div>

      {q.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {loadingText}
        </div>
      )}

      {q.isError && (
        <p className="text-xs text-danger">
          {(q.error as Error)?.message ?? "Couldn't summarise this article."}
        </p>
      )}

      {q.data && (mode === "impact" ? <ImpactBody data={q.data} /> : <SummaryBody data={q.data} />)}
    </div>
  );
}

function ImpactBody({ data }: { data: ArticleSummary }) {
  const dir = data.bettingImpact.direction;
  const tone =
    dir === "positive"
      ? { Icon: TrendingUp, label: "Positive impact", className: "text-accent border-accent/40 bg-accent/15" }
      : dir === "negative"
        ? { Icon: TrendingDown, label: "Negative impact", className: "text-danger border-danger/40 bg-danger/10" }
        : { Icon: Minus, label: "Neutral impact", className: "text-muted-foreground border-border bg-surface-2" };
  const Icon = tone.Icon;
  return (
    <div className={`rounded-xl border p-3 ${tone.className}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-black mb-1">
        <Icon className="h-3.5 w-3.5" />
        {tone.label} on Insights bets
      </div>
      <p className="text-xs leading-relaxed text-foreground/90">{data.bettingImpact.note}</p>
    </div>
  );
}

function SummaryBody({ data }: { data: ArticleSummary }) {
  const dir = data.bettingImpact.direction;
  const tone =
    dir === "positive"
      ? { Icon: TrendingUp, label: "Positive impact", className: "text-accent border-accent/40 bg-accent/15" }
      : dir === "negative"
        ? { Icon: TrendingDown, label: "Negative impact", className: "text-danger border-danger/40 bg-danger/10" }
        : { Icon: Minus, label: "Neutral impact", className: "text-muted-foreground border-border bg-surface-2" };
  const Icon = tone.Icon;

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-foreground/90">{data.summary}</p>

      {data.keyPoints.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">Key points</div>
          <ul className="space-y-1">
            {data.keyPoints.map((p, i) => (
              <li key={i} className="text-xs text-foreground/85 flex gap-2">
                <span className="text-accent font-black mt-0.5">·</span>
                <span className="flex-1">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`rounded-xl border p-3 ${tone.className}`}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-black mb-1">
          <Icon className="h-3.5 w-3.5" />
          {tone.label} on Insights bets
        </div>
        <p className="text-xs leading-relaxed text-foreground/90">{data.bettingImpact.note}</p>
      </div>
    </div>
  );
}
