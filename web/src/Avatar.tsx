import { useEffect, useRef, useState } from 'react'
import { accessQuery } from './access'
import type { TutorState } from './Tutor'

// Johannes on screen in "Talk to Johannes": short muted loops cut from a recording of him
// (web/public/avatar, never on GitHub, behind the access code like the slides).
// One loop of him talking, one of him listening; they fade into each other with what he's doing.
// It's not lip-synced: it shows he's there and whose turn it is. If the videos can't load,
// `onFail` lets the page fall back to the plain tutor circle.
export function Avatar({ state, label, onFail }: { state: TutorState; label: string; onFail: () => void }) {
  const talking = useRef<HTMLVideoElement>(null)
  const listening = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const speaking = state === 'speaking'

  // Keep both loops running (iOS sometimes pauses muted videos, e.g. after the tab was hidden).
  useEffect(() => {
    for (const v of [talking.current, listening.current]) {
      if (v && v.paused) v.play().catch(() => undefined)
    }
  }, [state])

  const q = accessQuery()
  return (
    <div className={`avatar avatar-${state}`}>
      <div className="avatar-frame" style={{ backgroundImage: `url(/avatar/still.jpg${q})` }}>
        <video
          ref={listening}
          className={`avatar-video ${speaking ? '' : 'is-on'}`}
          src={`/avatar/listening.mp4${q}`}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          aria-hidden="true"
          onCanPlay={() => setReady(true)}
          onError={onFail}
        />
        <video
          ref={talking}
          className={`avatar-video ${speaking ? 'is-on' : ''}`}
          src={`/avatar/talking.mp4${q}`}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          aria-hidden="true"
          onError={onFail}
        />
        {state === 'thinking' && (
          <span className="avatar-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
        {!ready && <span className="sr-only">Loading…</span>}
      </div>
      <span className="tutor-label avatar-label" aria-live="polite">
        {label}
      </span>
    </div>
  )
}
