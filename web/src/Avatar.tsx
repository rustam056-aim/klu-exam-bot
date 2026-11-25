import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { accessQuery } from './access'
import { VIDEO_BUFFER_MS, avatarEnabled, onAvatarChange, setAvatarActive, startAvatar, stopAvatar, videoPeers } from './talkingAvatar'
import type { AvatarState } from './talkingAvatar'
import type { TutorState } from './Tutor'

// Johannes on screen in "Talk to Johannes".
// Talk: his photo (web/public/avatar/photo.jpg, never on GitHub, behind the access code) with a ring
// that shows what's happening: a gentle pulse while he talks, the accent colour when it's your
// turn, dots while he thinks.
// Video (`call`): like a video call. The talking avatar (Simli, see talkingAvatar.ts) fills the
// screen; while it connects you see a soft, blurred version of his photo and "Connecting…", so
// it never looks like a still picture pretending to be the video. The status sits on the video,
// and `children` (the Stop button) at the bottom of it.
// If even the photo can't load, `onFail` lets the page fall back.
export function Avatar({
  state,
  label,
  live: wantVideo,
  call = false,
  onFail,
  intro,
  onIntroEnd,
  children,
}: {
  state: TutorState
  label: string
  live: boolean // connect the talking avatar; otherwise just the photo
  call?: boolean // Video: full-screen video call layout
  onFail: () => void
  intro?: string | null // a recorded video to play first (the exam welcome, made with HeyGen)
  onIntroEnd?: (played: boolean) => void // false = it couldn't play
  children?: ReactNode
}) {
  const [loaded, setLoaded] = useState(false)
  const [live, setLive] = useState<AvatarState>('off')
  const [retry, setRetry] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => onAvatarChange(setLive), [])

  // The recorded welcome: plays with sound; if the browser or the file says no, tell the page
  // (it then says the welcome with the live voice instead).
  const introVideo = useRef<HTMLVideoElement>(null)
  const introEnd = useRef(onIntroEnd)
  introEnd.current = onIntroEnd
  useEffect(() => {
    const el = introVideo.current
    if (!intro || !el) return
    el.muted = false
    el.play().catch(() => introEnd.current?.(false))
  }, [intro])
  const introEl = intro ? (
    <video
      ref={introVideo}
      key={intro}
      className={call ? 'vcall-video is-on' : 'avatar-live is-on'}
      src={intro}
      playsInline
      preload="auto"
      onEnded={() => introEnd.current?.(true)}
      onError={() => introEnd.current?.(false)}
    />
  ) : null

  // The call (Video): connect when it's shown, and reconnect if the connection was closed meanwhile
  // (Simli hangs up after 2 quiet minutes). Hidden = his voice goes back to the normal speakers,
  // but the connection stays, so coming back is instant. Leaving the conversation hangs up.
  useEffect(() => {
    if (!call) return
    setAvatarActive(wantVideo)
    if (!wantVideo) return
    let cancelled = false
    void avatarEnabled().then((on) => {
      if (on && !cancelled && video.current && audio.current) void startAvatar(video.current, audio.current)
    })
    return () => {
      cancelled = true
    }
  }, [wantVideo, call, retry])
  useEffect(() => {
    if (!call) return
    return () => {
      setAvatarActive(false)
      stopAvatar()
    }
  }, [call])

  const showVideo = wantVideo && live === 'live'
  const photo = `/avatar/photo.jpg${accessQuery()}`

  if (call) {
    const connecting = !showVideo && live !== 'failed' && !intro
    return (
      <div className={`vcall-stage avatar-${state} ${showVideo ? 'is-live' : ''} ${PLAIN ? 'is-plain' : ''}`}>
        <div className="vcall-backdrop" style={{ backgroundImage: `url(${photo})` }} aria-hidden="true" />
        <video ref={video} className={`vcall-video ${showVideo ? 'is-on' : ''}`} autoPlay playsInline aria-hidden="true" />
        <audio ref={audio} autoPlay />
        {introEl}
        {DEBUG && showVideo && <VideoStats video={video} />}
        {!showVideo && (
          <img
            className="vcall-photo is-waiting"
            src={photo}
            alt="Prof. Johannes Meuer"
            onLoad={() => setLoaded(true)}
            onError={onFail}
          />
        )}
        {connecting && (
          <div className="vcall-connecting" role="status">
            <span className="vcall-spinner" aria-hidden="true" />
            Connecting to Johannes…
          </div>
        )}
        {live === 'failed' && !intro && (
          <div className="vcall-connecting" role="alert">
            The video couldn’t start, so it’s voice only for now.
            <button className="btn secondary sm" type="button" onClick={() => setRetry((n) => n + 1)}>
              Try the video again
            </button>
          </div>
        )}
        {showVideo && (
          <span className="vcall-status" aria-live="polite">
            {state === 'thinking' ? 'Thinking…' : label}
          </span>
        )}
        {state === 'thinking' && showVideo && (
          <span className="avatar-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
        <div className="vcall-controls">{children}</div>
        <span className="vcall-note">AI tutor with Prof. Meuer’s face and voice · can make mistakes</span>
      </div>
    )
  }

  return (
    <div className={`avatar avatar-${state}`}>
      <div className="avatar-frame">
        <img
          className={`avatar-photo ${loaded && !showVideo ? 'is-on' : ''}`}
          src={photo}
          alt="Prof. Johannes Meuer"
          onLoad={() => setLoaded(true)}
          onError={onFail}
        />
        <video ref={video} className={`avatar-live ${showVideo ? 'is-on' : ''}`} autoPlay playsInline aria-hidden="true" />
        <audio ref={audio} autoPlay />
        {introEl}
        {state === 'thinking' && (
          <span className="avatar-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
      <span className="tutor-label avatar-label" aria-live="polite">
        {wantVideo && live === 'starting' ? 'Connecting the video…' : label}
      </span>
    </div>
  )
}

// ?debug=1: a small live meter on the video (frames per second actually shown, the size Simli
// sends, dropped frames, the longest freeze in the last 5 seconds), to judge how smooth it is.
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1'
// ?plain=1: no blurred photo behind the video and no rounded corners (the lightest possible call
// window), to test whether the page itself makes the video stutter on a slow computer.
const PLAIN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('plain') === '1'

type Inbound = { framesReceived?: number; framesDecoded?: number; framesDropped?: number; packetsLost?: number; packetsReceived?: number; jitter?: number }
async function inboundVideo(): Promise<Inbound | null> {
  for (const pc of videoPeers) {
    if (pc.connectionState === 'closed') continue
    const stats = await pc.getStats().catch(() => null)
    let found: Inbound | null = null
    stats?.forEach((r: { type?: string; kind?: string } & Inbound) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') found = r
    })
    if (found) return found
  }
  return null
}

function VideoStats({ video }: { video: { current: HTMLVideoElement | null } }) {
  const [text, setText] = useState('measuring…')
  useEffect(() => {
    const el = video.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }) | null
    if (!el || !el.requestVideoFrameCallback) return
    let frames: number[] = []
    let stopped = false
    let before: Inbound | null = null
    const onFrame = () => {
      if (stopped) return
      frames.push(performance.now())
      el.requestVideoFrameCallback!(onFrame)
    }
    el.requestVideoFrameCallback(onFrame)
    const timer = window.setInterval(async () => {
      const now = performance.now()
      // From the network, per second: frames received and decoded, lost packets, jitter.
      const net = await inboundVideo()
      let network = ''
      if (net && before) {
        const d = (k: keyof Inbound) => (net[k] ?? 0) - (before![k] ?? 0)
        const lost = d('packetsLost'), got = d('packetsReceived')
        network =
          ` | network: ${d('framesReceived')} fps in, ${d('framesDecoded')} decoded, ${d('framesDropped')} dropped` +
          `, lost ${got + lost > 0 ? Math.round((100 * lost) / (got + lost)) : 0}%, jitter ${Math.round((net.jitter ?? 0) * 1000)} ms`
      }
      before = net
      frames = frames.filter((t) => now - t < 5000)
      const lastSecond = frames.filter((t) => now - t < 1000).length
      let longest = 0
      for (let i = 1; i < frames.length; i++) longest = Math.max(longest, frames[i] - frames[i - 1])
      const q = el.getVideoPlaybackQuality?.()
      setText(
        `shown ${lastSecond} fps · ${el.videoWidth}×${el.videoHeight} · buffer ${VIDEO_BUFFER_MS} ms · longest freeze ${Math.round(longest)} ms` +
          (q ? ` · dropped ${q.droppedVideoFrames}/${q.totalVideoFrames}` : '') +
          network,
      )
    }, 1000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [video])
  return <div className="vcall-debug">{text}</div>
}
