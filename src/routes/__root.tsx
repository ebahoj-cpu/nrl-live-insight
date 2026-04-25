import {
  Outlet, Link, HeadContent, Scripts,
  createRootRouteWithContext, useRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider, useIsFetching, useQuery } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import { RotateCw, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getCurrentRoundFixtures } from "@/server/index.functions";
import { TeamLogo } from "@/components/TeamLogo";

interface RouterContext { queryClient: QueryClient }

function NotFoundComponent() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-7xl font-bold tracking-tight">404</h1>
        <p className="mt-3 text-muted-foreground">That page doesn't exist.</p>
        <Link to="/" className="mt-6 inline-block px-5 py-2 bg-accent text-accent-foreground rounded-full font-semibold">
          Back to fixtures
        </Link>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LINEBREAK – NRL Betting Insights" },
      { name: "description", content: "Live NRL odds, official stats, and AI-generated betting insights for every match." },
      { name: "theme-color", content: "#0A0A0A" },
      { property: "og:title", content: "LINEBREAK – NRL Betting Insights" },
      { property: "og:description", content: "Live NRL odds, official stats, and AI-generated betting insights for every match." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "LINEBREAK – NRL Betting Insights" },
      { name: "twitter:description", content: "Live NRL odds, official stats, and AI-generated betting insights for every match." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1bd44cc0-9ab8-4ac8-8e34-323ecb88c548/id-preview-d4fa06cd--74ebdc8e-deaf-40ed-ab5a-fa30c4277ca5.lovable.app-1776656446133.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1bd44cc0-9ab8-4ac8-8e34-323ecb88c548/id-preview-d4fa06cd--74ebdc8e-deaf-40ed-ab5a-fa30c4277ca5.lovable.app-1776656446133.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://www.nrl.com" },
      { rel: "preconnect", href: "https://api.the-odds-api.com" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body className="bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Header />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
        <Outlet />
      </main>
      <Footer />
    </QueryClientProvider>
  );
}

function Header() {
  const router = useRouter();
  const fetching = useIsFetching();
  const refresh = () => router.invalidate();
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground font-black">
            L
          </span>
          <span className="font-display font-extrabold tracking-tight text-lg">
            LINE<span className="text-accent">BREAK</span>
          </span>
        </Link>
        <button
          onClick={refresh}
          aria-label="Refresh data"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 transition"
        >
          <RotateCw className={`h-4 w-4 ${fetching ? "animate-spin-slow" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border mt-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>Bet responsibly · 18+</span>
        <span className="ml-auto">© LINEBREAK</span>
      </div>
    </footer>
  );
}
