// Voice mode: turn "B", "bee", "I think it's option C" or the option's own words into a letter.
const SOUNDS: Record<string, string> = {
  a: 'A', ay: 'A', eh: 'A',
  b: 'B', be: 'B', bee: 'B',
  c: 'C', see: 'C', sea: 'C', si: 'C',
  d: 'D', dee: 'D',
}

export function spokenChoice(text: string, options: Record<string, string>): string | null {
  const t = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const valid = (l: string | undefined) => (l && l in options ? l : null)

  // "option c", "answer is b", "letter d"
  const named =
    t.match(/\b(?:option|answer|letter|choice)\s+(a|b|c|d|ay|bee|see|sea|dee)\b/g) ??
    t.match(/\bis\s+(b|c|d|bee|see|sea|dee)\b/g)
  if (named) {
    const last = named[named.length - 1].split(' ').pop()!
    const l = valid(SOUNDS[last])
    if (l) return l
  }

  // Just the letter, maybe with a filler word: "b", "uh c", "bee"
  const words = t.split(' ')
  if (words.length <= 3) {
    for (const w of [...words].reverse()) {
      const l = valid(SOUNDS[w])
      if (l) return l
    }
  }

  // A lone b/c/d somewhere in a longer sentence ("a" and "the" are too common to count)
  const lone = t.match(/\b([bcd])\b/g)
  if (lone && new Set(lone).size === 1) {
    const l = valid(lone[0].toUpperCase())
    if (l) return l
  }

  // The student read the option out: pick the option whose words they used most
  let best: string | null = null
  let bestScore = 0
  for (const [key, label] of Object.entries(options)) {
    const ws = label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2)
    if (ws.length === 0) continue
    const score = ws.filter((w) => t.includes(w)).length / ws.length
    if (score > bestScore) {
      bestScore = score
      best = key
    }
  }
  return bestScore >= 0.6 ? best : null
}
