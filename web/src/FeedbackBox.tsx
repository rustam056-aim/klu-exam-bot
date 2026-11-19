import { useState } from 'react'
import { api } from './api'
import type { FeedbackAnswers } from './api'

// "Help us improve": a few quick taps and a few words, sent to Rustam and Prof. Meuer.
// No name, no login; it only says which part of the tool the student was in.
// The questions are the ones that help most to improve the tutor: are the answers right, are the
// questions at exam level, does the voice work, would they really use it.

type Choice = { value: string; label: string }
const QUESTIONS: { key: keyof FeedbackAnswers; label: string; choices: Choice[] }[] = [
  {
    key: 'correct',
    label: 'Were Johannes’s answers right, compared with the course?',
    choices: [
      { value: 'yes', label: 'Yes' },
      { value: 'mostly', label: 'Mostly' },
      { value: 'mistake', label: 'I spotted a mistake' },
    ],
  },
  {
    key: 'level',
    label: 'How did the questions feel?',
    choices: [
      { value: 'easy', label: 'Too easy' },
      { value: 'right', label: 'Like the exam' },
      { value: 'hard', label: 'Too hard' },
    ],
  },
  {
    key: 'voice',
    label: 'How was talking to him?',
    choices: [
      { value: 'natural', label: 'Natural' },
      { value: 'ok', label: 'OK' },
      { value: 'awkward', label: 'Awkward' },
      { value: 'none', label: 'Didn’t try' },
    ],
  },
  {
    key: 'use',
    label: 'Would you use it to prepare for the exam?',
    choices: [
      { value: 'yes', label: 'Yes' },
      { value: 'maybe', label: 'Maybe' },
      { value: 'no', label: 'No' },
    ],
  },
]

export function FeedbackBox({ where, compact = false }: { where: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [answers, setAnswers] = useState<FeedbackAnswers>({})
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
        Help us improve (1 min)
      </button>
    )
  }

  // At least one comment, so we know what to work on.
  const anything = text.trim().length >= 3
  const mistake = answers.correct === 'mistake'

  return (
    <form
      className="card feedback-box"
      onSubmit={(e) => {
        e.preventDefault()
        setState('sending')
        api
          .feedback({ text, rating: rating || undefined, where, answers })
          .then(() => setState('sent'))
          .catch(() => setState('failed'))
      }}
    >
      <h2>Help us improve</h2>
      <p className="note">
        Your feedback helps us make this a better way to prepare for your exam. It’s anonymous and goes straight to the
        people building this tool.
      </p>

      <fieldset className="fb-q">
        <legend>How useful was it?</legend>
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
      </fieldset>

      {QUESTIONS.map((q) => (
        <fieldset className="fb-q" key={q.key}>
          <legend>{q.label}</legend>
          <div className="fb-choices" role="radiogroup" aria-label={q.label}>
            {q.choices.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={answers[q.key] === c.value}
                className="fb-choice"
                onClick={() =>
                  setAnswers((a) => {
                    const next = { ...a }
                    if (next[q.key] === c.value) delete next[q.key]
                    else next[q.key] = c.value
                    return next
                  })
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      <label className="open fb-q">
        <span className="fb-legend">
          {mistake
            ? 'What was wrong? (the question and what he said)'
            : 'Last thing: please leave at least one comment, so we know what to improve'}
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={600}
          placeholder={mistake ? 'Which question, what he said, and what the slides say' : 'What should be better? What’s missing? What did you like?'}
        />
      </label>
      {state === 'failed' && (
        <p className="error" role="alert">
          That didn’t go through. Try again.
        </p>
      )}
      <div className="actions">
        <button className="btn primary" type="submit" disabled={state === 'sending' || !anything}>
          {state === 'sending' ? 'Sending…' : anything ? 'Send' : 'Add a comment to send'}
        </button>
        <button className="btn ghost" type="button" onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </form>
  )
}
