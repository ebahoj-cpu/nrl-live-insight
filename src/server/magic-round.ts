// Magic Round venue adjustment.
//
// During Magic Round every match is played at Suncorp Stadium in Brisbane.
// The nominal "home" team designation barely matters — the crowd, travel and
// climate edge instead flow to the Queensland-based clubs. We model that with
// a per-team Brisbane boost and recompute the effective home advantage so
// downstream predictors (logistic regression, Monte Carlo, deterministic
// rating) reflect the true on-ground edge.

const QLD_BOOST: Record<string, number> = {
  // Brisbane locals — Suncorp is their actual home ground.
  broncos: 3,
  dolphins: 3,
  // Other Queensland clubs — short travel, partisan QLD crowd.
  titans: 1.5,
  cowboys: 1.5,
};

export function qldBoost(nickname: string | undefined): number {
  if (!nickname) return 0;
  return QLD_BOOST[nickname.toLowerCase()] ?? 0;
}

export function isMagicRoundVenue(venue: string | null | undefined): boolean {
  if (!venue) return false;
  const v = venue.toLowerCase();
  return v.includes("suncorp") || v.includes("magic round");
}

// Returns the effective home-advantage value (in expected points) for a
// Magic Round fixture, or null when the venue is not Suncorp Stadium and
// callers should keep their default home-advantage logic.
//
// Baseline of 1 retained for the nominal home side (kit, kick direction,
// dressing-room familiarity), then layered with the QLD differential.
export function magicRoundHomeAdvantage(
  homeNickname: string,
  awayNickname: string,
  venue: string | null | undefined,
): number | null {
  if (!isMagicRoundVenue(venue)) return null;
  return 1 + qldBoost(homeNickname) - qldBoost(awayNickname);
}
