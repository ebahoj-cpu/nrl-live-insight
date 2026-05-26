// PlayerModal — full-screen modal showing a player's profile + Performance
// Edge. Mounted once at the app root via <PlayerModalProvider>; anywhere
// underneath you call `usePlayerModal().open({...})` to display the card.
//
// Data: pulled lazily via the `getPlayerProfile` server fn (NRL.com scrape +
// 60 min in-memory cache). forceRefresh=true on each open so the card is
// always working from the latest scrape — the cache exists for repeat opens.

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { TeamLogo } from "@/components/TeamLogo";
import { getPlayerProfile, type PlayerProfilePayload } from "@/server/player-profile.functions";
import type { SkillRating, EnergyTier } from "@/lib/performance-edge";
import {
  Activity, Sword, Zap, Shield, Hand, Dumbbell, Footprints,
  Hand as HandIcon, User2, BatteryFull, BatteryLow,
  Cake, Ruler, Weight as WeightIcon, TrendingUp,
} from "lucide-react";

export type OpenPlayerArgs = {
  firstName: string;
  lastName: string;
  teamThemeKey: string;
  teamNickname: string;
  position?: string;
  jerseyNumber?: number;
  /** Optional fallback headshot used while the scrape resolves */
  headImage?: string;
};

type Ctx = {
  open: (args: OpenPlayerArgs) => void;
  close: () => void;
};
const PlayerModalCtx = createContext<Ctx | null>(null);

export function usePlayerModal(): Ctx {
  const ctx = useContext(PlayerModalCtx);
  if (!ctx) throw new Error("usePlayerModal must be used inside <PlayerModalProvider>");
  return ctx;
}

export function PlayerModalProvider({ children }: { children: ReactNode }) {
  const [args, setArgs] = useState<OpenPlayerArgs | null>(null);
  const open = useCallback((a: OpenPlayerArgs) => setArgs(a), []);
  const close = useCallback(() => setArgs(null), []);
  return (
    <PlayerModalCtx.Provider value={{ open, close }}>
      {children}
      <PlayerModal args={args} onClose={close} />
    </PlayerModalCtx.Provider>
  );
}

// -------------------------- Modal ---------------------------------

function PlayerModal({ args, onClose }: { args: OpenPlayerArgs | null; onClose: () => void }) {
  const fetchProfile = useServerFn(getPlayerProfile);
  const key = args ? `${args.teamThemeKey}:${args.firstName}:${args.lastName}` : "none";
  const { data, isLoading } = useQuery<PlayerProfilePayload>({
    queryKey: ["playerProfile", key],
    queryFn: () => fetchProfile({
      data: {
        teamThemeKey: args!.teamThemeKey,
        teamNickname: args!.teamNickname,
        firstName: args!.firstName,
        lastName: args!.lastName,
        position: args!.position,
        jerseyNumber: args!.jerseyNumber,
        forceRefresh: true,           // always pull latest on open
      },
    }),
    enabled: !!args,
    staleTime: 60_000,
  });

  return (
    <Dialog open={!!args} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl w-[96vw] max-h-[92vh] overflow-y-auto p-0 gap-0 bg-surface border-accent/30">
        {args && <PlayerProfileCard args={args} payload={data} loading={isLoading} />}
      </DialogContent>
    </Dialog>
  );
}

