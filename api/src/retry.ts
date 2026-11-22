// Busy moments, e.g. a whole class practising at once: Anthropic and ElevenLabs then answer
// 429 (too many requests right now) or 5xx / 529 (overloaded). Wait a moment and try again,
// up to `tries` times, instead of showing the student an error straight away.
export async function withRetry(send: () => Promise<Response>, label: string, tries = 3): Promise<Response> {
  let res = await send();
  for (let attempt = 1; attempt < tries && (res.status === 429 || res.status >= 500); attempt++) {
    const after = Number(res.headers.get('retry-after'));
    // Their own "retry after" if they sent one (capped at 4 s), else 0.7 s, then 1.4 s; plus a
    // little randomness so many waiting students don't all try again at the same moment.
    const wait = Math.min(4000, after > 0 ? after * 1000 : 700 * 2 ** (attempt - 1)) + Math.random() * 400;
    console.log(`${label}: ${res.status}, trying again in ${Math.round(wait)} ms`);
    await res.body?.cancel().catch(() => undefined);
    await new Promise((r) => setTimeout(r, wait));
    res = await send();
  }
  return res;
}
