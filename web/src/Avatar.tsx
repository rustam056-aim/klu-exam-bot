import { useState } from 'react'
import { accessQuery } from './access'
import type { TutorState } from './Tutor'

// Johannes on screen in "Talk to Johannes": his photo (web/public/avatar/photo.jpg, never on
// GitHub, behind the access code like the slides), with a ring that shows what's happening:
// a gentle pulse while he talks, the accent colour when it's your turn, dots while he thinks.
// No fake movement. A real lip-synced face (e.g. Simli) can replace the photo later.
// If the photo can't load, `onFail` lets the page fall back to the plain tutor circle.
export function Avatar({ state, label, onFail }: { state: TutorState; label: string; onFail: () => void }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className={`avatar avatar-${state}`}>
      <div className="avatar-frame">
        <img
          className={`avatar-photo ${loaded ? 'is-on' : ''}`}
          src={`/avatar/photo.jpg${accessQuery()}`}
          alt="Prof. Johannes Meuer"
          onLoad={() => setLoaded(true)}
          onError={onFail}
        />
        {state === 'thinking' && (
          <span className="avatar-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
      <span className="tutor-label avatar-label" aria-live="polite">
        {label}
      </span>
    </div>
  )
}
