import { accessHeaders } from './access'
import { HeygenCall } from './heygenAvatar'

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

// Which talking avatar: Simli (the default) or HeyGen (LiveAvatar, being compared). HeyGen only
// shows up with a test link: ?avatar=heygen adds a "Video · HeyGen" way on the home screen and
// uses HeyGen for the oral exam too. The student trial stays on Simli.
export type AvatarKind = 'simli' | 'heygen'
export const HEYGEN_TEST = typeof location !== 'undefined' && new URLSearchParams(location.search).get('avatar') === 'heygen'
let kind: AvatarKind = 'simli'
export function avatarKind(): AvatarKind {
  return kind
}
export function setAvatarKind(next: AvatarKind) {
  if (next === kind) return
  stopAvatar()
  kind = next
}

// Smoothing buffer for his video, in ms (link: ?buffer=300 to try another). Simli sends frames in little bursts;
// with no buffer Chrome shows only the last frame of each burst and drops the others (measured:
// 25 to 28 frames a second arrive, 17 to 19 are shown). A short buffer lets Chrome show them
// evenly; his voice is then started the same amount later, so the lips still match.
// Measured on a MacBook Air: no buffer 17 to 19 shown, 200 ms 25 shown (2% dropped, longest
// freeze 66 ms), 400 ms no better. So 200 ms by default; ?buffer=0 switches it off.
export const VIDEO_BUFFER_MS = (() => {
  if (typeof location === 'undefined') return 200
  const asked = new URLSearchParams(location.search).get('buffer')
  const n = asked === null ? 200 : Number(asked)
  return Number.isFinite(n) ? Math.min(1000, Math.max(0, n)) : 200
})()

// The video connections (Simli's WebRTC), so we can set that buffer and the ?debug=1 meter can
// read what arrives from the network.
export const videoPeers: RTCPeerConnection[] = []
if (typeof window !== 'undefined' && window.RTCPeerConnection) {
  const Original = window.RTCPeerConnection
  const Watched = function (this: unknown, ...args: ConstructorParameters<typeof RTCPeerConnection>) {
    const pc = new Original(...args)
    videoPeers.push(pc)
    if (VIDEO_BUFFER_MS > 0) {
      pc.addEventListener('track', (e) => {
        // Only for Simli. HeyGen sends voice and video as two tracks: delaying just the video
        // would put the lips behind the voice.
        if (kind !== 'simli') return
        const receiver = e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null }
        if (e.track.kind === 'video' && 'jitterBufferTarget' in receiver) receiver.jitterBufferTarget = VIDEO_BUFFER_MS
      })
    }
    return pc
  } as unknown as typeof RTCPeerConnection
  Watched.prototype = Original.prototype
  Object.assign(Watched, Original)
  window.RTCPeerConnection = Watched
}

let session: SimliSession | null = null
let heygen: HeygenCall | null = null
export function heygenCall(): HeygenCall | null {
  return heygen
}
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

// Is the call on screen? While it's hidden (Talk or Type tab), the connection stays but his voice
// plays through the normal speakers.
let active = false
let hiddenTimer = 0
export function setAvatarActive(on: boolean) {
  active = on
  window.clearTimeout(hiddenTimer)
  // HeyGen costs per minute while open: hang up when the call has been hidden for 30 s.
  if (!on && heygen) hiddenTimer = window.setTimeout(() => !active && heygen && stopAvatar(), 30_000)
}

export function avatarLive(): boolean {
  return active && state === 'live' && (kind === 'heygen' ? heygen !== null : session !== null)
}

// Which avatars are set up on the server (keys and face ids)? Asked once per visit.
type Setup = { simli: boolean; heygen: boolean }
let setup: Promise<Setup> | null = null
function avatarSetup(): Promise<Setup> {
  if (setup) return setup
  const asking = fetch('/api/avatar', { headers: accessHeaders() })
    .then((r) => {
      if (r.status === 401) setup = null // no access code yet: ask again later
      return r.ok ? r.json() : {}
    })
    .then((d: { enabled?: boolean; heygen?: boolean }) => ({ simli: d.enabled === true, heygen: d.heygen === true }))
    .catch(() => {
      setup = null
      return { simli: false, heygen: false }
    })
  setup = asking
  return asking
}

// Is the avatar in use (Simli or HeyGen) set up?
export function avatarEnabled(): Promise<boolean> {
  const asked = kind
  return avatarSetup().then((s) => s[asked])
}

// Is HeyGen set up (for the test button)?
export function heygenEnabled(): Promise<boolean> {
  return avatarSetup().then((s) => s.heygen)
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

// Load the Simli code ahead of time (on the home screen), so the video connects faster.
export function prefetchAvatar() {
  void import('simli-client').catch(() => undefined)
  if (HEYGEN_TEST) void import('livekit-client').catch(() => undefined)
}

async function startHeygen(video: HTMLVideoElement, audio: HTMLAudioElement): Promise<boolean> {
  if (heygen) return true
  const mine = ++attempt
  setState('starting')
  const call = new HeygenCall()
  call.onClose = () => {
    if (heygen === call) {
      heygen = null
      setState('off')
    }
  }
  try {
    await call.start(video, audio, () => mine !== attempt)
    if (mine !== attempt) {
      call.stop()
      return false
    }
    heygen = call
    setState('live')
    return true
  } catch (err) {
    call.stop()
    console.warn('HeyGen avatar could not start, showing the photo instead:', err)
    if (mine === attempt) setState('failed')
    return false
  }
}

export async function startAvatar(video: HTMLVideoElement, audio: HTMLAudioElement): Promise<boolean> {
  if (kind === 'heygen') return startHeygen(video, audio)
  if (session) return true
  const mine = ++attempt
  setState('starting')
  try {
    // Simli's default square video (768 x 768): measured smoother than a 1280 x 720 one (19 vs 13
    // frames a second on a MacBook Air). The blurred photo fills the sides of the call window.
    // A link with ?video=wide (or tall) still asks for the big video, to compare.
    const forced = new URLSearchParams(location.search).get('video')
    const shape = forced === 'wide' || forced === 'tall' ? forced : 'square'
    const res = await fetch('/api/avatar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ shape }),
    })
    if (!res.ok) throw new Error(`avatar token ${res.status}`)
    const { token } = (await res.json()) as { token: string }
    const mod = (await import('simli-client')) as unknown as SimliModule
    if (mine !== attempt) return false
    // We play his voice ourselves (see voice.ts), so Simli's own sound stays off: that way the voice
    // always works, even where the browser would block Simli's audio.
    audio.muted = true
    const client = new mod.SimliClient(token, video, audio, null, mod.LogLevel?.ERROR)
    client.on('speaking', () => {
      const waiting = speakingWaiters
      speakingWaiters = []
      waiting.forEach((w) => w())
    })
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
  const h = heygen
  heygen = null
  h?.stop()
  setState('off')
}

// Closing the tab: hang up HeyGen too (it bills while open).
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => heygen && stopAvatar())

// Resolves when Simli starts moving his lips to what we just sent (or after `maxMs`, whatever comes
// first), so his voice can start at exactly that moment.
let speakingWaiters: (() => void)[] = []
export function nextAvatarSpeaking(maxMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer)
      speakingWaiters = speakingWaiters.filter((w) => w !== done)
      resolve()
    }
    const timer = window.setTimeout(done, maxMs)
    speakingWaiters.push(done)
  })
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
  heygen?.interrupt()
  try {
    session?.ClearBuffer()
  } catch {
    /* already gone */
  }
}
