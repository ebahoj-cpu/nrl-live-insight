// Single source of truth for "is this player allowed to appear in our outputs?"
// Used to scrub AI hallucinations + engine fallbacks: any tryscorer or bet leg
// that names a player not on the named squad is dropped.

import type { NrlPlayer } from "./nrl";

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();
}

export type SquadIndex = {
  full: Set<string>;
  last: Set<string>;
};

export function indexSquads(home: NrlPlayer[], away: NrlPlayer[]): SquadIndex {
  const full = new Set<string>();
  const last = new Set<string>();
  for (const p of [...home, ...away]) {
    const fn = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    if (!fn) continue;
    const f = norm(fn);
    full.add(f);
    const ln = f.split(" ").pop();
    if (ln && ln.length >= 3) last.add(ln);
  }
  return { full, last };
}

// Returns true if `name` (or any token in it) appears in the named squads.
export function isInSquad(name: string, idx: SquadIndex): boolean {
  if (!name) return false;
  const n = norm(name);
  if (!n) return false;
  if (idx.full.has(n)) return true;
  // Match by last token (covers "J. Smith" / "Smith")
  const last = n.split(" ").pop();
  if (last && idx.last.has(last)) return true;
  // Match if any token in name matches a known last name (handles "Joey Manu" → "manu")
  for (const tok of n.split(" ")) {
    if (tok.length >= 3 && idx.last.has(tok)) return true;
  }
  return false;
}

// Filter a list of objects, keeping only those whose `name` is in squad.
export function filterToSquad<T extends { name: string }>(items: T[], idx: SquadIndex): T[] {
  return items.filter((it) => isInSquad(it.name, idx));
}
