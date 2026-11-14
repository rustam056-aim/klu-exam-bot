import { useEffect, useRef, useState } from 'react'
import { micHelp } from './micHelp'
import type { MicHelp } from './micHelp'
import { audioContext } from './voice'

// The always-on mic for "Talk to Johannes".
// Tap once, then just talk: the mic stays open for the whole conversation. It listens all the time,
// notices when you start and stop talking, and hands each thing you say over as a short WAV clip.
// It also hears you when you start talking while Johannes is still speaking, so you can interrupt him
// just by talking. Nothing is recorded while you're quiet, and nothing is kept.

export type LiveState = 'off' | 'starting' | 'listening' | 'hearing'

type Callbacks = {
  onSpeechStart: () => void // the student started talking (e.g. pause Johannes)
  onUtterance: (wav: Blob) => void // the student finished a sentence
  onFalseStart: () => void // it was only a short noise after all
}

const RATE = 16000 // what the clip is saved at (plenty for speech, small to upload)
const PRE_ROLL_MS = 500 // keep this much from just before the speech started, so no word is cut off
const PAUSE_MS = 1100 // this much quiet after speech = "I'm done"
const MAX_MS = 40000 // one turn can't run longer than this

export function useLiveMic(callbacks: Callbacks) {
  const [state, setState] = useState<LiveState>('off')
  const [help, setHelp] = useState<MicHelp | null>(null)
  const cb = useRef(callbacks)
  cb.current = callbacks
  const live = useRef<{
    stream: MediaStream
    node: ScriptProcessorNode
    source: MediaStreamAudioSourceNode
    sink: GainNode
  } | null>(null)
  // What the analysis loop needs; refs, because the audio callback runs outside React.
  const ear = useRef({
    muted: false, // ignore the mic (while waiting for a reply or turning speech into text)
    strict: false, // Johannes is talking: only clear, sustained speech counts (not his echo)
    floor: 0.01, // the room's background level
    calibrated: 0, // ms of room measured so far
    loudMs: 0, // speech in a row
    quietMs: 0, // silence since the last speech
    inSpeech: false,
    confirmed: false, // long enough to be real speech, not a click
    preRoll: [] as Float32Array[],
    clip: [] as Float32Array[],
    clipMs: 0,
  })

  function reset() {
    const e = ear.current
    e.loudMs = 0
    e.quietMs = 0
    e.inSpeech = false
    e.confirmed = false
    e.clip = []
    e.clipMs = 0
  }

  function finish() {
    const e = ear.current
    const parts = [...e.clip]
    reset()
    setState('listening')
    cb.current.onUtterance(toWav(parts))
  }

  function process(input: Float32Array, inRate: number) {
    const e = ear.current
    const frame = downsample(input, inRate)
    const ms = (frame.length / RATE) * 1000
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const level = Math.sqrt(sum / frame.length)

    // First moments: learn how loud the room is.
    if (e.calibrated < 500) {
      e.calibrated += ms
      e.floor = Math.max(e.floor * 0.5 + level * 0.5, 0.004)
      return
    }
    if (e.muted) {
      reset()
      e.preRoll = []
      return
    }

    const threshold = e.strict ? Math.max(0.05, e.floor * 4) : Math.max(0.02, e.floor * 2.5)
    const needMs = e.strict ? 500 : 220
    const loud = level >= threshold

    if (!e.inSpeech) {
      e.preRoll.push(frame)
      let kept = e.preRoll.reduce((n, f) => n + f.length, 0)
      while (kept > (RATE * PRE_ROLL_MS) / 1000 && e.preRoll.length > 1) kept -= e.preRoll.shift()!.length
      if (!loud) {
        e.floor = Math.min(0.05, e.floor * 0.95 + level * 0.05) // follow the room slowly
        return
      }
      // Something loud: start a possible sentence, with the bit just before it.
      e.inSpeech = true
      e.clip = [...e.preRoll]
      e.preRoll = []
      e.clipMs = PRE_ROLL_MS
      e.loudMs = ms
      e.quietMs = 0
      return
    }

    e.clip.push(frame)
    e.clipMs += ms
    if (loud) {
      e.loudMs += ms
      e.quietMs = 0
    } else {
      e.quietMs += ms
      if (!e.confirmed && e.quietMs > 300) e.loudMs = 0
    }
    if (!e.confirmed) {
      if (e.loudMs >= needMs) {
        e.confirmed = true
        setState('hearing')
        cb.current.onSpeechStart()
      } else if (e.quietMs > 500) {
        reset() // just a click or a cough
      }
      return
    }
    if (e.quietMs >= PAUSE_MS || e.clipMs >= MAX_MS) {
      // Drop most of the trailing silence before sending.
      const dropFrames = Math.floor(Math.max(0, e.quietMs - 300) / ms)
      if (dropFrames > 0) e.clip.splice(e.clip.length - dropFrames, dropFrames)
      finish()
    }
  }

  const starting = useRef(false)
  async function start() {
    if (live.current) return
    if (starting.current) {
      stopped.current = false // switched off and on again while starting: keep the one that's coming
      return
    }
    starting.current = true
    try {
      await open()
    } finally {
      starting.current = false
    }
  }

  async function open() {
    stopped.current = false
    setHelp(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setHelp(micHelp('unsupported'))
      return
    }
    setState('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      const name = (err as DOMException)?.name
      setHelp(micHelp(name === 'NotFoundError' ? 'missing' : name === 'NotReadableError' ? 'busy' : 'blocked'))
      setState('off')
      return
    }
    const ctx = audioContext()
    if (!ctx || !mounted.current || stopped.current) {
      stream.getTracks().forEach((t) => t.stop())
      setState('off')
      if (!ctx) setHelp(micHelp('unsupported'))
      return
    }
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
    const source = ctx.createMediaStreamSource(stream)
    const node = ctx.createScriptProcessor(4096, 1, 1)
    const sink = ctx.createGain()
    sink.gain.value = 0 // the processor has to be connected to run, but we don't want to hear ourselves
    node.onaudioprocess = (ev) => process(ev.inputBuffer.getChannelData(0), ctx.sampleRate)
    source.connect(node)
    node.connect(sink)
    sink.connect(ctx.destination)
    ear.current.calibrated = 0
    reset()
    live.current = { stream, node, source, sink }
    setState('listening')
  }

  // Set when the student switches the mic off while it's still starting up.
  const stopped = useRef(false)
  function stop() {
    stopped.current = starting.current
    const l = live.current
    live.current = null
    if (l) {
      l.node.onaudioprocess = null
      l.source.disconnect()
      l.node.disconnect()
      l.sink.disconnect()
      l.stream.getTracks().forEach((t) => t.stop())
    }
    reset()
    setState('off')
  }

  // The student tapped while talking: they're done, send it now instead of waiting for the pause.
  function flush() {
    const e = ear.current
    if (e.inSpeech && e.confirmed) finish()
  }

  // Throw away what's being heard right now (e.g. the student tapped "stop").
  function drop() {
    if (ear.current.inSpeech && ear.current.confirmed) cb.current.onFalseStart()
    reset()
    if (live.current) setState('listening')
  }

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    state,
    help,
    on: state !== 'off',
    start: () => void start(),
    stop,
    drop,
    flush,
    dismissHelp: () => setHelp(null),
    // Ignore the mic (waiting for a reply, turning speech into text) or listen again.
    mute: (value: boolean) => {
      ear.current.muted = value
      if (value) {
        reset()
        if (live.current) setState('listening')
      }
    },
    // Johannes is talking: only clear, sustained speech interrupts him.
    strict: (value: boolean) => {
      ear.current.strict = value
    },
  }
}

function downsample(input: Float32Array, inRate: number): Float32Array {
  if (inRate === RATE) return new Float32Array(input)
  const ratio = inRate / RATE
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    // average the samples that fall into this output sample (a simple low-pass)
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

// 16 kHz, 16-bit, mono WAV.
function toWav(parts: Float32Array[]): Blob {
  const length = parts.reduce((n, p) => n + p.length, 0)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, length * 2, true)
  let at = 44
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const v = Math.max(-1, Math.min(1, part[i]))
      view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      at += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

// Did the mic just pick up Johannes himself (through the speakers) instead of the student?
// Mostly his words = his voice. Short bits ("okay", "right") that he also said count as him too.
export function soundsLikeEcho(heard: string, spoken: string): boolean {
  const words = (t: string) => t.toLowerCase().replace(/[’']/g, "'").match(/[a-z0-9']+/g) ?? []
  const said = words(heard)
  if (said.length === 0) return true
  const his = new Set(words(spoken))
  const overlap = said.filter((w) => his.has(w)).length / said.length
  if (said.length < 3) return overlap === 1
  return overlap >= 0.6
}
