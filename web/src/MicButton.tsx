import { useEffect, useState } from 'react'
import type { MicHelp } from './micHelp'
import { clock, useRecorder } from './useRecorder'
import type { MicState } from './useRecorder'

export type { MicState } from './useRecorder'

// Small "Answer by speaking" button under the text box. The text lands in the box and can still be edited.
export function MicButton({
  onText,
  disabled,
  onStateChange,
}: {
  onText: (text: string) => void
  disabled?: boolean
  onStateChange?: (state: MicState) => void
}) {
  const rec = useRecorder(onText)

  useEffect(() => {
    onStateChange?.(rec.state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.state])

  const label =
    rec.state === 'recording'
      ? `Stop recording (${clock(rec.seconds)})`
      : rec.state === 'working'
        ? 'Turning your answer into text…'
        : 'Answer by speaking'

  return (
    <div className="mic">
      <button
        type="button"
        className={`btn quiet mic-btn mic-${rec.state}`}
        onClick={rec.toggle}
        disabled={disabled || rec.state === 'working'}
        aria-pressed={rec.state === 'recording'}
      >
        {label}
      </button>
      {rec.error && (
        <p className="error" role="alert">
          {rec.error}
        </p>
      )}
      {rec.help && <MicHelpBox help={rec.help} onRetry={rec.start} onDismiss={rec.dismissHelp} />}
    </div>
  )
}

export function MicHelpBox({ help, onRetry, onDismiss }: { help: MicHelp; onRetry: () => void; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mic-help" role="alert">
      <h3>{help.title}</h3>
      <ol>
        {help.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="mic-help-actions">
        <button className="btn primary" type="button" onClick={onRetry}>
          Try again
        </button>
        {help.openElsewhere && (
          <button
            className="btn quiet"
            type="button"
            onClick={() => {
              navigator.clipboard
                ?.writeText(location.href)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        )}
        <button className="btn link" type="button" onClick={onDismiss}>
          I’ll type instead
        </button>
      </div>
    </div>
  )
}
