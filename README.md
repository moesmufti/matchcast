# MatchCast

Live match prediction dashboard for the FIFA World Cup third-place match — **France vs England**, 18 July 2026, 23:00 (Europe/Amsterdam), Miami. Renders live win probabilities, a probability-history chart, a model snapshot, and an event feed, driven by a deterministic prediction engine over a simulated live feed.

> All numbers are **model estimates** for entertainment — not betting advice.

## Architecture

```
worker/index.ts                  Hono app on Cloudflare Workers — serves /api/*,
                                 static assets via the Workers assets binding.
                                 Real sports-data keys live here (wrangler secrets),
                                 never in browser code.

src/domain/types.ts              Typed domain models: Match, Team, MatchEvent,
                                 PredictionState, ProbabilitySnapshot, ...
src/domain/fixture.ts            Pre-match priors + initial match state for this fixture.
src/domain/prediction.ts         Pure, deterministic prediction engine (Poisson model
                                 over remaining xG, adjusted for score, clock, red
                                 cards, momentum). No I/O, no randomness. Unit-tested.

src/providers/LiveMatchProvider.ts   Source-agnostic provider contract + optional
                                     SimulationControls capability interface.
src/providers/SimulatedMatchProvider.ts  Simulated live feed (clock, ambient events,
                                         manual event injection).
src/providers/ApiMatchProvider.ts        Documented stub for a real live-data feed.

src/state/useLiveMatch.ts        React hook: subscribes to a provider, computes the
                                 prediction per update, tracks probability history.
src/ui/*                         Presentational components (header, bars, SVG chart,
                                 snapshot, event feed, sim controls).
src/App.tsx                      Wires one provider into the hook and composes the page.
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

## Replacing the simulator with a real live-data feed

1. Get a sports-data API key and store it server-side:
   `wrangler secret put SPORTS_API_KEY` (available as `c.env.SPORTS_API_KEY` in the worker).
2. Implement the proxy in `worker/index.ts` (`GET /api/match`): call the vendor API,
   map its payload into the `Match` domain model, return JSON. The browser never
   sees the key — it only talks to `/api/*`.
3. Flesh out `src/providers/ApiMatchProvider.ts` (polling or SSE against `/api/match`).
4. In `src/App.tsx`, swap `new SimulatedMatchProvider()` for `new ApiMatchProvider()`.
   Simulation controls disappear automatically — the UI feature-detects them via
   `supportsSimulation()`.
