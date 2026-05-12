// Public model health summary endpoint (Phase 5).
// Read-only, no secrets, no raw payloads.

import { createFileRoute } from "@tanstack/react-router";
import { buildModelHealthSummary } from "@/server/model-health";
import { getRefreshSchedule } from "@/server/refresh-schedule";

export const Route = createFileRoute("/api/public/hooks/model-health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const windowHours = Math.max(1, Math.min(168, Number(url.searchParams.get("windowHours")) || 24));
        const includeSchedule = url.searchParams.get("schedule") === "1";
        const summary = await buildModelHealthSummary(windowHours);
        const body: Record<string, unknown> = { health: summary };
        if (includeSchedule) body.schedule = getRefreshSchedule();
        return new Response(JSON.stringify(body, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
