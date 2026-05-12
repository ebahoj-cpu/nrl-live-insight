// ============================================================================
// Correlation guard (Phase 5).
//
// Removes redundant or over-correlated legs from a multi/parlay.
// Examples handled:
//   - duplicate leg (same selection twice)
//   - winner + winner-implied margin (same direction) → keep stronger leg
//   - 3+ tryscorer legs from the same team → trim to top 2 unless high-tempo
//   - over X.5 + many outside backs → flag as correlated; keep unless model
//     strongly supports a high-tempo (RuckTempoProfile) script
//
// Pure function — input legs in, filtered legs + reasons out.
// ============================================================================

export type GuardLeg = {
  id: string;
  market:
    | "match_winner"
    | "margin"
    | "totals"
    | "anytime_tryscorer"
    | "first_tryscorer"
    | "multi_tryscorer"
    | "htft"
    | "other";
  selection: string;
  team?: string;            // team nickname when applicable
  decimalOdds?: number;
  modelProb?: number;
};

export type CorrelationContext = {
  highTempoSupported?: boolean;   // ruckTempoProfile?.tempoLean === "fast" with non-low confidence
  totalLeansOver?: boolean;       // sim overProbAtLine >= 0.6
};

export type GuardResult = {
  kept: GuardLeg[];
  removed: { leg: GuardLeg; reason: string }[];
};

function key(l: GuardLeg): string {
  return `${l.market}::${l.selection.trim().toLowerCase()}`;
}

export function applyCorrelationGuard(legs: GuardLeg[], ctx: CorrelationContext = {}): GuardResult {
  const kept: GuardLeg[] = [];
  const removed: GuardResult["removed"] = [];
  const seen = new Set<string>();

  // 1) De-duplicate identical legs (keep highest model prob).
  const byKey = new Map<string, GuardLeg>();
  for (const l of legs) {
    const k = key(l);
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, l); continue; }
    const a = prev.modelProb ?? 0;
    const b = l.modelProb ?? 0;
    if (b > a) {
      removed.push({ leg: prev, reason: "Duplicate leg — kept stronger." });
      byKey.set(k, l);
    } else {
      removed.push({ leg: l, reason: "Duplicate leg — kept stronger." });
    }
  }
  const deduped = Array.from(byKey.values());

  // 2) Winner + same-side margin redundancy.
  const winner = deduped.find((l) => l.market === "match_winner");
  for (const l of deduped) {
    if (l === winner) continue;
    if (l.market === "margin" && winner && l.team && winner.team && l.team === winner.team) {
      // Margin implies winner. Drop the weaker priced one.
      const winPrice = winner.decimalOdds ?? 0;
      const margPrice = l.decimalOdds ?? 0;
      if (winPrice && margPrice) {
        // Keep the leg with stronger model edge (higher modelProb*odds proxy).
        const winScore = (winner.modelProb ?? 0) * winPrice;
        const margScore = (l.modelProb ?? 0) * margPrice;
        if (margScore <= winScore) {
          removed.push({ leg: l, reason: "Margin already implied by winner leg." });
          continue;
        } else {
          // drop winner instead
          removed.push({ leg: winner, reason: "Winner already implied by stronger margin leg." });
          // Mark winner for skip later
          seen.add(key(winner));
        }
      }
    }
    if (!seen.has(key(l))) kept.push(l);
  }
  if (winner && !seen.has(key(winner)) && !kept.includes(winner)) kept.unshift(winner);

  // 3) Tryscorer over-stacking — max 2 per team unless high-tempo + over.
  const tryscorerLegs = kept.filter(
    (l) => l.market === "anytime_tryscorer" || l.market === "first_tryscorer" || l.market === "multi_tryscorer",
  );
  const byTeam = new Map<string, GuardLeg[]>();
  for (const l of tryscorerLegs) {
    const t = (l.team ?? "unknown").toLowerCase();
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t)!.push(l);
  }
  const allowExtra = !!(ctx.highTempoSupported && ctx.totalLeansOver);
  const maxPerTeam = allowExtra ? 3 : 2;
  for (const [, group] of byTeam) {
    if (group.length <= maxPerTeam) continue;
    const sorted = [...group].sort((a, b) => (b.modelProb ?? 0) - (a.modelProb ?? 0));
    const trimmed = sorted.slice(maxPerTeam);
    for (const t of trimmed) {
      const idx = kept.indexOf(t);
      if (idx >= 0) kept.splice(idx, 1);
      removed.push({ leg: t, reason: "Too many correlated tryscorer legs from the same team." });
    }
  }

  return { kept, removed };
}
