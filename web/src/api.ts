import { NeedsCode, accessHeaders } from './access'
import type { AnswerResult, NextResponse, SessionInfo } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: accessHeaders() })
  if (res.status === 401) throw new NeedsCode()
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
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
    return res.json() as Promise<AnswerResult>
  },

  feedback: async (body: { text: string; rating?: number; where: string }) => {
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
  ): Promise<ChatReply> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ messages, stream: true, ...(wrapUp ? { wrapUp: true } : {}) }),
    })
    if (res.status === 401) throw new NeedsCode()
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
}
