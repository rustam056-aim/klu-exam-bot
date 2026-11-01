import type { Verdict } from './types'
import { verdictLabel } from './format'

export type Stop = Verdict | 'current' | 'ahead'

const stopLabel: Record<Stop, string> = {
  ...verdictLabel,
  current: 'current question',
  ahead: 'still to come',
}

// The practice run drawn as a route: one stop per question, the last stop is the destination.
export function RouteLine({ stops }: { stops: Stop[] }) {
  return (
    <ol className="route" aria-label="Progress">
      {stops.map((stop, i) => (
        <li
          key={i}
          className={`stop stop-${stop}`}
          aria-label={`Question ${i + 1}: ${stopLabel[stop]}`}
          aria-current={stop === 'current' ? 'step' : undefined}
        />
      ))}
    </ol>
  )
}
