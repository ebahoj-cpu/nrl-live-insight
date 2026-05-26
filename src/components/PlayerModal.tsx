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
      {/* Hero block: large image + identity */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-6">
        <div className="relative w-full rounded-2xl bg-gradient-to-b from-accent/20 via-surface to-surface-2 ring-1 ring-accent/30 overflow-hidden">
          <div className="flex justify-center items-end h-64 sm:h-80">
            {heroImg ? (
              <img
                src={heroImg}
                alt={fullName}
                loading="eager"
                className="h-full w-auto object-contain object-bottom drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <User2 className="h-24 w-24 text-muted-foreground/40" />
            )}
          </div>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-accent/20 bg-surface/60 backdrop-blur">
            <TeamLogo themeKey={args.teamThemeKey} name={args.teamNickname} size={40} light />
            <div className="min-w-0 flex-1">
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
        </div>
      </div>

      {/* Bio circles: Age | Height | Weight  /  Hand | Foot */}
      <div className="px-4 sm:px-6 pt-5">
        <div className="flex flex-wrap justify-center gap-3 sm:gap-4 max-w-md sm:max-w-none mx-auto">
          <BioCircle icon={<Cake className="h-5 w-5" />}        label="Age"    value={profile?.age != null ? String(profile.age) : "—"} />
          <BioCircle icon={<Ruler className="h-5 w-5" />}       label="Height" value={profile?.heightCm ? `${profile.heightCm}` : "—"} unit={profile?.heightCm ? "cm" : undefined} />
          <BioCircle icon={<WeightIcon className="h-5 w-5" />}  label="Weight" value={profile?.weightKg ? `${profile.weightKg}` : "—"} unit={profile?.weightKg ? "kg" : undefined} />
          <BioCircle icon={<HandIcon className="h-5 w-5" />}    label="Hand"   value="R" />
          <BioCircle icon={<Footprints className="h-5 w-5" />}  label="Foot"   value="R" />
        </div>
      </div>

      {/* Performance Edge */}
      <div className="px-4 sm:px-6 pt-6 pb-6">
        <PerformanceEdgeSection edge={edge} loading={loading} profile={profile} />
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

function BioCircle({ icon, label, value, unit }: { icon: ReactNode; label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-20 w-20 sm:h-24 sm:w-24 rounded-full border-2 border-accent/50 bg-surface-2/50 flex flex-col items-center justify-center px-2 py-2.5">
        <div className="text-accent flex items-center justify-center mb-1.5">{icon}</div>
        <div className="text-xs sm:text-sm font-extrabold leading-none text-center">
          {value}{unit && <span className="text-[9px] text-muted-foreground ml-0.5">{unit}</span>}
        </div>
      </div>
      <span className="text-[10px] sm:text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

// -------------------------- Sub-components --------------------------

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

type PE = import("@/lib/performance-edge").PerformanceEdge;
type Profile = import("@/server/player-profile").PlayerProfile;

const ENERGY_FILL: Record<EnergyTier, number> = {
  Supercharged: 100, High: 80, Moderate: 60, Tired: 40, Fatigued: 20,
};
const FORM_FILL: Record<PE["form"]["tier"], number> = {
  "Red Hot": 100, "Good Form": 80, "Average": 60, "Below Average": 40, "Cold": 20,
};
const FORM_TONE: Record<PE["form"]["tier"], SkillRating["tone"]> = {
  "Red Hot": "great", "Good Form": "good", "Average": "ok", "Below Average": "low", "Cold": "low",
};
const ENERGY_TONE: Record<EnergyTier, SkillRating["tone"]> = {
  Supercharged: "great", High: "good", Moderate: "ok", Tired: "low", Fatigued: "low",
};

function PerformanceEdgeSection({ edge, loading, profile }: {
  edge: PE | null | undefined; loading: boolean; profile: Profile | null | undefined;
}) {
  const formTier = edge?.form.tier ?? "Average";
  const energyT = edge?.energy.tier ?? "Moderate";
  const caps = profile?.careerAppearances ?? 0;
  const expPct = Math.max(5, Math.min(100, (caps / 250) * 100));
  const EnergyIcon = energyT === "Fatigued" || energyT === "Tired" ? BatteryLow : BatteryFull;

  return (
    <section className="rounded-xl bg-surface-2/40 ring-1 ring-accent/15 p-4">
      <div className="mb-5 pb-3 border-b border-accent/20">
        <h3 className="font-display font-extrabold uppercase tracking-wider text-lg sm:text-xl whitespace-nowrap">
          Performance <span className="text-accent">Edge</span>
        </h3>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
        <Meter
          icon={<Activity className="h-3.5 w-3.5 text-accent shrink-0" />}
          label="Experience"
          valueText={`${caps} caps`}
          pct={expPct}
          tone="ok"
        />
        <Meter
          icon={<TrendingUp className="h-3.5 w-3.5 text-accent shrink-0" />}
          label="Form"
          valueText={loading ? "…" : formTier}
          pct={FORM_FILL[formTier]}
          tone={FORM_TONE[formTier]}
        />
        <Meter
          icon={<EnergyIcon className="h-3.5 w-3.5 text-accent shrink-0" />}
          label="Energy"
          valueText={loading ? "…" : energyT}
          pct={ENERGY_FILL[energyT]}
          tone={ENERGY_TONE[energyT]}
        />
        {(edge?.skills ?? PLACEHOLDER_SKILLS).map((s) => {
          const Icon = SKILL_ICONS[s.key];
          return (
            <Meter
              key={s.key}
              icon={<Icon className="h-3.5 w-3.5 text-accent shrink-0" />}
              label={s.label}
              valueText={loading ? "…" : s.word}
              pct={s.final}
              tone={s.tone}
            />
          );
        })}
      </ul>
    </section>
  );
}

function Meter({ icon, label, valueText, pct, tone }: {
  icon: ReactNode; label: string; valueText: string; pct: number; tone: SkillRating["tone"];
}) {
  return (
    <li className="flex items-center gap-2">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-[11px] mb-0.5">
          <span className="font-bold uppercase tracking-wider">{label}</span>
          <span className={`font-bold ${toneClass(tone)}`}>{valueText}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
          <div className={`h-full transition-all ${toneBgClass(tone)}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </li>
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
