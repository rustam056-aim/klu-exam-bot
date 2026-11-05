import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { difficultyLabel, formatSource, lectureAudio, opening, slideImages, verdictLabel } from './format'
import { MicHelpBox } from './MicButton'
import { spokenChoice } from './spokenChoice'
import { Tutor } from './Tutor'
import { clock, useRecorder } from './useRecorder'
import type { MicState } from './useRecorder'
import { onSpeakingChange, speak, stopSpeaking } from './voice'
import type { AnswerResult, Attempt, OpenResult, PublicQuestion, Verdict } from './types'

type Props = {
  question: PublicQuestion
  number: number
  total: number
  readAloud: boolean
  voice: boolean // voice mode: big mic at the bottom, answer by talking
  onDone: (attempt: Attempt) => void
}

// What gets read aloud: the question (with its options), and the feedback after checking.
function questionSpeech(q: PublicQuestion) {
  const options = q.options ? Object.entries(q.options).map(([k, v]) => `${k}: ${v}.`).join(' ') : ''
  return `${q.question} ${options}`.trim()
}

function feedbackSpeech(result: AnswerResult): string {
  if (result.type === 'MC') {
    return result.verdict === 'correct'
      ? `${opening('correct', result.id)} ${result.explanation}`
      : `${opening('wrong', result.id)} It’s ${result.correctOption}. ${result.explanation}`
  }
  if (result.verdict === 'not_graded_yet') {
    return `Compare your answer with the key points. ${result.keyPoints.join('. ')}.`
  }
  return [opening(result.verdict, result.id), result.feedback ?? ''].join(' ').trim()
}

// Self-check verdict for open answers, used when Claude grading isn't available.
function selfCheckVerdict(result: OpenResult, covered: Set<number>): Verdict {
  if (covered.size === 0) return 'wrong'
  return covered.size === result.keyPoints.length ? 'correct' : 'partly'
}

