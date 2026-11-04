import { formatSource, verdictLabel } from './format'
import { RouteLine } from './RouteLine'
import type { Attempt } from './types'

export function Summary(props: {
  attempts: Attempt[]
  onRetry: (ids: string[]) => void
  onRestart: () => void
}) {
  const { attempts, onRetry, onRestart } = props
  const count = (v: Attempt['verdict']) => attempts.filter((a) => a.verdict === v).length
  const toReview = attempts.filter((a) => a.verdict !== 'correct')

  if (attempts.length === 0) {
    return (
      <section className="summary">
        <h1>No questions answered yet</h1>
        <div className="actions">
          <button className="btn primary" type="button" onClick={onRestart}>
            Start a new practice
          </button>
        </div>
      </section>
    )
  }

  const parts = [
    count('partly') && `${count('partly')} partly right`,
    count('wrong') && `${count('wrong')} not quite`,
    count('skipped') && `${count('skipped')} skipped`,
  ].filter(Boolean)

  return (
    <section className="summary">
      <h1>
        You got {count('correct')} of {attempts.length} right
      </h1>
      {parts.length > 0 && <p className="lede">{parts.join(', ')}.</p>}
      <RouteLine stops={attempts.map((a) => a.verdict)} />

      {toReview.length > 0 ? (
        <>
          <h2>Review these before the exam</h2>
          <ul className="review">
            {toReview.map((a) => (
              <li key={a.question.id}>
                <span className={`tag verdict-tag-${a.verdict}`}>{verdictLabel[a.verdict]}</span>
                <p>{a.question.question}</p>
                <p className="source">
                  {a.source ? formatSource(a.source) : (a.question.sessionLabel ?? `Session ${a.question.session}`)}: {a.question.topic}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>Everything right. Try a harder level or another session.</p>
      )}

      <div className="actions">
        {toReview.length > 0 && (
          <button className="btn primary" type="button" onClick={() => onRetry(toReview.map((a) => a.question.id))}>
            Practise these {toReview.length} again
          </button>
        )}
        <button className={`btn ${toReview.length > 0 ? 'quiet' : 'primary'}`} type="button" onClick={onRestart}>
          Start a new practice
        </button>
      </div>
    </section>
  )
}
