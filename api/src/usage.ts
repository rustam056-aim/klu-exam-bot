// Daily limits per student, so one person can't use up the voice and AI credits for everyone,
// plus a daily limit for the whole site (all students together), so a busy day or misuse can
// never run up an unexpected bill.
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

  // POST { key, amount, limit, totalKey?, totalLimit? } -> { ok, used, limit, everyone? }.
  // Counts only when it's allowed: the student is under their limit AND the whole site is under
  // its limit (before this request). everyone = it was the site-wide limit that stopped it.
  async fetch(req: Request): Promise<Response> {
    const { key, amount, limit, totalKey, totalLimit } = (await req.json()) as {
      key: string;
      amount: number;
      limit: number;
      totalKey?: string;
      totalLimit?: number;
    };
    const used = (await this.storage.get<number>(key)) ?? 0;
    const total = totalKey ? ((await this.storage.get<number>(totalKey)) ?? 0) : 0;
    const mine = used < limit;
    const all = !totalKey || !totalLimit || total < totalLimit;
    const ok = mine && all;
    if (ok) {
      await this.storage.put(key, used + amount);
      if (totalKey) await this.storage.put(totalKey, total + amount);
    }
    if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(Date.now() + 2 * 86_400_000);
    return Response.json({ ok, used: ok ? used + amount : used, limit, everyone: mine && !all });
  }

  async alarm() {
    await this.storage.deleteAll();
  }
}

export type UsageKind = 'voice' | 'chat' | 'practice' | 'listen' | 'avatar' | 'exam' | 'flag' | 'session';

export type UsageEnv = {
  USAGE?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(url: string, init: RequestInit): Promise<Response> };
  };
  DAILY_VOICE_CHARS?: string; // characters of voice per student per day (default 25000: a 30-minute oral exam plus some practice)
  DAILY_CHAT?: string; // conversation messages per student per day (default 150)
  DAILY_PRACTICE?: string; // graded answers and hints per student per day (default 400)
  // For the whole site, all students together, per day (safety net for the credits):
  DAILY_TOTAL_CHAT?: string; // conversation messages (default 5000, roughly 50 dollars of Claude)
  DAILY_TOTAL_VOICE_CHARS?: string; // characters of his voice (default 200000: about 50 oral exams; ElevenLabs Creator has 275,000 a month, or 550,000 with the Flash model)
  DAILY_TOTAL_AVATAR?: string; // video sessions (default 300)
};

// exam = full practice exams that go into Prof. Meuer's class overview; flag = answers sent to him to check.
const DEFAULTS: Record<UsageKind, number> = { voice: 25000, chat: 150, practice: 400, listen: 300, avatar: 20, exam: 3, flag: 6, session: 40 };

// The same for the whole site per day.
const TOTAL_DEFAULTS: Record<UsageKind, number> = {
  voice: 200000,
  chat: 5000,
  practice: 40000,
  listen: 10000,
  avatar: 300,
  exam: 500,
  flag: 300,
  session: 5000,
};

function totalOf(env: UsageEnv, kind: UsageKind): number {
  const set = { voice: env.DAILY_TOTAL_VOICE_CHARS, chat: env.DAILY_TOTAL_CHAT, avatar: env.DAILY_TOTAL_AVATAR }[kind as string];
  const n = Number(set);
  return Number.isFinite(n) && n > 0 ? n : TOTAL_DEFAULTS[kind];
}

function limitOf(env: UsageEnv, kind: UsageKind): number {
  const set = { voice: env.DAILY_VOICE_CHARS, chat: env.DAILY_CHAT, practice: env.DAILY_PRACTICE, listen: undefined, avatar: undefined, exam: undefined, flag: undefined, session: undefined }[kind];
  const n = Number(set);
  return Number.isFinite(n) && n > 0 ? n : DEFAULTS[kind];
}

// Which student: the random id the browser keeps (header x-device), else the IP address.
function whoIs(req: Request): string {
  const device = (req.headers.get('x-device') ?? '').trim();
  if (/^[a-z0-9-]{8,64}$/i.test(device)) return `d:${device}`;
  return `ip:${req.headers.get('cf-connecting-ip') ?? 'unknown'}`;
}

// Requests stopped by the site-wide limit (not the student's own), so the reply can say so.
export const everyoneLimited = new WeakSet<Request>();

// true = go ahead. Counts `amount` for this student today (and for the whole site). If the
// counter can't be reached, the request goes ahead (a broken counter shouldn't break the tool).
export async function allow(env: UsageEnv, req: Request, kind: UsageKind, amount = 1): Promise<boolean> {
  if (!env.USAGE) return true;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const stub = env.USAGE.get(env.USAGE.idFromName(day));
    const res = await stub.fetch('https://usage/count', {
      method: 'POST',
      body: JSON.stringify({
        key: `${kind}:${whoIs(req)}`,
        amount,
        limit: limitOf(env, kind),
        totalKey: `${kind}:ALL`,
        totalLimit: totalOf(env, kind),
      }),
    });
    const data = (await res.json()) as { ok: boolean; used: number; limit: number; everyone?: boolean };
    if (data.everyone) {
      everyoneLimited.add(req);
      console.log(`Daily limit for the whole site reached: ${kind} (${totalOf(env, kind)})`);
    } else if (!data.ok) console.log(`Daily limit reached: ${kind} ${whoIs(req)} (${data.used}/${data.limit})`);
    return data.ok;
  } catch (err) {
    console.log('Usage counter failed:', String(err));
    return true;
  }
}
