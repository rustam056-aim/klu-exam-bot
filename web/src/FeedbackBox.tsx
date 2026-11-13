import { useState } from 'react'
import { api } from './api'

// "What should be better?": stars and a few words, sent to Rustam and Prof. Meuer.
// No name, no login; it only says which part of the tool the student was in.
export function FeedbackBox({ where, compact = false }: { where: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  if (state === 'sent') {
    return (
      <p className="feedback-thanks" role="status">
        Thanks, that helps a lot!
      </p>
    )
  }

  if (!open) {
    return (
      <button className={`btn ${compact ? 'ghost sm' : 'secondary'} feedback-open`} type="button" onClick={() => setOpen(true)}>
        What should be better?
      </button>
    )
  }

  return (
    <form
      className="card feedback-box"
      onSubmit={(e) => {
        e.preventDefault()
        setState('sending')
        api
          .feedback({ text, rating: rating || undefined, where })
          .then(() => setState('sent'))
          .catch(() => setState('failed'))
      }}
    >
      <h2>What should be better?</h2>
      <p className="note">Anonymous. It goes straight to the people building this tool.</p>
      <div className="stars" role="radiogroup" aria-label="How useful was it?">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} of 5`}
            className={n <= rating ? 'is-on' : undefined}
            onClick={() => setRating(n === rating ? 0 : n)}
          >
            ★
          </button>
        ))}
      </div>
      <label className="open">
        <span className="sr-only">Your feedback</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={600}
          placeholder="What worked, what was confusing, what’s missing?"
        />
      </label>
      {state === 'failed' && (
        <p className="error" role="alert">
          That didn’t go through. Try again.
        </p>
      )}
      <div className="actions">
        <button className="btn primary" type="submit" disabled={state === 'sending' || (!text.trim() && !rating)}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
        <button className="btn ghost" type="button" onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </form>
  )
}
