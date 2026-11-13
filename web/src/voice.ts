import { accessHeaders } from './access'

// Voice helpers. All calls go through our backend; the ElevenLabs key never reaches the browser.

// One shared player for everything the tutor says. iPhones only let a page start sound by itself
// on a player that was first started by a tap, so unlockAudio() "blesses" this one during a tap
// and every later reply reuses it.
const player: HTMLAudioElement | null = typeof Audio === 'undefined' ? null : new Audio()
const SILENCE = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'
let unlocked = false
let playing = false // something is audible (or loading into the player) right now
let finishCurrent: (() => void) | null = null
let generation = 0 // bumps on every speak/stop; only the newest request may play
const cache = new Map<string, Promise<string>>() // request -> audio URL, shared by parallel requests

// Lets the page show a "Stop" button while something is being read.
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

// Call this inside a tap or click, before any waiting, so a spoken reply may start on its own later.
export function unlockAudio() {
  if (!player || unlocked || playing) return
  player.src = SILENCE
  player
    .play()
    .then(() => {
      unlocked = true
    })
    .catch(() => {
      /* still locked: the student can tap "Listen" */
    })
}

export function stopSpeaking() {
  generation++
  if (player && playing) player.pause()
  playing = false
  finishCurrent?.()
  finishCurrent = null
  setSpeaking(false)
}

type SpeakOptions = {
  chat?: boolean // conversation: split in two so the first sentence starts sooner
}

function audioUrl(text: string, extra: { chat?: boolean; previous?: string; next?: string }): Promise<string> {
  const key = JSON.stringify([text, extra.chat ?? false, extra.previous ?? '', extra.next ?? ''])
  let url = cache.get(key)
  if (!url) {
    url = fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ text, ...extra }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`speak failed (${res.status})`)
      return URL.createObjectURL(await res.blob())
    })
    url.catch(() => cache.delete(key)) // let a failed request be retried
    cache.set(key, url)
  }
  return url
}

// First sentence on its own (it's ready sooner), then the rest in one piece.
export function splitForSpeech(text: string): string[] {
  const t = text.trim()
  const m = t.match(/^(.{20,220}?[.!?])\s+([A-Z0-9“"(].{30,})$/s)
  return m ? [m[1], m[2]] : [t]
}

function playUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!player) return reject(new Error('no audio'))
    finishCurrent = resolve
    player.onended = () => resolve()
    player.onerror = () => reject(new Error('audio error'))
    player.src = url
    player.play().catch(reject)
  })
}

// Reads the text aloud. Resolves true when it was read to the end, false when it was stopped
// or replaced by something newer. Rejects when the audio couldn't be made or played.
export async function speak(text: string, options: SpeakOptions = {}): Promise<boolean> {
  stopSpeaking()
  document.querySelectorAll('audio').forEach((a) => a.pause()) // e.g. Alan's lecture clip
  const mine = generation
  setSpeaking(true)
  playing = true
  const parts = options.chat ? splitForSpeech(text) : [text]
  // Ask for all parts right away; play them in order as they arrive.
  const urls = parts.map((part, i) =>
    audioUrl(part, options.chat ? { chat: true, previous: parts[i - 1], next: parts[i + 1] } : {}),
  )
  urls.forEach((u) => u.catch(() => undefined)) // handled below, in order
  try {
    for (const pending of urls) {
      const url = await pending
      if (mine !== generation) return false // stopped, or something newer started
      await playUrl(url)
      if (mine !== generation) return false
    }
    unlocked = true
    return true
  } finally {
    if (mine === generation) {
      playing = false
      finishCurrent = null
      setSpeaking(false)
    }
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
