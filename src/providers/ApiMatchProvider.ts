import type { Match } from '../domain/types'
import { createInitialMatch } from '../domain/fixture'
import type { LiveMatchProvider, MatchUpdate } from './LiveMatchProvider'

/**
 * Stub client for a future real sports-data feed.
 *
 * This class intentionally does very little today: the worker's
 * `/api/match` endpoint (see worker/index.ts) returns 501 until a real
 * provider is wired up server-side, so this class just surfaces that as a
 * `disconnected` status with the fixture's initial (pre-match) state. The
 * browser never talks to a third-party sports API directly — it only ever
 * calls same-origin `/api/*` routes, so no API key or secret is ever
 * present in client code or the network tab.
 *
 * --- How to wire up a real feed later ---
 *
 * 1. Provision a sports-data API key and store it server-side only:
 *      wrangler secret put SPORTS_API_KEY
 *    (see the `Bindings` type and the `/api/match` stub in worker/index.ts —
 *    `c.env.SPORTS_API_KEY` is only ever readable inside the Worker).
 *
 * 2. Implement the proxy in worker/index.ts:
 *      - Call the real provider's REST/WebSocket endpoint from the Worker,
 *        using SPORTS_API_KEY in the request the Worker makes (never sent
 *        to the browser).
 *      - Map that provider's payload shape into this project's domain
 *        model (`Match` from src/domain/types.ts) server-side, OR pass the
 *        raw payload through and do the mapping here in the client — either
 *        is fine, but keep the mapping logic in exactly one place.
 *      - Either return the current snapshot as JSON from `/api/match` (for
 *        polling), or upgrade the route to a Server-Sent Events stream
 *        (`text/event-stream`) for push updates.
 *
 * 3. Update this class's `subscribe()`:
 *      - Polling: replace the one-shot fetch below with a `setInterval`
 *        (a few seconds is plenty for a live score feed) that fetches
 *        `${baseUrl}/api/match`, maps the JSON body to a `Match`, and calls
 *        every listener with `{ match, status: 'live' }`. On a failed
 *        fetch, emit `status: 'stale'` (briefly) or `'disconnected'`
 *        (sustained) without discarding the last known-good `Match`.
 *      - SSE: open `new EventSource(\`${baseUrl}/api/match/stream\`)`,
 *        parse each message into a `Match`, and emit `status: 'live'` on
 *        message / `'error'` on the EventSource's error handler. Store the
 *        EventSource so `dispose()` can call `.close()` on it.
 *      - In both cases, keep `computePrediction` (src/domain/prediction.ts)
 *        as the single source of prediction math — this provider's job
 *        ends at producing a correct `Match`, never at predicting anything
 *        itself.
 *
 * 4. This class does not implement `SimulationControls` — real fixtures
 *    aren't controllable, so the UI's simulator-only controls (start,
 *    pause, inject events, etc.) will correctly stay hidden for this
 *    provider (see `supportsSimulation` in ./LiveMatchProvider).
 */
export class ApiMatchProvider implements LiveMatchProvider {
  private readonly baseUrl: string
  private listeners = new Set<(update: MatchUpdate) => void>()
  private disposed = false

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl
  }

  subscribe(listener: (update: MatchUpdate) => void): () => void {
    this.listeners.add(listener)

    const initialMatch = createInitialMatch()
    listener({ match: initialMatch, status: 'connecting' })

    void this.fetchOnce(initialMatch, listener)

    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private async fetchOnce(
    fallbackMatch: Match,
    listener: (update: MatchUpdate) => void,
  ): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/match`)
      if (this.disposed) return

      if (!response.ok) {
        // Expected today: the worker returns 501 until SPORTS_API_KEY is
        // configured and a real provider is implemented. Fall back to the
        // fixture's pre-match state so the UI has something sane to render.
        listener({ match: fallbackMatch, status: 'disconnected' })
        return
      }

      // No real payload shape exists yet — once the worker proxies a real
      // feed, map its JSON body into `Match` here before emitting it.
      listener({ match: fallbackMatch, status: 'disconnected' })
    } catch {
      if (this.disposed) return
      listener({ match: fallbackMatch, status: 'disconnected' })
    }
  }
}
