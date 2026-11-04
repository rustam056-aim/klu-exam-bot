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

export function accessHeaders(): Record<string, string> {
  return code ? { 'x-access-code': code } : {}
}

export class NeedsCode extends Error {}
