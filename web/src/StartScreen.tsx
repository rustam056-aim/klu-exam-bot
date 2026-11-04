import { useEffect, useState } from 'react'
import { NeedsCode, setAccessCode } from './access'
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
  const [sessions, setSessions] = useState<{ session: number; label?: string; count: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needCode, setNeedCode] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  function load(afterCodeEntry = false) {
    api
      .sessions()
      .then((s) => {
        setSessions(s)
        setNeedCode(false)
      })
      .catch((e) => {
        if (e instanceof NeedsCode) {
          setNeedCode(true)
          if (afterCodeEntry) setCodeError('That code didn’t work. Check it and try again.')
        } else {
          setError('The practice server is not responding. Reload the page in a minute.')
        }
      })
  }

  useEffect(() => load(), [])

  if (needCode) {
    return (
      <section className="start">
        <h1>Practise for the Sustainable Logistics exam</h1>
        <p className="lede">Enter the access code from the course page on Moodle to start.</p>
        <form
          className="settings"
          onSubmit={(e) => {
            e.preventDefault()
            setCodeError(null)
            setAccessCode(codeInput)
            load(true)
          }}
        >
          <label className="code-field">
            <span>Access code</span>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          {codeError && (
            <p className="error" role="alert">
              {codeError}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={!codeInput.trim()}>
            Continue
          </button>
        </form>
      </section>
    )
  }

  const sessionOptions: Option<string>[] = [
    { value: 'all', label: 'All sessions' },
    ...(sessions ?? []).map((s) => ({ value: String(s.session), label: s.label ?? `Session ${s.session}` })),
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
