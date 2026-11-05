import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { difficultyLabel, formatSource, opening, slideImages, verdictLabel } from './format'
import { MicButton, MicHelpBox } from './MicButton'
import type { MicState } from './MicButton'
import { spokenChoice } from './spokenChoice'
import { Tutor } from './Tutor'
import { clock, useRecorder } from './useRecorder'
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
    setHeard(said)
    setError(null)
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
  useEffect(() => {
    if (voice) setMicState(big.state)
  }, [voice, big.state])

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
    nextRef.current?.focus({ preventScroll: voice })
    // Voice mode: bring the feedback up above the big buttons.
    if (voice) feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [result, voice])

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

  return (
    <article className={`question ${voice ? 'question-voice' : ''}`}>
      {/* The tutor shows what the bot is doing. Option C: Prof. Meuer's animated photo goes here. */}
      <Tutor state={tutorState} big={voice} />
      <p className="q-meta">
        <span>
          Question {number} of {total}
        </span>
        <span>
          {question.sessionLabel ?? `Session ${question.session}`}: {question.topic}
        </span>
        <span className={`tag tag-${question.difficulty}`}>{difficultyLabel[question.difficulty]}</span>
      </p>

      <h2 className="q-text">{question.question}</h2>
      <div className="listen-row">
        {speaking ? (
          <button className="btn quiet stop-btn" type="button" onClick={stopSpeaking}>
            Stop reading
          </button>
        ) : (
          <>
            <button className="btn link" type="button" onClick={() => say(questionSpeech(question))}>
              {voice ? 'Read it again' : 'Listen to the question'}
            </button>
            {result && (
              <button className="btn link" type="button" onClick={() => say(feedbackSpeech(result))}>
                Listen to the feedback
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
      {voice && heard && isMC && !result && (
        <p className="note">
          You said: “{heard}”
        </p>
      )}

      {showTextBox && (
        <label className="open">
          <span className="sr-only">Your answer</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!!result}
            rows={voice ? 4 : 6}
            autoFocus={voice && typing}
            placeholder="Write your answer in a few sentences, as you would in the exam."
          />
        </label>
      )}
      {!voice && !isMC && !result && <MicButton onText={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))} onStateChange={setMicState} />}

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
      {voice && big.help && <MicHelpBox help={big.help} onRetry={big.start} onDismiss={() => { big.dismissHelp(); setTyping(true) }} />}

      {!result && !voice && (
        <div className="actions">
          <button className="btn primary" type="button" onClick={() => void check()} disabled={!answer || busy}>
            {busy ? 'Checking…' : 'Check answer'}
          </button>
          <button className="btn quiet" type="button" onClick={() => void showHint()} disabled={hints.length >= 2}>
            {hints.length === 0 ? 'Show a hint' : hints.length === 1 ? 'Show a stronger hint' : 'No more hints'}
          </button>
          <button className="btn quiet" type="button" onClick={skip}>
            Skip
          </button>
        </div>
      )}
      {!result && voice && typing && (
        <div className="actions">
          <button className="btn primary" type="button" onClick={() => void check()} disabled={!answer || busy}>
            {busy ? 'Checking…' : 'Check answer'}
          </button>
        </div>
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
          {!voice && (
            <div className="actions">
              <button ref={nextRef} className="btn primary" type="button" onClick={next}>
                {number === total ? 'See results' : 'Next question'}
              </button>
            </div>
          )}
        </div>
      )}

      {voice && (
        <div className="dock" role="toolbar" aria-label="Voice controls">
          {!result ? (
            <>
              <button
                className="dock-side"
                type="button"
                onClick={() => void showHint()}
                disabled={hints.length >= 2 || big.state !== 'idle'}
              >
                {hints.length === 0 ? 'Hint' : hints.length === 1 ? 'Stronger hint' : 'No more hints'}
              </button>
              <div className="dock-main">
                <button
                  type="button"
                  className={`big-mic big-mic-${busy ? 'working' : big.state}`}
                  onClick={big.toggle}
                  disabled={busy || big.state === 'working'}
                  aria-pressed={big.state === 'recording'}
                  aria-label={big.state === 'recording' ? 'Stop and check my answer' : 'Answer by talking'}
                >
                  <MicIcon recording={big.state === 'recording'} />
                </button>
                <span className="dock-label" aria-live="polite">
                  {big.state === 'recording'
                    ? `Tap when you’re done · ${clock(big.seconds)}`
                    : big.state === 'working' || busy
                      ? 'Checking…'
                      : isMC
                        ? 'Tap and say A, B, C or D'
                        : 'Tap and talk'}
                </span>
              </div>
              <div className="dock-side dock-stack">
                {!isMC && !typing && (
                  <button className="dock-link" type="button" onClick={() => setTyping(true)} disabled={big.state !== 'idle'}>
                    Type instead
                  </button>
                )}
                <button className="dock-link" type="button" onClick={skip} disabled={big.state !== 'idle' || busy}>
                  Skip
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="dock-side" />
              <div className="dock-main">
                <button ref={nextRef} type="button" className="big-mic big-next" onClick={next} aria-label={number === total ? 'See results' : 'Next question'}>
                  <ArrowIcon />
                </button>
                <span className="dock-label">{number === total ? 'See results' : 'Next question'}</span>
              </div>
              <span className="dock-side" />
            </>
          )}
        </div>
      )}
    </article>
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
          <button className="btn quiet lightbox-close" type="button" onClick={() => setOpen(null)} autoFocus>
            Close
          </button>
        </div>
      )}
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
