/**
 * Shown when a signed-in user without premium tries to access a paid route.
 * Free tier sees fixtures & ladder; everything else (news, scout, match
 * details, settings) is gated. Hook Stripe checkout into the CTA later.
 */
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Crown, Check, ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const FEATURES = [
  "AI match insights & predicted scripts",
  "Tryscorer picks (first, anytime, secondary)",
  "Scout — chat with our NRL model",
  "Live odds + value edges",
  "News-driven model adjustments",
];

export function PremiumGate() {
  const { profile, signOut } = useAuth();

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="rounded-2xl border border-accent/40 bg-gradient-to-b from-surface to-surface-2 p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 border border-accent/40 mb-4">
              <Crown className="h-7 w-7 text-accent" />
            </div>
            <span className="inline-block text-[10px] font-extrabold uppercase tracking-widest text-accent bg-accent/10 px-2 py-1 rounded">
              Premium Only
            </span>
            <h1 className="font-display font-extrabold text-3xl mt-3">Unlock the full edge</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Hi {profile?.full_name || profile?.username || "there"} — fixtures and the ladder are free,
              but this section is part of LINEBREAK Premium.
            </p>

            <ul className="text-left space-y-2 mt-6 w-full">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <div className="mt-7 w-full">
              <div className="flex items-baseline justify-center gap-1 mb-3">
                <span className="font-display font-extrabold text-4xl">$9</span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </div>
              <Button
                size="lg"
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => alert("Stripe checkout coming soon — for early access, contact support.")}
              >
                <Crown className="h-4 w-4 mr-2" />
                Upgrade to Premium
              </Button>
            </div>

            <div className="flex items-center gap-4 mt-5 text-xs">
              <Link to="/" search={{ round: undefined }} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-3 w-3" />
                Back to fixtures
              </Link>
              <span className="text-border">·</span>
              <button onClick={() => void signOut()} className="text-muted-foreground hover:text-foreground">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
