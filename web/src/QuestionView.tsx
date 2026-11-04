import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { difficultyLabel, formatSource, verdictLabel } from './format'
import { MicButton } from './MicButton'
import { speak, stopSpeaking } from './voice'
import type { AnswerResult, Attempt, OpenResult, PublicQuestion, Verdict } from './types'

type Props = {
  question: PublicQuestion
  number: number
  total: number
  readAloud: boolean
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
      ? `Correct. ${result.explanation}`
      : `Not quite. The answer is ${result.correctOption}. ${result.explanation}`
  }
  if (result.verdict === 'not_graded_yet') {
    return `Compare your answer with the key points. ${result.keyPoints.join('. ')}.`
  }
  return [verdictLabel[result.verdict] + '.', result.feedback ?? ''].join(' ').trim()
}

// Self-check verdict for open answers, used until Claude grading is switched on.
function selfCheckVerdict(result: OpenResult, covered: Set<number>): Verdict {
  if (covered.size === 0) return 'wrong'
  return covered.size === result.keyPoints.length ? 'correct' : 'partly'
}

export function QuestionView({ question, number, total, readAloud, onDone }: Props) {
  const [choice, setChoice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [hints, setHints] = useState<string[]>([])
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [covered, setCovered] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [audioNote, setAudioNote] = useState<string | null>(null)

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

  const isMC = question.type === 'MC'
  const answer = isMC ? choice : text.trim()

  function verdict(): Verdict {
    if (!result) return 'skipped'
    if (result.type === 'MC') return result.verdict
    if (result.verdict === 'not_graded_yet') return selfCheckVerdict(result, covered)
    return result.verdict
  }

  async function check() {
    if (!answer || busy || result) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.answer(question.id, answer))
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

  useEffect(() => {
    if (result) nextRef.current?.focus()
  }, [result])

  // Keyboard: A-D picks an option, Enter checks or moves on, Cmd/Ctrl+Enter checks a written answer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = (e.target as HTMLElement).tagName === 'TEXTAREA'
      if (typing) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void check()
        }
        return
      }
      const key = e.key.toUpperCase()
      if (isMC && !result && question.options && key in question.options) setChoice(key)
      if (e.key === 'Enter' && !result && answer && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault()
        void check()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <article className="question">
      <p className="q-meta">
        <span>
          Question {number} of {total}
        </span>
        <span>Session {question.session}: {question.topic}</span>
        <span className={`tag tag-${question.difficulty}`}>{difficultyLabel[question.difficulty]}</span>
      </p>

      <h2 className="q-text">{question.question}</h2>
      <div className="listen-row">
        <button className="btn link" type="button" onClick={() => say(questionSpeech(question))}>
          Listen to the question
        </button>
        {result && (
          <button className="btn link" type="button" onClick={() => say(feedbackSpeech(result))}>
            Listen to the feedback
          </button>
        )}
      </div>
      {audioNote && <p className="note">{audioNote}</p>}

      {/* Option C will place Prof. Meuer's animated photo here. Empty in option A. */}
      <div className="presenter" aria-hidden="true" />

      {isMC ? (
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
                disabled={!!result}
                onClick={() => setChoice(key)}
              >
                <span className="option-key">{key}</span>
                <span className="option-label">{label}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <label className="open">
          <span className="sr-only">Your answer</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!!result}
            rows={6}
            placeholder="Write your answer in a few sentences, as you would in the exam."
          />
        </label>
      )}
      {!isMC && !result && (
        <MicButton onText={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))} />
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

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!result ? (
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
      ) : (
        <>
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
          <div className="actions">
            <button ref={nextRef} className="btn primary" type="button" onClick={next}>
              {number === total ? 'See results' : 'Next question'}
            </button>
          </div>
        </>
      )}
    </article>
  )
}

function Feedback(props: {
  result: AnswerResult
  verdict: Verdict
  covered: Set<number>
  onToggle: (index: number) => void
}) {
  const { result, verdict, covered, onToggle } = props
  const source = <p className="source">From the slides: {formatSource(result.source)}</p>

  if (result.type === 'MC') {
    return (
      <section className={`feedback verdict-${verdict}`} aria-live="polite">
        <h3>{verdict === 'correct' ? 'Correct.' : `Not quite. The answer is ${result.correctOption}.`}</h3>
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

  // Graded by Claude (next step in the backend)
  return (
    <section className={`feedback verdict-${verdict}`} aria-live="polite">
      <h3>{verdictLabel[verdict]}.</h3>
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
