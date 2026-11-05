import { useEffect, useState } from 'react'
import { NeedsCode, setAccessCode } from './access'
import { api } from './api'
import { loadProgress, missedIds, resetProgress, sessionStats } from './progress'
import type { SessionInfo, Settings } from './types'

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

export function StartScreen({
  initial,
  onStart,
}: {
  initial: Settings
  onStart: (s: Settings, onlyIds?: string[]) => void
}) {
  const [settings, setSettings] = useState({ ...initial, quick: false })
  const [progress, setProgress] = useState(loadProgress)
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
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

  // How many questions match the chosen session + difficulty, so the length options fit.
  const picked = (sessions ?? []).filter((s) => settings.session === 'all' || String(s.session) === settings.session)
  const available = picked.reduce(
    (sum, s) =>
      sum + (settings.difficulty === 'mixed' ? s.count : (s.byDifficulty?.[settings.difficulty] ?? s.count)),
    0,
  )
  const ALL = 999 // "All" stays "All" when you switch to a bigger session
  const length = Math.min(settings.length, available)
  const lengthOptions: Option<string>[] = [
    ...[5, 10, 15].filter((n) => n < available).map((n) => ({ value: String(n), label: String(n) })),
    ...(available > 0 ? [{ value: String(available), label: `All ${available}` }] : []),
  ]

  return (
    <section className="start">
      <h1>Practise for the Sustainable Logistics exam</h1>
      <p className="lede">
        Answer questions from this year&rsquo;s course material, get feedback right away, and see what to review
        before the exam.
      </p>

      <div className="quick">
        <div>
          <h2>On the bus? Quick 5</h2>
          <p>Five multiple-choice questions from everything so far. About three minutes.</p>
        </div>
        <button
          className="btn signal"
          type="button"
          disabled={!sessions}
          onClick={() => onStart({ ...settings, session: 'all', difficulty: 'mixed', length: 5, quick: true })}
        >
          Go
        </button>
      </div>

      <form
        className="settings"
        onSubmit={(e) => {
          e.preventDefault()
          if (length > 0) onStart({ ...settings, length, quick: false })
        }}
      >
        <h2 className="settings-title">Or set up your own practice</h2>
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
        {sessions && available === 0 ? (
          <p className="fineprint">No {settings.difficulty} questions here yet. Try another difficulty.</p>
        ) : (
          <Choice
            legend="Questions"
            name="length"
            value={String(length)}
            options={lengthOptions}
            onChange={(n) =>
              setSettings({ ...settings, length: Number(n) === available ? ALL : Number(n) })
            }
          />
        )}

        <Choice
          legend="How you answer"
          name="mode"
          value={settings.voice ? 'voice' : 'type'}
          options={[
            { value: 'type', label: 'Type and tap' },
            { value: 'voice', label: 'Talk (voice mode)' },
          ]}
          onChange={(m) => setSettings({ ...settings, voice: m === 'voice' })}
        />
        {settings.voice && (
          <p className="choice-note">Questions are read out. Tap the big mic, answer out loud, and you hear the feedback.</p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={!sessions || available === 0}>
          Start practice
        </button>
      </form>

      {sessions && Object.keys(progress).length > 0 && (
        <ProgressPanel
          sessions={sessions}
          progress={progress}
          onPractiseMissed={(ids) => onStart({ ...settings, session: 'all', difficulty: 'mixed', quick: false }, ids)}
          onReset={() => {
            resetProgress()
            setProgress({})
          }}
        />
      )}

      <p className="fineprint">
        Questions come only from the course material. This is practice, not the real exam.
      </p>
    </section>
  )
}

// "Your progress": how much of each session you've tried and got right (kept in this browser only).
function ProgressPanel(props: {
  sessions: SessionInfo[]
  progress: ReturnType<typeof loadProgress>
  onPractiseMissed: (ids: string[]) => void
  onReset: () => void
}) {
  const { sessions, progress, onPractiseMissed, onReset } = props
  const missed = missedIds(progress)
  return (
    <section className="progress" aria-label="Your progress">
      <h2>Your progress</h2>
      <ul>
        {sessions.map((s) => {
          const { tried, right } = sessionStats(progress, s.session)
          const label = s.label ?? `Session ${s.session}`
          return (
            <li key={s.session}>
              <span className="progress-label">{label}</span>
              <span
                className="progress-bar"
                role="img"
                aria-label={`${right} right and ${tried - right} not yet, out of ${s.count}`}
              >
                <span className="progress-right" style={{ width: `${(100 * right) / s.count}%` }} />
                <span className="progress-tried" style={{ width: `${(100 * (tried - right)) / s.count}%` }} />
              </span>
              <span className="progress-count">
                {tried === 0 ? 'not started' : `${tried} of ${s.count} tried · ${right} right`}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="actions">
        {missed.length > 0 && (
          <button className="btn quiet" type="button" onClick={() => onPractiseMissed(missed)}>
            Practise the {missed.length} you missed
          </button>
        )}
        <button className="btn link" type="button" onClick={onReset}>
          Start over
        </button>
      </div>
      <p className="note">Saved in this browser only. Nobody else sees it.</p>
    </section>
  )
}
