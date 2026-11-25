import { accessHeaders } from './access'

// The HeyGen talking avatar (LiveAvatar by HeyGen, "LITE" mode), to compare with Simli.
// Our server opens the session (the HeyGen key stays there) and gives us two things:
// - a LiveKit room, where HeyGen streams his video AND his voice, already in sync (so unlike
//   Simli we don't play the voice ourselves);
// - a WebSocket, where we send his voice (raw 24 kHz audio from ElevenLabs, in ~1 s pieces) and
//   get told when he starts and stops talking.
// HeyGen bills per minute while the session is open, so it's closed as soon as the call is left.

type Outcome = 'ended' | 'interrupted' | 'closed'

type Started = { session_id: string; livekit_url: string; livekit_client_token: string; ws_url: string }

type Message = {
  type?: string
  state?: string
  data?: { state?: string }
  source_event_id?: string | null
  error?: unknown
  warning?: unknown
}

const BYTES_PER_SECOND = 48000 // 24,000 samples of 2 bytes

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export class HeygenCall {
  private room: { disconnect(): Promise<void>; startAudio(): Promise<void> } | null = null
  private ws: WebSocket | null = null
  private sessionId = ''
  private keepAlive = 0
  private closed = false
  private utterance: string | null = null // id of what he's saying now (the first piece's event id)
  private open = false // more audio may still come for this utterance
  private waiters: ((o: Outcome) => void)[] = []
  /** performance.now() when he started saying the current utterance, null before. */
  startedAt: number | null = null
  onClose: () => void = () => undefined

  async start(video: HTMLVideoElement, audio: HTMLAudioElement, cancelled: () => boolean): Promise<void> {
    const res = await fetch('/api/avatar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({ provider: 'heygen' }),
    })
    if (!res.ok) throw new Error(`HeyGen session ${res.status}`)
    const s = (await res.json()) as Started
    this.sessionId = s.session_id
    if (cancelled()) throw new Error('cancelled')

    const { Room, RoomEvent, Track } = await import('livekit-client')
    const room = new Room({ adaptiveStream: false, dynacast: false })
    this.room = room
    const firstFrame = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('no video from HeyGen')), 25000)
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video) {
          track.attach(video)
          const shown = () => {
            window.clearTimeout(timer)
            resolve()
          }
          if (video.readyState >= 2) shown()
          else video.addEventListener('loadeddata', shown, { once: true })
        } else if (track.kind === Track.Kind.Audio) {
          audio.muted = false
          track.attach(audio)
        }
      })
      room.on(RoomEvent.Disconnected, () => {
        window.clearTimeout(timer)
        reject(new Error('HeyGen room closed'))
        this.close()
      })
    })
    const socketReady = this.openSocket(s.ws_url)
    await room.connect(s.livekit_url, s.livekit_client_token)
    void room.startAudio().catch(() => undefined)
    await Promise.all([firstFrame, socketReady])
    // Without a sign of life HeyGen closes after 5 idle minutes; while the call is open, keep it.
    this.keepAlive = window.setInterval(() => this.send({ type: 'session.keep_alive' }), 60_000)
  }

  private openSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      const timer = window.setTimeout(() => reject(new Error('HeyGen socket timed out')), 25000)
      ws.onmessage = (e) => {
        let msg: Message
        try {
          msg = JSON.parse(String(e.data)) as Message
        } catch {
          return
        }
        const ours = !msg.source_event_id || msg.source_event_id === this.utterance
        switch (msg.type) {
          case 'session.state_updated': {
            const state = msg.state ?? msg.data?.state
            if (state === 'connected') {
              window.clearTimeout(timer)
              resolve()
            } else if (state === 'disconnected') this.close()
            break
          }
          case 'agent.speak_started':
            if (ours) this.startedAt = performance.now()
            break
          case 'agent.speak_ended':
            if (ours) this.finish('ended')
            break
          case 'agent.speak_interrupted':
            if (ours) this.finish('interrupted')
            break
          case 'error':
            console.warn('HeyGen error:', msg.error ?? msg)
            break
          case 'warning':
            console.info('HeyGen warning:', msg.warning ?? msg)
            break
        }
      }
      ws.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error('HeyGen socket error'))
      }
      ws.onclose = () => this.close()
    })
  }

  private send(event: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event))
  }

  private finish(outcome: Outcome) {
    this.utterance = null
    this.open = false
    const waiting = this.waiters
    this.waiters = []
    waiting.forEach((w) => w(outcome))
  }

  /** Adds audio (24 kHz 16-bit mono) to what he's saying, or starts a new utterance. */
  say(pcm: Uint8Array) {
    const even = pcm.length % 2 ? pcm.subarray(0, pcm.length - 1) : pcm
    for (let i = 0; i < even.length; i += BYTES_PER_SECOND) {
      const event: Record<string, unknown> = { type: 'agent.speak', audio: toBase64(even.subarray(i, i + BYTES_PER_SECOND)) }
      if (!this.open) {
        this.utterance = crypto.randomUUID()
        this.open = true
        this.startedAt = null
        event.event_id = this.utterance
      }
      this.send(event)
    }
  }

  /** No more audio for this utterance; resolves when he has said it all (or was cut off). */
  finishSaying(): Promise<Outcome> {
    const done = new Promise<Outcome>((resolve) => this.waiters.push(resolve))
    if (this.open) {
      this.send({ type: 'agent.speak_end' })
      this.open = false
    } else if (!this.utterance) this.finish('ended')
    return done
  }

  /** Stop him at once (lips and voice). */
  interrupt() {
    if (this.utterance || this.open) this.send({ type: 'agent.interrupt' })
    this.startedAt = null
    this.finish('interrupted')
  }

  /** Hang up: closes the room and tells HeyGen to end the session (so it stops billing). */
  stop() {
    if (this.sessionId) {
      void fetch('/api/avatar/stop', {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json', ...accessHeaders() },
        body: JSON.stringify({ session_id: this.sessionId }),
      }).catch(() => undefined)
      this.sessionId = ''
    }
    this.close()
  }

  private close() {
    if (this.closed) return
    this.closed = true
    window.clearInterval(this.keepAlive)
    try {
      this.ws?.close()
    } catch {
      /* already closed */
    }
    void this.room?.disconnect().catch(() => undefined)
    this.finish('closed')
    this.onClose()
  }
}
