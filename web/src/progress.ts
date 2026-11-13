import type { Attempt, Verdict } from './types'

// Progress across practice runs, kept in this browser only (nothing is sent anywhere).
// For each question we keep the last result, so "missed" means "not right the last time".
const KEY = 'progress-v1'

export type Seen = { verdict: Verdict; session: number; at: number }
export type Progress = Record<string, Seen>

export function loadProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Progress
  } catch {
    return {}
  }
}

export function saveAttempt(a: Attempt) {
  if (a.verdict === 'skipped') return // skipping doesn't count as trying
  const p = loadProgress()
  p[a.question.id] = { verdict: a.verdict, session: a.question.session, at: Date.now() }
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private mode: progress lasts for this visit only */
  }
}

export function resetProgress() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem('talk-progress-v1')
  } catch {
    /* nothing to reset */
  }
}

export function missedIds(p: Progress): string[] {
  return Object.entries(p)
    .filter(([, s]) => s.verdict !== 'correct')
    .map(([id]) => id)
}

export function sessionStats(p: Progress, session: number) {
  const seen = Object.values(p).filter((s) => s.session === session)
  return { tried: seen.length, right: seen.filter((s) => s.verdict === 'correct').length }
}

// ---------- Talking with Johannes ----------
// When he asks a question in the conversation and the student answers, he notes how it went.
// Kept in this browser only, like the practice progress.
const TALK_KEY = 'talk-progress-v1'

export type TalkAnswer = { result: 'right' | 'partly' | 'wrong'; session?: number; at: number }

export function loadTalk(): TalkAnswer[] {
  try {
    const list = JSON.parse(localStorage.getItem(TALK_KEY) ?? '[]') as TalkAnswer[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveTalkAnswer(answer: { result: TalkAnswer['result']; session?: number }) {
  const list = [...loadTalk(), { ...answer, at: Date.now() }].slice(-400)
  try {
    localStorage.setItem(TALK_KEY, JSON.stringify(list))
  } catch {
    /* private mode: lasts for this visit only */
  }
}

export function talkStats(list: TalkAnswer[], session?: number) {
  const mine = session === undefined ? list : list.filter((a) => a.session === session)
  return { answered: mine.length, right: mine.filter((a) => a.result === 'right').length }
}
