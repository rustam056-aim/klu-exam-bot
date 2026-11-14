// Turns Alan McKinnon's video transcripts (materials/alan-transcripts, never on GitHub) into
// api/data/private/alan_transcripts.json, which the conversation tutor reads as course material.
// That file is git-ignored too, so the Worker can only be deployed from a machine that has it.
// Run from the project folder:  node scripts/build-alan-notes.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'materials/alan-transcripts'
const videos = readdirSync(dir)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => {
    const m = f.match(/\((\d+)\)\s*(.+?)_\d{6}_default\.txt$/)
    if (!m) throw new Error(`Unexpected file name: ${f}`)
    const text = readFileSync(join(dir, f), 'utf8').replace(/\s+/g, ' ').trim()
    return { number: Number(m[1]), title: m[2].trim(), text }
  })
  .sort((a, b) => a.number - b.number)

mkdirSync('api/data/private', { recursive: true })
writeFileSync('api/data/private/alan_transcripts.json', JSON.stringify({ videos }, null, 1) + '\n')
console.log(`Wrote ${videos.length} transcripts (${videos.reduce((n, v) => n + v.text.split(' ').length, 0)} words).`)
