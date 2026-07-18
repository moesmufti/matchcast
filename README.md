# MatchCast

Live match prediction dashboard for the FIFA World Cup third-place match — **France vs England**, 18 July 2026, 23:00 (Europe/Amsterdam), Miami. Renders live win probabilities, a probability-history chart, a model snapshot, and an event feed, driven by a deterministic prediction engine over either a **real live feed** (football-data.org, proxied through the Worker) or a realistic client-side simulation.

> All numbers are **model estimates** for entertainment — not betting advice.

## Architecture

```
worker/index.ts                  Hono app on Cloudflare Workers — serves /api/*,
                                 static assets via the Workers assets binding.
                                 Proxies football-data.org (v4) with the API key
                                 held server-side (wrangler secret), a 10 s
                                 shared vendor cache, and match-id discovery.

src/domain/types.ts              Typed domain models: Match (incl. stoppage clock,
                                 shot counts, knockout flag, penalty-shootout state),
                                 Team, MatchEvent, PredictionState, ...
src/domain/fixture.ts            Pre-match priors + initial match state for this fixture.
src/domain/clock.ts              Stoppage-aware clock helpers ("45+2'", "105+1'",
                                 effective minutes, expected added time across
                                 regulation and extra time). Pure.
src/domain/momentum.ts           Shot-based momentum: recency-weighted sum of recent
                                 shots/goals per team. Pure, deterministic. Unit-tested.
src/domain/prediction.ts         Pure, deterministic prediction engine (Poisson model
                                 over remaining xG, adjusted for score, stoppage-aware
                                 clock, red cards, momentum; extra-time regime and a
                                 kick-by-kick penalty-shootout win-probability model
                                 for knockout fixtures). No I/O, no randomness.
src/domain/feed.ts               Types for the trimmed vendor payload the worker
                                 returns to the browser (no runtime code).

src/providers/LiveMatchProvider.ts   Source-agnostic provider contract + optional
                                     SimulationControls capability interface.
src/providers/SimulatedMatchProvider.ts  Realistic simulation: shot-driven goals
                                         calibrated to the pre-match xG, announced
                                         stoppage time, extra time and a kick-by-kick
                                         penalty shoot-out when a knockout match is
                                         level, speed control (1×/15×/60×), manual
                                         event injection.
src/providers/ApiMatchProvider.ts        Real polling client for /api/match: maps the
                                         vendor feed to the domain Match (clock incl.
                                         extra time, events, red cards, lineups,
                                         penalty shoot-out state), synthesizes
                                         shot events from shot-count deltas so live
                                         momentum stays shot-based.

src/state/useLiveMatch.ts        React hook: subscribes to a provider, computes the
                                 prediction per update, tracks probability history.
src/ui/*                         Presentational components (header, bars, SVG chart,
                                 snapshot, line-ups, event feed, sim controls).
src/App.tsx                      Picks the provider (live when configured, else
                                 simulation; ?source=sim|live overrides) and
                                 composes the page.
```

Live match state is fully separated from rendering: the UI renders only from
`MatchUpdate` snapshots pushed through `LiveMatchProvider.subscribe`, and the
prediction engine is a pure function of `(Match, PreMatchModel)`.

## Local development

```sh
npm install
npm run dev        # Vite dev server (with the worker running via @cloudflare/vite-plugin)
npm test           # Vitest unit tests (prediction engine)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run format     # prettier --check
npm run build      # typecheck + production build
```

## Deployment (Cloudflare Workers)

```sh
npm run deploy     # builds, then `wrangler deploy`
```

The Vite Cloudflare plugin outputs the client bundle as Worker static assets and
bundles `worker/index.ts` as the Worker entry (see `wrangler.jsonc`).

## Going live (real data)

The live path is fully implemented against **football-data.org v4** (the FIFA
World Cup is included in their free tier):

1. Get a token at football-data.org and store it server-side:

   ```sh
   wrangler secret put SPORTS_API_KEY     # locally: put it in .dev.vars instead
   ```

2. Optionally pin the vendor match id via `vars.SPORTS_MATCH_ID` in
   `wrangler.jsonc`. If unset, the worker discovers the WC third-place fixture
   for today ± 1 day automatically (`stage=THIRD_PLACE`).
3. `npm run deploy`.

The app then auto-selects the live provider (it asks `/api/health`); without a
key it falls back to the simulation. Force either mode with `?source=live` or
`?source=sim`. The browser only ever talks to same-origin `/api/*` — the key
never reaches client code. The worker caches the vendor response for 10 s so
any number of viewers stay within the free tier's 10 requests/min.

## Known limitations

- BTTS and over-2.5 track the whole match including extra time (shoot-out
  kicks never count as goals) — they don't follow the 90-minute betting-market
  settlement convention.
- The free vendor tier may delay live scores slightly, and per-team shot
  statistics (which feed live momentum) may be tier-gated — without them,
  live momentum rides on goals only.
- Simulation randomness lives in the providers; the prediction engine itself
  stays pure and deterministic.
