import { useEffect, useState } from 'react'
import './App.css'
import { api } from './api'
import { ChatView } from './ChatView'
import { saveAttempt } from './progress'
import { stopSpeaking, unlockAudio } from './voice'
import { QuestionView } from './QuestionView'
import { RouteLine } from './RouteLine'
import type { Stop } from './RouteLine'
import { StartScreen } from './StartScreen'
import { Summary } from './Summary'
import type { Attempt, ChatSeed, PublicQuestion, Settings } from './types'

type Phase = 'start' | 'practice' | 'quiz' | 'summary' | 'chat'

export default function App() {
  const [phase, setPhase] = useState<Phase>('start')
  const [settings, setSettings] = useState<Settings>({ session: 'all', difficulty: 'mixed', length: 10, voice: false })
  const [only, setOnly] = useState<string[] | undefined>()
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [current, setCurrent] = useState<PublicQuestion | null>(null)
  const [total, setTotal] = useState(10)
  const [error, setError] = useState<string | null>(null)
  // The conversation: an optional question to talk through, and where "back" leads afterwards.
  const [chatSeed, setChatSeed] = useState<ChatSeed | undefined>()
  const [chatKey, setChatKey] = useState(0)
  const [backTo, setBackTo] = useState<Phase>('start')
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

  // inBackground: the student is in the conversation; get the next question ready without leaving it.
  async function loadNext(done: Attempt[], s: Settings, onlyIds?: string[], inBackground = false) {
    setError(null)
    setCurrent(null)
    try {
      const res = await api.next({
        session: s.session === 'all' ? undefined : s.session,
        difficulty: s.difficulty === 'mixed' ? undefined : s.difficulty,
        type: s.quick ? 'MC' : undefined,
        exclude: done.map((a) => a.question.id),
        only: onlyIds,
      })
      if (res.done) {
        if (inBackground) setBackTo('summary')
        else setPhase('summary')
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
    saveAttempt(attempt)
    const done = [...attempts, attempt]
    setAttempts(done)
    if (done.length >= total) setPhase('summary')
    else void loadNext(done, settings, only)
  }

  function openChat(seed?: ChatSeed) {
    setChatSeed(seed)
    setChatKey((k) => k + 1)
    setPhase('chat')
  }

  // "Talk it through" on a question: count the answer, open the conversation, and line up the
  // next question for when the student comes back.
  function talkThrough(attempt: Attempt, seed: ChatSeed) {
    saveAttempt(attempt)
    const done = [...attempts, attempt]
    setAttempts(done)
    if (done.length >= total) setBackTo('summary')
    else {
      setBackTo('quiz')
      void loadNext(done, settings, only, true)
    }
    openChat(seed)
  }

  const stops: Stop[] = Array.from({ length: total }, (_, i) =>
    i < attempts.length ? attempts[i].verdict : i === attempts.length ? 'current' : 'ahead',
  )

  return (
    <div className={`page page-${phase}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <button
            className="brand"
            type="button"
            onClick={() => {
              stopSpeaking()
              setPhase('start')
            }}
            aria-label="Sustainable Logistics exam practice: back to the start"
          >
            <img className="brand-logo" src="/klu-logo.png" alt="Kühne Logistics University" width="160" height="68" />
            <span className="brand-tag">
              Sustainable Logistics
              <span>Exam practice</span>
            </span>
          </button>
          <div className="topbar-actions">
            {phase === 'quiz' && settings.voice ? (
              <span className="mode-pill">Voice mode</span>
            ) : (
              <button
                className={`switch ${readAloud ? 'is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={readAloud}
                aria-label="Read aloud"
                onClick={() => {
                  if (readAloud) stopSpeaking()
                  setReadAloud(!readAloud)
                }}
              >
                <span className="switch-track" aria-hidden="true" />
                <span className="switch-label">Read aloud</span>
              </button>
            )}
            {phase === 'quiz' && (
              <button className="btn secondary sm" type="button" onClick={() => setPhase('summary')}>
                End practice
              </button>
            )}
            {phase === 'chat' && (
              <button
                className="btn secondary sm"
                type="button"
                onClick={() => {
                  stopSpeaking()
                  setPhase(backTo)
                }}
              >
                {backTo === 'start' ? 'End chat' : 'Back to practice'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app">
        {(phase === 'start' || phase === 'practice') && (
          <StartScreen
            screen={phase === 'start' ? 'home' : 'practice'}
            onScreen={(screen) => {
              setPhase(screen === 'home' ? 'start' : 'practice')
              window.scrollTo(0, 0)
            }}
            initial={settings}
            onStart={(s, ids) => start(s, ids)}
            onChat={() => {
              unlockAudio() // this click lets his greeting start by itself, also on iPhones
              setBackTo('start')
              openChat()
            }}
          />
        )}

        {phase === 'chat' && <ChatView key={chatKey} readAloud={readAloud} seed={chatSeed} />}

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
                readAloud={readAloud || settings.voice}
                voice={settings.voice}
                onDone={record}
                onTalk={talkThrough}
              />
            )}
          </>
        )}

        {phase === 'summary' && (
          <Summary
            attempts={attempts}
            onRetry={(ids) => start({ ...settings, session: 'all', difficulty: 'mixed', quick: false }, ids)}
            onRestart={() => setPhase('practice')}
          />
        )}
      </main>
    </div>
  )
}
