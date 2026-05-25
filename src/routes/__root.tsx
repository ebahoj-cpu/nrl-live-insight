import {
  Outlet, Link, HeadContent, Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import { Download, Menu, X, Swords, ListOrdered, Newspaper, Bird, Settings, UserCircle2, LogOut } from "lucide-react";
import { useEffect, useState } from "react";

interface RouterContext { queryClient: QueryClient }

const NAV_ITEMS = [
  { to: "/", label: "Fixtures", icon: Swords, exact: true },
  { to: "/ladder", label: "Ladder", icon: ListOrdered, exact: false },
  { to: "/news", label: "News", icon: Newspaper, exact: false },
  { to: "/scout", label: "Scout", icon: Bird, exact: false },
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
      <body className="bg-background text-foreground antialiased overflow-x-hidden">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    cleanupPreviewServiceWorkers();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Header />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-32 overflow-x-hidden">
        <Outlet />
      </main>
      <BottomNav />
    </QueryClientProvider>
  );
}

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isPreviewRuntime() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  return inIframe || host.includes("id-preview--") || host.includes("lovableproject.com");
}

function cleanupPreviewServiceWorkers() {
  if (typeof window === "undefined" || !isPreviewRuntime()) return;
  // Installed preview PWAs can keep an old cached shell and show only the launch icon.
  // In Lovable preview/iframe contexts, clear any prior service worker/cache state.
  void navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });
  void window.caches?.keys().then((names) => {
    names.forEach((name) => void window.caches.delete(name));
  });
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isPreviewRuntime()) {
      setInstalled(true);
      return;
    }

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
    <>
    <header className="fixed top-0 inset-x-0 z-40 backdrop-blur-xl bg-background/85 border-b border-border">
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
    </header>
    {menuOpen && <NavMenu onClose={() => setMenuOpen(false)} />}
    {showIosHint && <IosInstallHint onClose={() => setShowIosHint(false)} />}
    </>
  );
}

function IosInstallHint({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-background/60 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-sm my-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl max-h-[calc(100vh-2rem)] overflow-y-auto">
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
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="fixed inset-0 bg-background/70 backdrop-blur-md z-40 animate-in fade-in duration-200"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-[min(88vw,340px)] bg-surface border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
      >
        {/* Close button */}
        <div className="flex justify-end px-4 pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-border hover:bg-surface-2 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Profile header */}
        <div className="px-5 pt-2 pb-5 flex flex-col items-center text-center border-b border-border">
          <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-accent/15 text-accent border border-accent/30 mb-3">
            <UserCircle2 className="h-12 w-12" />
          </span>
          <div className="font-display font-extrabold text-lg leading-tight">Guest</div>
          <div className="text-xs text-muted-foreground mt-0.5">Sign in to sync picks</div>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon, exact }) => (
              <li key={to}>
                <Link
                  to={to}
                  onClick={onClose}
                  activeOptions={{ exact }}
                  activeProps={{ className: "bg-accent/15 text-accent" }}
                  inactiveProps={{ className: "text-foreground hover:bg-surface-2" }}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl transition"
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-semibold text-sm uppercase tracking-wider">{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer / account */}
        <div className="border-t border-border px-3 py-3 space-y-1">
          <Link
            to="/settings"
            onClick={onClose}
            activeProps={{ className: "bg-accent/15 text-accent" }}
            inactiveProps={{ className: "text-foreground hover:bg-surface-2" }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition"
          >
            <Settings className="h-5 w-5" />
            <span className="font-semibold text-sm uppercase tracking-wider">Settings</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-foreground hover:bg-surface-2 transition"
          >
            <UserCircle2 className="h-5 w-5" />
            <span className="font-semibold text-sm uppercase tracking-wider">Account</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
          >
            <LogOut className="h-5 w-5" />
            <span className="font-semibold text-sm uppercase tracking-wider">Sign in</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function BottomNav() {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 pointer-events-none pb-[env(safe-area-inset-bottom)]">
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
                    <span className={`inline-flex h-11 w-14 items-center justify-center rounded-full transition ${isActive ? "bg-accent text-accent-foreground shadow-lg shadow-accent/30 scale-105" : "text-muted-foreground group-hover:text-foreground group-hover:bg-surface-2"}`}>
                      <Icon className="h-6 w-6" strokeWidth={isActive ? 2.5 : 2} />
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
