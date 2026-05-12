// ============================================================================
// Model health (Phase 5).
//
// Produces safe summaries of recent simulation activity for admin/dev surfaces.
// Never returns raw payloads, secrets, or PII.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ConfidenceDistribution = { low: number; medium: number; high: number };

export type ModelHealthSummary = {
  generatedAt: string;
  windowHours: number;
  // Counts
  simulationsGenerated: number;
  simulationsFallback: number;          // rows where confidence was "low"
  withCalibration: number;
  withModelDrivers: number;
  // Distributions
  confidenceDistribution: ConfidenceDistribution;
  advancedModelVersions: Record<string, number>;
  // Coverage stats
  averageMissingFields: number;
  sourceCoverageBuckets: { full: number; partial: number; minimal: number };
  // Last activity
  lastGeneratedAt: string | null;
  // Errors observed in window (best-effort, optional)
  recentErrors: number;
};

type RawRow = {
  confidence?: string | null;
  generated_at?: string | null;
  advanced_model_version?: string | null;
  calibration?: unknown;
  model_drivers?: unknown;
  source_coverage?: Record<string, unknown> | null;
};

function bucketCoverage(coverage: Record<string, unknown> | null | undefined): "full" | "partial" | "minimal" {
  if (!coverage || typeof coverage !== "object") return "minimal";
  const present = Object.values(coverage).filter((v) => v === true || (typeof v === "object" && v !== null)).length;
  if (present >= 6) return "full";
  if (present >= 3) return "partial";
  return "minimal";
}

function countMissingFields(coverage: Record<string, unknown> | null | undefined): number {
  if (!coverage || typeof coverage !== "object") return 0;
  return Object.values(coverage).filter((v) => v === false || v == null).length;
}

export async function buildModelHealthSummary(windowHours = 24): Promise<ModelHealthSummary> {
  const since = new Date(Date.now() - windowHours * 60 * 60_000).toISOString();
  const empty: ModelHealthSummary = {
    generatedAt: new Date().toISOString(),
    windowHours,
    simulationsGenerated: 0,
    simulationsFallback: 0,
    withCalibration: 0,
    withModelDrivers: 0,
    confidenceDistribution: { low: 0, medium: 0, high: 0 },
    advancedModelVersions: {},
    averageMissingFields: 0,
    sourceCoverageBuckets: { full: 0, partial: 0, minimal: 0 },
    lastGeneratedAt: null,
    recentErrors: 0,
  };

  try {
    const { data, error } = await supabaseAdmin
      .from("simulation_summaries" as never)
      .select(
        "confidence, generated_at, advanced_model_version, calibration, model_drivers, source_coverage" as never,
      )
      .gte("generated_at" as never, since as never)
      .order("generated_at" as never, { ascending: false } as never)
      .limit(2000);
    if (error || !data) return empty;
    const rows = data as unknown as RawRow[];
    const out: ModelHealthSummary = { ...empty };
    out.simulationsGenerated = rows.length;
    let missing = 0;
    let lastTs: string | null = null;
    for (const r of rows) {
      const c = (r.confidence as "low" | "medium" | "high") ?? "low";
      if (c === "low" || c === "medium" || c === "high") out.confidenceDistribution[c] += 1;
      if (c === "low") out.simulationsFallback += 1;
      if (r.calibration) out.withCalibration += 1;
      if (Array.isArray(r.model_drivers) && r.model_drivers.length > 0) out.withModelDrivers += 1;
      const v = r.advanced_model_version ?? "unversioned";
      out.advancedModelVersions[v] = (out.advancedModelVersions[v] ?? 0) + 1;
      out.sourceCoverageBuckets[bucketCoverage(r.source_coverage)] += 1;
      missing += countMissingFields(r.source_coverage);
      if (r.generated_at && (!lastTs || r.generated_at > lastTs)) lastTs = r.generated_at;
    }
    out.averageMissingFields = rows.length ? Math.round((missing / rows.length) * 100) / 100 : 0;
    out.lastGeneratedAt = lastTs;
    return out;
  } catch (e) {
    console.warn("[model-health] summary failed:", e);
    return empty;
  }
}