export function PlayerProfileCard({ args, payload, loading }: {
  args: OpenPlayerArgs;
  payload: PlayerProfilePayload | undefined;
  loading: boolean;
}) {
  const profile = payload?.profile;
  const edge = payload?.edge;
  const fullName = `${args.firstName} ${args.lastName}`;
  const heroImg = profile?.bodyImageUrl ?? args.headImage ?? null;

  return (
    <div className="flex flex-col">
      {/* Energy bar (full width across the top) */}
      <EnergyBar tier={edge?.energy.tier ?? "Moderate"} loading={loading} />

      {/* Hero block: large image left, identity + bio lines right */}
      <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-6">
        {/* Headshot */}
        <div className="relative shrink-0 w-full sm:w-44 h-56 sm:h-64 rounded-xl bg-gradient-to-b from-accent/15 to-surface-2 ring-1 ring-accent/25 overflow-hidden flex items-end justify-center">
          {heroImg ? (
            <img
              src={heroImg}
              alt={fullName}
              loading="eager"
              className="h-full w-auto max-w-none object-contain object-bottom drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <User2 className="h-24 w-24 text-muted-foreground/40" />
          )}
        </div>

        {/* Right column: name + logo + position + bio */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-3 mb-1">
            <TeamLogo themeKey={args.teamThemeKey} name={args.teamNickname} size={36} light />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                {args.firstName}
              </div>
              <h2 className="font-display font-extrabold text-2xl sm:text-3xl leading-none uppercase truncate">
                {args.lastName}
              </h2>
              <div className="mt-1 text-xs font-bold uppercase tracking-wider text-accent">
                {profile?.position ?? args.position ?? "—"}
                {args.jerseyNumber != null && (
                  <span className="ml-2 text-muted-foreground">#{args.jerseyNumber}</span>
                )}
              </div>
            </div>
          </div>

          {/* Bio line 1: Age | Height | Weight | Handed | Footed */}
          <BioLine items={[
            { label: "Age",    value: profile?.age != null ? String(profile.age) : "—" },
            { label: "Height", value: profile?.heightCm ? `${profile.heightCm} cm` : "—" },
            { label: "Weight", value: profile?.weightKg ? `${profile.weightKg} kg` : "—" },
            { label: "Handed", icon: <HandIcon className="h-3 w-3" />, value: "Right" },
            { label: "Footed", icon: <Footprints className="h-3 w-3" />, value: "Right" },
          ]} />

          {/* Bio line 2: Temperament + Experience progress bars */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TemperamentBar profile={profile} />
            <ExperienceBar profile={profile} />
          </div>

          {profile?.nickname && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              “{profile.nickname}” · debut {profile.debutClub ?? "—"}
            </p>
          )}
        </div>
      </div>

      {/* Performance Edge */}
      <div className="px-4 sm:px-6 pb-6">
        <PerformanceEdgeSection edge={edge} loading={loading} />
      </div>

      {loading && (
        <div className="px-6 pb-4 text-xs text-muted-foreground">Loading latest player data from NRL.com…</div>
      )}
      {payload?.error && (
        <div className="px-6 pb-4 text-xs text-danger">{payload.error}</div>
      )}
    </div>
  );
}

// -------------------------- Sub-components --------------------------

function EnergyBar({ tier, loading }: { tier: EnergyTier; loading: boolean }) {
  // 0..100 visual fill matched to the descriptive label.
  const fill: Record<EnergyTier, number> = {
    Supercharged: 100, High: 80, Moderate: 60, Tired: 40, Fatigued: 20,
  };
  const Icon = tier === "Fatigued" || tier === "Tired" ? BatteryLow : BatteryFull;
  return (
    <div className="px-4 sm:px-6 pt-4 pb-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-accent" /> Energy
        </span>
        <span className="text-accent">{loading ? "…" : tier}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-accent/60 to-accent transition-all"
          style={{ width: `${fill[tier]}%` }}
        />
      </div>
    </div>
  );
}

function BioLine({ items }: { items: { label: string; value: string; icon?: ReactNode }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] sm:text-xs">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="uppercase tracking-wider text-muted-foreground text-[9px] sm:text-[10px] font-semibold">
            {it.label}
          </span>
          <span className="flex items-center gap-1 font-bold text-foreground">
            {it.icon}{it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function TemperamentBar({ profile }: { profile: { seasonStats: { errors: number; appearances: number; tackleBreaks: number } } | null | undefined }) {
  // Temperament = composure under pressure. We proxy it from
  // (low errors per game) + (positive tackle-bust rate). 0..100.
  let value = 65;
  if (profile && profile.seasonStats.appearances > 0) {
    const errPerGame = profile.seasonStats.errors / profile.seasonStats.appearances;
    const breaks = profile.seasonStats.tackleBreaks / profile.seasonStats.appearances;
    value = Math.max(15, Math.min(95, 70 - errPerGame * 12 + breaks * 4));
  }
  return (
    <MiniStat icon={<Flame className="h-3 w-3" />} label="Temperament" value={Math.round(value)} suffix="/100" />
  );
}

function ExperienceBar({ profile }: { profile: { careerAppearances: number } | null | undefined }) {
  const caps = profile?.careerAppearances ?? 0;
  // 250 caps = 100%, scaled.
  const pct = Math.max(5, Math.min(100, (caps / 250) * 100));
  return (
    <MiniStat icon={<Activity className="h-3 w-3" />} label="Experience" value={caps} suffix=" caps" widthPct={pct} />
  );
}

function MiniStat({ icon, label, value, suffix, widthPct }: {
  icon: ReactNode; label: string; value: number; suffix: string; widthPct?: number;
}) {
  const pct = widthPct ?? value;
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
        <span className="flex items-center gap-1.5">{icon}{label}</span>
        <span className="text-foreground">{value}{suffix}</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

// -------------------------- Performance Edge --------------------------

const SKILL_ICONS = {
  stamina:  Activity,
  attack:   Sword,
  agility:  Zap,
  defence:  Shield,
  handling: Hand,
  strength: Dumbbell,
  kicking:  Footprints,
} as const;

function PerformanceEdgeSection({ edge, loading }: { edge: typeof undefined | null | import("@/lib/performance-edge").PerformanceEdge; loading: boolean }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display font-extrabold uppercase tracking-wider text-sm">
          Performance <span className="text-accent">Edge</span>
        </h3>
        {edge && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Overall <span className="text-accent font-bold">{edge.overall}</span>
          </span>
        )}
      </div>
      {edge && (
        <p className="text-[10px] text-muted-foreground mb-3">
          Form: <span className="text-foreground font-bold">{edge.form.tier}</span> ·
          {" "}Energy: <span className="text-foreground font-bold">{edge.energy.tier}</span>
          {edge.energy.minutesPerGame != null && (
            <span className="text-muted-foreground"> ({Math.round(edge.energy.minutesPerGame)} min/game)</span>
          )}
        </p>
      )}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
        {(edge?.skills ?? PLACEHOLDER_SKILLS).map((s) => {
          const Icon = SKILL_ICONS[s.key];
          return (
            <li key={s.key} className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="font-bold uppercase tracking-wider">{s.label}</span>
                  <span className={`font-bold ${toneClass(s.tone)}`}>
                    {loading ? "…" : s.word}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className={`h-full transition-all ${toneBgClass(s.tone)}`}
                    style={{ width: `${s.final}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const PLACEHOLDER_SKILLS: SkillRating[] = [
  { key: "stamina",  label: "Stamina",       base: 0, final: 0, word: "—", tone: "ok" },
  { key: "attack",   label: "Attack",        base: 0, final: 0, word: "—", tone: "ok" },
  { key: "agility",  label: "Agility/Speed", base: 0, final: 0, word: "—", tone: "ok" },
  { key: "defence",  label: "Defence",       base: 0, final: 0, word: "—", tone: "ok" },
  { key: "handling", label: "Handling",      base: 0, final: 0, word: "—", tone: "ok" },
  { key: "strength", label: "Strength",      base: 0, final: 0, word: "—", tone: "ok" },
  { key: "kicking",  label: "Kicking",       base: 0, final: 0, word: "—", tone: "ok" },
];

function toneClass(t: SkillRating["tone"]): string {
  switch (t) {
    case "great": return "text-accent";
    case "good":  return "text-emerald-400";
    case "ok":    return "text-foreground";
    case "low":   return "text-danger";
  }
}
function toneBgClass(t: SkillRating["tone"]): string {
  switch (t) {
    case "great": return "bg-accent";
    case "good":  return "bg-emerald-500";
    case "ok":    return "bg-muted-foreground";
    case "low":   return "bg-danger";
  }
}
