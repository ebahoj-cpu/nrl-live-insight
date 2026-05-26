// Client-safe player slug helper. Mirrors NRL.com's URL pattern so we can
// generate links to the player profile route without importing anything from
// `src/server/*` (which is blocked from client bundles by the template's
// import protection).
export function playerSlug(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/['’`.]/g, "")           // strip apostrophes / dots
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}
