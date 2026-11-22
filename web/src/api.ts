import { NeedsCode, accessHeaders, checkLimit } from './access'
import type { AnswerResult, NextResponse, SessionInfo } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: accessHeaders() })
  if (res.status === 401) throw new NeedsCode()
  await checkLimit(res)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<T>
}

export const api = {
  sessions: () => get<SessionInfo[]>('/api/sessions'),

  next: (p: { session?: string; difficulty?: string; type?: 'MC'; exclude: string[]; only?: string[] }) => {
    const params = new URLSearchParams()
    if (p.session) params.set('session', p.session)
    if (p.difficulty) params.set('difficulty', p.difficulty)
    if (p.type) params.set('type', p.type)
    if (p.exclude.length) params.set('exclude', p.exclude.join(','))
    if (p.only?.length) params.set('only', p.only.join(','))
    return get<NextResponse>(`/api/question/next?${params}`)
  },

  hint: (id: string, level: 1 | 2) =>
    get<{ hint: string }>(`/api/hint?id=${encodeURIComponent(id)}&level=${level}`),

  answer: async (id: string, answer: string): Promise<AnswerResult> => {
    const res = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ id, answer }),
    })
    if (res.status === 401) throw new NeedsCode()
    await checkLimit(res)
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
    return res.json() as Promise<AnswerResult>
  },

  // After the practice oral exam: a practice grade and a comment per answer.
  examGrade: async (turns: { question: string; answer: string }[]): Promise<ExamGradeReply> => {
    const res = await fetch('/api/exam/grade', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ turns }),
    })
    if (res.status === 401) throw new NeedsCode()
    await checkLimit(res)
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
    return res.json() as Promise<ExamGradeReply>
  },

  // After a full practice exam: anonymous stats for Prof. Meuer's class overview (no name, nothing said).
  examSubmit: async (stats: unknown): Promise<{ counted: boolean }> => {
    const res = await fetch('/api/exam/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify(stats),
    })
    if (res.status === 401) throw new NeedsCode()
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
    return res.json() as Promise<{ counted: boolean }>
  },

  // One answer the student wants Prof. Meuer to check, with their reason.
  examFlag: async (flag: { question: string; answer: string; result?: string; comment?: string; note: string; grade?: number }) => {
    const res = await fetch('/api/exam/flag', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify(flag),
    })
    if (res.status === 401) throw new NeedsCode()
    if (res.status === 429) throw new Error('limit')
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
  },

  feedback: async (body: { text: string; rating?: number; where: string; answers?: FeedbackAnswers }) => {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
  },

  // One turn of the conversation. The reply streams in: `onFirst` gets his first sentence as soon
  // as it's written (so his voice can start), the promise gives the whole reply. `rest` is what's
  // left to read after that first sentence.
  chat: async (
    messages: { role: 'user' | 'assistant'; content: string }[],
    wrapUp = false,
    onFirst?: (sentence: string) => void,
    greeting?: string,
    exam?: { minutesLeft: number; ending?: boolean }, // the timed oral exam
    recentSources?: string[], // main source of each of his last replies, newest last
  ): Promise<ChatReply> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ messages, stream: true, greeting, exam, recentSources, ...(wrapUp ? { wrapUp: true } : {}) }),
    })
    if (res.status === 401) throw new NeedsCode()
    await checkLimit(res)
    if (!res.ok) {
      // The server says why ("429", "empty"…), so a screenshot of the error tells us what happened.
      const why = await res.json().then((b: { reason?: string }) => b.reason).catch(() => undefined)
      throw new Error(`Request failed (${why ?? res.status})`)
    }
    if (!(res.headers.get('content-type') ?? '').includes('ndjson') || !res.body) return res.json() as Promise<ChatReply>
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (value) buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        const ev = JSON.parse(line) as ({ type: 'first'; text: string } | ({ type: 'done' } & ChatReply) | { type: 'error'; reason?: string })
        if (ev.type === 'first') onFirst?.(ev.text)
        else if (ev.type === 'done') return ev
        else if (ev.type === 'error') throw new Error(`Request failed (${ev.reason ?? 'error'})`)
      }
      if (done) throw new Error('Request failed (cut)')
    }
  },
}

export type ChatReply = {
  reply: string
  sources: string[]
  check?: { result: 'right' | 'partly' | 'wrong'; session?: number } // he asked, the student answered
  first?: string // already handed to onFirst
  rest?: string // what's left to read after the first sentence
  examOver?: boolean // timed exam: the student asked to end it, this was his closing
}

// The quick questions in the feedback box (each optional).
export type FeedbackAnswers = Partial<Record<'correct' | 'level' | 'voice' | 'use', string>>

export type ExamGradeReply = {
  grade: number // KLU scale: 1.0 best, 4.0 pass, 5.0 fail (a practice estimate)
  verdict: string
  answers: { result: 'right' | 'partly' | 'wrong' | 'beyond' | 'skip'; comment: string; module?: string; topic?: string }[]
}
