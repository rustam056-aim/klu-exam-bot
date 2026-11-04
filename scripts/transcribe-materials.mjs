// Turns the lecture recordings in materials/alan-audio into text with ElevenLabs Scribe v2.
// Uses the ElevenLabs key from api/.dev.vars. Results go to materials/alan-transcripts (never to GitHub).
//
//   node scripts/transcribe-materials.mjs --one   -> just one file, to check the cost first
//   node scripts/transcribe-materials.mjs         -> all files that aren't done yet
import { existsSync, mkdirSync, openAsBlob, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const vars = readFileSync(join(root, 'api/.dev.vars'), 'utf8')
const key = vars.match(/^ELEVENLABS_API_KEY=(.*)$/m)?.[1]?.trim()
if (!key) {
  console.error('No ELEVENLABS_API_KEY found in api/.dev.vars')
  process.exit(1)
}

const inDir = join(root, 'materials/alan-audio')
const outDir = join(root, 'materials/alan-transcripts')
mkdirSync(outDir, { recursive: true })

const files = readdirSync(inDir)
  .filter((f) => /\.(mp4|m4a|mp3|wav)$/i.test(f) && !/\(1\)\.\w+$/.test(f)) // skip "(1)" duplicates
  .sort()
const outName = (f) => join(outDir, basename(f, extname(f)) + '.txt')
const todo = files.filter((f) => !existsSync(outName(f)))
const batch = process.argv.includes('--one') ? todo.slice(0, 1) : todo
console.log(`${files.length} lectures, ${todo.length} not done yet, doing ${batch.length} now\n`)

for (const f of batch) {
  process.stdout.write(`${f.slice(0, 80)} ... `)
  const form = new FormData()
  form.append('file', await openAsBlob(join(inDir, f)), f)
  form.append('model_id', 'scribe_v2')
  form.append('language_code', 'eng')
  form.append('tag_audio_events', 'false')
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
  })
  if (!res.ok) {
    console.log(`failed ${res.status}: ${(await res.text()).slice(0, 200)}`)
    continue
  }
  const data = await res.json()
  const text = (data.text ?? '').trim()
  writeFileSync(outName(f), text + '\n')
  console.log(`done, ${text.split(/\s+/).length} words`)
}
console.log(`\nTranscripts are in materials/alan-transcripts`)
