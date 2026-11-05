import { accessQuery } from './access'
import type { Difficulty, Verdict } from './types'

const VIDEO_TITLES: Record<string, string> = {
  '01': "Scale of the climate change threat",
  '02': "Logistics' share of emissions and freight growth",
  '06': "Methodologies and lack of standards",
  '08': "Absolute and carbon intensity measures",
  '09': "Activity-based vs energy-based calculation",
  '16': "Avoid-Shift-Improve",
  '23': "Carbon offsetting: critical questions",
  '24': "Carbon insetting",
  '36': "Policy targets for freight modal shift",
  '47': "Truck energy efficiency and fuel economy standards",
  '51': "Eco-driver training",
  '53': "Traffic congestion and fuel efficiency",
  '63': "Low-carbon electricity in freight transport",
  '64': "The electrification route",
  '65': "Hydrogen as an energy carrier",
  '67': "Combined effect of all carbon-saving measures",
}

// "S1 p28" -> "Session 1, page 28"; "S2 p33, p34" -> "Session 2, pages 33 and 34"
export function formatSource(source: string): string {
  const video = source.match(/^Video (\d+)/)?.[1]
  if (video) return `Alan McKinnon’s video “${VIDEO_TITLES[video] ?? video}”`
  if (source.startsWith('Elkington 2018')) {
    const pages = [...source.matchAll(/p(\d+)/g)].map((m) => m[1])
    return `Elkington’s article “25 Years Ago I Coined the Phrase Triple Bottom Line”${pages.length ? `, page ${pages.join(' and ')}` : ''}`
  }
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

// Slide images for a source like "S1 p15, p17" (only this year's session decks have them).
export function slideImages(source: string): { src: string; caption: string }[] {
  const session = source.match(/^S(\d+)/)?.[1]
  if (!session) return []
  return [...source.matchAll(/p(\d+)/g)].map((m) => ({
    src: `/slides/S${session}-${m[1]}.webp${accessQuery()}`,
    caption: `Session ${session}, page ${m[1]}`,
  }))
}

// Alan McKinnon's lecture audio for a source like "Video 65".
export function lectureAudio(source: string): { src: string; title: string } | null {
  const video = source.match(/^Video (\d+)/)?.[1]
  if (!video) return null
  return { src: `/alan/${video}.m4a${accessQuery()}`, title: VIDEO_TITLES[video] ?? `Video ${video}` }
}
