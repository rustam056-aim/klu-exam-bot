// Hands-free talking: decides when the student has finished speaking.
// Fed with the microphone loudness about ten times a second.

export type Vad = {
  floor: number // background noise level, learned while nobody speaks
  heard: number // ms of speech in the current burst
  quiet: number // ms of silence since the last speech
  waited: number // ms since the mic opened without any speech
  spoke: boolean // the student has said something
}

export const newVad = (): Vad => ({ floor: 0.008, heard: 0, quiet: 0, waited: 0, spoke: false })

const SPEECH_MS = 250 // this much sound in a row counts as speech (a cough or a click doesn't)
const PAUSE_MS = 1600 // this much silence after speech means "I'm done"
const CALIBRATE_MS = 400 // listen to the room first
const GIVE_UP_MS = 9000 // nobody said anything: close the mic again

// 'stop' = the student finished, send it. 'nothing' = no speech at all, give up quietly.
export function vadStep(v: Vad, loudness: number, dt: number): 'go' | 'stop' | 'nothing' {
  // First moments after the mic opens: just measure the room (a bus is louder than a bedroom).
  if (v.waited < CALIBRATE_MS) {
    v.floor = Math.max(v.floor, Math.min(loudness, 0.04))
    v.waited += dt
    return 'go'
  }
  const threshold = Math.max(0.02, v.floor * 2.5)
  if (loudness >= threshold) {
    v.heard += dt
    v.quiet = 0
    if (v.heard >= SPEECH_MS) v.spoke = true
  } else {
    v.floor = v.floor * 0.9 + loudness * 0.1 // follow the room noise slowly
    v.quiet += dt
    if (v.quiet > 300) v.heard = 0
  }
  if (!v.spoke) {
    v.waited += dt
    return v.waited >= GIVE_UP_MS ? 'nothing' : 'go'
  }
  return v.quiet >= PAUSE_MS ? 'stop' : 'go'
}

// Loudness (0 to 1) of one snapshot from an AnalyserNode's getByteTimeDomainData.
export function loudnessOf(samples: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const x = (samples[i] - 128) / 128
    sum += x * x
  }
  return Math.sqrt(sum / samples.length)
}
