import { useEffect, useState } from 'react'
import { api } from './api'
import type { ExamGradeReply } from './api'
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
export function examText(record: ExamRecord, messages: ChatMessage[], grade?: ExamGradeReply): string {
  const think = thinkTimes(record)
  const avg = think.length ? think.reduce((n, t) => n + t.ms, 0) / think.length : 0
  const lines = [
    'Sustainable Logistics: oral exam (practice)',
    `Date: ${new Date(record.startedAt).toLocaleString()}`,
    `Length: ${clock(record.endedAt - record.startedAt)}`,
    `Questions answered: ${record.turns.filter((t) => t.answer).length}`,
    `Right / partly / wrong: ${['right', 'partly', 'wrong'].map((r) => record.turns.filter((t) => t.result === r).length).join(' / ')}`,
    `Average time before answering: ${think.length ? seconds(avg) : 'n/a'}`,
    `Practice grade (AI estimate, not the real grade): ${grade ? grade.grade.toFixed(1) : 'n/a'}`,
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

const RESULT_LABEL = { right: 'Right', partly: 'Partly', wrong: 'Not there yet', beyond: 'Beyond the lectures' }

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
  const think = thinkTimes(record)
  const avg = think.length ? think.reduce((n, t) => n + t.ms, 0) / think.length : 0
  const long = think.filter((t) => t.ms >= LONG_PAUSE_MS)
  const [grade, setGrade] = useState<ExamGradeReply | null>(null)
  const [grading, setGrading] = useState<'working' | 'done' | 'failed'>(answered.length ? 'working' : 'done')
  const [flags, setFlags] = useState<boolean[]>(() => answered.map(() => false))
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  // The practice grade: the AI compares every answer with the course material.
  useEffect(() => {
    if (!answered.length) return
    let gone = false
    api
      .examGrade(answered.map((t) => ({ question: t.question, answer: t.answer ?? '' })))
      .then((g) => {
        if (!gone) {
          setGrade(g)
          setGrading('done')
        }
      })
      .catch(() => {
        if (!gone) setGrading('failed')
      })
    return () => {
      gone = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resultOf = (i: number) => grade?.answers[i]?.result ?? answered[i].result
  const count = (r: string) => answered.filter((_, i) => resultOf(i) === r).length

  function download() {
    const blob = new Blob([examText(record, messages, grade ?? undefined)], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `oral-exam-${new Date(record.startedAt).toISOString().slice(0, 16).replace(':', '-')}.txt`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  function send() {
    setSent('sending')
    api
      .examSubmit({
        lengthSec: Math.round((record.endedAt - record.startedAt) / 1000),
        grade: grade?.grade,
        verdict: grade?.verdict,
        leftWindow: record.leftWindow.length,
        turns: answered.map((t, i) => ({
          question: t.question,
          answer: t.answer,
          result: resultOf(i),
          comment: grade?.answers[i]?.comment,
          thinkMs: t.firstSpeechAt ? t.firstSpeechAt - t.askedAt : null,
          flagged: flags[i],
        })),
      })
      .then(() => setSent('sent'))
      .catch(() => setSent('failed'))
  }

  const flaggedCount = flags.filter(Boolean).length

  return (
    <section className="exam-report card" aria-labelledby="exam-report-title">
      <h2 id="exam-report-title">Your practice oral exam</h2>

      <div className="exam-grade" aria-live="polite">
        {grading === 'working' && <p className="note">Johannes is going through your answers…</p>}
        {grading === 'failed' && <p className="note">The practice grade couldn’t be worked out this time.</p>}
        {grade && (
          <>
            <div className="exam-grade-number">
              <span className="exam-grade-label">Practice grade</span>
              <strong>{grade.grade.toFixed(1)}</strong>
            </div>
            <div>
              <p className="exam-verdict">{grade.verdict}</p>
              <p className="note">
                An estimate by the AI, judged against the course material. It isn’t your real grade.
              </p>
            </div>
          </>
        )}
      </div>

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
          <dt>Right · partly · not yet</dt>
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
        <>
          <p className="note">
            Think an answer was judged unfairly, or you said something beyond the lectures? Flag it, and Prof. Meuer
            will double-check it.
          </p>
          <ol className="exam-turns">
            {answered.map((t, i) => {
              const r = resultOf(i)
              return (
                <li key={i} className={r ? `is-${r}` : undefined}>
                  <p className="exam-q">{t.question}</p>
                  <p className="exam-a">
                    {t.firstSpeechAt && <span className="exam-time">after {seconds(t.firstSpeechAt - t.askedAt)}</span>}
                    {t.answer}
                  </p>
                  {(r || grade?.answers[i]?.comment) && (
                    <p className="exam-comment">
                      {r && <b>{RESULT_LABEL[r]}. </b>}
                      {grade?.answers[i]?.comment}
                    </p>
                  )}
                  <button
                    type="button"
                    className={`exam-flag ${flags[i] ? 'is-on' : ''}`}
                    aria-pressed={flags[i]}
                    disabled={sent === 'sent'}
                    onClick={() => setFlags((f) => f.map((v, j) => (j === i ? !v : v)))}
                  >
                    {flags[i] ? '⚑ Flagged for Prof. Meuer' : '⚐ Ask Prof. Meuer to double-check'}
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}

      {answered.length > 0 && (
        <div className="exam-send">
          {sent === 'sent' ? (
            <p className="feedback-thanks" role="status">
              Sent to Prof. Meuer. Thank you!
            </p>
          ) : (
            <>
              <button className="btn primary" type="button" onClick={send} disabled={sent === 'sending' || grading === 'working'}>
                {sent === 'sending'
                  ? 'Sending…'
                  : flaggedCount
                    ? `Send my exam to Prof. Meuer (${flaggedCount} flagged)`
                    : 'Send my exam to Prof. Meuer'}
              </button>
              <p className="note">Without your name. He sees your answers, the timings and what you flagged.</p>
              {sent === 'failed' && (
                <p className="error" role="alert">
                  That didn’t go through. Try again.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="actions">
        <button className="btn secondary" type="button" onClick={onFeedback}>
          Talk it through with Johannes
        </button>
        <button className="btn ghost" type="button" onClick={download}>
          Download the record
        </button>
      </div>
    </section>
  )
}
