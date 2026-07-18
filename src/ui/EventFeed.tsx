import type { MatchEvent, MatchEventType } from '../domain/types'

const ICONS: Record<MatchEventType, string> = {
  kickoff: '⏱',
  goal: '⚽',
  chance: '⚡',
  'yellow-card': '🟨',
  'red-card': '🟥',
  substitution: '🔁',
  'half-time': '⏱',
  'second-half-start': '⏱',
  'full-time': '⏱',
  clock: '⏱',
}

interface EventFeedProps {
  events: MatchEvent[]
}

export function EventFeed({ events }: EventFeedProps) {
  if (events.length === 0) {
    return (
      <section className="event-feed" aria-label="Match events">
        <h2 className="event-feed__title">Match events</h2>
        <p className="event-feed__empty">
          No events yet — start the simulation or wait for kick-off.
        </p>
      </section>
    )
  }

  const newestFirst = [...events].reverse()

  return (
    <section className="event-feed">
      <h2 className="event-feed__title">Match events</h2>
      <ul className="event-feed__list" aria-label="Match events">
        {newestFirst.map((event) => (
          <li className="event-feed__item" key={event.id}>
            <span className="event-feed__minute">{event.minute}'</span>
            <span className="event-feed__icon" aria-hidden="true">
              {ICONS[event.type]}
            </span>
            <div className="event-feed__body">
              <p className="event-feed__description">{event.description}</p>
              <p className="event-feed__reaction">{event.modelReaction}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
