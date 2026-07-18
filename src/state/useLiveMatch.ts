import { useEffect, useState } from 'react'
import type {
  ConnectionStatus,
  Match,
  PredictionState,
  PreMatchModel,
  ProbabilitySnapshot,
} from '../domain/types'
import { PRE_MATCH_MODEL } from '../domain/fixture'
import { computePrediction } from '../domain/prediction'
import { matchEffectiveMinute } from '../domain/clock'
import type { LiveMatchProvider } from '../providers/LiveMatchProvider'

// 120 regulation minutes + stoppage + extra time + shootout snapshots.
const MAX_HISTORY = 200

interface LiveMatchState {
  match: Match | null
  status: ConnectionStatus
  prediction: PredictionState | null
  history: ProbabilitySnapshot[]
}

const INITIAL_STATE: LiveMatchState = {
  match: null,
  status: 'connecting',
  prediction: null,
  history: [],
}

function isSnapshotEqual(a: ProbabilitySnapshot, b: ProbabilitySnapshot): boolean {
  return a.minute === b.minute && a.home === b.home && a.draw === b.draw && a.away === b.away
}

/**
 * Subscribes to a LiveMatchProvider and derives everything the UI needs:
 * the raw match/status, the memoized prediction for the current match, and a
 * capped history of probability snapshots for the momentum chart.
 */
export function useLiveMatch(
  provider: LiveMatchProvider,
  preMatchModel: PreMatchModel = PRE_MATCH_MODEL,
): LiveMatchState {
  const [state, setState] = useState<LiveMatchState>(INITIAL_STATE)

  useEffect(() => {
    // A provider swap (fixture change) starts from a clean slate so one
    // match's history never bleeds into another's chart.
    setState(INITIAL_STATE)
    const unsubscribe = provider.subscribe(({ match, status }) => {
      setState((prev) => {
        const prediction = computePrediction(match, preMatchModel)
        const snapshot: ProbabilitySnapshot = {
          minute: matchEffectiveMinute(match),
          home: prediction.probabilities.home,
          draw: prediction.probabilities.draw,
          away: prediction.probabilities.away,
        }
        const isReset = match.phase === 'pre-match' && match.events.length === 0

        let history: ProbabilitySnapshot[]
        if (isReset) {
          history = [snapshot]
        } else {
          const last = prev.history[prev.history.length - 1]
          const unchanged = last !== undefined && isSnapshotEqual(last, snapshot)
          history = unchanged ? prev.history : [...prev.history, snapshot].slice(-MAX_HISTORY)
        }

        return { match, status, prediction, history }
      })
    })

    return () => {
      unsubscribe()
      provider.dispose()
    }
  }, [provider, preMatchModel])

  return state
}
