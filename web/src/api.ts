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

  chat: async (messages: { role: 'user' | 'assistant'; content: string }[], wrapUp = false) => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify(wrapUp ? { messages, wrapUp: true } : { messages }),
    })
    if (res.status === 401) throw new NeedsCode()
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
    return res.json() as Promise<{
      reply: string
      sources: string[]
      check?: { result: 'right' | 'partly' | 'wrong'; session?: number } // he asked, the student answered
    }>
  },
}
