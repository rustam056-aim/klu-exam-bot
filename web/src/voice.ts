import { accessHeaders, checkLimit } from './access'
import { VIDEO_BUFFER_MS, avatarKind, avatarLive, clearAvatar, heygenCall, nextAvatarSpeaking, sendToAvatar } from './talkingAvatar'

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

// A soft two-note "your turn" sound when the microphone opens, so you know when to talk
// without watching the screen.
let tones: AudioContext | null = null

export function chime() {
  try {
    if (!tones || tones.state !== 'running') return
    const t = tones.currentTime
    for (const [freq, at] of [
      [660, 0],
      [880, 0.09],
    ]) {
      const osc = tones.createOscillator()
      const gain = tones.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t + at)
      gain.gain.exponentialRampToValueAtTime(0.06, t + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.09)
      osc.connect(gain).connect(tones.destination)
      osc.start(t + at)
      osc.stop(t + at + 0.1)
    }
  } catch {
    /* no sound cue on this browser */
  }
}

// Call this inside a tap or click, before any waiting, so a spoken reply may start on its own later.
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctx && !tones) tones = new Ctx()
    if (tones && tones.state === 'suspended') void tones.resume()
  } catch {
    /* the chime is optional */
  }
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

// The always-on mic hears the student start to talk while the tutor is speaking. It pauses him first
// and only stops him for good once it's clear the student really said something (not just a cough,
// or his own voice coming back through the speakers).
let pausedAt: number | null = null

// When he goes on after a pause, he goes back a little, so the word he was cut off in isn't lost.
const RESUME_BACK_S = 0.4

export function pauseSpeaking(): boolean {
  if (hgVoice) return pauseHeygenVoice()
  if (avatarVoice) return pauseAvatarVoice()
  if (!player || !playing || player.paused) return false
  pausedAt = generation
  player.pause()
  setSpeaking(false)
  return true
}

export function resumeSpeaking() {
  if (hgHeld) return resumeHeygenVoice()
  if (avatarHeld) return resumeAvatarVoice()
  if (!player || pausedAt === null || pausedAt !== generation) return
  pausedAt = null
  setSpeaking(true)
  player.currentTime = Math.max(0, player.currentTime - RESUME_BACK_S)
  player.play().catch(() => stopSpeaking())
}

// The shared Web Audio context, started during a tap (unlockAudio). The always-on mic uses it too.
export function audioContext(): AudioContext | null {
  if (!tones) unlockAudio()
  return tones
}

export function stopSpeaking() {
  pausedAt = null
  avatarVoice = false
  avatarGoOn = false
  avatarHeld = null
  avatarSegments = []
  hgVoice = false
  hgSent = []
  hgHeld = null
  hgGoOn = false
  const wake = avatarWake
  avatarWake = null
  const hgWaking = hgWake
  hgWake = null
  generation++
  wake?.()
  hgWaking?.()
  if (avatarLive() && playing) clearAvatar()
  stopVoiceSources()
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
      await checkLimit(res)
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

// ---- Through the talking avatar: raw audio goes to Simli, which plays it with moving lips ----
const pcmCache = new Map<string, Promise<Uint8Array>>()

// rate: 16000 for Simli, 24000 for HeyGen.
function pcmFor(text: string, extra: { chat?: boolean; previous?: string; next?: string; rate?: number }): Promise<Uint8Array> {
  const key = JSON.stringify([text, extra.chat ?? false, extra.previous ?? '', extra.next ?? '', extra.rate ?? 16000])
  let pcm = pcmCache.get(key)
  if (!pcm) {
    pcm = fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ text, ...extra, pcm: true }),
    }).then(async (res) => {
      await checkLimit(res)
      if (!res.ok) throw new Error(`speak failed (${res.status})`)
      return new Uint8Array(await res.arrayBuffer())
    })
    pcm.catch(() => pcmCache.delete(key))
    pcmCache.set(key, pcm)
  }
  return pcm
}

