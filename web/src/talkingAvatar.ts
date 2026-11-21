import { accessHeaders } from './access'

// The talking avatar (Simli, simli.com): a live video of Prof. Meuer whose lips move with his voice.
// We send Simli his voice (from ElevenLabs, as raw 16 kHz audio) and it streams back video and
// sound in sync, into a <video> and an <audio> on the page. The Simli key stays on our server
// (/api/avatar gives a short-lived token per session). The Simli code is only loaded when needed.
// If anything goes wrong the page just shows his photo and plays the voice as before.

type SimliSession = {
  start(): Promise<void>
  stop(): Promise<void>
  sendAudioData(data: Uint8Array): void
  ClearBuffer(): void
  on(event: string, callback: (...args: unknown[]) => void): void
}
type SimliModule = {
  SimliClient: new (
    token: string,
    video: HTMLVideoElement,
    audio: HTMLAudioElement,
    iceServers: null,
    logLevel?: number,
  ) => SimliSession
  LogLevel?: Record<string, number>
}

export type AvatarState = 'off' | 'starting' | 'live' | 'failed'

let session: SimliSession | null = null
let state: AvatarState = 'off'
let attempt = 0 // bumps on every start/stop, so a slow start that was cancelled doesn't come alive
const listeners = new Set<(s: AvatarState) => void>()

function setState(next: AvatarState) {
  state = next
  listeners.forEach((l) => l(next))
}

export function onAvatarChange(listener: (s: AvatarState) => void): () => void {
  listeners.add(listener)
  listener(state)
  return () => {
    listeners.delete(listener)
  }
}

export function avatarLive(): boolean {
  return state === 'live' && session !== null
}

// Is the avatar set up on the server (key and face id)? Asked once per visit.
let enabled: Promise<boolean> | null = null
export function avatarEnabled(): Promise<boolean> {
  enabled ??= fetch('/api/avatar', { headers: accessHeaders() })
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((d: { enabled?: boolean }) => d.enabled === true)
    .catch(() => false)
  return enabled
}

// Before his first words: wait (at most a few seconds) for the avatar to connect, if it's set up.
export async function readyToGreet(maxMs = 4000): Promise<void> {
  if (!(await avatarEnabled())) return
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, maxMs)
    const off = onAvatarChange((s) => {
      if (s === 'live' || s === 'failed') done()
    })
    function done() {
      window.clearTimeout(timer)
      off()
      resolve()
    }
  })
}

export async function startAvatar(video: HTMLVideoElement, audio: HTMLAudioElement): Promise<boolean> {
  if (session) return true
  const mine = ++attempt
  setState('starting')
  try {
    const res = await fetch('/api/avatar', { method: 'POST', headers: accessHeaders() })
    if (!res.ok) throw new Error(`avatar token ${res.status}`)
    const { token } = (await res.json()) as { token: string }
    const mod = (await import('simli-client')) as unknown as SimliModule
    if (mine !== attempt) return false
    const client = new mod.SimliClient(token, video, audio, null, mod.LogLevel?.ERROR)
    client.on('stop', () => {
      if (session === client) {
        session = null
        setState('off')
      }
    })
    client.on('error', (detail) => console.warn('Avatar error:', detail))
    await client.start() // resolves on the first video frame
    if (mine !== attempt) {
      void client.stop()
      return false
    }
    session = client
    setState('live')
    return true
  } catch (err) {
    console.warn('Avatar could not start, showing the photo instead:', err)
    if (mine === attempt) setState('failed')
    return false
  }
}

export function stopAvatar() {
  attempt++
  const s = session
  session = null
  endsAt = 0
  if (s) void s.stop().catch(() => undefined)
  setState('off')
}

// ---- Speaking through the avatar ----
// Simli plays the audio itself, in sync with the lips. We know how long each piece lasts
// (16,000 samples of 2 bytes = 32,000 bytes per second), so we can tell when he's done.
const BYTES_PER_SECOND = 32000
const START_DELAY = 0.45 // seconds before Simli starts playing what we send
let endsAt = 0 // when (performance.now, ms) the audio sent so far will have been spoken

export function sendToAvatar(pcm: Uint8Array): number {
  if (!session) return 0
  const now = performance.now()
  // Simli wants an even number of bytes, in chunks of about 6,000.
  const even = pcm.length % 2 ? pcm.subarray(0, pcm.length - 1) : pcm
  for (let i = 0; i < even.length; i += 6000) session.sendAudioData(even.subarray(i, i + 6000))
  endsAt = Math.max(endsAt, now + START_DELAY * 1000) + (even.length / BYTES_PER_SECOND) * 1000
  return endsAt
}

export function avatarEndsAt(): number {
  return endsAt
}

// Stop him mid-sentence: throw away everything he hasn't said yet.
export function clearAvatar() {
  endsAt = 0
  try {
    session?.ClearBuffer()
  } catch {
    /* already gone */
  }
}
