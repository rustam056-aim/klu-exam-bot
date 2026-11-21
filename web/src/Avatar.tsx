import { useEffect, useRef, useState } from 'react'
import { accessQuery } from './access'
import { avatarEnabled, onAvatarChange, startAvatar, stopAvatar } from './talkingAvatar'
import type { AvatarState } from './talkingAvatar'
import type { TutorState } from './Tutor'

// Johannes on screen in "Talk to Johannes".
// With the talking avatar set up (Simli, see talkingAvatar.ts) it's a live video of him whose lips
// move with his voice. Until it's connected, or if it can't be, it's his photo
// (web/public/avatar/photo.jpg, never on GitHub, behind the access code like the slides).
// The ring shows what's happening: a gentle pulse while he talks, the accent colour when it's
// your turn, dots while he thinks. If even the photo can't load, `onFail` brings back the circle.
export function Avatar({ state, label, onFail }: { state: TutorState; label: string; onFail: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [live, setLive] = useState<AvatarState>('off')
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)

  // Connect the talking avatar while this screen is open; hang up when leaving it.
  useEffect(() => {
    const off = onAvatarChange(setLive)
    let cancelled = false
    void avatarEnabled().then((on) => {
      if (on && !cancelled && video.current && audio.current) void startAvatar(video.current, audio.current)
    })
    return () => {
      cancelled = true
      off()
      stopAvatar()
    }
  }, [])

  const showVideo = live === 'live'
  return (
    <div className={`avatar avatar-${state}`}>
      <div className="avatar-frame">
        <img
          className={`avatar-photo ${loaded && !showVideo ? 'is-on' : ''}`}
          src={`/avatar/photo.jpg${accessQuery()}`}
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
        {label}
      </span>
    </div>
  )
}
