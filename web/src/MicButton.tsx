import { useEffect, useRef, useState } from 'react'
import { stopSpeaking, transcribe } from './voice'

const MAX_SECONDS = 120

function clock(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Records the student's spoken answer and hands back the text, which they can still edit.
export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  async function start() {
    setError(null)
    stopSpeaking() // don't record the app's own voice
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice answers don’t work in this browser. Type your answer instead.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('The microphone is blocked. Allow it in your browser settings, or type your answer.')
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
        if (text) onText(text)
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

  const label =
    state === 'recording'
      ? `Stop recording (${clock(seconds)})`
      : state === 'working'
        ? 'Turning your answer into text…'
        : 'Answer by speaking'

  return (
    <div className="mic">
      <button
        type="button"
        className={`btn quiet mic-btn mic-${state}`}
        onClick={state === 'recording' ? stop : () => void start()}
        disabled={disabled || state === 'working'}
        aria-pressed={state === 'recording'}
      >
        {label}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