export function QuestionView({ question, number, total, readAloud, voice, onDone }: Props) {
  const [choice, setChoice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [heard, setHeard] = useState<string | null>(null) // voice mode: what the student said
  const [typing, setTyping] = useState(false) // voice mode: "type instead"
  const [hints, setHints] = useState<string[]>([])
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [covered, setCovered] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [audioNote, setAudioNote] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [micState, setMicState] = useState<MicState>('idle')
  useEffect(() => onSpeakingChange(setSpeaking), [])

  const isMC = question.type === 'MC'
  const answer = isMC ? choice : text.trim()

  // Voice mode: whatever the student says is checked straight away.
  const big = useRecorder((said) => {
    setError(null)
    if (!voice) {
      setText((prev) => (prev ? `${prev} ${said}` : said))
      return
    }
    setHeard(said)
    if (isMC) {
      const letter = spokenChoice(said, question.options ?? {})
      if (!letter) {
        setError('I didn’t catch a letter. Say A, B, C or D, or tap an option.')
        return
      }
      setChoice(letter)
      void check(letter)
    } else {
      setText(said)
      void check(said)
    }
  })
  useEffect(() => setMicState(big.state), [big.state])

  function say(text: string) {
    setAudioNote(null)
    speak(text).catch(() => setAudioNote('The audio couldn’t play. Use “Listen” to try again.'))
  }

  // Read the question when it appears (if read aloud is on); stop talking when it goes away.
  useEffect(() => {
    if (readAloud) say(questionSpeech(question))
    return () => stopSpeaking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (result && readAloud) say(feedbackSpeech(result))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  function verdict(): Verdict {
    if (!result) return 'skipped'
    if (result.type === 'MC') return result.verdict
    if (result.verdict === 'not_graded_yet') return selfCheckVerdict(result, covered)
    return result.verdict
  }

  async function check(given?: string) {
    const a = (given ?? answer ?? '').trim()
    if (!a || busy || result) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.answer(question.id, a))
    } catch {
      setError('Your answer could not be checked. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function showHint() {
    if (hints.length >= 2) return
    try {
      const h = await api.hint(question.id, (hints.length + 1) as 1 | 2)
      setHints([...hints, h.hint])
      if (voice) say(h.hint)
    } catch {
      setError('The hint could not be loaded. Try again.')
    }
  }

  function next() {
    onDone({ question, verdict: verdict(), source: result?.source ?? '', hintsUsed: hints.length })
  }

  function skip() {
    onDone({ question, verdict: 'skipped', source: '', hintsUsed: hints.length })
  }

  const feedbackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!result) return
    nextRef.current?.focus({ preventScroll: true })
    // Bring the feedback up above the bottom bar.
    feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [result])

  // Keyboard: A-D picks an option, Enter checks or moves on, Cmd/Ctrl+Enter checks a written answer,
  // Space in voice mode starts and stops the microphone.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        stopSpeaking()
        return
      }
      const inText = (e.target as HTMLElement).tagName === 'TEXTAREA'
      if (inText) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void check()
        }
        return
      }
      if (voice && e.key === ' ' && !result && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault()
        big.toggle()
        return
      }
      const key = e.key.toUpperCase()
      if (isMC && !result && question.options && key in question.options) {
        setChoice(key)
        if (voice) void check(key)
      }
      if (e.key === 'Enter' && !result && answer && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault()
        void check()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tutorState =
    micState === 'recording' ? 'listening' : busy || micState === 'working' ? 'thinking' : speaking ? 'speaking' : 'idle'
  const showTextBox = !isMC && (!voice || typing)
  const recording = big.state === 'recording'
  const micBusy = big.state !== 'idle'
  const hintLabel = hints.length === 0 ? 'Hint' : hints.length === 1 ? 'Stronger hint' : 'No more hints'
  // Middle button: the mic for open questions and in voice mode; a check button for tapped answers.
  const micIsMain = voice || !isMC

  return (
    <article className="question">
      {/* The tutor shows what the bot is doing. Option C: Prof. Meuer's animated photo goes here. */}
      <Tutor state={tutorState} />
      <p className="q-meta">
        <span className="q-count">
          Question {number} of {total}
        </span>
        <span>
          {question.sessionLabel ?? `Session ${question.session}`}: {question.topic}
        </span>
        <span className="tag">{difficultyLabel[question.difficulty]}</span>
      </p>

      <h2 className="q-text">{question.question}</h2>
      <div className="listen-row">
        {speaking ? (
          <button className="btn secondary sm" type="button" onClick={stopSpeaking}>
            <StopIcon /> Stop reading
          </button>
        ) : (
          <>
            <button className="btn secondary sm" type="button" onClick={() => say(questionSpeech(question))}>
              <SpeakerIcon /> {voice ? 'Read it again' : 'Listen'}
            </button>
            {result && (
              <button className="btn secondary sm" type="button" onClick={() => say(feedbackSpeech(result))}>
                <SpeakerIcon /> Listen to the feedback
              </button>
            )}
          </>
        )}
      </div>
      {audioNote && <p className="note">{audioNote}</p>}

      {isMC && (
        <div className="options" role="radiogroup" aria-label="Answer options">
          {Object.entries(question.options ?? {}).map(([key, label]) => {
            let state = key === choice ? 'is-selected' : ''
            if (result?.type === 'MC') {
              state = key === result.correctOption ? 'is-correct' : key === choice ? 'is-wrong' : 'is-muted'
            }
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={choice === key}
                className={`option ${state}`}
                disabled={!!result || busy}
                onClick={() => {
                  setChoice(key)
                  if (voice) void check(key) // one tap is enough in voice mode
                }}
              >
                <span className="option-key">{key}</span>
                <span className="option-label">{label}</span>
              </button>
            )
          })}
        </div>
      )}

      {voice && heard && !isMC && !typing && (
        <blockquote className="heard">
          <span>You said</span>
          {heard}
        </blockquote>
      )}
      {voice && heard && isMC && !result && <p className="note">You said: “{heard}”</p>}

      {showTextBox && (
        <label className="open">
          <span className="sr-only">Your answer</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!!result || recording}
            rows={5}
            autoFocus={voice && typing}
            placeholder={
              recording ? 'Listening… tap the button again when you’re done.' : 'Type your answer, or tap the mic below and say it.'
            }
          />
        </label>
      )}

      {hints.length > 0 && (
        <ul className="hints">
          {hints.map((h, i) => (
            <li key={i}>
              <strong>Hint {i + 1}.</strong> {h}
            </li>
          ))}
        </ul>
      )}

      {(error || big.error) && (
        <p className="error" role="alert">
          {error ?? big.error}
        </p>
      )}
      {big.help && (
        <MicHelpBox
          help={big.help}
          onRetry={big.start}
          onDismiss={() => {
            big.dismissHelp()
            setTyping(true)
          }}
        />
      )}

      {result && (
        <div ref={feedbackRef} className="feedback-wrap">
          <Feedback
            result={result}
            verdict={verdict()}
            covered={covered}
            onToggle={(i) => {
              const nextSet = new Set(covered)
              if (nextSet.has(i)) nextSet.delete(i)
              else nextSet.add(i)
              setCovered(nextSet)
            }}
          />
        </div>
      )}

      {/* Bottom bar, same on every question: hint and skip on the left, the main round button in the middle. */}
      <div className="dock" role="toolbar" aria-label="Answer controls">
        {!result ? (
          <>
            <div className="dock-side">
              <button className="btn secondary sm" type="button" onClick={() => void showHint()} disabled={hints.length >= 2 || micBusy}>
                {hintLabel}
              </button>
              <button className="btn ghost sm" type="button" onClick={skip} disabled={micBusy || busy}>
                Skip
              </button>
            </div>

            <div className="dock-main">
              {micIsMain ? (
                <button
                  type="button"
                  className={`round ${busy ? 'round-working' : `round-${big.state}`}`}
                  onClick={big.toggle}
                  disabled={busy || big.state === 'working'}
                  aria-pressed={recording}
                  aria-label={recording ? 'Stop recording' : 'Answer by talking'}
                >
                  <MicIcon recording={recording} />
                </button>
              ) : (
                <button
                  type="button"
                  className={`round round-check ${busy ? 'round-working' : ''}`}
                  onClick={() => void check()}
                  disabled={!answer || busy}
                  aria-label="Check answer"
                >
                  <CheckIcon />
                </button>
              )}
              <span className="dock-label" aria-live="polite">
                {recording
                  ? `Tap when you’re done · ${clock(big.seconds)}`
                  : big.state === 'working'
                    ? 'Turning it into text…'
                    : busy
                      ? 'Checking…'
                      : !micIsMain
                        ? choice
                          ? 'Check answer'
                          : 'Pick an answer'
                        : voice
                          ? isMC
                            ? 'Tap and say A, B, C or D'
                            : 'Tap and talk'
                          : 'Tap to say it'}
              </span>
            </div>

            <div className="dock-side dock-right">
              {!isMC && (!voice || typing) && (
                <button className="btn primary sm" type="button" onClick={() => void check()} disabled={!answer || busy || micBusy}>
                  Check
                </button>
              )}
              {!isMC && voice && !typing && (
                <button className="btn secondary sm" type="button" onClick={() => setTyping(true)} disabled={micBusy}>
                  Type instead
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="dock-side" />
            <div className="dock-main">
              <button
                ref={nextRef}
                type="button"
                className="round round-next"
                onClick={next}
                aria-label={number === total ? 'See results' : 'Next question'}
              >
                <ArrowIcon />
              </button>
              <span className="dock-label">{number === total ? 'See results' : 'Next question'}</span>
            </div>
            <span className="dock-side" />
          </>
        )}
      </div>
    </article>
  )
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function MicIcon({ recording }: { recording: boolean }) {
  if (recording) {
    return (
      <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

// "See the slide": the page the answer comes from, right under the feedback. Tap to see it big.
function Slides({ source }: { source: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const slides = slideImages(source).filter((s) => !broken.has(s.src))
  if (slides.length === 0) return null
  return (
    <div className="slides">
      <p className="slides-title">See the slide</p>
      <div className="slides-row">
        {slides.map((s) => (
          <button key={s.src} type="button" className="slide-thumb" onClick={() => setOpen(s.src)}>
            <img
              src={s.src}
              alt={`Slide: ${s.caption}`}
              loading="lazy"
              onError={() => setBroken((b) => new Set(b).add(s.src))}
            />
            <span>{s.caption}</span>
          </button>
        ))}
      </div>
      {open && (
        <div className="lightbox" role="dialog" aria-label="Slide" onClick={() => setOpen(null)}>
          <img src={open} alt="Slide, enlarged" />
          <button className="btn secondary lightbox-close" type="button" onClick={() => setOpen(null)} autoFocus>
            Close
          </button>
        </div>
      )}
    </div>
  )
}

// "Hear it from Alan": the lecture the answer comes from, starting around the right part.
function LectureClip({ source, at }: { source: string; at?: number }) {
  const clip = lectureAudio(source)
  const [broken, setBroken] = useState(false)
  if (!clip || broken) return null
  return (
    <div className="clip">
      <p className="slides-title">Hear it from Alan</p>
      <p className="clip-title">“{clip.title}”</p>
      <audio
        controls
        preload="metadata"
        src={clip.src}
        onLoadedMetadata={(e) => {
          if (at) e.currentTarget.currentTime = at
        }}
        onPlay={() => stopSpeaking()}
        onError={() => setBroken(true)}
      />
      {at ? <p className="note">Starts at {clock(at)}, around where he talks about this.</p> : null}
    </div>
  )
}

function Feedback(props: {
  result: AnswerResult
  verdict: Verdict
  covered: Set<number>
  onToggle: (index: number) => void
}) {
  const { result, verdict, covered, onToggle } = props
  const source = (
    <>
      <p className="source">From the course: {formatSource(result.source)}</p>
      <Slides source={result.source} />
      <LectureClip source={result.source} at={result.sourceTime} />
    </>
  )

  if (result.type === 'MC') {
    return (
      <section className={`feedback verdict-${verdict}`} aria-live="polite">
        <h3>
          {verdict === 'correct'
            ? opening('correct', result.id)
            : `${opening('wrong', result.id)} It’s ${result.correctOption}.`}
        </h3>
        <p>{result.explanation}</p>
        {source}
      </section>
    )
  }

  if (result.verdict === 'not_graded_yet') {
    return (
      <section className={`feedback verdict-${verdict}`} aria-live="polite">
        <h3>Compare your answer with the key points</h3>
        <p>Tick the points your answer covered.</p>
        <ul className="keypoints">
          {result.keyPoints.map((point, i) => (
            <li key={i}>
              <label>
                <input type="checkbox" checked={covered.has(i)} onChange={() => onToggle(i)} />
                <span>{point}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="self-verdict">That counts as: {verdictLabel[verdict].toLowerCase()}</p>
        <details>
          <summary>Model answer</summary>
          <p>{result.modelAnswer}</p>
        </details>
        {source}
      </section>
    )
  }

  // Graded by Claude
  return (
    <section className={`feedback verdict-${verdict}`} aria-live="polite">
      <h3>{opening(verdict, result.id)}</h3>
      {result.feedback && <p>{result.feedback}</p>}
      {result.pointsHit && result.pointsHit.length > 0 && (
        <>
          <h4>What you got</h4>
          <ul>{result.pointsHit.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </>
      )}
      {result.pointsMissed && result.pointsMissed.length > 0 && (
        <>
          <h4>What was missing</h4>
          <ul>{result.pointsMissed.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </>
      )}
      <details>
        <summary>Model answer</summary>
        <p>{result.modelAnswer}</p>
      </details>
      {source}
    </section>
  )
}
