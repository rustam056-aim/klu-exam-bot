import { useEffect, useRef, useState } from 'react'
import { DailyLimit } from './access'
import { ExamReport } from './ExamReport'
import type { ExamRecord } from './ExamReport'
import { api } from './api'
import { formatSource, lectureAudio, slideImages } from './format'
import { FeedbackBox } from './FeedbackBox'
import { MicHelpBox } from './MicButton'
import { saveTalkAnswer } from './progress'
import { ArrowIcon, LectureClip, MicIcon, Slides, SpeakerIcon, StopIcon } from './QuestionView'
import { Avatar } from './Avatar'
import { avatarEnabled, readyToGreet } from './talkingAvatar'
import { Tutor } from './Tutor'
import { clock, useRecorder } from './useRecorder'
import { soundsLikeEcho, useLiveMic, wantsHimToGoOn } from './liveMic'
import {
  chime,
  onSpeakingChange,
  pauseSpeaking,
  resumeSpeaking,
  speak,
  speakInParts,
  stopSpeaking,
  transcribe,
  unlockAudio,
} from './voice'
import type { ChatMessage, ChatSeed } from './types'

// "Talk to Johannes": a conversation with the course tutor.
// Two ways to use it, sharing one conversation:
//   Talk: like a call. Tap once and the mic stays on ("Hands-free"): just talk, he notices when
//         you stop, and you can interrupt him simply by talking. With it off: tap to talk, tap to send.
//   Type: a normal chat with a text box (and a mic button).
// The tutor answers only from the course material. Nothing is saved: the conversation lives in
// this tab and is gone when you leave.

// He opens differently each time (a new one per conversation).
const GREETINGS = [
  'Hey, good to see you. Is there a topic you’re stuck on, or shall I quiz you?',
  'Hello! Pick anything from the course, or say “quiz me” and I’ll put you on the spot.',
  'Hi there. Ask me something tricky, or let me quiz you.',
  'Welcome back! Which topic do you want to tackle, or should I throw a few questions at you?',
  'Hey! Got a question from the slides, or do you want a quick quiz?',
  'Good to have you here. What should we look at today? Or just say “quiz me”.',
]

function greeting(): ChatMessage {
  return { role: 'assistant', local: true, text: GREETINGS[Math.floor(Math.random() * GREETINGS.length)] }
}

// Quick starts: the mock exam, plus three others picked at random.
const STARTERS = [
  'Quiz me on carbon accounting',
  'Quiz me on air cargo',
  'Quiz me on the guest lectures',
  'Why is air freight so carbon-heavy?',
  'When does an electric truck pay off?',
  'What’s the difference between offsetting and insetting?',
  'Explain Avoid-Shift-Improve',
  'Quiz me on anything',
]

function pickStarters(): string[] {
  const pool = [...STARTERS]
  const picked: string[] = []
  while (picked.length < 3) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  return [picked[0], 'Give me a mock oral exam', picked[1], picked[2]]
}

const seedText = (seed: ChatSeed) =>
  `I got this practice question wrong and want to talk it through.\nQuestion: ${seed.question}\nMy answer: ${seed.answer || '(I skipped it)'}`

function remembered(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === 'on'
  } catch {
    return fallback
  }
}

// The three ways to talk to him, as chosen on the home screen (and as tabs here).
export type TalkMode = 'type' | 'talk' | 'video'

// The timed oral exam, as in the real thing.
// 15 minutes (Prof. Meuer: "maybe make the trial exam only 15 min"); a link with ?examMinutes=5
// makes a shorter one, for trying it out.
const EXAM_MINUTES =
  (typeof location !== 'undefined' && Number(new URLSearchParams(location.search).get('examMinutes'))) || 15
const EXAM_GREETING = `Welcome to your practice oral exam in Sustainable Logistics. It takes about ${EXAM_MINUTES} minutes. I’ll ask you questions, and you just answer out loud, the way you would in the real exam. Let’s begin.`

