import {
  Outlet, Link, HeadContent, Scripts,
  createRootRouteWithContext, useRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider, useIsFetching } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import { RotateCw, Menu, X, Calendar, BarChart3, Newspaper, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

interface RouterContext { queryClient: QueryClient }

const NAV_ITEMS = [
  { to: "/", label: "Fixtures", icon: Calendar, exact: true },
  { to: "/ladder", label: "Ladder", icon: BarChart3, exact: false },
  { to: "/news", label: "News", icon: Newspaper, exact: false },
  { to: "/scout", label: "Scout", icon: Sparkles, exact: false },
] as const;

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
      <main className="mx-auto max-w-6xl px-4 sm:px-6 pb-32">
        <Outlet />
      </main>
      <BottomNav />
      <Footer />
    </QueryClientProvider>
  );
}

function Header() {
  const router = useRouter();
  const fetching = useIsFetching();
  const refresh = () => router.invalidate();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border relative">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground font-black">
            L
          </span>
          <span className="font-display font-extrabold tracking-tight text-lg">
            LINE<span className="text-accent">BREAK</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            aria-label="Refresh data"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 transition"
          >
            <RotateCw className={`h-4 w-4 ${fetching ? "animate-spin-slow" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-border bg-surface hover:bg-surface-2 transition"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {menuOpen && <NavMenu onClose={() => setMenuOpen(false)} />}
    </header>
  );
}

function NavMenu({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="fixed inset-0 top-16 bg-background/40 backdrop-blur-sm z-20"
      />
      <div className="absolute right-0 sm:right-4 top-full mt-2 w-[min(92vw,300px)] rounded-2xl border border-border bg-surface shadow-2xl z-30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[10px] uppercase tracking-[0.2em] text-accent font-bold">Navigation</div>
        </div>
        <nav className="p-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => (
            <Link
              key={to}
              to={to}
              onClick={onClose}
              activeOptions={{ exact }}
              activeProps={{ className: "bg-accent/15 text-accent" }}
              inactiveProps={{ className: "text-foreground hover:bg-surface-2" }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition"
            >
              <Icon className="h-4 w-4" />
              <span className="font-semibold text-sm">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}

function BottomNav() {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 pointer-events-none pb-[env(safe-area-inset-bottom)]">
      {/* fade behind the bar to lift it off page content */}
      <div className="h-6 bg-gradient-to-t from-background to-transparent" />
      <nav
        aria-label="Primary"
        className="pointer-events-auto bg-surface/95 backdrop-blur-xl border-t-2 border-accent/40 shadow-[0_-12px_32px_-8px_rgba(0,0,0,0.6)]"
      >
        <ul className="mx-auto max-w-6xl grid grid-cols-3 px-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => (
            <li key={to}>
              <Link
                to={to}
                activeOptions={{ exact }}
                className="group flex flex-col items-center justify-center gap-1 py-3 transition relative"
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-12 rounded-b-full bg-accent" />
                    )}
                    <span className={`inline-flex h-9 w-14 items-center justify-center rounded-full transition ${isActive ? "bg-accent text-accent-foreground shadow-lg shadow-accent/30 scale-105" : "text-muted-foreground group-hover:text-foreground group-hover:bg-surface-2"}`}>
                      <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                    </span>
                    <span className={`text-[10px] font-extrabold uppercase tracking-wider transition ${isActive ? "text-accent" : "text-muted-foreground group-hover:text-foreground"}`}>
                      {label}
                    </span>
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border mt-16 mb-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>Bet responsibly · 18+</span>
        <span className="ml-auto">© LINEBREAK</span>
      </div>
    </footer>
  );
}
