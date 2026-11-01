import type { Difficulty, Verdict } from './types'

// "S1 p28" -> "Session 1, page 28"; "S2 p33, p34" -> "Session 2, pages 33 and 34"
export function formatSource(source: string): string {
  const session = source.match(/S(\d+)/)?.[1]
  const pages = [...source.matchAll(/p(\d+)/g)].map((m) => m[1])
  if (!session) return source
  if (pages.length === 0) return `Session ${session}`
  if (pages.length === 1) return `Session ${session}, page ${pages[0]}`
  return `Session ${session}, pages ${pages.slice(0, -1).join(', ')} and ${pages.at(-1)}`
}

export const verdictLabel: Record<Verdict, string> = {
  correct: 'Correct',
  partly: 'Partly there',
  wrong: 'Not quite',
  skipped: 'Skipped',
}

export const difficultyLabel: Record<Difficulty, string> = {
  easy: 'Easy, about 1 minute',
  medium: 'Medium, about 2 minutes',
  hard: 'Hard, about 3 minutes',
}
