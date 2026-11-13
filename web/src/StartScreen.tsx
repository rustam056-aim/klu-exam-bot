import { useEffect, useState } from 'react'
import { NeedsCode, setAccessCode } from './access'
import { api } from './api'
import { FeedbackBox } from './FeedbackBox'
import { loadProgress, loadTalk, missedIds, resetProgress, sessionStats, talkStats } from './progress'
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

// The first two screens:
//   home     = pick one of two ways to study: talk to Johannes, or practise by module
//   practice = the modules (sessions, guest lectures, readings) with your progress on each
export function StartScreen({
  screen,
  initial,
  onStart,
  onChat,
  onScreen,
}: {
  screen: 'home' | 'practice'
  initial: Settings
  onStart: (s: Settings, onlyIds?: string[]) => void
  onChat: () => void
  onScreen: (screen: 'home' | 'practice') => void
}) {
  const [settings, setSettings] = useState({ ...initial, length: initial.lengthPref ?? initial.length, quick: false })
  const [progress, setProgress] = useState(loadProgress)
  const [talk, setTalk] = useState(loadTalk)
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
          className="card settings"
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

  const all = sessions ?? []
  const totalQuestions = all.reduce((n, s) => n + s.count, 0)
  const tried = Object.keys(progress).length
  const right = Object.values(progress).filter((p) => p.verdict === 'correct').length
  const talked = talkStats(talk)
  const missed = missedIds(progress)

  if (screen === 'home') {
    return (
      <section className="start">
        <h1>Practise for the Sustainable Logistics exam</h1>
        <p className="lede">Two ways to get ready. Pick one, switch whenever you like.</p>

        <div className="modes">
          <button className="card mode" type="button" disabled={!sessions} onClick={onChat}>
            <span className="card-icon card-icon-talk" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26">
                <path
                  d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.6 3.9a.6.6 0 0 1-1-.46V16A2.5 2.5 0 0 1 4 13.5z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span className="mode-title">
              Talk to Johannes <span className="tag">AI tutor</span>
            </span>
            <span className="mode-text">
              A conversation about the course, out loud or typed. Ask anything, let him quiz you, or do a mock oral
              exam.
            </span>
            <span className="mode-stat">
              {talked.answered > 0
                ? `So far: ${talked.right} of ${talked.answered} of his questions right`
                : 'He answers in Prof. Meuer’s voice'}
            </span>
            <span className="btn primary mode-go">Start talking</span>
          </button>

          <button className="card mode" type="button" disabled={!sessions} onClick={() => onScreen('practice')}>
            <span className="card-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M9 6h11M9 12h11M9 18h11" />
                <circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
                <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
                <circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="mode-title">Practise by module</span>
            <span className="mode-text">
              Exam-style questions, session by session, with feedback, the slide it comes from, and your progress.
            </span>
            <span className="mode-stat">
              {tried > 0
                ? `So far: ${tried} of ${totalQuestions} questions tried, ${right} right`
                : sessions
                  ? `${totalQuestions} questions in ${all.length} modules`
                  : 'Loading…'}
            </span>
            <span className="btn primary mode-go">Choose a module</span>
          </button>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="feedback-row">
          <FeedbackBox where="home" />
        </div>
        <p className="fineprint">
          Everything comes only from this year&rsquo;s course material. This is practice, not the real exam.
        </p>
      </section>
    )
  }

  // ---------- Practise by module ----------
  const ALL = 999 // "All" stays "All" for whichever module you start
  const availableIn = (s: SessionInfo) =>
    settings.difficulty === 'mixed' ? s.count : (s.byDifficulty?.[settings.difficulty] ?? s.count)
  const lengthLabel = settings.length >= ALL ? 'all questions' : `${settings.length} questions`
  const difficultyLabel = settings.difficulty === 'mixed' ? 'mixed difficulty' : settings.difficulty
  const startModule = (session: string, available: number) => {
    if (available > 0) {
      onStart({ ...settings, session, length: Math.min(settings.length, available), lengthPref: settings.length, quick: false })
    }
  }
  const everything = all.reduce((n, s) => n + availableIn(s), 0)

  return (
    <section className="start">
      <button className="btn ghost sm back" type="button" onClick={() => onScreen('home')}>
        <span aria-hidden="true">←</span> Back
      </button>
      <h1>Practise by module</h1>
      <p className="lede">Pick a module to start. Your progress stays in this browser.</p>

      <div className="card quick-card">
        <span className="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" fill="currentColor" />
          </svg>
        </span>
        <div className="quick-text">
          <h2>Quick 5</h2>
          <p>Five multiple-choice questions from everything so far. About three minutes, good for the bus.</p>
        </div>
        <button
          className="btn primary"
          type="button"
          disabled={!sessions}
          onClick={() =>
            onStart({ ...settings, session: 'all', difficulty: 'mixed', length: 5, lengthPref: settings.length, quick: true })
          }
        >
          Start Quick 5
        </button>
      </div>

      <div className="card">
        <div className="modules-head">
          <h2>Modules</h2>
          <details className="options">
            <summary>
              Options: {difficultyLabel}, {lengthLabel}, {settings.voice ? 'talking' : 'typing'}
            </summary>
            <div className="settings options-body">
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
                legend="Questions per round"
                name="length"
                value={String(settings.length >= ALL ? ALL : settings.length)}
                options={[
                  { value: '5', label: '5' },
                  { value: '10', label: '10' },
                  { value: '15', label: '15' },
                  { value: String(ALL), label: 'All' },
                ]}
                onChange={(n) => setSettings({ ...settings, length: Number(n) })}
              />
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
            </div>
          </details>
        </div>

        <ul className="modules">
          <li>
            <button className="module" type="button" disabled={!sessions || everything === 0} onClick={() => startModule('all', everything)}>
              <span className="module-name">Everything, mixed</span>
              <ModuleBar right={right} tried={tried} count={totalQuestions} />
              <span className="module-count">{tried === 0 ? `${totalQuestions} questions` : `${right} of ${totalQuestions} right`}</span>
              <span className="module-go" aria-hidden="true">→</span>
            </button>
          </li>
          {all.map((s) => {
            const st = sessionStats(progress, s.session)
            const withJohannes = talkStats(talk, s.session)
            const available = availableIn(s)
            return (
              <li key={s.session}>
                <button
                  className="module"
                  type="button"
                  disabled={available === 0}
                  onClick={() => startModule(String(s.session), available)}
                >
                  <span className="module-name">
                    {s.label ?? `Session ${s.session}`}
                    {withJohannes.answered > 0 && (
                      <small>
                        With Johannes: {withJohannes.right} of {withJohannes.answered} right
                      </small>
                    )}
                  </span>
                  <ModuleBar right={st.right} tried={st.tried} count={s.count} />
                  <span className="module-count">
                    {available === 0
                      ? `no ${settings.difficulty} questions`
                      : st.tried === 0
                        ? `${s.count} questions`
                        : `${st.right} of ${s.count} right`}
                  </span>
                  <span className="module-go" aria-hidden="true">→</span>
                </button>
              </li>
            )
          })}
        </ul>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {(missed.length > 0 || tried > 0 || talked.answered > 0) && (
          <div className="actions">
            {missed.length > 0 && (
              <button
                className="btn secondary"
                type="button"
                onClick={() =>
                  onStart({ ...settings, session: 'all', difficulty: 'mixed', lengthPref: settings.length, quick: false }, missed)
                }
              >
                Practise the {missed.length} you missed
              </button>
            )}
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                resetProgress()
                setProgress({})
                setTalk([])
              }}
            >
              Reset my progress
            </button>
          </div>
        )}
      </div>

      <p className="fineprint">Questions come only from the course material. This is practice, not the real exam.</p>
    </section>
  )
}

// Green = right, amber = tried but not right yet.
function ModuleBar({ right, tried, count }: { right: number; tried: number; count: number }) {
  const pct = (n: number) => `${count > 0 ? (100 * n) / count : 0}%`
  return (
    <span className="progress-bar" role="img" aria-label={`${right} right and ${tried - right} not yet, out of ${count}`}>
      <span className="progress-right" style={{ width: pct(right) }} />
      <span className="progress-tried" style={{ width: pct(tried - right) }} />
    </span>
  )
}
