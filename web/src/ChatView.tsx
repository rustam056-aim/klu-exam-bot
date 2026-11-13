import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { formatSource, slideImages } from './format'
import { FeedbackBox } from './FeedbackBox'
import { MicHelpBox } from './MicButton'
import { saveTalkAnswer } from './progress'
import { ArrowIcon, LectureClip, MicIcon, Slides, SpeakerIcon, StopIcon } from './QuestionView'
import { Tutor } from './Tutor'
import { clock, useRecorder } from './useRecorder'
import { soundsLikeEcho, useLiveMic } from './liveMic'
import {
  chime,
  onSpeakingChange,
  pauseSpeaking,
  resumeSpeaking,
  speak,
  stopSpeaking,
  transcribe,
  unlockAudio,
} from './voice'
import type { ChatMessage, ChatSeed } from './types'

// "Talk to Johannes": a conversation with the course tutor.
// Two ways to use it, sharing one conversation:
//   Talk: like a call. Tap once and the mic stays on ("Hands-free"): just talk, he notices when
//         you stop, and you can interrupt him simply by talking. With it off: tap to talk, tap to send.
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
  const [handsFree, setHandsFree] = useState(() => remembered('alwaysListening', true))
  const [transcribing, setTranscribing] = useState(false) // always-on mic: turning speech into text
  const [messages, setMessages] = useState<ChatMessage[]>(seed ? [] : [GREETING])
  const [draft, setDraft] = useState('')
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const setBusy = (value: boolean) => {
    busyRef.current = value
    setBusyState(value)
  }
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [score, setScore] = useState({ answered: 0, right: 0 }) // his questions in this talk
  const [slideOpen, setSlideOpen] = useState(false) // Talk view: the slide shows only when asked for
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)
  const seeded = useRef(false)
  // The latest values, for code that continues after a long wait (a reply, the end of a sentence).
  const now = useRef({ view, handsFree, readAloud })
  now.current = { view, handsFree, readAloud }

  useEffect(() => onSpeakingChange(setSpeaking), [])

  // Tap to talk, tap to send: the Type view's mic, and Talk with "Hands-free" off.
  const rec = useRecorder((said) => void send(said, true))

  // Hands-free: the mic stays on during the call. When the student starts talking while
  // Johannes speaks, he pauses; if it was really the student (not a cough, not his own echo),
  // he stops and listens, otherwise he carries on.
  const pausedForStudent = useRef(false)
  const live = useLiveMic({
    onSpeechStart: () => {
      setNote(null)
      pausedForStudent.current = pauseSpeaking()
    },
    onFalseStart: () => {
      if (pausedForStudent.current) resumeSpeaking()
      pausedForStudent.current = false
    },
    onUtterance: (wav) => void heard(wav),
  })
  const liveRef = useRef(live)
  liveRef.current = live

  async function heard(wav: Blob) {
    const wasPaused = pausedForStudent.current
    pausedForStudent.current = false
    liveRef.current.mute(true)
    setTranscribing(true)
    let text = ''
    try {
      text = (await transcribe(wav)).trim()
    } catch {
      if (mounted.current) setNote('That didn’t come through. Say it again?')
    }
    if (!mounted.current) return
    setTranscribing(false)
    const his = [...messagesRef.current].reverse().find((m) => m.role === 'assistant')?.text ?? ''
    if (!text || (wasPaused && soundsLikeEcho(text, his))) {
      // Nothing real: carry on where he was.
      if (wasPaused) resumeSpeaking()
      liveRef.current.mute(false)
      return
    }
    stopSpeaking()
    await send(text, true)
    liveRef.current.mute(false)
  }

  // When he has finished talking: a soft "your turn" tone (the mic is already on).
  function yourTurn() {
    if (!mounted.current || now.current.view !== 'call') return
    if (liveRef.current.on) chime()
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
      if (speakIt && (await say(res.reply))) yourTurn()
    } catch (err) {
      if (!mounted.current) return
      const reason = err instanceof Error ? err.message.match(/\((\w+)\)/)?.[1] : undefined
      setError(`That didn’t go through${reason ? ` (code ${reason})` : ''}. Try again.`)
      setBusy(false)
    }
  }

  async function send(text: string, byVoice = false, wrapUp = false) {
    const said = text.trim()
    if (!said || busyRef.current) return
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
        if (done) yourTurn()
      })
    }
    // Hands-free: the mic goes on right away, so the student can even cut into the greeting.
    if (now.current.handsFree) live.start()
    return () => {
      mounted.current = false
      stopSpeaking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('alwaysListening', handsFree ? 'on' : 'off')
    } catch {
      /* private mode: just don't remember it */
    }
  }, [handsFree])

  // Type view: keep the newest message in sight.
  useEffect(() => {
    if (view === 'chat') endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, error, view])

  // The mic listens only while it's the student's turn: not while we wait for his reply or turn
  // speech into text; while he talks it only reacts to clear speech (so his own voice can't cut him off).
  useEffect(() => {
    live.mute(busy || transcribing)
    live.strict(speaking)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, transcribing, speaking])

  const recording = rec.state === 'recording'
  const liveOn = view === 'call' && handsFree && live.on

  // The big button.
  //   Hands-free, mic on:  while he talks = interrupt him; otherwise = pause the mic.
  //   Hands-free, mic off: switch it on.
  //   Tap-to-talk:               talk / send.
  function bigTap() {
    unlockAudio()
    setNote(null)
    if (view === 'call' && handsFree) {
      if (live.state === 'hearing') {
        live.flush() // done talking: send it now
        return
      }
      if (live.on && speaking) {
        stopSpeaking()
        return
      }
      if (live.on) live.stop()
      else {
        if (speaking) stopSpeaking()
        chime()
        live.start()
      }
      return
    }
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

  const tutorState =
    recording || live.state === 'hearing'
      ? 'listening'
      : busy || transcribing || rec.state === 'working'
        ? 'thinking'
        : speaking
          ? 'speaking'
          : liveOn
            ? 'listening'
            : 'idle'
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
      {live.help && (
        <MicHelpBox
          help={live.help}
          onRetry={live.start}
          onDismiss={() => {
            live.dismissHelp()
            setView('chat')
            window.setTimeout(() => inputRef.current?.focus(), 50)
          }}
        />
      )}
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
          <button type="button" role="tab" aria-selected={view === 'call'} onClick={() => {
              unlockAudio()
              setView('call')
              if (handsFree) live.start()
            }}>
            Talk
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'chat'}
            onClick={() => {
              if (recording) rec.cancel()
              live.stop()
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
                live.drop()
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
              idle: handsFree ? 'Tap the mic once to start' : 'Tap the mic to talk',
              speaking: liveOn ? 'Johannes is talking, just talk to cut in' : 'Johannes is talking',
              listening: live.state === 'hearing' || recording ? 'I’m listening…' : 'Your turn, just talk',
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
          {smallPrint}

          {/* Bottom bar: one big button, like a call. */}
          <div className="dock" role="toolbar" aria-label="Voice controls">
            <div className="dock-side">
              <button
                className={`switch ${handsFree ? 'is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={handsFree}
                onClick={() => {
                  if (handsFree) live.stop()
                  else rec.cancel()
                  setHandsFree(!handsFree)
                }}
              >
                <span className="switch-track" aria-hidden="true" />
                Hands-free
              </button>
            </div>
            <div className="dock-main">
              <button
                type="button"
                className={`round round-${
                  busy || transcribing
                    ? 'working'
                    : live.state === 'hearing'
                      ? 'recording'
                      : liveOn
                        ? 'live'
                        : rec.state
                }`}
                onClick={bigTap}
                disabled={busy || transcribing || rec.state === 'working' || live.state === 'starting'}
                aria-pressed={recording || liveOn}
                aria-label={
                  handsFree
                    ? live.state === 'hearing'
                      ? 'Done, send it'
                      : liveOn
                      ? speaking
                        ? 'Stop him'
                        : 'Pause the mic'
                      : 'Turn the mic on'
                    : recording
                      ? 'Done talking'
                      : speaking
                        ? 'Interrupt and talk'
                        : 'Talk'
                }
              >
                <MicIcon recording={recording} />
              </button>
              <span className="dock-label" aria-live="polite">
                {handsFree
                  ? transcribing
                    ? 'Got it…'
                    : busy
                      ? 'Thinking…'
                      : live.state === 'starting'
                        ? 'Starting the mic…'
                        : live.state === 'hearing'
                          ? 'Listening… tap when done'
                          : liveOn
                            ? speaking
                              ? 'Just talk to cut in'
                              : 'Mic on · just talk'
                            : 'Tap once, then just talk'
                  : recording
                  ? `${clock(rec.seconds)} · tap when you’re done`
                  : rec.state === 'working'
                    ? 'Got it…'
                    : busy
                      ? 'Thinking…'
                      : speaking
                        ? 'Tap to interrupt'
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