// His voice with the avatar: the same raw audio goes to Simli (for the lips) and to our own speakers
// (Web Audio). Each piece starts playing the moment Simli starts moving his lips to it, and the next
// pieces follow without a gap, so voice and lips stay together.
let voiceSources: AudioBufferSourceNode[] = []

function stopVoiceSources() {
  for (const src of voiceSources) {
    try {
      src.onended = null
      src.stop()
    } catch {
      /* already stopped */
    }
  }
  voiceSources = []
}

function pcmToBuffer(ctx: AudioContext, pcm: Uint8Array): AudioBuffer {
  const samples = pcm.length >> 1
  const buffer = ctx.createBuffer(1, Math.max(1, samples), 16000)
  const out = buffer.getChannelData(0)
  const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2)
  for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true) / 32768
  return buffer
}

// While he talks through the avatar: what's scheduled (to know where he is when paused), and while
// paused, the audio he still has to say (the rest of the piece he was in, and pieces not yet played).
type Segment = { pcm: Uint8Array; at: number; src: AudioBufferSourceNode }
let avatarVoice = false // speakViaAvatar is running
let avatarSegments: Segment[] = []
let avatarHeld: Uint8Array[] | null = null // non-null = paused
let avatarWake: (() => void) | null = null // resolves the wait while paused (resume or stop)
let avatarGoOn = false // "go on" came before anything was waiting for it

// The student started talking: stop voice and lips right away, but remember where he was.
function pauseAvatarVoice(): boolean {
  const ctx = tones
  if (!ctx || !playing || avatarHeld) return false
  const now = ctx.currentTime
  const held: Uint8Array[] = []
  for (const seg of avatarSegments) {
    const duration = seg.pcm.length / 2 / 16000
    if (now < seg.at) held.push(seg.pcm)
    else if (now < seg.at + duration) {
      const from = Math.max(0, Math.floor((now - seg.at - RESUME_BACK_S) * 16000)) * 2
      held.push(seg.pcm.subarray(from))
    }
  }
  avatarHeld = held
  avatarGoOn = false
  avatarSegments = []
  stopVoiceSources()
  clearAvatar()
  setSpeaking(false)
  return true
}

// It was nothing (a cough, his own echo) or the student said "go on": carry on from there.
function resumeAvatarVoice() {
  if (!avatarHeld) return
  setSpeaking(true)
  avatarGoOn = true
  const wake = avatarWake
  avatarWake = null
  wake?.() // speakViaAvatar picks the held audio up again
}

// Plays one piece: sent to Simli for the lips, and played by us once the lips start moving
// (after a gap) or right after the previous piece.
async function playPiece(ctx: AudioContext, pcm: Uint8Array, next: number, mine: number): Promise<number | null> {
  const afterGap = next <= ctx.currentTime // nothing is playing: wait for the lips to start
  const lipsStart = afterGap ? nextAvatarSpeaking(1500) : null
  sendToAvatar(pcm)
  if (lipsStart) {
    await lipsStart
    if (mine !== generation || avatarHeld) return null
  }
  const src = ctx.createBufferSource()
  src.buffer = pcmToBuffer(ctx, pcm)
  src.connect(ctx.destination)
  // With a smoothing buffer on his video (?buffer=), the lips show up that much later: wait too.
  const at = Math.max(next, ctx.currentTime + (afterGap ? VIDEO_BUFFER_MS / 1000 : 0))
  src.start(at)
  voiceSources.push(src)
  avatarSegments.push({ pcm, at, src })
  return at + src.buffer.duration
}

// (Functions, so TypeScript doesn't assume these can't change while we wait.)
const heldAudio = (): Uint8Array[] | null => avatarHeld
const waitWhilePaused = () =>
  avatarGoOn
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        avatarWake = resolve
      })

