import { accessHeaders } from './access'

// Anonymous numbers about one conversation or practice exam, for Prof. Meuer's overview page:
// which mode was used and for how long, how often he asked more than one question at once,
// repeats, cut-ins, and technical failures. No text, no name.
export type TalkMode = 'type' | 'talk' | 'video'

export class SessionStats {
  private startedAt = Date.now()
  private mode: TalkMode | null = null
  private since = 0
  private ms: Record<TalkMode, number> = { type: 0, talk: 0, video: 0 }
  private n = {
    replies: 0, // his replies
    multiQuestion: 0, // replies with more than one question
    repeats: 0, // "please repeat": the app replayed his exact question
    cutIns: 0, // the student started talking while he spoke
    stopped: 0, // ... and he stopped
    echoes: 0, // he stopped, but it was his own voice from the speakers
    videoFallback: 0, // the video couldn't start, voice only
    voiceFails: 0, // his voice didn't play
    sttFails: 0, // what the student said couldn't be turned into text
  }
  private sent = false

  private exam: boolean
  constructor(exam: boolean) {
    this.exam = exam
  }

  setMode(mode: TalkMode) {
    const t = Date.now()
    if (this.mode) this.ms[this.mode] += t - this.since
    this.mode = mode
    this.since = t
  }

  reply(text: string) {
    this.n.replies++
    if ((text.match(/\?/g) ?? []).length > 1) this.n.multiQuestion++
  }

  count(what: 'repeats' | 'cutIns' | 'stopped' | 'echoes' | 'videoFallback' | 'voiceFails' | 'sttFails') {
    this.n[what]++
  }

  // Sent once, when the student leaves the conversation (or closes the tab).
  send() {
    if (this.sent || this.n.replies === 0) return
    this.sent = true
    this.setMode(this.mode ?? 'type')
    const body = {
      exam: this.exam,
      seconds: Math.round((Date.now() - this.startedAt) / 1000),
      modeSeconds: { type: Math.round(this.ms.type / 1000), talk: Math.round(this.ms.talk / 1000), video: Math.round(this.ms.video / 1000) },
      ...this.n,
    }
    void fetch('/api/session', {
      method: 'POST',
      keepalive: true, // still goes out when the tab is closing
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify(body),
    }).catch(() => undefined)
  }
}
