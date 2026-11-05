// Shown when the microphone can't be used: browser-specific steps to fix it, or type instead.
import { useState } from 'react'
import type { MicHelp } from './micHelp'

export type { MicState } from './useRecorder'

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
            className="btn secondary"
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
        <button className="btn ghost" type="button" onClick={onDismiss}>
          I’ll type instead
        </button>
      </div>
    </div>
  )
}
