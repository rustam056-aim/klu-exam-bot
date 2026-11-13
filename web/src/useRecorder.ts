import { useEffect, useRef, useState } from 'react'
import { micHelp } from './micHelp'
import type { MicHelp } from './micHelp'
import { loudnessOf, newVad, vadStep } from './vad'
import { stopSpeaking, transcribe } from './voice'

export type MicState = 'idle' | 'recording' | 'working'

const MAX_SECONDS = 120
const MAX_SECONDS_HANDS_FREE = 45 // if the room never goes quiet, don't record forever

export function clock(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Options = {
  // Hands-free: stop by itself when the student stops talking (see vad.ts).
  autoStop?: boolean
  // Hands-free: the mic was open but nobody said anything.
  onNothing?: () => void
}

// Records the student's voice and hands back the text.
export function useRecorder(onText: (text: string) => void, options: Options = {}) {
  const [state, setState] = useState<MicState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [help, setHelp] = useState<MicHelp | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const cancelled = useRef(false) // stop without turning the recording into text
  const starting = useRef(false) // waiting for the browser's microphone permission
  const gone = useRef(false) // the screen using this recorder was closed
  const listening = useRef<{ ctx: AudioContext; timer: number } | null>(null)
  const textHandler = useRef(onText)
  textHandler.current = onText
  const opts = useRef(options)
  opts.current = options

  function stopListeningForSilence() {
    if (!listening.current) return
    window.clearInterval(listening.current.timer)
    void listening.current.ctx.close().catch(() => undefined)
    listening.current = null
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  // Close the mic and throw the recording away.
  function cancel() {
    cancelled.current = true
    stop()
  }

  async function start() {
    if (starting.current || recorder.current?.state === 'recording') return
    setError(null)
    setHelp(null)
    stopSpeaking() // don't record the app's own voice
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setHelp(micHelp('unsupported'))
      return
    }
    let stream: MediaStream
    starting.current = true
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      const name = (err as DOMException)?.name
      setHelp(micHelp(name === 'NotFoundError' ? 'missing' : name === 'NotReadableError' ? 'busy' : 'blocked'))
      return
    } finally {
      starting.current = false
    }
    if (gone.current) {
      stream.getTracks().forEach((t) => t.stop()) // the student already left this screen
      return
    }
    const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunks.current = []
    cancelled.current = false
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
    }
    rec.onstop = async () => {
      stopListeningForSilence()
      stream.getTracks().forEach((t) => t.stop())
      if (cancelled.current) {
        setState('idle')
        return
      }
      setState('working')
      try {
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || 'audio/webm' })
        const text = await transcribe(blob)
        if (text) textHandler.current(text)
        else setError('Nothing was picked up. Try again a little closer to the microphone.')
      } catch {
        setError('Your recording couldn’t be turned into text. Try again, or type instead.')
      } finally {
        setState('idle')
      }
    }
    recorder.current = rec
    rec.start()
    setSeconds(0)
    setState('recording')

    // Hands-free: watch the loudness and stop when the student has finished talking.
    if (opts.current.autoStop) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new Ctx()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(stream).connect(analyser)
        const samples = new Uint8Array(analyser.fftSize)
        const vad = newVad()
        const timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples)
          const verdict = vadStep(vad, loudnessOf(samples), 100)
          if (verdict === 'stop') stop()
          if (verdict === 'nothing') {
            cancel()
            opts.current.onNothing?.()
          }
        }, 100)
        listening.current = { ctx, timer }
      } catch {
        /* no silence detection on this browser: the student taps to stop, as before */
      }
    }
  }

  // Recording timer, with an automatic stop.
  useEffect(() => {
    if (state !== 'recording') return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [state])

  useEffect(() => {
    const max = opts.current.autoStop ? MAX_SECONDS_HANDS_FREE : MAX_SECONDS
    if (state === 'recording' && seconds >= max) stop()
  }, [seconds, state])

  // Close the microphone if the student leaves while recording.
  useEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
      cancelled.current = true
      stop()
      stopListeningForSilence()
    }
  }, [])

  return {
    state,
    seconds,
    error,
    help,
    start: () => void start(),
    stop,
    cancel,
    toggle: () => (state === 'recording' ? stop() : void start()),
    dismissHelp: () => setHelp(null),
  }
}