export function ChatView({
  readAloud,
  seed,
  mode,
  exam = false,
}: {
  readAloud: boolean
  seed?: ChatSeed
  mode?: TalkMode
  exam?: boolean // the 30-minute oral exam
}) {
  const [view, setView] = useState<'call' | 'chat'>(mode === 'type' && !exam ? 'chat' : 'call')
  const [handsFree, setHandsFree] = useState(() => exam || remembered('alwaysListening', true))
  // The exam: running -> closing (time is up, he says goodbye) -> done (the summary).
  const [examPhase, setExamPhase] = useState<'running' | 'closing' | 'done' | 'off'>(exam ? 'running' : 'off')
  const examOn = examPhase === 'running' || examPhase === 'closing'
  const examRecord = useRef<ExamRecord>({ startedAt: 0, endedAt: 0, plannedMs: EXAM_MINUTES * 60000, turns: [], leftWindow: [] })
  const examEndsAt = useRef(0)
  const endRequested = useRef(false) // the student pressed End exam
  const timeUp = useRef(false)
  const [tick, setTick] = useState(0) // re-renders the exam clock every second
  const [showAvatar, setShowAvatar] = useState(true) // his picture; falls back to the circle if it can't load
  // Three ways to practise, as tabs: Type, Talk (voice, his photo) and Video (the talking avatar).
  // Video only shows up when the avatar is set up on the server.
  const [withVideo, setWithVideo] = useState(() => {
    if (exam) return true // the exam is a video call when the avatar is set up, otherwise voice
    if (mode) return mode === 'video'
    if (typeof location !== 'undefined' && /[?&]mode=video\b/.test(location.search)) return true
    return remembered('talkVideo', false)
  })
  const [videoAvailable, setVideoAvailable] = useState(false)
  useEffect(() => {
    void avatarEnabled().then(setVideoAvailable)
  }, [])
  const videoOn = withVideo && videoAvailable
  const inVideo = view === 'call' && videoOn && examPhase !== 'done'
  // Once the video call has been opened it stays mounted (hidden) for the rest of the conversation.
  const [videoUsed, setVideoUsed] = useState(false)
  useEffect(() => {
    if (inVideo) setVideoUsed(true)
  }, [inVideo])
  const [transcribing, setTranscribing] = useState(false)
  const [partial, setPartial] = useState<string | null>(null) // his first sentence, while the rest is written // always-on mic: turning speech into text
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    seed ? [] : exam ? [{ role: 'assistant', local: true, text: EXAM_GREETING }] : [greeting()],
  )
  const [starterList, setStarterList] = useState(pickStarters)
  const [draft, setDraft] = useState('')
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const setBusy = (value: boolean) => {
    busyRef.current = value
    setBusyState(value)
  }
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [score, setScore] = useState({ answered: 0, right: 0 }) // his questions in this talk
  const [slideOpen, setSlideOpen] = useState(false) // Talk view: the slide shows only when asked for
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)
  const seeded = useRef(false)
  // The latest values, for code that continues after a long wait (a reply, the end of a sentence).
  // wantsVideo: the Video tab is chosen (even before we know the avatar is set up).
  const now = useRef({ view, handsFree, readAloud, withVideo: videoOn, wantsVideo: withVideo, examPhase })
  now.current = { view, handsFree, readAloud, withVideo: videoOn, wantsVideo: withVideo, examPhase }

  useEffect(() => onSpeakingChange(setSpeaking), [])
  const speakingRef = useRef(false)
  speakingRef.current = speaking

  // Tap to talk, tap to send: the Type view's mic, and Talk with "Hands-free" off.
  const rec = useRecorder((said) => void send(said, true))

  // Hands-free: the mic stays on during the call. When the student starts talking while
  // Johannes speaks, he pauses; if it was really the student (not a cough, not his own echo),
  // he stops and listens, otherwise he carries on.
  const pausedForStudent = useRef(false)
  const overHim = useRef(false) // the student started talking while he was speaking
  const hisWords = useRef('') // what he's saying right now (to tell his echo from the student)
  const pending = useRef<string | null>(null) // said while his reply was still being written
  const live = useLiveMic({
    onSpeechStart: () => {
      setNote(null)
      // Exam: how long the student took before starting to answer.
      const last = examRecord.current.turns[examRecord.current.turns.length - 1]
      if (now.current.examPhase === 'running' && last && !last.firstSpeechAt && !speakingRef.current) {
        last.firstSpeechAt = Date.now()
      }
      overHim.current = speakingRef.current
      pausedForStudent.current = pauseSpeaking()
    },
    onFalseStart: () => {
      if (pausedForStudent.current) resumeSpeaking()
      pausedForStudent.current = false
    },
    onUtterance: (wav) => void heard(wav),
  })
  const liveRef = useRef(live)
  liveRef.current = live

  async function heard(wav: Blob) {
    const wasPaused = pausedForStudent.current
    const wasOverHim = overHim.current || wasPaused
    pausedForStudent.current = false
    overHim.current = false
    liveRef.current.mute(true)
    setTranscribing(true)
    let text = ''
    try {
      text = (await transcribe(wav)).trim()
    } catch (err) {
      if (err instanceof DailyLimit) {
        voiceFailed(err)
        setTranscribing(false)
        return
      }
      if (mounted.current) setNote('That didn’t come through. Say it again?')
    }
    if (!mounted.current) return
    setTranscribing(false)
    const his = `${hisWords.current} ${[...messagesRef.current].reverse().find((m) => m.role === 'assistant')?.text ?? ''}`
    if (!text || (wasOverHim && soundsLikeEcho(text, his))) {
      // Nothing real: carry on where he was.
      if (wasOverHim && text) liveRef.current.heardEcho()
      if (wasPaused) resumeSpeaking()
      liveRef.current.mute(false)
      return
    }
    if (wasPaused && wantsHimToGoOn(text)) {
      // "Sorry, go on": he picks up exactly where he stopped.
      resumeSpeaking()
      liveRef.current.mute(false)
      return
    }
    stopSpeaking()
    if (busyRef.current) {
      // He's still writing his reply: answer this as soon as he's done.
      pending.current = text
      return
    }
    await send(text, true)
  }

  // Something the student said while his reply was still coming in.
  function sendPending() {
    const text = pending.current
    pending.current = null
    if (text && mounted.current) void send(text, true)
  }

  // When he has finished talking: a soft "your turn" tone (the mic is already on).
  function yourTurn() {
    if (!mounted.current || now.current.view !== 'call') return
    if (now.current.examPhase === 'running') {
      // Exam: he has just finished asking; the clock for "time before answering" starts now.
      const question = [...messagesRef.current].reverse().find((m) => m.role === 'assistant' && !m.local)?.text
      if (question) examRecord.current.turns.push({ question, askedAt: Date.now() })
    }
    if (liveRef.current.on) chime()
  }

  // Reads a reply aloud. True when he got to the end (false: stopped, interrupted, or no sound).
  async function say(text: string): Promise<boolean> {
    setNote(null)
    hisWords.current = text
    try {
      return await speak(text, { chat: true })
    } catch (err) {
      voiceFailed(err)
      return false
    }
  }

  // His voice didn't play. Out of today's voice time: carry on by typing.
  function voiceFailed(err: unknown) {
    if (!mounted.current) return
    if (err instanceof DailyLimit) {
      setNote(err.message)
      liveRef.current.stop()
      setView('chat')
      return
    }
    setNote('The sound didn’t start. Tap “Listen” to hear it.')
  }

  async function ask(history: ChatMessage[], speakIt: boolean, wrapUp = false) {
    const examNow = now.current.examPhase === 'running' && !wrapUp
    const ending = examNow && timeUp.current
    if (ending) setExamPhase('closing')
    const examInfo = examNow
      ? { minutesLeft: Math.max(0, (examEndsAt.current - Date.now()) / 60000), totalMinutes: EXAM_MINUTES, ending }
      : undefined
    setBusy(true)
    setError(null)
    setNote(null)
    setSlideOpen(false)
    // His voice starts on the first sentence while the rest is still being written.
    const rest = { finish: (_text: string) => undefined as void }
    const voice: { current: Promise<boolean> | null } = { current: null }
    try {
      const res = await api.chat(
        history.filter((m) => !m.local).map((m) => ({ role: m.role, content: m.text })),
        wrapUp,
        (first) => {
          if (!mounted.current) return
          setPartial(first)
          hisWords.current = first
          if (!speakIt) return
          const remaining = new Promise<string>((resolve) => (rest.finish = resolve))
          voice.current = speakInParts(first, remaining).catch((err) => {
            voiceFailed(err)
            return false
          })
        },
        history.find((m) => m.local && m.role === 'assistant')?.text, // the greeting he opened with
        examInfo,
        // Which lecture his last replies were about, so he moves on to another one in time.
        history
          .filter((m) => m.role === 'assistant' && !m.local)
          .slice(-4)
          .map((m) => m.sources?.[0] ?? ''),
      )
      rest.finish(res.rest ?? '')
      hisWords.current = res.reply
      setPartial(null)
      if (!mounted.current) return
      if (res.check && examNow) {
        // Exam: the result belongs to the question just answered (shown only in the summary).
        const answered = [...examRecord.current.turns].reverse().find((t) => t.answer && !t.result)
        if (answered) answered.result = res.check.result
      }
      if (res.check) {
        // He had asked a question and the student answered: keep the score.
        saveTalkAnswer(res.check)
        const right = res.check.result === 'right' ? 1 : 0
        setScore((s) => ({ answered: s.answered + 1, right: s.right + right }))
      }
      const withReply: ChatMessage[] = [...history, { role: 'assistant', text: res.reply, sources: res.sources, wrap: wrapUp }]
      messagesRef.current = withReply
      setMessages(withReply)
      setBusy(false)
      if (pending.current) {
        stopSpeaking()
        sendPending()
        return
      }
      if (ending || (examNow && res.examOver)) {
        // Time is up, or the student asked to stop: he says goodbye, then the summary.
        if (!ending) setExamPhase('closing')
        if (speakIt) await (voice.current ?? say(res.reply))
        finishExam()
        return
      }
      if (examNow && endRequested.current) {
        // End exam was pressed while he was writing: skip this question and close right away.
        rest.finish('')
        stopSpeaking()
        void send('I’d like to end the exam here.', true, false, true)
        return
      }
      if (speakIt && (await (voice.current ?? say(res.reply)))) yourTurn()
    } catch (err) {
      rest.finish('')
      if (voice.current) stopSpeaking()
      setPartial(null)
      if (!mounted.current) return
      const reason = err instanceof Error ? err.message.match(/\((\w+)\)/)?.[1] : undefined
      // 429 / 5xx / 529 from the AI even after the server's retries: a busy moment, not a bug.
      const busyNow = reason !== undefined && /^(429|500|502|503|504|529)$/.test(reason)
      setError(
        err instanceof DailyLimit
          ? err.message
          : busyNow
            ? 'Lots of students are practising right now. Give it a few seconds and try again.'
            : `That didn’t go through${reason ? ` (code ${reason})` : ''}. Try again.`,
      )
      setBusy(false)
      pending.current = null
    }
  }

  async function send(text: string, byVoice = false, wrapUp = false, meta = false) {
    const said = text.trim()
    if (!said || busyRef.current) return
    stopSpeaking()
    if (now.current.examPhase === 'running' && !meta) {
      const turns = examRecord.current.turns
      const asked = [...messagesRef.current].reverse().find((m) => m.role === 'assistant' && !m.local)?.text
      let last = turns[turns.length - 1]
      // Cut in before he finished asking: the question still counts (no thinking time then).
      if (asked && (!last || last.question !== asked)) {
        last = { question: asked, askedAt: Date.now() }
        turns.push(last)
      }
      // Two things said to one question count as one answer.
      if (last) last.answer = last.answer ? `${last.answer} ${said}` : said
    }
    const next: ChatMessage[] = [...messagesRef.current, { role: 'user', text: said, meta }]
    messagesRef.current = next
    setMessages(next)
    setDraft('')
    await ask(next, now.current.view === 'call' || now.current.readAloud || byVoice, wrapUp)
  }

  // On arrival: either talk through the question the student brought, or say hello.
  useEffect(() => {
    mounted.current = true
    if (seed) {
      if (!seeded.current) {
        seeded.current = true
        void send(seedText(seed))
      }
    } else if (exam) {
      // The oral exam: he welcomes the student, then asks the first question straight away.
      void (now.current.wantsVideo ? readyToGreet(9000) : Promise.resolve())
        .then(() => (mounted.current ? say(EXAM_GREETING) : false))
        .then(() => {
          if (!mounted.current) return
          examRecord.current.startedAt = Date.now()
          examEndsAt.current = Date.now() + EXAM_MINUTES * 60000
          void send('I’m ready, please start the exam.', true, false, true)
        })
    } else if (now.current.view === 'call' || now.current.readAloud) {
      // With the talking avatar, give it a moment to connect so he greets with moving lips.
      void (now.current.wantsVideo ? readyToGreet(9000) : Promise.resolve())
        .then(() => (mounted.current ? say(messagesRef.current[0]?.text ?? '') : false))
        .then((done) => {
          if (done) yourTurn()
        })
    }
    // Hands-free: the mic goes on right away, so the student can even cut into the greeting.
    if ((now.current.handsFree || now.current.wantsVideo) && now.current.view === 'call') live.start()
    return () => {
      mounted.current = false
      stopSpeaking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      if (exam) return // the exam doesn't change the student's usual settings
      localStorage.setItem('alwaysListening', handsFree ? 'on' : 'off')
      localStorage.setItem('talkVideo', withVideo ? 'on' : 'off')
    } catch {
      /* private mode: just don't remember it */
    }
  }, [handsFree, withVideo])

  // Type view: keep the newest message in sight.
  useEffect(() => {
    if (view === 'chat') endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, error, view])

  // The mic is off only while it turns speech into text, or while we wait for his reply in silence.
  // While he talks it stays on, but only clear, sustained speech counts (strict), so the student can
  // cut in just by talking; if what it caught was only his own voice from the speakers, he carries on.
  useEffect(() => {
    live.mute(transcribing || (busy && !speaking))
    live.strict(speaking)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, transcribing, speaking])

  const recording = rec.state === 'recording'
  const liveOn = view === 'call' && (handsFree || videoOn) && live.on

  // The big button.
  //   Hands-free, mic on:  while he talks = interrupt him; otherwise = pause the mic.
  //   Hands-free, mic off: switch it on.
  //   Tap-to-talk:               talk / send.
  function bigTap() {
    unlockAudio()
    setNote(null)
    if (view === 'call' && handsFree) {
      if (live.state === 'hearing') {
        live.flush() // done talking: send it now
        return
      }
      if (live.on && speaking) {
        stopSpeaking() // cut in
        chime()
        return
      }
      if (live.on) live.stop()
      else {
        if (speaking) stopSpeaking()
        chime()
        live.start()
      }
      return
    }
    if (recording) {
      rec.stop()
      return
    }
    if (speaking) stopSpeaking()
    chime()
    rec.start()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') stopSpeaking()
      const tag = (e.target as HTMLElement).tagName
      if (e.key === ' ' && view === 'call' && tag !== 'BUTTON' && tag !== 'TEXTAREA' && !busy && rec.state !== 'working') {
        e.preventDefault()
        bigTap()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- The oral exam ----
  const examLeft = examEndsAt.current ? examEndsAt.current - Date.now() : null
  void tick

  function finishExam() {
    examRecord.current.endedAt = Date.now()
    live.stop()
    setExamPhase('done')
  }

  // "End exam": he closes the exam right away (or after the reply he's writing).
  function endExamNow() {
    timeUp.current = true
    endRequested.current = true
    stopSpeaking()
    if (!busyRef.current) void send('I’d like to end the exam here.', true, false, true)
  }

  // After the summary: normal talk with him, starting with his feedback on the exam.
  function examFeedback() {
    setExamPhase('off')
    setView('chat')
    void send('The exam is over. How did I do? Give me feedback on my answers.', false, true)
  }

  // The exam clock: when time is up, his next reply closes the exam. If the student doesn't
  // say anything for a while after that, he closes it anyway.
  useEffect(() => {
    if (!examOn) return
    const timer = window.setInterval(() => {
      setTick((n) => n + 1)
      if (!examEndsAt.current || Date.now() < examEndsAt.current) return
      timeUp.current = true
      if (now.current.examPhase === 'running' && !busyRef.current && !speakingRef.current && Date.now() > examEndsAt.current + 60000) {
        void send('(Time is up.)', true, false, true)
      }
    }, 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examOn])

  // The exam: note every time the student leaves the tab or the window.
  useEffect(() => {
    if (examPhase !== 'running') return
    let lastAt = 0
    const left = () => {
      if (!examRecord.current.startedAt || Date.now() - lastAt < 1500) return
      lastAt = Date.now()
      examRecord.current.leftWindow.push(lastAt)
    }
    const onVisibility = () => {
      if (document.hidden) left()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', left)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', left)
    }
  }, [examPhase])

  const tutorLabels = {
    idle: handsFree ? 'Tap the mic once to start' : 'Tap the mic to talk',
    speaking: 'Johannes is talking',
    listening: live.state === 'hearing' || recording ? 'I’m listening…' : 'Your turn, just talk',
    thinking: 'Thinking…',
  }
  const tutorState =
    recording || live.state === 'hearing'
      ? 'listening'
      : speaking
        ? 'speaking'
        : busy || transcribing || rec.state === 'working'
          ? 'thinking'
          : liveOn
            ? 'listening'
            : 'idle'
  const userTurns = messages.filter((m) => m.role === 'user').length
  const fresh = userTurns === 0
  const last = messages[messages.length - 1]
  const lastTutor = [...messages].reverse().find((m) => m.role === 'assistant')
  const waitingForRetry = !!error && last?.role === 'user' && !error?.startsWith('You’ve')
  const canWrapUp = userTurns >= 2 && !busy && !recording && last?.role === 'assistant' && !last.wrap
  const slideSource = lastTutor?.sources?.find((s) => slideImages(s).length > 0)
  // For a source from Alan's videos there's no slide, but there's the lecture clip.
  const clipSource = slideSource ? undefined : lastTutor?.sources?.find((s) => lectureAudio(s) !== null)

  const starters = fresh && !busy && !exam && (
    <div className="starters">
      {starterList.map((s) => (
        <button
          key={s}
          className="btn secondary sm"
          type="button"
          onClick={() => {
            unlockAudio()
            void send(s)
          }}
        >
          {s}
        </button>
      ))}
    </div>
  )
  const smallPrint = fresh && (
    <p className="note chat-note">
      This is an AI tutor. It&rsquo;s built on this year&rsquo;s course material (slides, lectures, videos and readings)
      and sometimes adds related background. It can still get things wrong, so the slides have the last word. Keep
      personal details out of it; this site doesn&rsquo;t keep your conversation.
    </p>
  )
  const problems = (
    <>
      {error && (
        <div className="error-block" role="alert">
          <p>{error}</p>
          {waitingForRetry && (
            <button className="btn primary sm" type="button" onClick={() => void ask(messages, view === 'call' || readAloud)}>
              Try again
            </button>
          )}
        </div>
      )}
      {rec.error && (
        <p className="error" role="alert">
          {rec.error}
        </p>
      )}
      {note && <p className="note">{note}</p>}
      {live.help && (
        <MicHelpBox
          help={live.help}
          onRetry={live.start}
          onDismiss={() => {
            live.dismissHelp()
            setView('chat')
            window.setTimeout(() => inputRef.current?.focus(), 50)
          }}
        />
      )}
      {rec.help && (
        <MicHelpBox
          help={rec.help}
          onRetry={rec.start}
          onDismiss={() => {
            rec.dismissHelp()
            setView('chat')
            window.setTimeout(() => inputRef.current?.focus(), 50)
          }}
        />
      )}
    </>
  )

  return (
    <section className={`chat chat-${view}`}>
      {examPhase !== 'off' ? (
        <div className="chat-head exam-head">
          <span className="exam-title">Oral exam</span>
          {examOn && (
            <span className={`tag exam-clock ${examLeft !== null && examLeft < 120000 ? 'is-late' : ''}`} aria-live="off">
              {examLeft === null ? `${EXAM_MINUTES}:00` : examLeft > 0 ? `${clock(Math.ceil(examLeft / 1000))} left` : 'Time is up'}
            </span>
          )}
          {examPhase === 'running' && (
            <button className="btn secondary sm" type="button" onClick={endExamNow} disabled={!examRecord.current.startedAt}>
              End exam
            </button>
          )}
        </div>
      ) : (
      <div className="chat-head">
        <div className="seg" role="tablist" aria-label="How you talk to the tutor">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'chat'}
            onClick={() => {
              if (recording) rec.cancel()
              live.stop()
              setView('chat')
            }}
          >
            Type
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'call' && !videoOn}
            onClick={() => {
              unlockAudio()
              if (withVideo) stopSpeaking()
              setWithVideo(false)
              setView('call')
              if (handsFree) live.start()
            }}
          >
            Talk
          </button>
          {videoAvailable && (
            <button
              type="button"
              role="tab"
              aria-selected={view === 'call' && videoOn}
              onClick={() => {
                unlockAudio()
                if (!withVideo) stopSpeaking()
                setWithVideo(true)
                setView('call')
                live.start() // a video call: the mic is simply on
              }}
            >
              Video
            </button>
          )}
        </div>
        <div className="chat-head-actions">
          {score.answered > 0 && (
            <span className="tag score-tag" title="His questions you answered in this talk">
              {score.right} of {score.answered} right
            </span>
          )}
          {view === 'chat' && speaking && (
            <button className="btn secondary sm" type="button" onClick={stopSpeaking}>
              <StopIcon /> Stop
            </button>
          )}
          {canWrapUp && (
            <button
              className="btn secondary sm"
              type="button"
              onClick={() => {
                unlockAudio()
                void send('Let’s wrap up.', false, true)
              }}
            >
              Wrap up
            </button>
          )}
          {!fresh && (
            <button
              className="btn ghost sm"
              type="button"
              onClick={() => {
                stopSpeaking()
                rec.cancel()
                live.drop()
                setMessages([greeting()])
                setStarterList(pickStarters())
                setScore({ answered: 0, right: 0 })
                setError(null)
                setNote(null)
              }}
              disabled={busy}
            >
              New chat
            </button>
          )}
        </div>
      </div>
      )}

      {examPhase === 'done' && (
        <ExamReport record={examRecord.current} messages={messages} onFeedback={examFeedback} />
      )}

      {/* Video: like a video call. He fills the screen, the mic is always on, and the only button
          is Stop (to cut him off). No subtitles: you hear him and see him. Once opened, the call
          stays connected in the background while you switch tabs, so coming back is instant. */}
      {videoUsed && (
        <div className="vcall" hidden={!inVideo}>
          <Avatar
            state={tutorState}
            label={tutorLabels[tutorState]}
            live={inVideo}
            call
            onFail={() => setWithVideo(false)}
          >
            {speaking ? (
              <button className="vcall-stop" type="button" onClick={stopSpeaking} aria-label="Stop him">
                <StopIcon />
                <span>Stop</span>
              </button>
            ) : (
              <span className={`vcall-mic ${live.state === 'hearing' ? 'is-hearing' : ''}`} aria-hidden="true">
                <MicIcon recording={false} />
              </span>
            )}
          </Avatar>
          {inVideo && problems}
        </div>
      )}
      {inVideo || examPhase === 'done' ? null : view === 'call' ? (
        <div className="call">
          {showAvatar ? (
            <Avatar state={tutorState} label={tutorLabels[tutorState]} live={false} onFail={() => setShowAvatar(false)} />
          ) : (
            <Tutor big state={tutorState} labels={tutorLabels} />
          )}
          {busy && partial ? (
            <p className="call-line" aria-live="polite">
              {partial}
            </p>
          ) : busy ? (
            <p className="call-line call-wait" aria-label="Thinking">
              <span />
              <span />
              <span />
            </p>
          ) : (
            lastTutor && (
              <p className="call-line" aria-live="polite">
                {lastTutor.text}
              </p>
            )
          )}
          {!busy && lastTutor?.sources && lastTutor.sources.length > 0 && (
            <div className="call-source">
              {/* The slide (or the lecture clip) is a hint you ask for, not something that pops up by itself. */}
              {(slideSource || clipSource) && !slideOpen && !examOn && (
                <button className="btn secondary sm hint-btn" type="button" onClick={() => setSlideOpen(true)}>
                  {slideSource ? 'Need a hint? Show the slide' : 'Need a hint? Hear it from Alan'}
                </button>
              )}
              {(slideOpen || (!slideSource && !clipSource)) && (
                <p className="source">From the course: {lastTutor.sources.map(formatSource).join(' · ')}</p>
              )}
              {slideSource && slideOpen && <Slides source={slideSource} />}
              {clipSource && slideOpen && <LectureClip source={clipSource} />}
            </div>
          )}
          {starters}
          {problems}
          {last?.wrap && <FeedbackBox where="talk" compact />}
          {smallPrint}

          {/* Bottom bar: one big button, like a call. */}
          <div className="dock" role="toolbar" aria-label="Voice controls">
            <div className="dock-side">
              {!exam && (
              <button
                className={`switch ${handsFree ? 'is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={handsFree}
                onClick={() => {
                  if (handsFree) live.stop()
                  else rec.cancel()
                  setHandsFree(!handsFree)
                }}
              >
                <span className="switch-track" aria-hidden="true" />
                Hands-free
              </button>
              )}
            </div>
            <div className="dock-main">
              <button
                type="button"
                className={`round round-${
                  (busy && !speaking) || transcribing
                    ? 'working'
                    : live.state === 'hearing'
                      ? 'recording'
                      : liveOn
                        ? 'live'
                        : rec.state
                }`}
                onClick={bigTap}
                disabled={(busy && !speaking) || transcribing || rec.state === 'working' || live.state === 'starting'}
                aria-pressed={recording || liveOn}
                aria-label={
                  handsFree
                    ? speaking
                      ? 'Stop him'
                      : live.state === 'hearing'
                        ? 'Done, send it'
                        : liveOn
                          ? 'Pause the mic'
                          : 'Turn the mic on'
                    : recording
                      ? 'Done talking'
                      : speaking
                        ? 'Interrupt and talk'
                        : 'Talk'
                }
              >
                <MicIcon recording={recording} />
              </button>
              <span className="dock-label" aria-live="polite">
                {handsFree
                  ? transcribing
                    ? 'Got it…'
                    : speaking
                      ? 'Talk or tap to cut in'
                      : busy
                      ? 'Thinking…'
                      : live.state === 'starting'
                        ? 'Starting the mic…'
                        : live.state === 'hearing'
                          ? 'Listening… tap when done'
                          : liveOn
                            ? 'Mic on · just talk'
                            : 'Tap once, then just talk'
                  : recording
                  ? `${clock(rec.seconds)} · tap when you’re done`
                  : rec.state === 'working'
                    ? 'Got it…'
                    : speaking
                      ? 'Tap to interrupt'
                      : busy
                        ? 'Thinking…'
                        : 'Tap to talk'}
              </span>
            </div>
            <div className="dock-side dock-right">
              {speaking && (
                <button className="btn secondary sm" type="button" onClick={stopSpeaking}>
                  <StopIcon /> Stop
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <ol className="chat-log" aria-live="polite">
            {messages.map((m, i) => (
              <li key={i} className={`msg msg-${m.role}`}>
                <p className="msg-text">{m.text}</p>
                {m.role === 'assistant' && !m.local && (
                  <div className="msg-extra">
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={() => {
                        unlockAudio()
                        void say(m.text)
                      }}
                    >
                      <SpeakerIcon /> Listen
                    </button>
                    {m.sources && m.sources.length > 0 && (
                      <details className="msg-sources" open={m.wrap}>
                        <summary>{m.wrap ? 'Look at these again' : 'Where this comes from'}</summary>
                        {m.sources.map((s) => (
                          <div key={s}>
                            <p className="source">{formatSource(s)}</p>
                            <Slides source={s} />
                            <LectureClip source={s} />
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                )}
              </li>
            ))}
            {busy && partial && (
              <li className="msg msg-assistant">
                <p className="msg-text">{partial}</p>
              </li>
            )}
            {busy && !partial && (
              <li className="msg msg-assistant msg-wait" aria-label="Thinking">
                <span />
                <span />
                <span />
              </li>
            )}
          </ol>
          {starters}
          {smallPrint}
          {problems}
          {last?.wrap && <FeedbackBox where="talk" compact />}
          <div ref={endRef} className="chat-end" />

          {/* Bottom bar: type, or tap the mic and say it. */}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault()
              unlockAudio()
              void send(draft)
            }}
          >
            <span className="composer-status" aria-live="polite">
              {recording
                ? `Listening · ${clock(rec.seconds)} · tap the mic when you’re done`
                : rec.state === 'working'
                  ? 'Got it…'
                  : busy
                    ? 'Thinking…'
                    : 'Type, or tap the mic and talk'}
            </span>
            <div className="composer-row">
              <label className="composer-field">
                <span className="sr-only">Your message</span>
                <textarea
                  ref={inputRef}
                  value={draft}
                  rows={1}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      unlockAudio()
                      void send(draft)
                    }
                  }}
                  placeholder="Ask about the course…"
                  disabled={recording}
                  maxLength={1500}
                />
                <button className="composer-send" type="submit" disabled={!draft.trim() || busy} aria-label="Send">
                  <ArrowIcon />
                </button>
              </label>
              <button
                type="button"
                className={`round round-${busy ? 'idle' : rec.state}`}
                onClick={bigTap}
                disabled={busy || rec.state === 'working'}
                aria-pressed={recording}
                aria-label={recording ? 'Stop and send' : 'Talk'}
              >
                <MicIcon recording={recording} />
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