async function speakViaAvatar(parts: Promise<Uint8Array>[], mine: number): Promise<boolean> {
  const ctx = audioContext()
  if (!ctx) throw new Error('no audio')
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
  avatarVoice = true
  avatarSegments = []
  avatarHeld = null
  let next = 0 // audio-clock time where the next piece starts

  // Paused: wait until he may go on (or is stopped), then play what was held back.
  async function goOnAfterPause(): Promise<boolean> {
    await waitWhilePaused()
    avatarGoOn = false
    if (mine !== generation) return false
    const held = heldAudio() ?? []
    avatarHeld = null
    next = 0
    for (let i = 0; i < held.length; i++) {
      if (held[i].length < 2) continue
      const end = await playPiece(ctx!, held[i], next, mine)
      if (mine !== generation) return false
      if (end === null) {
        // Paused again before this piece started: keep it (and the rest) for later.
        heldAudio()?.unshift(...held.slice(i))
        break
      }
      next = end
    }
    return true
  }

  try {
    const queue = [...parts]
    for (;;) {
      if (heldAudio()) {
        if (!(await goOnAfterPause())) return false
        continue
      }
      const part = queue.shift()
      if (!part) break
      const pcm = await part
      if (mine !== generation) return false
      if (pcm.length < 2) continue
      const paused = heldAudio()
      if (paused) {
        paused.push(pcm) // arrived while paused: say it after going on
        continue
      }
      const end = await playPiece(ctx, pcm, next, mine)
      if (mine !== generation) return false
      if (end === null) {
        heldAudio()?.unshift(pcm) // paused while waiting for the lips: not played yet
        continue
      }
      next = end
    }
    // Everything is scheduled: wait until he's done (or paused again, or stopped).
    for (;;) {
      if (mine !== generation) return false
      if (heldAudio()) {
        if (!(await goOnAfterPause())) return false
        continue
      }
      const left = next - ctx.currentTime
      if (left <= 0) break
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, Math.min(250, left * 1000 + 20))
        finishCurrent = () => {
          window.clearTimeout(timer)
          resolve()
        }
      })
    }
    voiceSources = []
    return true
  } finally {
    if (mine === generation) {
      avatarVoice = false
      avatarSegments = []
      avatarHeld = null
    }
  }
}

// ---- Through the HeyGen avatar: it plays his voice itself, in sync with the lips ----
// We send the audio and wait until HeyGen says he's done. When the student cuts in, we cut him off
// (interrupt) and keep what he hadn't said yet (from about where he was, minus 0.4 s), so "go on"
// continues from there, like with Simli.
let hgVoice = false // speakViaHeygen is running
let hgSent: Uint8Array[] = [] // the audio of what he's saying now
let hgHeld: Uint8Array[] | null = null // non-null = paused: what's still to say
let hgGoOn = false
let hgWake: (() => void) | null = null
const HG_RATE = 24000

function pauseHeygenVoice(): boolean {
  const call = heygenCall()
  if (!call || !playing || hgHeld) return false
  const all = new Uint8Array(hgSent.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of hgSent) {
    all.set(p, at)
    at += p.length
  }
  const said = call.startedAt === null ? 0 : (performance.now() - call.startedAt) / 1000
  const from = Math.max(0, Math.floor((said - RESUME_BACK_S) * HG_RATE)) * 2
  hgHeld = from < all.length ? [all.subarray(from)] : []
  hgSent = []
  hgGoOn = false
  call.interrupt()
  setSpeaking(false)
  return true
}

function resumeHeygenVoice() {
  if (!hgHeld) return
  setSpeaking(true)
  hgGoOn = true
  const wake = hgWake
  hgWake = null
  wake?.()
}

const heygenHeld = (): Uint8Array[] | null => hgHeld
const heygenGoOn = (): boolean => hgGoOn
const waitHeygenGoOn = () =>
  hgGoOn
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        hgWake = resolve
      })

