// Source-coverage helpers.
//
// Tracks which data sources contributed to each normalised payload, what
// fields are missing, and how that should affect downstream confidence.

import type { DataSource, SourceCoverage } from "./nrl-data-types";

export function makeCoverage(args: {
  primary: DataSource;
  sourcesUsed?: DataSource[];
  missingFields?: string[];
  lastUpdated?: string;
  notes?: string[];
}): SourceCoverage {
  const c: SourceCoverage = {
    primary: args.primary,
    sourcesUsed: args.sourcesUsed?.length ? args.sourcesUsed : [args.primary],
    missingFields: args.missingFields ?? [],
    lastUpdated: args.lastUpdated ?? new Date().toISOString(),
  };
  if (args.notes?.length) (c as SourceCoverage & { notes: string[] }).notes = args.notes;
  return c;
}

// Append a note (e.g. a discrepancy) without throwing on missing array.
export function addNote(c: SourceCoverage, note: string): SourceCoverage {
  const x = c as SourceCoverage & { notes?: string[] };
  const notes = x.notes ? [...x.notes, note] : [note];
  return { ...c, ...({ notes } as { notes: string[] }) };
}

// Convenience: add a "conflict: ..." note when sources disagree on a field.
export function withConflictNote(c: SourceCoverage, field: string, primaryVal: unknown, otherVal: unknown): SourceCoverage {
  return addNote(c, `conflict:${field} primary=${String(primaryVal)} other=${String(otherVal)}`);
}

// Merge two coverage records, preferring the higher-priority source as primary
// (NRL.com > Zyla > merged > cache > fallback).
const SOURCE_RANK: Record<DataSource, number> = {
  "nrl.com": 5,
  zyla: 4,
  merged: 3,
  cache: 2,
  fallback: 1,
};

export function mergeCoverage(a: SourceCoverage, b: SourceCoverage): SourceCoverage {
  const primary = SOURCE_RANK[a.primary] >= SOURCE_RANK[b.primary] ? a.primary : b.primary;
  const used = Array.from(new Set([...a.sourcesUsed, ...b.sourcesUsed]));
  // A field is only missing if BOTH sources failed to provide it.
  const aMissing = new Set(a.missingFields);
  const missing = b.missingFields.filter((f) => aMissing.has(f));
  const lastUpdated = a.lastUpdated > b.lastUpdated ? a.lastUpdated : b.lastUpdated;
  return { primary, sourcesUsed: used, missingFields: missing, lastUpdated };
}

// Score the quality of a coverage record on a 0..100 scale. Used as the raw
// input to the confidence system (which then maps to low/medium/high).
export function coverageScore(c: SourceCoverage): number {
  let score = 50;
  // Primary source quality
  score += (SOURCE_RANK[c.primary] - 1) * 10; // 0..40
  // Missing fields penalty (capped at -30)
  score -= Math.min(30, c.missingFields.length * 5);
  // Freshness: -20 if >24h, -10 if >6h, 0 otherwise
  const ageMs = Date.now() - Date.parse(c.lastUpdated || new Date().toISOString());
  if (ageMs > 24 * 60 * 60_000) score -= 20;
  else if (ageMs > 6 * 60 * 60_000) score -= 10;
  return Math.max(0, Math.min(100, score));
}
