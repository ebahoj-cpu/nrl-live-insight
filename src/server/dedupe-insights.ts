// Anti-repetition layer: removes paraphrased duplicates from AI insights so
// the user only sees the strongest version of each idea. Runs after the AI
// returns, before applyRealOdds / normaliseBetMath.
//
// Strategy: token-set Jaccard similarity on normalised strings. Anything
// scoring >= THRESHOLD against an already-kept string is dropped. Order
// matters — earlier (more "primary") sections win over later ones.

import type { Insights } from "./ai-insights";

const SIM_THRESHOLD = 0.55; // tuned: catches paraphrases, keeps genuinely different points

const STOP = new Set([
  "the","a","an","and","or","but","of","to","in","on","at","for","with","by",
  "is","are","was","were","be","been","being","this","that","these","those",
  "it","its","their","they","them","there","then","than","as","so","if","when",
  "into","from","over","under","up","down","out","off","not","no","do","does",
  "did","has","have","had","will","would","could","should","can","may","might",
  "team","game","match","side","play","plays","player","players","one","two",
  "three","first","second","time","point","points","try","tries","really","very",
  "more","most","less","least","also","just","like","get","gets","got","make",
  "makes","made","good","strong","big","key","need","needs","look","looks",
]);

function tokens(s: string): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Filter an array, keeping only items whose normalised text is sufficiently
// different from already-kept items AND from the running "seen" pool from
// other sections (cross-section dedup).
function filterUnique<T>(
  items: T[] | undefined,
  text: (item: T) => string,
  seen: Set<string>[],
  threshold = SIM_THRESHOLD,
): T[] {
  if (!Array.isArray(items)) return items ?? [];
  const kept: T[] = [];
  const keptTokens: Set<string>[] = [];
  for (const item of items) {
    const t = tokens(text(item));
    if (t.size === 0) continue;
    let dup = false;
    for (const prev of keptTokens) {
      if (jaccard(t, prev) >= threshold) { dup = true; break; }
    }
    if (!dup) {
      for (const prev of seen) {
        if (jaccard(t, prev) >= threshold) { dup = true; break; }
      }
    }
    if (!dup) {
      kept.push(item);
      keptTokens.push(t);
    }
  }
  // promote kept tokens into the global seen pool so later sections see them
  for (const k of keptTokens) seen.push(k);
  return kept;
}

