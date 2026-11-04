// Voice helpers. All calls go through our backend; the ElevenLabs key never reaches the browser.
// transcribe() and speak() are the only two places to change for option C (Prof. Meuer's own voice).

let current: HTMLAudioElement | null = null
const cache = new Map<string, string>() // text -> object URL, so repeated text costs no extra credits

export function stopSpeaking() {
  if (current) {
    current.pause()
    current = null
  }
}

export async function speak(text: string): Promise<void> {
  stopSpeaking()
  let url = cache.get(text)
  if (!url) {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error(`speak failed (${res.status})`)
    url = URL.createObjectURL(await res.blob())
    cache.set(text, url)
  }
  const audio = new Audio(url)
  current = audio
  await audio.play()
}

export async function transcribe(blob: Blob): Promise<string> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/webm' },
    body: blob,
  })
  if (!res.ok) throw new Error(`transcribe failed (${res.status})`)
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}
