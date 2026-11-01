import { useEffect, useState } from 'react'
import { api } from './api'
import type { Settings } from './types'

type Option<T extends string> = { value: T; label: string }

function Choice<T extends string>(props: {
  legend: string
  name: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="choice">
      <legend>{props.legend}</legend>
      <div className="choice-row">
        {props.options.map((o) => (
          <label key={o.value} className={o.value === props.value ? 'is-on' : undefined}>
            <input
              type="radio"
              name={props.name}
              value={o.value}
              checked={o.value === props.value}
              onChange={() => props.onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function StartScreen({ initial, onStart }: { initial: Settings; onStart: (s: Settings) => void }) {
  const [settings, setSettings] = useState(initial)
  const [sessions, setSessions] = useState<{ session: number; count: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .sessions()
      .then(setSessions)
      .catch(() => setError('The practice server is not responding. Reload the page in a minute.'))
  }, [])

  const sessionOptions: Option<string>[] = [
    { value: 'all', label: 'All sessions' },
    ...(sessions ?? []).map((s) => ({ value: String(s.session), label: `Session ${s.session}` })),
  ]

  return (
    <section className="start">
      <h1>Practise for the Sustainable Logistics exam</h1>
      <p className="lede">
        Answer questions from this year&rsquo;s course slides, get feedback right away, and see what to review
        before the exam.
      </p>

      <form
        className="settings"
        onSubmit={(e) => {
          e.preventDefault()
          onStart(settings)
        }}
      >
        <Choice
          legend="Sessions"
          name="session"
          value={settings.session}
          options={sessionOptions}
          onChange={(session) => setSettings({ ...settings, session })}
        />
        <Choice
          legend="Difficulty"
          name="difficulty"
          value={settings.difficulty}
          options={[
            { value: 'mixed', label: 'Mixed' },
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
          ]}
          onChange={(difficulty) => setSettings({ ...settings, difficulty })}
        />
        <Choice
          legend="Questions"
          name="length"
          value={String(settings.length)}
          options={[
            { value: '5', label: '5' },
            { value: '10', label: '10' },
            { value: '15', label: '15' },
          ]}
          onChange={(length) => setSettings({ ...settings, length: Number(length) })}
        />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={!sessions}>
          Start practice
        </button>
      </form>

      <p className="fineprint">
        Questions come only from the course material. This is practice, not the real exam.
      </p>
    </section>
  )
}
