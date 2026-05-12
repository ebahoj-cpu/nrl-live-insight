// ============================================================================
// Driver surfacing helpers (Phase 5).
//
// Produces short, audience-safe strings to lightly fold into existing
// reasoning fields (Insights / Script / Bets). No source attribution, no
// "simulation says…" phrasing.
// ============================================================================

import type { ModelDriver } from "./model-driver-explainer";

const STRENGTH_RANK: Record<ModelDriver["strength"], number> = {
  strong: 3, medium: 2, small: 1,
};

function score(d: ModelDriver): number {
  let s = STRENGTH_RANK[d.strength] ?? 0;
  if (d.direction !== "neutral") s += 0.5;
  return s;
}

export function topDrivers(drivers: ModelDriver[] | undefined | null, n = 2): ModelDriver[] {
  if (!Array.isArray(drivers) || drivers.length === 0) return [];
  return [...drivers].sort((a, b) => score(b) - score(a)).slice(0, n);
}

export function driverPhrase(d: ModelDriver): string {
  const note = (d.note ?? "").trim().replace(/\.$/, "");
  if (!note) return d.label;
  return `${d.label.toLowerCase()}: ${note}`;
}

// Append top driver phrases into an existing reasoning string. Keeps it
// short (≤ ~40 extra chars per driver) and never creates new sentences if
// the source string already contains the same label.
export function appendDriverHint(reasoning: string, drivers: ModelDriver[] | undefined | null, n = 1): string {
  const top = topDrivers(drivers, n).filter((d) => d.strength !== "small");
  if (top.length === 0) return reasoning;
  const phrases = top
    .map(driverPhrase)
    .filter((p) => !reasoning.toLowerCase().includes(p.split(":")[0].toLowerCase()));
  if (phrases.length === 0) return reasoning;
  const sep = reasoning.trim().endsWith(".") ? " " : ". ";
  return `${reasoning}${sep}Key drivers — ${phrases.join("; ")}.`;
}
