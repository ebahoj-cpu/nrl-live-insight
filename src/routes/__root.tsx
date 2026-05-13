import {
  Outlet, Link, HeadContent, Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import { Download, Menu, X, Swords, ListOrdered, Newspaper, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import scoutAvatar from "@/assets/scout-avatar.png";

interface RouterContext { queryClient: QueryClient }

const NAV_ITEMS = [
  { to: "/", label: "Fixtures", icon: Swords, exact: true },
  { to: "/ladder", label: "Ladder", icon: ListOrdered, exact: false },
  { to: "/news", label: "News", icon: Newspaper, exact: false },
  { to: "/scout", label: "Scout", icon: Swords /* unused — rendered as avatar image */, exact: false },
] as const;

function NotFoundComponent() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-7xl font-bold tracking-tight">404</h1>
        <p className="mt-3 text-muted-foreground">That page doesn't exist.</p>
        <Link to="/" search={{ round: undefined }} className="mt-6 inline-block px-5 py-2 bg-accent text-accent-foreground rounded-full font-semibold">
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
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@500;600;700&display=swap" },
      { rel: "manifest", href: "/api/public/manifest" },
      { rel: "apple-touch-icon", href: "/api/public/app-icon?size=512" },
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

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BIPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    // Already installed?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);

    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const installApp = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
      return;
    }
    // Fallback (iOS / unsupported): show "Add to Home Screen" hint.
    setShowIosHint(true);
  };

  if (installed) {
    // No-op: keep menu still rendered via the button below.
  }

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border relative">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" search={{ round: undefined }} className="flex items-center gap-2 group">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground font-black">
            L
          </span>
          <span className="font-display font-extrabold tracking-tight text-lg">
            LINE<span className="text-accent">BREAK</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              // Hard reload bypasses HTTP cache. The match-page loaders re-fetch
              // and the insights cache freshness gate regenerates if squads/odds
              // changed or if a news impact was injected.
              window.location.reload();
            }}
            aria-label="Refresh app"
            title="Refresh app — re-fetches insights, scripts and bets"
            className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/15 text-accent px-3 py-1.5 text-sm font-semibold hover:bg-accent/25 transition"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          {!installed && (
            <button
              onClick={installApp}
              aria-label="Install app"
              className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/15 text-accent px-3 py-1.5 text-sm font-semibold hover:bg-accent/25 transition"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Install app</span>
            </button>
          )}
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
      {showIosHint && <IosInstallHint onClose={() => setShowIosHint(false)} />}
    </header>
  );
}

function IosInstallHint({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <div className="text-[10px] uppercase tracking-[0.2em] text-accent font-bold mb-2">Install LINEBREAK</div>
        <h2 className="font-display font-extrabold text-lg mb-2">Add to Home Screen</h2>
        <p className="text-sm text-muted-foreground">
          On iPhone: tap the <span className="font-semibold text-foreground">Share</span> button in Safari, then choose
          <span className="font-semibold text-foreground"> "Add to Home Screen"</span>.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          On Android: open the browser menu and tap <span className="font-semibold text-foreground">"Install app"</span>.
        </p>
        <button
          onClick={onClose}
          className="mt-4 w-full inline-flex items-center justify-center rounded-full bg-accent text-accent-foreground font-semibold py-2 text-sm"
        >
          Got it
        </button>
      </div>
    </div>
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
              {to === "/scout" ? (
                <img src={scoutAvatar} alt="" width={36} height={36} className="h-9 w-9 object-contain -my-1" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
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
        <ul className="mx-auto max-w-6xl grid grid-cols-4 px-2">
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
                    {to === "/scout" ? (
                      <span className="inline-flex h-11 w-11 items-center justify-center">
                        <img
                          src={scoutAvatar}
                          alt=""
                          width={44}
                          height={44}
                          className={`h-11 w-11 object-contain transition ${isActive ? "drop-shadow-[0_0_10px_var(--accent)] scale-110" : "opacity-95 group-hover:opacity-100 group-hover:scale-105"}`}
                        />
                      </span>
                    ) : (
                      <span className={`inline-flex h-11 w-14 items-center justify-center rounded-full transition ${isActive ? "bg-accent text-accent-foreground shadow-lg shadow-accent/30 scale-105" : "text-muted-foreground group-hover:text-foreground group-hover:bg-surface-2"}`}>
                        <Icon className="h-6 w-6" strokeWidth={isActive ? 2.5 : 2} />
                      </span>
                    )}
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
