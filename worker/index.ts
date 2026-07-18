import { Hono } from 'hono'

type Bindings = {
  /**
   * Set via `wrangler secret put SPORTS_API_KEY` for a real data provider.
   * Never shipped to the browser — the client talks only to /api/*.
   */
  SPORTS_API_KEY?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/health', (c) => c.json({ ok: true }))

/**
 * Stub for a future real live-data feed. A real implementation would proxy a
 * sports-data API here (key stays server-side) and the browser's
 * ApiMatchProvider would poll this endpoint or hold an SSE/WebSocket open.
 */
app.get('/api/match', (c) => {
  if (!c.env.SPORTS_API_KEY) {
    return c.json({ error: 'No live data provider configured. Using client-side simulation.' }, 501)
  }
  return c.json({ error: 'Real provider not implemented yet.' }, 501)
})

export default app
