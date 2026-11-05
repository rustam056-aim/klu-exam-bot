import { useEffect, useRef, useState } from 'react'
import { micHelp } from './micHelp'
import type { MicHelp } from './micHelp'
import { stopSpeaking, transcribe } from './voice'

export type MicState = 'idle' | 'recording' | 'working'

const MAX_SECONDS = 120

export function clock(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Records the student's voice and hands back the text. Used by the small mic button and the big voice-mode one.
export function useRecorder(onText: (text: string) => void) {
  const [state, setState] = useState<MicState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [help, setHelp] = useState<MicHelp | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const textHandler = useRef(onText)
  textHandler.current = onText

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  async function start() {
    setError(null)
    setHelp(null)
    stopSpeaking() // don't record the app's own voice
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setHelp(micHelp('unsupported'))
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const name = (err as DOMException)?.name
      setHelp(micHelp(name === 'NotFoundError' ? 'missing' : name === 'NotReadableError' ? 'busy' : 'blocked'))
      return
    }
    const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunks.current = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data)
    }
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setState('working')
      try {
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || 'audio/webm' })
        const text = await transcribe(blob)
        if (text) textHandler.current(text)
        else setError('Nothing was picked up. Try again a little closer to the microphone.')
      } catch {
        setError('Your recording couldn’t be turned into text. Try again, or type your answer.')
      } finally {
        setState('idle')
      }
    }
    recorder.current = rec
    rec.start()
    setSeconds(0)
    setState('recording')
  }

  // Recording timer, with an automatic stop at two minutes.
  useEffect(() => {
    if (state !== 'recording') return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [state])

  useEffect(() => {
    if (state === 'recording' && seconds >= MAX_SECONDS) stop()
  }, [seconds, state])

  // Stop the microphone if the student leaves the question while recording.
  useEffect(() => () => stop(), [])

  return {
    state,
    seconds,
    error,
    help,
    start: () => void start(),
    stop,
    toggle: () => (state === 'recording' ? stop() : void start()),
    dismissHelp: () => setHelp(null),
  }
}
