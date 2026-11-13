import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { formatSource } from './format'
import { MicHelpBox } from './MicButton'
import { ArrowIcon, LectureClip, MicIcon, Slides, SpeakerIcon, StopIcon } from './QuestionView'
import { Tutor } from './Tutor'
import { clock, useRecorder } from './useRecorder'
import { onSpeakingChange, speak, stopSpeaking } from './voice'
import type { ChatMessage } from './types'

// "Talk to Johannes": a conversation with the course tutor, by typing or by voice.
// The tutor answers only from the course material, follows up, and can quiz the student.
// Nothing is saved: the conversation lives in this tab and is gone when you leave.

const GREETING: ChatMessage = {
  role: 'assistant',
  local: true,
  text: 'Hi! Ask me anything from the course, or say “quiz me” and I’ll ask the questions. What’s on your mind?',
}

const STARTERS = [
  'Quiz me on carbon accounting',
  'Explain Scope 1, 2 and 3 simply',
  'Why is air freight so carbon-heavy?',
  'When does an electric truck pay off?',
]

export function ChatView({ readAloud }: { readAloud: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audioNote, setAudioNote] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [typing, setTyping] = useState(false) // the mic can't be used: point to the text box
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Speak the next reply if the student used their voice, even with "Read aloud" off.
  const voiceTurn = useRef(false)

  useEffect(() => onSpeakingChange(setSpeaking), [])
  useEffect(() => () => stopSpeaking(), [])

  function say(text: string) {
    setAudioNote(null)
    speak(text).catch(() => setAudioNote('The audio couldn’t play. Tap “Listen” to try again.'))
  }

  async function send(text: string, byVoice = false) {
    const said = text.trim()
    if (!said || busy) return
    stopSpeaking()
    voiceTurn.current = byVoice
    const next: ChatMessage[] = [...messages, { role: 'user', text: said }]
    setMessages(next)
    setDraft('')
    await ask(next)
  }

  async function ask(history: ChatMessage[]) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.chat(history.filter((m) => !m.local).map((m) => ({ role: m.role, content: m.text })))
      setMessages([...history, { role: 'assistant', text: res.reply, sources: res.sources }])
      if (readAloud || voiceTurn.current) say(res.reply)
    } catch {
      setError('That didn’t go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const rec = useRecorder((said) => void send(said, true))

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, error])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') stopSpeaking()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const recording = rec.state === 'recording'
  const tutorState = recording ? 'listening' : busy || rec.state === 'working' ? 'thinking' : speaking ? 'speaking' : 'idle'
  const fresh = messages.length === 1
  const waitingForRetry = !!error && messages[messages.length - 1].role === 'user'

  return (
    <section className="chat">
      <div className="chat-head">
        <Tutor
          state={tutorState}
          labels={{ idle: 'Talk to Johannes', speaking: 'Talking…', listening: 'Listening…', thinking: 'Thinking…' }}
        />
        <div className="chat-head-actions">
          {speaking && (
            <button className="btn secondary sm" type="button" onClick={stopSpeaking}>
              <StopIcon /> Stop
            </button>
          )}
          {!fresh && (
            <button
              className="btn ghost sm"
              type="button"
              onClick={() => {
                stopSpeaking()
                setMessages([GREETING])
                setError(null)
              }}
              disabled={busy || recording}
            >
              New chat
            </button>
          )}
        </div>
      </div>

      <ol className="chat-log" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={`msg msg-${m.role}`}>
            <p className="msg-text">{m.text}</p>
            {m.role === 'assistant' && !m.local && (
              <div className="msg-extra">
                <button className="btn ghost sm" type="button" onClick={() => say(m.text)}>
                  <SpeakerIcon /> Listen
                </button>
                {m.sources && m.sources.length > 0 && (
                  <details className="msg-sources">
                    <summary>Where this comes from</summary>
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

      {fresh && (
        <div className="starters">
          {STARTERS.map((s) => (
            <button key={s} className="btn secondary sm" type="button" onClick={() => void send(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}
      {fresh && (
        <p className="note chat-note">
          This is an AI tutor. It answers only from this year&rsquo;s course material and can still get things wrong,
          so the slides have the last word. Please don&rsquo;t share personal details: what you say or type is sent
          to Anthropic and ElevenLabs to create the reply, and isn&rsquo;t saved by this site.
        </p>
      )}

      {error && (
        <div className="error-block" role="alert">
          <p>{error}</p>
          {waitingForRetry && (
            <button className="btn primary sm" type="button" onClick={() => void ask(messages)}>
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
      {audioNote && <p className="note">{audioNote}</p>}
      {rec.help && (
        <MicHelpBox
          help={rec.help}
          onRetry={rec.start}
          onDismiss={() => {
            rec.dismissHelp()
            setTyping(true)
            inputRef.current?.focus()
          }}
        />
      )}
      <div ref={endRef} className="chat-end" />

      {/* Bottom bar: type on the left, or tap the big mic and just talk. */}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
      >
        <span className="composer-status" aria-live="polite">
          {recording
            ? `Listening · ${clock(rec.seconds)} · tap the mic when you’re done`
            : rec.state === 'working'
              ? 'Turning it into text…'
              : busy
                ? 'Thinking…'
                : typing
                  ? 'Type your question below'
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
            onClick={rec.toggle}
            disabled={busy || rec.state === 'working'}
            aria-pressed={recording}
            aria-label={recording ? 'Stop and send' : 'Talk'}
          >
            <MicIcon recording={recording} />
          </button>
        </div>
      </form>
    </section>
  )
}
