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
import type { PlayerRanking } from "@/server/stats-leaders";
import type { SkillRating, SkillKey, EnergyTier } from "@/lib/performance-edge";
import {
  Activity, Sword, Zap, Shield, Hand, Footprints,
  Hand as HandIcon, User2, BatteryFull, BatteryLow,
  Cake, Ruler, Weight as WeightIcon, TrendingUp,
  Trophy, Flame, Target, Swords, Wind, Crosshair, ShieldCheck, Star,
  Scale,
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
          <BioCircle icon={<HandIcon className="h-5 w-5" />}    label="Handed" value="RIGHT" />
          <BioCircle icon={<Footprints className="h-5 w-5" />}  label="Footed" value="RIGHT" />

        </div>
      </div>

      {/* NRL.com leaderboard rankings */}
      <RankingBadges rankings={payload?.rankings ?? []} loading={loading} />

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

function RankingBadges({ rankings, loading }: { rankings: PlayerRanking[]; loading: boolean }) {
  if (loading && rankings.length === 0) return null;
  if (!loading && rankings.length === 0) return null;
  const sorted = [...rankings].sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  return (
    <div className="px-4 sm:px-6 pt-6">
      <section className="rounded-xl bg-surface-2/40 ring-1 ring-accent/15 p-4">
        <div className="mb-5 pb-3 border-b border-accent/20 text-center">
          <h3 className="font-display font-extrabold uppercase tracking-wider text-lg sm:text-xl whitespace-nowrap">
            Top <span className="text-accent">Leaderboards</span>
          </h3>
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-5 sm:gap-x-8">
          {sorted.map((r) => (
            <RankingBadge key={r.statId} ranking={r} />
          ))}
        </div>
      </section>
    </div>
  );
}

// Map an NRL.com leaderboard category title to a representative icon.
function iconForCategory(title: string) {
  const t = title.toLowerCase();
  if (t.includes("try")) return Trophy;
  if (t.includes("linebreak")) return Zap;
  if (t.includes("tackle break") || t.includes("bust")) return Flame;
  if (t.includes("offload")) return Hand;
  if (t.includes("run metre") || t.includes("metres")) return Wind;
  if (t.includes("post-contact") || t.includes("post contact")) return Swords;
  if (t.includes("tackle")) return ShieldCheck;
  if (t.includes("kick")) return Footprints;
  if (t.includes("goal") || t.includes("conversion")) return Crosshair;
  if (t.includes("assist")) return Target;
  if (t.includes("point")) return Star;
  if (t.includes("hit")) return Shield;
  return Trophy;
}

function RankingBadge({ ranking }: { ranking: PlayerRanking }) {
  const Icon = iconForCategory(ranking.title);
  return (
    <div className="flex flex-col items-center text-center w-20 sm:w-24">
      <Icon className="h-7 w-7 text-accent" strokeWidth={2} />
      <div className="mt-1.5 text-[9px] uppercase tracking-wider font-bold text-accent leading-tight line-clamp-2">
        Top {ranking.title}
      </div>
      <div className="mt-1 text-sm font-extrabold tabular-nums leading-none">
        #{ranking.rank}
      </div>
    </div>
  );
}

// -------------------------- Sub-components --------------------------

// -------------------------- Performance Edge --------------------------

const SKILL_ICONS: Record<SkillKey, typeof Sword> = {
  attack:      Sword,
  defence:     Shield,
  handling:    Hand,
  temperament: Scale,
};

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
  void profile;
  const formTier = edge?.form.tier ?? "Average";
  const energyT = edge?.energy.tier ?? "Moderate";
  const exp = edge?.experience ?? { tier: "EMERGING" as const, pct: 20, caps: 0, bonus: 0 };
  const EnergyIcon = energyT === "Fatigued" || energyT === "Tired" ? BatteryLow : BatteryFull;
  const skills = edge?.skills ?? PLACEHOLDER_SKILLS;

  return (
    <section className="rounded-xl bg-surface-2/40 ring-1 ring-accent/15 p-4">
      <div className="mb-5 pb-3 border-b border-accent/20 text-center">
        <h3 className="font-display font-extrabold uppercase tracking-wider text-lg sm:text-xl whitespace-nowrap">
          Performance <span className="text-accent">Edge</span>
        </h3>
      </div>

      {/* Context bars: Experience / Form / Energy */}
      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2.5 mb-5 pb-5 border-b border-accent/10">
        <Meter
          icon={<Activity className="h-3.5 w-3.5 text-accent shrink-0" />}
          label="Experience"
          valueText={loading ? "…" : `${exp.tier} · ${exp.caps} caps`}
          pct={exp.pct}
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
      </ul>

      {/* Four core skills, scored 0-100 */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        {skills.map((s) => {
          const Icon = SKILL_ICONS[s.key];
          const isTemperament = s.key === "temperament";
          return (
            <SkillMeter
              key={s.key}
              icon={<Icon className={`h-4 w-4 shrink-0 ${isTemperament ? "text-amber-400" : "text-accent"}`} />}
              label={s.label}
              score={loading ? 0 : s.final}
              tone={s.tone}
              prominent={isTemperament}
              loading={loading}
            />
          );
        })}
      </ul>
    </section>
  );
}

function SkillMeter({ icon, label, score, tone, prominent, loading }: {
  icon: ReactNode; label: string; score: number; tone: SkillRating["tone"];
  prominent?: boolean; loading?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, score));
  const barColor = prominent ? "bg-amber-400" : toneBgClass(tone);
  return (
    <li
      className={`flex items-center gap-2.5 ${
        prominent ? "rounded-lg ring-1 ring-amber-400/40 bg-amber-400/5 p-2 -m-2 sm:col-span-2" : ""
      }`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1">
          <span
            className={`uppercase tracking-wider font-bold ${
              prominent ? "text-[12px] text-amber-300" : "text-[11px]"
            }`}
          >
            {label}
          </span>
          <span
            className={`tabular-nums font-extrabold ${
              prominent ? "text-base text-amber-300" : `text-sm ${toneClass(tone)}`
            }`}
          >
            {loading ? "…" : `${pct}`}
            <span className="text-[10px] text-muted-foreground font-semibold ml-0.5">/100</span>
          </span>
        </div>
        <div className={`relative w-full overflow-hidden rounded-full bg-surface-2 ${prominent ? "h-2.5" : "h-2"}`}>
          <div
            className={`h-full ${barColor} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </li>
  );
}

const PLACEHOLDER_SKILLS: SkillRating[] = [
  { key: "attack",      label: "Attack",      base: 0, final: 0, word: "—", tone: "ok" },
  { key: "defence",     label: "Defence",     base: 0, final: 0, word: "—", tone: "ok" },
  { key: "handling",    label: "Handling",    base: 0, final: 0, word: "—", tone: "ok" },
  { key: "temperament", label: "Temperament", base: 0, final: 0, word: "—", tone: "ok" },
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
