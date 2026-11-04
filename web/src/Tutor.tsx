// A small "tutor" that shows what the practice bot is doing: reading, listening or thinking.
// Option C would replace the orb with Prof. Meuer's animated photo.
export type TutorState = 'idle' | 'speaking' | 'listening' | 'thinking'

const label: Record<TutorState, string> = {
  idle: 'Your practice tutor',
  speaking: 'Reading aloud…',
  listening: 'Listening…',
  thinking: 'Thinking…',
}

export function Tutor({ state }: { state: TutorState }) {
  return (
    <div className={`tutor tutor-${state}`}>
      <div className="tutor-orb" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className="tutor-label" aria-live="polite">
        {label[state]}
      </span>
    </div>
  )
}