export function dedupeInsights(ins: Insights): Insights {
  // Global pool of token-sets for everything we've already shown the user.
  // Order = priority. xFactor / weaknessExploit feed in early so generic
  // restatements in keysToVictory / keyFactors get pruned.
  const seen: Set<string>[] = [];

  // Seed with the highest-signal narrative items first
  if (ins.script?.xFactor) seen.push(tokens(ins.script.xFactor));
  if (ins.script?.headToHead) seen.push(tokens(ins.script.headToHead));
  if (ins.script?.formAnalysis) seen.push(tokens(ins.script.formAnalysis));

  if (ins.weaknessExploit?.home) {
    const h = ins.weaknessExploit.home;
    h.opponentWeaknesses = filterUnique(h.opponentWeaknesses, (s) => s, seen);
    h.targetAreas = filterUnique(h.targetAreas, (s) => s, seen);
    if (h.tacticalPlan) seen.push(tokens(h.tacticalPlan));
    h.playersToWatch = filterUnique(h.playersToWatch, (p) => `${p.name} ${p.role} ${p.why}`, seen);
  }
  if (ins.weaknessExploit?.away) {
    const a = ins.weaknessExploit.away;
    a.opponentWeaknesses = filterUnique(a.opponentWeaknesses, (s) => s, seen);
    a.targetAreas = filterUnique(a.targetAreas, (s) => s, seen);
    if (a.tacticalPlan) seen.push(tokens(a.tacticalPlan));
    a.playersToWatch = filterUnique(a.playersToWatch, (p) => `${p.name} ${p.role} ${p.why}`, seen);
  }

  // Mirror-image guard for tactical plans: if the two team plans are too
  // similar (just team names swapped), drop the weaker (away) one's overlap.
  if (ins.weaknessExploit?.home?.tacticalPlan && ins.weaknessExploit?.away?.tacticalPlan) {
    const ht = tokens(ins.weaknessExploit.home.tacticalPlan);
    const at = tokens(ins.weaknessExploit.away.tacticalPlan);
    if (jaccard(ht, at) >= 0.7) {
      // Too similar — flag the away plan with a marker so it's regenerated
      // on next refresh. We don't blank it (UI would break), but we trim it.
      ins.weaknessExploit.away.tacticalPlan = ins.weaknessExploit.away.tacticalPlan
        .split(/\.\s+/).slice(0, 1).join(". ") + ".";
    }
  }

  // Keys to victory: dedupe within each team AND vs opposite team's keys
  // (mirror guard) AND vs the global seen pool.
  if (ins.keysToVictory?.home) {
    ins.keysToVictory.home = filterUnique(ins.keysToVictory.home, (s) => s, seen, 0.5);
  }
  if (ins.keysToVictory?.away) {
    ins.keysToVictory.away = filterUnique(ins.keysToVictory.away, (s) => s, seen, 0.5);
  }

  // Key factors: most aggressive prune — only the truly novel ones survive
  if (ins.keyFactors) {
    ins.keyFactors = filterUnique(ins.keyFactors, (s) => s, seen, 0.45);
  }

  // Game flow momentum swings — dedupe against each other only (they're
  // pinned to time windows so cross-section overlap is expected).
  if (ins.gameFlow?.momentumSwings) {
    const localSeen: Set<string>[] = [];
    ins.gameFlow.momentumSwings = filterUnique(ins.gameFlow.momentumSwings, (s) => s, localSeen);
  }

  // Tryscorer reasoning per team — dedupe within team only
  if (ins.tryscorerScript?.home?.picks) {
    const localSeen: Set<string>[] = [];
    ins.tryscorerScript.home.picks = filterUnique(
      ins.tryscorerScript.home.picks,
      (p) => `${p.name} ${p.reasoning}`,
      localSeen,
      0.6,
    );
  }
  if (ins.tryscorerScript?.away?.picks) {
    const localSeen: Set<string>[] = [];
    ins.tryscorerScript.away.picks = filterUnique(
      ins.tryscorerScript.away.picks,
      (p) => `${p.name} ${p.reasoning}`,
      localSeen,
      0.6,
    );
  }

  // Anytime tryscorer narrative bullets — dedupe within
  if (ins.anytimeTryscorers) {
    const localSeen: Set<string>[] = [];
    ins.anytimeTryscorers = filterUnique(
      ins.anytimeTryscorers,
      (a) => `${a.pick} ${a.reasoning}`,
      localSeen,
      0.6,
    );
  }

  // Bet reasoning — dedupe ONLY against other bet reasonings (each bet is a
  // distinct market, so cross-pool dedup would over-prune).
  if (Array.isArray(ins.bets)) {
    const localSeen: Set<string>[] = [];
    const kept: typeof ins.bets = [];
    for (const bet of ins.bets) {
      const t = tokens(bet.reasoning ?? "");
      let dup = false;
      for (const prev of localSeen) {
        if (jaccard(t, prev) >= 0.7) { dup = true; break; }
      }
      // Always keep — bets must all render — but if reasoning duplicates,
      // shorten it to its first sentence so the user isn't reading the same
      // paragraph 10 times.
      if (dup && bet.reasoning) {
        bet.reasoning = bet.reasoning.split(/\.\s+/).slice(0, 1).join(". ") + ".";
      }
      if (t.size > 0) localSeen.push(t);
      kept.push(bet);
    }
    ins.bets = kept;
  }

  return ins;
}
