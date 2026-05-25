# LINEBREAK — NRL Live Insight

AI-powered NRL prediction, insights and betting companion. LINEBREAK pulls live
fixtures, lineups, odds and form data, runs them through a multi-model
simulation pipeline, and surfaces actionable pre-match insights, value bets and
after-match accuracy reviews.

> Built on TanStack Start + React 19, powered by Lovable Cloud (Supabase) and
> deployed to the Cloudflare edge.

---

## Features

- **Live fixtures & match pages** — round-by-round NRL fixtures with team
  logos, kickoff times, venue and broadcast info.
- **AI Match Insights** — pre-match projections (score, winner, margin, first
  try scorer, half-time/full-time doubles) generated from an ensemble of
  predictive models.
- **Sealed prediction snapshots** — once a match kicks off, its insights are
  locked immutably so historical predictions stay honest.
- **Aftermatch review** — automatic accuracy scoring of locked predictions
  against the final NRL.com result.
- **Scout assistant** — conversational AI that grounds answers in real lineups,
  odds and team news.
- **Value bets engine** — fair-odds modelling, staking, correlation guards and
  edge detection across head-to-head, line, totals and try-scorer markets.
- **Ladder & projected ladder** — current standings plus season-end
  projections.
- **News, rulings and injury impacts** — surfaced and tagged per fixture.

## Tech stack

- **Framework**: [TanStack Start](https://tanstack.com/start) v1 (SSR + server functions)
- **UI**: React 19, Tailwind CSS v4, Radix UI, shadcn-style components
- **Data**: TanStack Query, TanStack Router file-based routes
- **Backend**: Lovable Cloud (Supabase — Postgres, Auth, Storage, RLS)
- **Build**: Vite 7
- **Runtime**: Cloudflare Workers (edge) via `@cloudflare/vite-plugin`
- **AI**: Lovable AI Gateway (Gemini, GPT-5 family)
- **Tooling**: TypeScript (strict), ESLint, Prettier, Vitest, Bun

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- A Lovable Cloud / Supabase project (URL + publishable anon key)

### Install

```bash
bun install
```

### Configure environment

```bash
cp .env.example .env
# then edit .env with your Supabase project URL + publishable key
```

See [Environment variables](#environment-variables) below.

### Run locally

```bash
bun dev
```

The app boots on the default Vite port. Server functions, SSR and route
generation all run through the same dev server.

### Other scripts

```bash
bun run build       # production build (Cloudflare Worker target)
bun run build:dev   # development-mode build with prerender
bun run preview     # preview a production build locally
bun run lint        # ESLint
bun run format      # Prettier
bunx vitest run     # run the test suite
```

## Environment variables

All variables are documented in [`.env.example`](./.env.example). Quick
reference:

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | server | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | server | Anon/publishable key |
| `VITE_SUPABASE_URL` | client | Same URL, bundled into the client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client | Same key, bundled into the client |
| `VITE_SUPABASE_PROJECT_ID` | client | Supabase project ref |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Admin client (bypasses RLS — keep secret) |

Never commit `.env`. Only `.env.example` is tracked.

## Project structure

```
src/
  routes/           File-based TanStack routes (pages + /api server routes)
  components/       Reusable UI (shadcn-style)
  server/           Server functions, models, simulation, caching
  integrations/     Supabase client wiring (auto-generated — do not edit)
  lib/              Shared utilities
supabase/
  migrations/       SQL migrations applied to Lovable Cloud
```

## Deployment

The app targets Cloudflare's edge runtime through `@cloudflare/vite-plugin`.

### Cloudflare Pages / Workers

1. `bun run build` produces a Worker bundle in `dist/`.
2. Deploy via `wrangler deploy` (see `wrangler.jsonc`) or connect the repo to
   Cloudflare Pages and use `bun run build` as the build command.
3. Set the environment variables from `.env.example` in your Cloudflare
   project settings.

### Lovable

This project is also deployable directly from
[Lovable](https://lovable.dev) — frontend changes ship on **Publish**, while
server functions and Supabase migrations deploy automatically.

## Screenshots

_Coming soon._

<!--
![Fixtures](./docs/screenshots/fixtures.png)
![Match insights](./docs/screenshots/insights.png)
![Scout](./docs/screenshots/scout.png)
-->

## Contributing

Issues and pull requests are welcome. Before submitting a PR:

1. Run `bun run lint` and `bunx vitest run`.
2. Keep changes scoped — UI changes shouldn't touch backend logic and vice versa.
3. Don't edit auto-generated files (`src/routeTree.gen.ts`,
   `src/integrations/supabase/*`).

## License

MIT © LINEBREAK contributors. See [LICENSE](./LICENSE) for details.
