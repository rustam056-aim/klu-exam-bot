import type { ChatMessage } from './types'

// What happened in one oral exam question: when he finished asking, when the student started
// to answer, what they said, and how it went (as judged against the course material).
export type ExamTurn = {
  question: string
  askedAt: number // when he finished asking (ms)
  firstSpeechAt?: number // when the student started to answer
  answer?: string
  result?: 'right' | 'partly' | 'wrong'
}

export type ExamRecord = {
  startedAt: number
  endedAt: number
  turns: ExamTurn[]
  leftWindow: number[] // times the student left the tab or window
}

const LONG_PAUSE_MS = 10000 // a "long pause" before answering

function seconds(ms: number) {
  return `${Math.round(ms / 1000)} s`
}

function clock(ms: number) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function thinkTimes(record: ExamRecord) {
  return record.turns
    .filter((t) => t.firstSpeechAt && t.answer)
    .map((t) => ({ turn: t, ms: Math.max(0, (t.firstSpeechAt ?? 0) - t.askedAt) }))
}

// A plain-text record of the exam, to download (or, later, to hand in).
export function examText(record: ExamRecord, messages: ChatMessage[]): string {
  const think = thinkTimes(record)
  const avg = think.length ? think.reduce((n, t) => n + t.ms, 0) / think.length : 0
  const lines = [
    'Sustainable Logistics: oral exam (practice)',
    `Date: ${new Date(record.startedAt).toLocaleString()}`,
    `Length: ${clock(record.endedAt - record.startedAt)}`,
    `Questions answered: ${record.turns.filter((t) => t.answer).length}`,
    `Right / partly / wrong: ${['right', 'partly', 'wrong'].map((r) => record.turns.filter((t) => t.result === r).length).join(' / ')}`,
    `Average time before answering: ${think.length ? seconds(avg) : 'n/a'}`,
    `Left the window: ${record.leftWindow.length} time(s)${record.leftWindow.length ? ` (at ${record.leftWindow.map((t) => clock(t - record.startedAt)).join(', ')})` : ''}`,
    '',
    'Transcript (time from start; thinking time before each answer):',
  ]
  let turn = 0
  for (const m of messages) {
    if (m.local || m.meta) continue
    if (m.role === 'assistant') {
      lines.push('', `Johannes: ${m.text}`)
    } else {
      const t = record.turns.find((x, i) => i >= turn && x.answer === m.text)
      if (t) turn = record.turns.indexOf(t) + 1
      const ms = t?.firstSpeechAt ? t.firstSpeechAt - t.askedAt : undefined
      lines.push(`Student${ms !== undefined ? ` (after ${seconds(ms)})` : ''}${t?.result ? ` [${t.result}]` : ''}: ${m.text}`)
    }
  }
  return lines.join('\n')
}

export function ExamReport({
  record,
  messages,
  onFeedback,
}: {
  record: ExamRecord
  messages: ChatMessage[]
  onFeedback: () => void
}) {
  const answered = record.turns.filter((t) => t.answer)
  const count = (r: ExamTurn['result']) => record.turns.filter((t) => t.result === r).length
  const think = thinkTimes(record)
  const avg = think.length ? think.reduce((n, t) => n + t.ms, 0) / think.length : 0
  const long = think.filter((t) => t.ms >= LONG_PAUSE_MS)

  function download() {
    const blob = new Blob([examText(record, messages)], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `oral-exam-${new Date(record.startedAt).toISOString().slice(0, 16).replace(':', '-')}.txt`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  return (
    <section className="exam-report card" aria-labelledby="exam-report-title">
      <h2 id="exam-report-title">Your oral exam</h2>
      <p className="note">
        A practice summary, judged against the course material. It isn’t a grade and nothing is sent anywhere.
      </p>
      <dl className="exam-stats">
        <div>
          <dt>Length</dt>
          <dd>{clock(record.endedAt - record.startedAt)}</dd>
        </div>
        <div>
          <dt>Questions answered</dt>
          <dd>{answered.length}</dd>
        </div>
        <div>
          <dt>Right · partly · wrong</dt>
          <dd>
            {count('right')} · {count('partly')} · {count('wrong')}
          </dd>
        </div>
        <div>
          <dt>Time before answering</dt>
          <dd>{think.length ? `${seconds(avg)} on average` : 'n/a'}</dd>
        </div>
        <div>
          <dt>Long pauses (10 s or more)</dt>
          <dd>{long.length}</dd>
        </div>
        <div>
          <dt>Left the window</dt>
          <dd>{record.leftWindow.length === 0 ? 'never' : `${record.leftWindow.length}×`}</dd>
        </div>
      </dl>
      {answered.length > 0 && (
        <ol className="exam-turns">
          {record.turns
            .filter((t) => t.answer)
            .map((t, i) => (
              <li key={i} className={t.result ? `is-${t.result}` : undefined}>
                <p className="exam-q">{t.question}</p>
                <p className="exam-a">
                  {t.firstSpeechAt && <span className="exam-time">after {seconds(t.firstSpeechAt - t.askedAt)}</span>}
                  {t.answer}
                </p>
              </li>
            ))}
        </ol>
      )}
      <div className="actions">
        <button className="btn primary" type="button" onClick={onFeedback}>
          Get feedback from Johannes
        </button>
        <button className="btn secondary" type="button" onClick={download}>
          Download the record
        </button>
      </div>
    </section>
  )
}
