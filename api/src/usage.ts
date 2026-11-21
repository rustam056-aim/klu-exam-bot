// Daily limits per student, so one person can't use up the voice and AI credits for everyone.
// A Cloudflare Durable Object (binding USAGE, see wrangler.jsonc) counts, per day and per device,
// how much each student used: characters of voice, conversation messages, and the rest.
// One counter object per day (UTC); it deletes itself two days later.
// Without the binding there are no limits (e.g. local tests).

type Storage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
};

export class Usage {
  private storage: Storage;
  constructor(state: { storage: Storage }) {
    this.storage = state.storage;
  }

  // POST { key, amount, limit } -> { ok, used, limit }. Counts only when it's allowed.
  async fetch(req: Request): Promise<Response> {
    const { key, amount, limit } = (await req.json()) as { key: string; amount: number; limit: number };
    const used = (await this.storage.get<number>(key)) ?? 0;
    // Allowed as long as the student is still under the limit before this request.
    const ok = used < limit;
    if (ok) await this.storage.put(key, used + amount);
    if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(Date.now() + 2 * 86_400_000);
    return Response.json({ ok, used: ok ? used + amount : used, limit });
  }

  async alarm() {
    await this.storage.deleteAll();
  }
}

export type UsageKind = 'voice' | 'chat' | 'practice' | 'listen' | 'avatar';

export type UsageEnv = {
  USAGE?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(url: string, init: RequestInit): Promise<Response> };
  };
  DAILY_VOICE_CHARS?: string; // characters of voice per student per day (default 25000: a 30-minute oral exam plus some practice)
  DAILY_CHAT?: string; // conversation messages per student per day (default 150)
  DAILY_PRACTICE?: string; // graded answers and hints per student per day (default 400)
};

const DEFAULTS: Record<UsageKind, number> = { voice: 25000, chat: 150, practice: 400, listen: 300, avatar: 20 };

function limitOf(env: UsageEnv, kind: UsageKind): number {
  const set = { voice: env.DAILY_VOICE_CHARS, chat: env.DAILY_CHAT, practice: env.DAILY_PRACTICE, listen: undefined, avatar: undefined }[kind];
  const n = Number(set);
  return Number.isFinite(n) && n > 0 ? n : DEFAULTS[kind];
}

// Which student: the random id the browser keeps (header x-device), else the IP address.
function whoIs(req: Request): string {
  const device = (req.headers.get('x-device') ?? '').trim();
  if (/^[a-z0-9-]{8,64}$/i.test(device)) return `d:${device}`;
  return `ip:${req.headers.get('cf-connecting-ip') ?? 'unknown'}`;
}

// true = go ahead. Counts `amount` for this student today. If the counter can't be reached,
// the request goes ahead (a broken counter shouldn't break the tool).
export async function allow(env: UsageEnv, req: Request, kind: UsageKind, amount = 1): Promise<boolean> {
  if (!env.USAGE) return true;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const stub = env.USAGE.get(env.USAGE.idFromName(day));
    const res = await stub.fetch('https://usage/count', {
      method: 'POST',
      body: JSON.stringify({ key: `${kind}:${whoIs(req)}`, amount, limit: limitOf(env, kind) }),
    });
    const data = (await res.json()) as { ok: boolean; used: number; limit: number };
    if (!data.ok) console.log(`Daily limit reached: ${kind} ${whoIs(req)} (${data.used}/${data.limit})`);
    return data.ok;
  } catch (err) {
    console.log('Usage counter failed:', String(err));
    return true;
  }
}
