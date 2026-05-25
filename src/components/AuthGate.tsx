/**
 * AuthGate wraps the app and enforces access rules:
 *  - Not signed in → show LoginScreen (no redirect; URL preserved).
 *  - Signed in but not premium AND on a premium-only route → show PremiumGate.
 *  - Otherwise render children.
 *
 * Free routes: "/" (fixtures) and "/ladder".
 * Premium routes: everything else (news, scout, match details, settings).
 *
 * Extend to Stripe: when checkout succeeds, your webhook flips
 * profiles.is_premium and the user is unblocked on next auth refresh.
 */
import { useLocation } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { LoginScreen } from "@/components/LoginScreen";
import { PremiumGate } from "@/components/PremiumGate";
import type { ReactNode } from "react";

const FREE_PATHS = ["/", "/ladder"];

function isFreePath(pathname: string) {
  if (pathname === "/") return true;
  return FREE_PATHS.some((p) => p !== "/" && (pathname === p || pathname.startsWith(p + "/")));
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, isPremium, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  if (!isPremium && !isFreePath(pathname)) {
    return <PremiumGate />;
  }

  return <>{children}</>;
}
