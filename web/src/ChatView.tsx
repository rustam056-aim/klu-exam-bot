import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { formatSource, slideImages } from './format'
import { FeedbackBox } from './FeedbackBox'
import { MicHelpBox } from './MicButton'
import { saveTalkAnswer } from './progress'
import { ArrowIcon, LectureClip, MicIcon, Slides, SpeakerIcon, StopIcon } from './QuestionView'
import { Tutor } from './Tutor'
import { clock, useRecorder } from './useRecorder'
import { chime, onSpeakingChange, speak, stopSpeaking, unlockAudio } from './voice'
import type { ChatMessage, ChatSeed } from './types'

// "Talk to Johannes": a conversation with the course tutor.
// Two ways to use it, sharing one conversation:
//   Talk: like a call. He speaks, you answer out loud; with hands-free on, the mic opens by itself
//         after he finishes and closes when you stop talking. Tap the button to interrupt him.
//   Type: a normal chat with a text box (and a mic button).
// The tutor answers only from the course material. Nothing is saved: the conversation lives in
// this tab and is gone when you leave.

const GREETING: ChatMessage = {
  role: 'assistant',
  local: true,
  text: 'Hi! Don’t expect to be fed, be hungry. Ask me anything from the course, or say “quiz me”.',
}

const STARTERS = [
  'Quiz me on carbon accounting',
  'Give me a mock oral exam',
  'Why is air freight so carbon-heavy?',
  'When does an electric truck pay off?',
]

const seedText = (seed: ChatSeed) =>
  `I got this practice question wrong and want to talk it through.\nQuestion: ${seed.question}\nMy answer: ${seed.answer || '(I skipped it)'}`

function remembered(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === 'on'
  } catch {
    return fallback
  }
}

