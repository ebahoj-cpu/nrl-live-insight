// ============================================================================
// Refresh schedule helper (Phase 5).
//
// Declarative list of recommended refresh jobs. Surfaced via a dev/admin
// endpoint so operators (or a future pg_cron migration) can configure
// schedules from one source of truth.
//
// Pure data — no secrets, no live HTTP calls.
// ============================================================================

export type ScheduleJob = {
  name: string;
  mode: string;                          // refresh-nrl-data ?mode=...
  hookPath: string;                      // path under /api/public/hooks/
  cadence: string;                       // human-readable cadence
  cronExpression: string;                // standard cron
  whenToRun: string;
  priority: "high" | "medium" | "low";
  reason: string;
};

const REFRESH_HOOK = "/api/public/hooks/refresh-nrl-data";
const PRECOMPUTE_HOOK = "/api/public/hooks/precompute-insights";
const ODDS_HOOK = "/api/public/hooks/refresh-odds";

export const REFRESH_SCHEDULE: ScheduleJob[] = [
  {
    name: "fixtures-current-round",
    mode: "fixtures",
    hookPath: `${REFRESH_HOOK}?mode=fixtures`,
    cadence: "Every 6 hours",
    cronExpression: "0 */6 * * *",
    whenToRun: "Throughout the week to catch fixture changes.",
    priority: "high",
    reason: "Draw can change (venue swaps, time changes).",
  },
  {
    name: "ladder",
    mode: "ladder",
    hookPath: `${REFRESH_HOOK}?mode=ladder`,
    cadence: "Daily at 04:00 UTC",
    cronExpression: "0 4 * * *",
    whenToRun: "After all fixtures from a round have completed.",
    priority: "medium",
    reason: "Ladder updates are slow-moving; daily is enough.",
  },
  {
    name: "team-lists",
    mode: "teamlists",
    hookPath: `${REFRESH_HOOK}?mode=teamlists`,
    cadence: "Tuesday 04:00 + match day every 2 hours",
    cronExpression: "0 */2 * * 4-6,0",
    whenToRun: "Tuesday 4pm AEST team-list drop, then frequently match day.",
    priority: "high",
    reason: "Squad changes are highest-impact data update.",
  },
  {
    name: "injuries",
    mode: "injuries",
    hookPath: `${REFRESH_HOOK}?mode=injuries`,
    cadence: "Every 2 hours match week",
    cronExpression: "0 */2 * * *",
    whenToRun: "Throughout the match week to capture late mail.",
    priority: "high",
    reason: "Late mail directly changes win probability.",
  },
  {
    name: "officials",
    mode: "officials",
    hookPath: `${REFRESH_HOOK}?mode=officials`,
    cadence: "Wednesday + Friday morning",
    cronExpression: "0 22 * * 2,4",
    whenToRun: "After NRL announces refs (mid-week + game day).",
    priority: "medium",
    reason: "Referee profile feeds totals/sin-bin tendencies.",
  },
  {
    name: "team-stats",
    mode: "teamstats",
    hookPath: `${REFRESH_HOOK}?mode=teamstats`,
    cadence: "Daily 05:00 UTC",
    cronExpression: "0 5 * * *",
    whenToRun: "After ladder + match results settle.",
    priority: "medium",
    reason: "Season stats power the simulation feature builder.",
  },
  {
    name: "player-stats",
    mode: "playerstats",
    hookPath: `${REFRESH_HOOK}?mode=playerstats`,
    cadence: "Daily 05:30 UTC",
    cronExpression: "30 5 * * *",
    whenToRun: "After team-stats refresh.",
    priority: "medium",
    reason: "Player ratings drive tryscorer + edge attack models.",
  },
  {
    name: "historical-matches",
    mode: "historical",
    hookPath: `${REFRESH_HOOK}?mode=historical`,
    cadence: "Weekly Monday 06:00 UTC",
    cronExpression: "0 6 * * 1",
    whenToRun: "Once per round — feeds head-to-head model.",
    priority: "low",
    reason: "Historical data is slow-changing.",
  },
  {
    name: "odds",
    mode: "odds",
    hookPath: ODDS_HOOK,
    cadence: "Every 15 minutes match week",
    cronExpression: "*/15 * * * *",
    whenToRun: "While markets are live and moving.",
    priority: "high",
    reason: "Calibration + value picks rely on fresh odds.",
  },
  {
    name: "precompute-insights",
    mode: "precompute",
    hookPath: PRECOMPUTE_HOOK,
    cadence: "Hourly Tue–Sun",
    cronExpression: "5 * * * 2-7",
    whenToRun: "Warms enriched bundle, runs simulation, persists summaries.",
    priority: "high",
    reason: "Pre-warms cache so user-facing reads are instant.",
  },
];

export function getRefreshSchedule(): ScheduleJob[] {
  return REFRESH_SCHEDULE;
}