async function speakViaHeygen(parts: Promise<Uint8Array>[], mine: number): Promise<boolean> {
  const call = heygenCall()
  if (!call) throw new Error('no avatar')
  hgVoice = true
  hgSent = []
  hgHeld = null
  hgGoOn = false
  const send = (pcm: Uint8Array) => {
    call.say(pcm)
    hgSent.push(pcm)
  }
  const sendHeld = () => {
    const held = heygenHeld() ?? []
    hgHeld = null
    hgGoOn = false
    hgSent = []
    for (const p of held) if (p.length > 1) send(p)
  }
  try {
    for (const part of parts) {
      const pcm = await part
      if (mine !== generation) return false
      if (heygenHeld() && heygenGoOn()) sendHeld()
      if (pcm.length < 2) continue
      const held = heygenHeld()
      if (held) held.push(pcm) // paused: say it after going on
      else send(pcm)
    }
    for (;;) {
      if (mine !== generation) return false
      if (heygenHeld()) {
        await waitHeygenGoOn()
        if (mine !== generation) return false
        sendHeld()
      }
      if (hgSent.length === 0) return true // nothing (left) to say
      const seconds = hgSent.reduce((n, p) => n + p.length, 0) / (HG_RATE * 2)
      const outcome = await Promise.race([
        call.finishSaying(),
        new Promise<'timeout'>((resolve) => window.setTimeout(() => resolve('timeout'), (seconds + 10) * 1000)),
      ])
      if (mine !== generation) return false
      if (outcome === 'interrupted' && heygenHeld()) continue // the student cut in: wait, maybe go on
      return outcome !== 'interrupted'
    }
  } finally {
    if (mine === generation) {
      hgVoice = false
      hgSent = []
      hgHeld = null
    }
  }
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
  if (options.chat && avatarLive()) {
    try {
      if (avatarKind() === 'heygen')
        return await speakViaHeygen(
          parts.map((part, i) => pcmFor(part, { chat: true, previous: parts[i - 1], next: parts[i + 1], rate: HG_RATE })),
          mine,
        )
      return await speakViaAvatar(
        parts.map((part, i) => pcmFor(part, { chat: true, previous: parts[i - 1], next: parts[i + 1] })),
        mine,
      )
    } finally {
      if (mine === generation) {
        playing = false
        finishCurrent = null
        setSpeaking(false)
      }
    }
  }
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

// Conversation, streamed: starts reading the first sentence right away, then reads the rest once
// it's written. Resolves like speak().
export async function speakInParts(first: string, rest: Promise<string>): Promise<boolean> {
  stopSpeaking()
  document.querySelectorAll('audio').forEach((a) => a.pause())
  const mine = generation
  setSpeaking(true)
  playing = true
  if (avatarLive() && avatarKind() === 'heygen') {
    try {
      const firstPcm = pcmFor(first, { chat: true, rate: HG_RATE })
      const restPcm = rest.then((r) =>
        r.trim() ? pcmFor(r.trim(), { chat: true, previous: first, rate: HG_RATE }) : new Uint8Array(),
      )
      return await speakViaHeygen([firstPcm, restPcm], mine)
    } finally {
      if (mine === generation) {
        playing = false
        finishCurrent = null
        setSpeaking(false)
      }
    }
  }
  if (avatarLive()) {
    try {
      const firstPcm = pcmFor(first, { chat: true })
      const restPcm = rest.then((r) => (r.trim() ? pcmFor(r.trim(), { chat: true, previous: first }) : new Uint8Array()))
      return await speakViaAvatar([firstPcm, restPcm], mine)
    } finally {
      if (mine === generation) {
        playing = false
        finishCurrent = null
        setSpeaking(false)
      }
    }
  }
  const firstUrl = audioUrl(first, { chat: true })
  const restUrl = rest.then((r) => (r.trim() ? audioUrl(r.trim(), { chat: true, previous: first }) : null))
  firstUrl.catch(() => undefined)
  restUrl.catch(() => undefined)
  try {
    const url1 = await firstUrl
    if (mine !== generation) return false
    await playUrl(url1)
    if (mine !== generation) return false
    const url = await restUrl
    if (mine !== generation) return false
    if (url) await playUrl(url)
    if (mine !== generation) return false
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
  await checkLimit(res)
  if (!res.ok) throw new Error(`transcribe failed (${res.status})`)
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}
