import { accessHeaders } from './access'

// Voice helpers. All calls go through our backend; the ElevenLabs key never reaches the browser.
// transcribe() and speak() are the only two places to change for option C (Prof. Meuer's own voice).

let current: HTMLAudioElement | null = null
let generation = 0 // bumps on every speak/stop; only the newest request may play
const cache = new Map<string, Promise<string>>() // text -> audio URL, shared by parallel requests

// Lets the page show a "Stop reading" button while something is being read.
type Listener = (speaking: boolean) => void
const listeners = new Set<Listener>()
let speaking = false

function setSpeaking(value: boolean) {
  if (speaking === value) return
  speaking = value
  listeners.forEach((l) => l(value))
}

export function onSpeakingChange(listener: Listener): () => void {
  listeners.add(listener)
  listener(speaking)
  return () => {
    listeners.delete(listener)
  }
}

export function stopSpeaking() {
  generation++
  if (current) {
    current.pause()
    current = null
  }
  setSpeaking(false)
}

function audioUrl(text: string): Promise<string> {
  let url = cache.get(text)
  if (!url) {
    url = fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ text }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`speak failed (${res.status})`)
      return URL.createObjectURL(await res.blob())
    })
    url.catch(() => cache.delete(text)) // let a failed request be retried
    cache.set(text, url)
  }
  return url
}

export async function speak(text: string): Promise<void> {
  stopSpeaking()
  document.querySelectorAll('audio').forEach((a) => a.pause()) // e.g. Alan's lecture clip
  const mine = generation
  setSpeaking(true)
  let url: string
  try {
    url = await audioUrl(text)
  } catch (err) {
    if (mine === generation) setSpeaking(false)
    throw err
  }
  if (mine !== generation) return // something newer started (or it was stopped) while loading
  const audio = new Audio(url)
  current = audio
  audio.onended = () => {
    if (current === audio) {
      current = null
      setSpeaking(false)
    }
  }
  try {
    await audio.play()
  } catch (err) {
    if (current === audio) {
      current = null
      setSpeaking(false)
    }
    throw err
  }
}

export async function transcribe(blob: Blob): Promise<string> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/webm', ...accessHeaders() },
    body: blob,
  })
  if (!res.ok) throw new Error(`transcribe failed (${res.status})`)
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}
