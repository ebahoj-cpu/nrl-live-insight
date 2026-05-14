// ============================================================================
// Scout reasoning helpers — pure, deterministic, no I/O.
//
// Provides:
//   • parseNewsInjection(text) — best-effort extraction of a NewsModifier from
//     a free-form user line like "Broncos lose Reynolds" or "rain expected".
//   • pickTopDrivers / formatConfidence / formatValueLine / formatRiskWarning
//     — stable string builders used by the orchestrator and tests.
//   • toneScrub(text) — strips disallowed phrases ("lock", "guaranteed", "free
//     money") from any LLM output before it reaches the user, and appends the
//     responsible-betting reminder when bet suggestions are present.
// ============================================================================

import { findTeam } from "@/lib/teams";
import type { ConfidenceTier } from "../confidence";
import type { ModelDriver } from "../model-driver-explainer";
import type { NewsModifier, NewsModifierKind, ScoutBetSuggestion } from "./scout-contracts";

// ---------- News parsing --------------------------------------------------

const INJURY_PATTERNS: RegExp[] = [
  /(?<team>[A-Za-z][A-Za-z\s]+?)\s+(?:lose|losing|lost|miss|missing|without)\s+(?:starting\s+)?(?<player>[A-Za-z][\w\s'-]+)/i,
  /(?<player>[A-Za-z][\w\s'-]+)\s+(?:ruled out|out for|injured|withdrawn|scratched)\s*(?:for\s+(?<team>[A-Za-z\s]+))?/i,
];

const RETURN_PATTERN = /(?<player>[A-Za-z][\w\s'-]+)\s+(?:back|returns|cleared|named|recalled)\s*(?:for\s+(?<team>[A-Za-z\s]+))?/i;

const WEATHER_PATTERN = /\b(rain|wet|storm|downpour|wind(?:y)?|gale|heat|hot weather|humid)\b/i;

const REFEREE_PATTERN = /\b(referee|ref|whistle)\s+(?:swap|change|swapped|named)\s+(?:to\s+)?(?<name>[A-Za-z][\w\s'-]+)?/i;

function makeId(seed: string): string {
  // 8-char base36 hash — enough for dedupe within a session.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return `mod_${(h >>> 0).toString(36)}_${Date.now().toString(36).slice(-4)}`;
}

function normTeam(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return findTeam(s.trim())?.nickname;
}

export function parseNewsInjection(text: string): NewsModifier | null {
  const t = (text || "").trim();
  if (!t || t.length > 400) return null;

  // Weather first — short distinct vocabulary, low false positives.
  const wm = t.match(WEATHER_PATTERN);
  if (wm) {
    const wet = /(rain|wet|storm|downpour|humid)/i.test(wm[1]);
    const wind = /(wind|gale)/i.test(wm[1]);
    return {
      id: makeId(`weather:${wm[1]}:${t}`),
      kind: "weather" satisfies NewsModifierKind,
      description: t,
      impact: {
        tempo: wet ? -0.12 : wind ? -0.08 : -0.04,
        expectedPoints: wet ? -3 : wind ? -2 : -1,
      },
      createdAt: Date.now(),
    };
  }

  const ref = t.match(REFEREE_PATTERN);
  if (ref) {
    return {
      id: makeId(`ref:${t}`),
      kind: "official_change" satisfies NewsModifierKind,
      description: t,
      impact: { tempo: 0 },
      createdAt: Date.now(),
    };
  }

  for (const re of INJURY_PATTERNS) {
    const m = t.match(re);
    if (m && m.groups) {
      const team = normTeam(m.groups.team);
      const player = m.groups.player?.trim();
      const isHalfback = /\b(halfback|playmaker|fullback|hooker|five-?eighth)\b/i.test(t);
      return {
        id: makeId(`injury:${team ?? ""}:${player ?? ""}`),
        kind: "injury",
        team,
        description: t,
        impact: {
          attack: isHalfback ? -0.09 : -0.05,
          tempo: isHalfback ? -0.05 : -0.02,
          playerTryRate: -0.15,
          affectedPlayer: player,
        },
        createdAt: Date.now(),
      };
    }
  }

  const ret = t.match(RETURN_PATTERN);
  if (ret && ret.groups) {
    const team = normTeam(ret.groups.team);
    const player = ret.groups.player?.trim();
    return {
      id: makeId(`return:${team ?? ""}:${player ?? ""}`),
      kind: "return",
      team,
      description: t,
      impact: {
        attack: 0.04,
        playerTryRate: 0.1,
        affectedPlayer: player,
      },
      createdAt: Date.now(),
    };
  }

  return null;
}

// ---------- Driver / confidence / value formatting ------------------------

export function pickTopDrivers(drivers: ModelDriver[] | undefined, n = 3): ModelDriver[] {
  if (!drivers || drivers.length === 0) return [];
  // Existing engines emit drivers already sorted by influence; trust that and
  // de-dupe by label so we don't surface the same point twice.
  const seen = new Set<string>();
  const out: ModelDriver[] = [];
  for (const d of drivers) {
    const key = (d.label ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
    if (out.length >= n) break;
  }
  return out;
}

export function formatConfidence(tier: ConfidenceTier, reasons: string[]): string {
  const head = tier === "high" ? "High confidence"
    : tier === "medium" ? "Medium confidence"
    : "Low confidence";
  const why = reasons.filter(Boolean).slice(0, 2).join("; ");
  return why ? `${head} — ${why}.` : `${head}.`;
}

export function formatValueLine(b: ScoutBetSuggestion): string {
  const odds = b.marketOdds != null ? `@${b.marketOdds.toFixed(2)}` : "no price";
  const impl = (b.impliedProb * 100).toFixed(0);
  const model = (b.modelProb * 100).toFixed(0);
  const edge = b.edgePct.toFixed(1);
  const stake = b.recommendedStake > 0 ? ` · suggested $${b.recommendedStake.toFixed(2)} (frac. Kelly)` : "";
  return `${b.selection} ${odds} — model ${model}% vs implied ${impl}% (edge ${edge}%, ${b.confidence} conf)${stake}`;
}

export function formatRiskWarning(warnings: string[]): string {
  if (!warnings.length) return "";
  return `Risk: ${warnings.slice(0, 3).join("; ")}.`;
}

// ---------- Tone scrub ----------------------------------------------------

const FORBIDDEN = [
  /\block(?:s|ed|-in|\s+of\s+the\s+(?:day|week))?\b/gi,
  /\bguaranteed?\b/gi,
  /\bfree\s+money\b/gi,
  /\bcan'?t\s+lose\b/gi,
  /\bsure\s+thing\b/gi,
];

export function toneScrub(text: string, opts: { hasBets: boolean }): string {
  if (!text) return text;
  let out = text;
  for (const re of FORBIDDEN) out = out.replace(re, "edge");
  if (opts.hasBets && !/responsible|gamble|18\+/i.test(out)) {
    out += "\n\n_Bet within your limits — gamble responsibly (18+)._";
  }
  return out;
}
