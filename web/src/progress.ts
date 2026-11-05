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
