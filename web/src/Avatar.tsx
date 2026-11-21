import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { accessQuery } from './access'
import { avatarEnabled, onAvatarChange, setAvatarActive, startAvatar, stopAvatar } from './talkingAvatar'
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
  children,
}: {
  state: TutorState
  label: string
  live: boolean // connect the talking avatar; otherwise just the photo
  call?: boolean // Video: full-screen video call layout
  onFail: () => void
  children?: ReactNode
}) {
  const [loaded, setLoaded] = useState(false)
  const [live, setLive] = useState<AvatarState>('off')
  const [retry, setRetry] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => onAvatarChange(setLive), [])

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
    const connecting = !showVideo && live !== 'failed'
    return (
      <div className={`vcall-stage avatar-${state} ${showVideo ? 'is-live' : ''}`}>
        <div className="vcall-backdrop" style={{ backgroundImage: `url(${photo})` }} aria-hidden="true" />
        <video ref={video} className={`vcall-video ${showVideo ? 'is-on' : ''}`} autoPlay playsInline aria-hidden="true" />
        <audio ref={audio} autoPlay />
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
        {live === 'failed' && (
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