export function ChatView({ readAloud, seed }: { readAloud: boolean; seed?: ChatSeed }) {
  const [view, setView] = useState<'call' | 'chat'>('call')
  const [handsFree, setHandsFree] = useState(() => remembered('handsFree', true))
  const [messages, setMessages] = useState<ChatMessage[]>(seed ? [] : [GREETING])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [score, setScore] = useState({ answered: 0, right: 0 }) // his questions in this talk
  const [slideOpen, setSlideOpen] = useState(false) // Talk view: the slide shows only when asked for
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)
  const seeded = useRef(false)
  // The latest values, for code that continues after a long wait (a reply, the end of a sentence).
  const now = useRef({ view, handsFree, readAloud })
  now.current = { view, handsFree, readAloud }

  useEffect(() => onSpeakingChange(setSpeaking), [])

  const rec = useRecorder((said) => void send(said, true), {
    autoStop: handsFree && view === 'call',
    onNothing: () => setNote('I’m here when you’re ready. Tap the mic to talk.'),
  })
  const recRef = useRef(rec)
  recRef.current = rec

  // Auto mic: when he has finished talking, open the mic for the student's turn, with a soft
  // "your turn" sound so it's clear when to talk.
  function listenIfHandsFree() {
    if (mounted.current && now.current.handsFree && now.current.view === 'call') {
      chime()
      recRef.current.start()
    }
  }

  // Reads a reply aloud. True when he got to the end (false: stopped, interrupted, or no sound).
  async function say(text: string): Promise<boolean> {
    setNote(null)
    try {
      return await speak(text, { chat: true })
    } catch {
      if (mounted.current) setNote('The sound didn’t start. Tap “Listen” to hear it.')
      return false
    }
  }

  async function ask(history: ChatMessage[], speakIt: boolean, wrapUp = false) {
    setBusy(true)
    setError(null)
    setNote(null)
    setSlideOpen(false)
    try {
      const res = await api.chat(
        history.filter((m) => !m.local).map((m) => ({ role: m.role, content: m.text })),
        wrapUp,
      )
      if (!mounted.current) return
      if (res.check) {
        // He had asked a question and the student answered: keep the score.
        saveTalkAnswer(res.check)
        const right = res.check.result === 'right' ? 1 : 0
        setScore((s) => ({ answered: s.answered + 1, right: s.right + right }))
      }
      setMessages([...history, { role: 'assistant', text: res.reply, sources: res.sources, wrap: wrapUp }])
      setBusy(false)
      if (speakIt && (await say(res.reply))) listenIfHandsFree()
    } catch {
      if (!mounted.current) return
      setError('That didn’t go through. Try again.')
      setBusy(false)
    }
  }

  async function send(text: string, byVoice = false, wrapUp = false) {
    const said = text.trim()
    if (!said || busy) return
    stopSpeaking()
    const next: ChatMessage[] = [...messages, { role: 'user', text: said }]
    setMessages(next)
    setDraft('')
    await ask(next, now.current.view === 'call' || now.current.readAloud || byVoice, wrapUp)
  }

  // On arrival: either talk through the question the student brought, or say hello.
  useEffect(() => {
    mounted.current = true
    if (seed) {
      if (!seeded.current) {
        seeded.current = true
        void send(seedText(seed))
      }
    } else {
      void say(GREETING.text).then((done) => {
        if (done) listenIfHandsFree()
      })
    }
    return () => {
      mounted.current = false
      stopSpeaking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('handsFree', handsFree ? 'on' : 'off')
    } catch {
      /* private mode: just don't remember it */
    }
  }, [handsFree])

  // Type view: keep the newest message in sight.
  useEffect(() => {
    if (view === 'chat') endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, error, view])

  const recording = rec.state === 'recording'

  // The big button: talk, finish talking, or cut him off and talk.
  function bigTap() {
    unlockAudio()
    setNote(null)
    if (recording) {
      rec.stop()
      return
    }
    if (speaking) stopSpeaking()
    chime()
    rec.start()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') stopSpeaking()
      const tag = (e.target as HTMLElement).tagName
      if (e.key === ' ' && view === 'call' && tag !== 'BUTTON' && tag !== 'TEXTAREA' && !busy && rec.state !== 'working') {
        e.preventDefault()
        bigTap()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tutorState = recording ? 'listening' : busy || rec.state === 'working' ? 'thinking' : speaking ? 'speaking' : 'idle'
  const userTurns = messages.filter((m) => m.role === 'user').length
  const fresh = userTurns === 0
  const last = messages[messages.length - 1]
  const lastTutor = [...messages].reverse().find((m) => m.role === 'assistant')
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const waitingForRetry = !!error && last?.role === 'user'
  const canWrapUp = userTurns >= 2 && !busy && !recording && last?.role === 'assistant' && !last.wrap
  const slideSource = lastTutor?.sources?.find((s) => slideImages(s).length > 0)

  const starters = fresh && !busy && (
    <div className="starters">
      {STARTERS.map((s) => (
        <button
          key={s}
          className="btn secondary sm"
          type="button"
          onClick={() => {
            unlockAudio()
            void send(s)
          }}
        >
          {s}
        </button>
      ))}
    </div>
  )
  const smallPrint = fresh && (
    <p className="note chat-note">
      This is an AI tutor. It answers only from this year&rsquo;s course material and can still get things wrong, so
      the slides have the last word. Please don&rsquo;t share personal details: what you say or type is sent to
      Anthropic and ElevenLabs to create the reply, and isn&rsquo;t saved by this site.
    </p>
  )
  const problems = (
    <>
      {error && (
        <div className="error-block" role="alert">
          <p>{error}</p>
          {waitingForRetry && (
            <button className="btn primary sm" type="button" onClick={() => void ask(messages, view === 'call' || readAloud)}>
              Try again
            </button>
          )}
        </div>
      )}
      {rec.error && (
        <p className="error" role="alert">
          {rec.error}
        </p>
      )}
      {note && <p className="note">{note}</p>}
      {rec.help && (
        <MicHelpBox
          help={rec.help}
          onRetry={rec.start}
          onDismiss={() => {
            rec.dismissHelp()
            setView('chat')
            window.setTimeout(() => inputRef.current?.focus(), 50)
          }}
        />
      )}
    </>
  )

  return (
    <section className={`chat chat-${view}`}>
      <div className="chat-head">
        <div className="seg" role="tablist" aria-label="How you talk to the tutor">
          <button type="button" role="tab" aria-selected={view === 'call'} onClick={() => setView('call')}>
            Talk
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'chat'}
            onClick={() => {
              if (recording) rec.cancel()
              setView('chat')
            }}
          >
            Type
          </button>
        </div>
        <div className="chat-head-actions">
          {score.answered > 0 && (
            <span className="tag score-tag" title="His questions you answered in this talk">
              {score.right} of {score.answered} right
            </span>
          )}
          {view === 'chat' && speaking && (
            <button className="btn secondary sm" type="button" onClick={stopSpeaking}>
              <StopIcon /> Stop
            </button>
          )}
          {canWrapUp && (
            <button
              className="btn secondary sm"
              type="button"
              onClick={() => {
                unlockAudio()
                void send('Let’s wrap up.', false, true)
              }}
            >
              Wrap up
            </button>
          )}
          {!fresh && (
            <button
              className="btn ghost sm"
              type="button"
              onClick={() => {
                stopSpeaking()
                rec.cancel()
                setMessages([GREETING])
                setScore({ answered: 0, right: 0 })
                setError(null)
                setNote(null)
              }}
              disabled={busy}
            >
              New chat
            </button>
          )}
        </div>
      </div>

      {view === 'call' ? (
        <div className="call">
          <Tutor
            big
            state={tutorState}
            labels={{
              idle: 'Tap the mic to talk',
              speaking: 'Johannes is talking',
              listening: 'Your turn, I’m listening',
              thinking: 'Thinking…',
            }}
          />
          {lastUser && <p className="call-you">You: {lastUser.text}</p>}
          {busy ? (
            <p className="call-line call-wait" aria-label="Thinking">
              <span />
              <span />
              <span />
            </p>
          ) : (
            lastTutor && (
              <p className="call-line" aria-live="polite">
                {lastTutor.text}
              </p>
            )
          )}
          {!busy && lastTutor?.sources && lastTutor.sources.length > 0 && (
            <div className="call-source">
              {/* The slide is a hint you ask for, not something that pops up by itself. */}
              {slideSource && !slideOpen && (
                <button className="btn ghost sm" type="button" onClick={() => setSlideOpen(true)}>
                  Show the slide
                </button>
              )}
              {(slideOpen || !slideSource) && (
                <p className="source">From the course: {lastTutor.sources.map(formatSource).join(' · ')}</p>
              )}
              {slideSource && slideOpen && <Slides source={slideSource} />}
            </div>
          )}
          {starters}
          {problems}
          {last?.wrap && <FeedbackBox where="talk" compact />}
          {fresh && (
            <p className="note chat-note">
              {handsFree ? (
                <>
                  <strong>Auto mic is on:</strong> the mic opens by itself each time Johannes finishes (you&rsquo;ll
                  hear a soft tone). Just answer, he notices when you stop. Tap the button any time to interrupt him.
                  Prefer to tap for every turn? Switch it off bottom left.
                </>
              ) : (
                <>
                  <strong>Auto mic is off:</strong> tap the button to talk, and tap again when you&rsquo;re done.
                </>
              )}
            </p>
          )}
          {smallPrint}

          {/* Bottom bar: one big button, like a call. */}
          <div className="dock" role="toolbar" aria-label="Voice controls">
            <div className="dock-side">
              <button
                className={`switch ${handsFree ? 'is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={handsFree}
                onClick={() => setHandsFree(!handsFree)}
              >
                <span className="switch-track" aria-hidden="true" />
                Auto mic
              </button>
            </div>
            <div className="dock-main">
              <button
                type="button"
                className={`round round-${busy ? 'working' : rec.state}`}
                onClick={bigTap}
                disabled={busy || rec.state === 'working'}
                aria-pressed={recording}
                aria-label={recording ? 'Done talking' : speaking ? 'Interrupt and talk' : 'Talk'}
              >
                <MicIcon recording={recording} />
              </button>
              <span className="dock-label" aria-live="polite">
                {recording
                  ? handsFree
                    ? `${clock(rec.seconds)} · just talk, I’ll notice when you stop`
                    : `${clock(rec.seconds)} · tap when you’re done`
                  : rec.state === 'working'
                    ? 'Got it…'
                    : busy
                      ? 'Thinking…'
                      : speaking
                        ? 'Tap to interrupt'
                        : handsFree
                          ? 'Tap once, then just talk'
                          : 'Tap to talk'}
              </span>
            </div>
            <div className="dock-side dock-right">
              {speaking && (
                <button className="btn secondary sm" type="button" onClick={stopSpeaking}>
                  <StopIcon /> Stop
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <ol className="chat-log" aria-live="polite">
            {messages.map((m, i) => (
              <li key={i} className={`msg msg-${m.role}`}>
                <p className="msg-text">{m.text}</p>
                {m.role === 'assistant' && !m.local && (
                  <div className="msg-extra">
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={() => {
                        unlockAudio()
                        void say(m.text)
                      }}
                    >
                      <SpeakerIcon /> Listen
                    </button>
                    {m.sources && m.sources.length > 0 && (
                      <details className="msg-sources" open={m.wrap}>
                        <summary>{m.wrap ? 'Look at these again' : 'Where this comes from'}</summary>
                        {m.sources.map((s) => (
                          <div key={s}>
                            <p className="source">{formatSource(s)}</p>
                            <Slides source={s} />
                            <LectureClip source={s} />
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                )}
              </li>
            ))}
            {busy && (
              <li className="msg msg-assistant msg-wait" aria-label="Thinking">
                <span />
                <span />
                <span />
              </li>
            )}
          </ol>
          {starters}
          {smallPrint}
          {problems}
          {last?.wrap && <FeedbackBox where="talk" compact />}
          <div ref={endRef} className="chat-end" />

          {/* Bottom bar: type, or tap the mic and say it. */}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault()
              unlockAudio()
              void send(draft)
            }}
          >
            <span className="composer-status" aria-live="polite">
              {recording
                ? `Listening · ${clock(rec.seconds)} · tap the mic when you’re done`
                : rec.state === 'working'
                  ? 'Got it…'
                  : busy
                    ? 'Thinking…'
                    : 'Type, or tap the mic and talk'}
            </span>
            <div className="composer-row">
              <label className="composer-field">
                <span className="sr-only">Your message</span>
                <textarea
                  ref={inputRef}
                  value={draft}
                  rows={1}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      unlockAudio()
                      void send(draft)
                    }
                  }}
                  placeholder="Ask about the course…"
                  disabled={recording}
                  maxLength={1500}
                />
                <button className="composer-send" type="submit" disabled={!draft.trim() || busy} aria-label="Send">
                  <ArrowIcon />
                </button>
              </label>
              <button
                type="button"
                className={`round round-${busy ? 'idle' : rec.state}`}
                onClick={bigTap}
                disabled={busy || rec.state === 'working'}
                aria-pressed={recording}
                aria-label={recording ? 'Stop and send' : 'Talk'}
              >
                <MicIcon recording={recording} />
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
