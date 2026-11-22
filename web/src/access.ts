// Access code shared on Moodle. Stored in the browser so students type it only once.
const KEY = 'accessCode'
let code = ''

try {
  code = localStorage.getItem(KEY) ?? ''
} catch {
  /* private mode: keep it in memory only */
}

export function setAccessCode(value: string) {
  code = value.trim()
  try {
    localStorage.setItem(KEY, code)
  } catch {
    /* private mode */
  }
}

// A random id for this browser, so the daily limits count per student (no name, nothing personal).
let device = ''
try {
  device = localStorage.getItem('device') ?? ''
  if (!device) {
    device = crypto.randomUUID()
    localStorage.setItem('device', device)
  }
} catch {
  /* private mode: a new id for this visit */
}
if (!device) device = Math.random().toString(36).slice(2) + Date.now().toString(36)

export function accessHeaders(): Record<string, string> {
  return { ...(code ? { 'x-access-code': code } : {}), 'x-device': device }
}

// For image URLs (an <img> can't send headers).
export function accessQuery(): string {
  return code ? `?c=${encodeURIComponent(code)}` : ''
}

export class NeedsCode extends Error {}

// The student has used today's share (voice, conversation or practice). Resets the next day.
export class DailyLimit extends Error {
  kind: string
  // everyone = the limit for the whole site (all students together) is reached, not just yours
  constructor(kind: string = '', everyone = false) {
    super(
      everyone
        ? kind === 'voice'
          ? 'So many students practised today that his voice is resting until tomorrow. You can keep practising by typing.'
          : 'So many students practised today that the tool has reached its limit for today. It’s back tomorrow.'
        : kind === 'voice'
          ? 'You’ve used today’s voice time. You can keep practising by typing; his voice is back tomorrow.'
          : 'You’ve reached today’s limit. It resets tomorrow, see you then!',
    )
    this.kind = kind
  }
}

// Throws DailyLimit for a "daily limit" answer from the server.
export async function checkLimit(res: Response) {
  if (res.status !== 429) return
  const body = (await res.json().catch(() => ({}))) as { kind?: string; everyone?: boolean }
  throw new DailyLimit(body.kind, body.everyone === true)
}
