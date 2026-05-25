/**
 * Auth context + hook.
 * Wraps Supabase Auth and exposes the current session, profile (incl. is_premium),
 * and helpers for sign in / sign up / sign out / password reset.
 *
 * Premium status comes from public.profiles.is_premium and is refreshed
 * on every auth state change. To extend to Stripe later, flip is_premium
 * server-side (webhook → admin client) when a subscription becomes active.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface Profile {
  id: string;
  username: string | null;
  full_name: string | null;
  is_premium: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isPremium: boolean;
  refreshProfile: () => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null; needsEmailConfirm: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithMagicLink: (email: string) => Promise<{ error: Error | null }>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, full_name, is_premium")
        .eq("id", userId)
        .maybeSingle();
      setProfile((data as Profile) ?? null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    // Listener FIRST, then getSession (avoids missed events).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        setProfileLoading(true);
        // Defer to avoid deadlock inside the auth callback
        setTimeout(() => void loadProfile(newSession.user.id), 0);
      } else {
        setProfile(null);
        setProfileLoading(false);
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        setProfileLoading(true);
        void loadProfile(data.session.user.id);
      }
      setSessionResolved(true);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // Loading is true until we've resolved the session AND (when signed in) the
  // profile row. This prevents the premium-gate flash where session is known
  // but is_premium hasn't been fetched yet → isPremium briefly reads as false.
  const loading = !sessionResolved || (!!session?.user && profileLoading && !profile);

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    isPremium: !!profile?.is_premium,
    refreshProfile: async () => {
      if (session?.user) await loadProfile(session.user.id);
    },
    signUp: async (email, password, fullName) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: fullName ? { full_name: fullName } : undefined,
        },
      });
      return { error, needsEmailConfirm: !error };
    },
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    },
    signInWithMagicLink: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      return { error };
    },
    resetPassword: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return { error };
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
