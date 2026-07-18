import { useEffect, useState } from 'react'
import type { ConnectionStatus } from './domain/types'
import { DEFAULT_FIXTURE_ID, FIXTURES, isFixtureId, type FixtureId } from './domain/fixture'
import { useLiveMatch } from './state/useLiveMatch'
import { SimulatedMatchProvider } from './providers/SimulatedMatchProvider'
import { ApiMatchProvider } from './providers/ApiMatchProvider'
import { supportsSimulation, type LiveMatchProvider } from './providers/LiveMatchProvider'
import { TopBar } from './ui/TopBar'
import { MatchHeader } from './ui/MatchHeader'
import { ProbabilityBars } from './ui/ProbabilityBars'
import { ProbabilityChart } from './ui/ProbabilityChart'
import { ModelSnapshot } from './ui/ModelSnapshot'
import { MatchStatsCard } from './ui/MatchStatsCard'
import { LineupCard } from './ui/LineupCard'
import { EventFeed } from './ui/EventFeed'
import { SimControls } from './ui/SimControls'
import { Footer } from './ui/Footer'

const NOTICE_COPY: Partial<Record<ConnectionStatus, string>> = {
  disconnected: 'Live feed disconnected — showing the last known match state.',
  error: 'The live feed hit an error — showing the last known match state.',
  stale: 'Live feed data looks stale — attempting to reconnect.',
}

interface DashboardProps {
  provider: LiveMatchProvider
  fixtureId: FixtureId
  onFixtureChange: (fixtureId: FixtureId) => void
}

function Dashboard({ provider, fixtureId, onFixtureChange }: DashboardProps) {
  const { match, status, prediction, history } = useLiveMatch(
    provider,
    FIXTURES[fixtureId].preMatchModel,
  )

  if (!match || !prediction) {
    return (
      <div className="app app--loading">
        <p>Loading match model…</p>
      </div>
    )
  }

  const notice = NOTICE_COPY[status]

  return (
    <div className="app">
      <TopBar status={status} fixtureId={fixtureId} onFixtureChange={onFixtureChange} />
      <main className="app__main">
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        <div className="broadcast">
          <MatchHeader match={match} />
          <ProbabilityBars
            match={match}
            prediction={prediction}
            homeName={match.teams.home.name}
            awayName={match.teams.away.name}
          />
        </div>
        <div className="app__grid">
          <ProbabilityChart history={history} events={match.events} />
          <ModelSnapshot match={match} prediction={prediction} />
        </div>
        <MatchStatsCard match={match} />
        {match.lineups && <LineupCard teams={match.teams} lineups={match.lineups} />}
        <EventFeed events={match.events} />
        {supportsSimulation(provider) && <SimControls match={match} controls={provider} />}
      </main>
      <Footer simulated={supportsSimulation(provider)} />
    </div>
  )
}

/**
 * Picks which provider drives the dashboard:
 *  - `?source=sim` forces the client-side simulator.
 *  - `?source=live` forces the real polling provider.
 *  - otherwise, ask the worker via `/api/health` and use the real provider
 *    when `liveConfigured` is true, falling back to the simulator (including
 *    on a failed health check — e.g. offline dev, worker not running).
 */
async function chooseProvider(fixtureId: FixtureId): Promise<LiveMatchProvider> {
  const fixture = FIXTURES[fixtureId]
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source')

  if (source === 'sim') return new SimulatedMatchProvider(undefined, fixture)
  if (source === 'live') return new ApiMatchProvider('', fixture)

  try {
    const response = await fetch('/api/health')
    if (!response.ok) return new SimulatedMatchProvider(undefined, fixture)
    const body = (await response.json()) as { ok: boolean; liveConfigured?: boolean }
    return body.liveConfigured
      ? new ApiMatchProvider('', fixture)
      : new SimulatedMatchProvider(undefined, fixture)
  } catch {
    return new SimulatedMatchProvider(undefined, fixture)
  }
}

/** Initial selection: honour ?fixture=… in the URL, else the default match. */
function initialFixtureId(): FixtureId {
  const param = new URLSearchParams(window.location.search).get('fixture')
  return isFixtureId(param) ? param : DEFAULT_FIXTURE_ID
}

export default function App() {
  const [fixtureId, setFixtureId] = useState<FixtureId>(initialFixtureId)
  const [provider, setProvider] = useState<LiveMatchProvider | null>(null)

  useEffect(() => {
    let cancelled = false
    let created: LiveMatchProvider | null = null

    void chooseProvider(fixtureId).then((chosen) => {
      if (cancelled) {
        chosen.dispose()
        return
      }
      created = chosen
      setProvider(chosen)
    })

    return () => {
      cancelled = true
      created?.dispose()
    }
  }, [fixtureId])

  if (!provider) {
    return (
      <div className="app app--loading">
        <p>Loading match model…</p>
      </div>
    )
  }

  return <Dashboard provider={provider} fixtureId={fixtureId} onFixtureChange={setFixtureId} />
}
