/**
 * Combined sign in / sign up / magic link / forgot password screen.
 * Rendered inline by AuthGate when there's no session — no route change.
 */
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Mail, Lock, User as UserIcon } from "lucide-react";

type Mode = "signin" | "signup" | "magic" | "forgot";

export function LoginScreen() {
  const { signIn, signUp, signInWithMagicLink, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function handleGoogle() {
    setBusy(true);
    setMsg(null);
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (res.error) setMsg({ type: "error", text: res.error.message ?? "Google sign-in failed" });
    setBusy(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    if (mode === "signin") {
      const { error } = await signIn(email, password);
      if (error) setMsg({ type: "error", text: error.message });
    } else if (mode === "signup") {
      const { error } = await signUp(email, password, fullName || undefined);
      if (error) setMsg({ type: "error", text: error.message });
      else setMsg({ type: "success", text: "Check your inbox to verify your email, then sign in." });
    } else if (mode === "magic") {
      const { error } = await signInWithMagicLink(email);
      if (error) setMsg({ type: "error", text: error.message });
      else setMsg({ type: "success", text: "Magic link sent — check your inbox." });
    } else if (mode === "forgot") {
      const { error } = await resetPassword(email);
      if (error) setMsg({ type: "error", text: error.message });
      else setMsg({ type: "success", text: "Reset link sent — check your inbox." });
    }
    setBusy(false);
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground font-black text-2xl mb-3">
            L
          </div>
          <h1 className="font-display font-extrabold tracking-tight text-3xl">
            LINE<span className="text-accent">BREAK</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-2">Premium NRL betting insights</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-2xl">
          <Tabs value={mode === "signup" ? "signup" : "signin"} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-2 w-full mb-5">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>

            <Button type="button" variant="outline" className="w-full mb-4" onClick={handleGoogle} disabled={busy}>
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.99 10.99 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.83z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
              Continue with Google
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-surface px-2 text-muted-foreground">or</span></div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === "signup" && (
                <div>
                  <Label htmlFor="fullName">Full name</Label>
                  <div className="relative mt-1">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" className="pl-9" />
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="email">Email</Label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="pl-9" />
                </div>
              </div>

              {(mode === "signin" || mode === "signup") && (
                <div>
                  <Label htmlFor="password">Password</Label>
                  <div className="relative mt-1">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pl-9" />
                  </div>
                </div>
              )}

              {msg && (
                <div className={`text-sm rounded-md px-3 py-2 ${msg.type === "error" ? "bg-destructive/10 text-destructive" : "bg-accent/15 text-accent"}`}>
                  {msg.text}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {mode === "signin" && "Sign in"}
                {mode === "signup" && "Create account"}
                {mode === "magic" && "Send magic link"}
                {mode === "forgot" && "Send reset link"}
              </Button>
            </form>

            <div className="flex items-center justify-between mt-4 text-xs">
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setMode("magic"); setMsg(null); }}>
                Magic link instead
              </button>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setMode("forgot"); setMsg(null); }}>
                Forgot password?
              </button>
            </div>
          </Tabs>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          By continuing you agree to bet responsibly · 18+
        </p>
      </div>
    </div>
  );
}
