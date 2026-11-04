import type { Difficulty, Verdict } from './types'

// "S1 p28" -> "Session 1, page 28"; "S2 p33, p34" -> "Session 2, pages 33 and 34"
export function formatSource(source: string): string {
  const video = source.match(/^Video (\d+)/)?.[1]
  if (video) return `Alan McKinnon's video lecture ${video}`
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

// Varied openings so feedback doesn't sound the same every time.
// Picked by question id, so the same question always gets the same opening (no flicker on re-render).
const openings: Record<Verdict, string[]> = {
  correct: ['Nailed it.', 'Yep, that’s it.', 'Spot on.', 'Exactly.'],
  partly: ['Almost there.', 'Half of it, nice.', 'Close, one more bit.', 'Good start.'],
  wrong: ['Hmm, not this one.', 'Nope, but you know this.', 'Not yet, come on.', 'Not this time.'],
  skipped: ['Skipped.'],
}

export function opening(verdict: Verdict, id: string): string {
  const list = openings[verdict]
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return list[h % list.length]
}
