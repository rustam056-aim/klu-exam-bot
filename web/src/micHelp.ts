// Browser-specific steps for when the microphone is blocked, so students don't have to search for them.
export type MicHelp = { title: string; steps: string[]; openElsewhere?: boolean }

export function micHelp(kind: 'blocked' | 'missing' | 'busy' | 'unsupported'): MicHelp {
  if (kind === 'missing') {
    return { title: 'No microphone found', steps: ['Plug in or switch on a microphone, then tap Try again.', 'Or just type your answer.'] }
  }
  if (kind === 'busy') {
    return {
      title: 'The microphone is busy',
      steps: ['Another app (Zoom, Teams, a call) may be using it. Close it, then tap Try again.', 'Or just type your answer.'],
    }
  }

  const ua = navigator.userAgent
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/.test(ua)
  const inApp = /FBAN|FBAV|Instagram|LinkedInApp|MicroMessenger|Teams|GSA\//.test(ua) || (iOS && !/Safari\//.test(ua))

  if (kind === 'unsupported' || inApp) {
    return {
      title: 'Voice answers need a normal browser',
      steps: [
        'This page seems to be open inside another app, which can’t use the microphone.',
        iOS
          ? 'Tap ⋯ or the share icon and choose “Open in Safari”, or copy the link below and paste it into Safari.'
          : 'Open the page in Chrome or another browser: copy the link below and paste it there.',
      ],
      openElsewhere: true,
    }
  }

  if (iOS) {
    if (/CriOS/.test(ua)) {
      return {
        title: 'Allow the microphone for Chrome',
        steps: ['Open your iPhone Settings → Apps → Chrome.', 'Turn on Microphone.', 'Come back here and tap Try again.'],
      }
    }
    if (/FxiOS|EdgiOS/.test(ua)) {
      const app = /FxiOS/.test(ua) ? 'Firefox' : 'Edge'
      return {
        title: `Allow the microphone for ${app}`,
        steps: [`Open your iPhone Settings → Apps → ${app}.`, 'Turn on Microphone.', 'Come back here and tap Try again.'],
      }
    }
    return {
      title: 'Allow the microphone in Safari',
      steps: [
        'Tap “aA” in the address bar → Website Settings → Microphone → Allow.',
        'If that’s not there: iPhone Settings → Apps → Safari → Microphone → Ask.',
        'Then tap Try again.',
      ],
    }
  }

  if (android) {
    return {
      title: 'Allow the microphone',
      steps: [
        'Tap the icon left of the address bar → Permissions → Microphone → Allow.',
        'If it’s still blocked: phone Settings → Apps → your browser → Permissions → Microphone → Allow.',
        'Then tap Try again.',
      ],
    }
  }

  const mac = /Macintosh/.test(ua)
  const system = mac
    ? 'Still blocked? Mac System Settings → Privacy & Security → Microphone → turn on your browser.'
    : 'Still blocked? Windows Settings → Privacy & security → Microphone → allow apps and your browser.'

  if (/Firefox\//.test(ua)) {
    return {
      title: 'Allow the microphone in Firefox',
      steps: ['Click the crossed-out microphone in the address bar and remove the block.', 'Tap Try again.', system],
    }
  }
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
    return {
      title: 'Allow the microphone in Safari',
      steps: ['In the menu bar: Safari → Settings for this website → Microphone → Allow.', 'Tap Try again.', system],
    }
  }
  return {
    title: 'Allow the microphone',
    steps: [
      'Click the icon left of the address bar (a padlock or sliders) → turn on Microphone.',
      'Reload the page if asked, then tap Try again.',
      system,
    ],
  }
}
