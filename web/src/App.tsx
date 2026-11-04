import { useEffect, useState } from 'react'
import './App.css'
import { api } from './api'
import { stopSpeaking } from './voice'
import { QuestionView } from './QuestionView'
import { RouteLine } from './RouteLine'
import type { Stop } from './RouteLine'
import { StartScreen } from './StartScreen'
import { Summary } from './Summary'
import type { Attempt, PublicQuestion, Settings } from './types'

type Phase = 'start' | 'quiz' | 'summary'

export default function App() {
  const [phase, setPhase] = useState<Phase>('start')
  const [settings, setSettings] = useState<Settings>({ session: 'all', difficulty: 'mixed', length: 10 })
  const [only, setOnly] = useState<string[] | undefined>()
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [current, setCurrent] = useState<PublicQuestion | null>(null)
  const [total, setTotal] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const [readAloud, setReadAloud] = useState<boolean>(() => {
    try {
      return localStorage.getItem('readAloud') === 'on'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('readAloud', readAloud ? 'on' : 'off')
    } catch {
      /* private mode: just don't remember it */
    }
  }, [readAloud])

  async function loadNext(done: Attempt[], s: Settings, onlyIds?: string[]) {
    setError(null)
    setCurrent(null)
    try {
      const res = await api.next({
        session: s.session === 'all' ? undefined : s.session,
        difficulty: s.difficulty === 'mixed' ? undefined : s.difficulty,
        exclude: done.map((a) => a.question.id),
        only: onlyIds,
      })
      if (res.done) {
        setPhase('summary')
        return
      }
      setCurrent(res.question)
      // Fewer questions available than asked for: shorten the route.
      setTotal((t) => Math.min(t, done.length + 1 + res.remaining))
    } catch {
      setError('The practice server is not responding. Try again in a minute.')
    }
  }

  function start(s: Settings, onlyIds?: string[]) {
    setSettings(s)
    setOnly(onlyIds)
    setAttempts([])
    setTotal(onlyIds ? onlyIds.length : s.length)
    setPhase('quiz')
    void loadNext([], s, onlyIds)
  }

  function record(attempt: Attempt) {
    const done = [...attempts, attempt]
    setAttempts(done)
    if (done.length >= total) setPhase('summary')
    else void loadNext(done, settings, only)
  }

  const stops: Stop[] = Array.from({ length: total }, (_, i) =>
    i < attempts.length ? attempts[i].verdict : i === attempts.length ? 'current' : 'ahead',
  )

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Sustainable Logistics: exam practice</span>
        <div className="topbar-actions">
          <button
            className={`switch ${readAloud ? 'is-on' : ''}`}
            type="button"
            role="switch"
            aria-checked={readAloud}
            onClick={() => {
              if (readAloud) stopSpeaking()
              setReadAloud(!readAloud)
            }}
          >
            <span className="switch-track" aria-hidden="true" />
            Read aloud
          </button>
          {phase === 'quiz' && (
            <button className="btn link" type="button" onClick={() => setPhase('summary')}>
              End practice
            </button>
          )}
        </div>
      </header>

      <main>
        {phase === 'start' && <StartScreen initial={settings} onStart={(s) => start(s)} />}

        {phase === 'quiz' && (
          <>
            <RouteLine stops={stops} />
            {error && (
              <div className="error-block" role="alert">
                <p>{error}</p>
                <button className="btn primary" type="button" onClick={() => void loadNext(attempts, settings, only)}>
                  Try again
                </button>
              </div>
            )}
            {current && (
              <QuestionView
                key={current.id}
                question={current}
                number={attempts.length + 1}
                total={total}
                readAloud={readAloud}
                onDone={record}
              />
            )}
          </>
        )}

        {phase === 'summary' && (
          <Summary
            attempts={attempts}
            onRetry={(ids) => start({ ...settings, session: 'all', difficulty: 'mixed' }, ids)}
            onRestart={() => setPhase('start')}
          />
        )}
      </main>
    </div>
  )
}
