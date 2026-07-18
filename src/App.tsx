import { useState } from 'react'
import type { ConnectionStatus } from './domain/types'
import { useLiveMatch } from './state/useLiveMatch'
import { SimulatedMatchProvider } from './providers/SimulatedMatchProvider'
import { supportsSimulation } from './providers/LiveMatchProvider'
import { TopBar } from './ui/TopBar'
import { MatchHeader } from './ui/MatchHeader'
import { ProbabilityBars } from './ui/ProbabilityBars'
import { ProbabilityChart } from './ui/ProbabilityChart'
import { ModelSnapshot } from './ui/ModelSnapshot'
import { LineupCard } from './ui/LineupCard'
import { EventFeed } from './ui/EventFeed'
import { SimControls } from './ui/SimControls'
import { Footer } from './ui/Footer'

const NOTICE_COPY: Partial<Record<ConnectionStatus, string>> = {
  disconnected: 'Live feed disconnected — showing the last known match state.',
  error: 'The live feed hit an error — showing the last known match state.',
  stale: 'Live feed data looks stale — attempting to reconnect.',
}

export default function App() {
  const [provider] = useState(() => new SimulatedMatchProvider())
  const { match, status, prediction, history } = useLiveMatch(provider)

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
      <TopBar status={status} />
      <main className="app__main">
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        <div className="broadcast">
          <MatchHeader match={match} />
          <ProbabilityBars
            prediction={prediction}
            homeName={match.teams.home.name}
            awayName={match.teams.away.name}
          />
        </div>
        <div className="app__grid">
          <ProbabilityChart history={history} events={match.events} />
          <ModelSnapshot match={match} prediction={prediction} />
        </div>
        {match.lineups && <LineupCard teams={match.teams} lineups={match.lineups} />}
        <EventFeed events={match.events} />
        {supportsSimulation(provider) && <SimControls match={match} controls={provider} />}
      </main>
      <Footer />
    </div>
  )
}
