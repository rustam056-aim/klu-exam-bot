// Practice bot API: picks questions, gives hints, checks answers.
// Rule: everything comes from data/*.json (the course question bank). No outside knowledge.
import bank from '../data/questions_s1_s2_2026.json';

type Question = {
  id: string;
  session: number;
  year: number;
  topic: string;
  type: 'MC' | 'Open';
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options: Record<string, string> | null;
  correct: string | null;
  key_points: string[];
  model_answer: string;
  hint1: string;
  hint2: string;
  source_pages: string;
  status: string;
};

export interface Env {
  ANTHROPIC_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string; // optional: a different standard voice
  ONLY_APPROVED?: string; // set to "true" before students get access
}

const ALL = (bank as { questions: Question[] }).questions;
const active = (env: Env) =>
  env.ONLY_APPROVED === 'true' ? ALL.filter((q) => q.status === 'approved') : ALL;

// What the student sees: never the correct answer or key points.
const publicView = (q: Question) => ({
  id: q.id,
  session: q.session,
  topic: q.topic,
  type: q.type,
  difficulty: q.difficulty,
  question: q.question,
  options: q.options,
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const qs = active(env);

    if (path === '/api/health') {
      return json({ ok: true, questions: qs.length });
    }

    // GET /api/sessions -> [{ session: 1, count: 26 }, ...]
    if (path === '/api/sessions') {
      const counts: Record<number, number> = {};
      for (const q of qs) counts[q.session] = (counts[q.session] ?? 0) + 1;
      return json(
        Object.entries(counts).map(([session, count]) => ({ session: Number(session), count })),
      );
    }

    // GET /api/question/next?session=1&difficulty=easy&exclude=S1-01,S1-02
    // Optional: only=S1-03,S2-10 limits the pool to these questions ("practise these again").
    if (path === '/api/question/next' && req.method === 'GET') {
      const session = url.searchParams.get('session');
      const difficulty = url.searchParams.get('difficulty');
      const list = (name: string) => (url.searchParams.get(name) ?? '').split(',').filter(Boolean);
      const exclude = new Set(list('exclude'));
      const only = new Set(list('only'));
      let pool = qs.filter((q) => !exclude.has(q.id));
      if (only.size > 0) pool = pool.filter((q) => only.has(q.id));
      if (session) pool = pool.filter((q) => String(q.session) === session);
      if (difficulty) pool = pool.filter((q) => q.difficulty === difficulty);
      if (pool.length === 0) return json({ done: true });
      const q = pool[Math.floor(Math.random() * pool.length)];
      return json({ done: false, question: publicView(q), remaining: pool.length - 1 });
    }

    // GET /api/hint?id=S1-03&level=1   (level 1 = nudge, level 2 = stronger)
    if (path === '/api/hint' && req.method === 'GET') {
      const q = qs.find((x) => x.id === url.searchParams.get('id'));
      if (!q) return json({ error: 'unknown question' }, 404);
      const level = url.searchParams.get('level') === '2' ? 2 : 1;
      return json({ id: q.id, level, hint: level === 2 ? q.hint2 : q.hint1 });
    }

    // POST /api/answer  { "id": "S1-01", "answer": "B" }
    if (path === '/api/answer' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { id?: string; answer?: string } | null;
      const q = qs.find((x) => x.id === body?.id);
      if (!q || typeof body?.answer !== 'string') return json({ error: 'need id and answer' }, 400);

      if (q.type === 'MC') {
        // Multiple choice is checked by code. No AI involved.
        const correct = body.answer.trim().toUpperCase() === q.correct;
        return json({
          id: q.id,
          type: 'MC',
          verdict: correct ? 'correct' : 'wrong',
          correctOption: q.correct,
          explanation: q.model_answer,
          source: q.source_pages,
        });
      }

      // Open answers: AI grading against key_points comes next (needs ANTHROPIC_API_KEY).
      return json({
        id: q.id,
        type: 'Open',
        verdict: 'not_graded_yet',
        keyPoints: q.key_points,
        modelAnswer: q.model_answer,
        source: q.source_pages,
      });
    }

    // POST /api/transcribe  body = recorded audio (webm/mp4/ogg) -> { text }
    // Speech to text with ElevenLabs Scribe v2.
    if (path === '/api/transcribe' && req.method === 'POST') {
      if (!env.ELEVENLABS_API_KEY) return json({ error: 'voice is not set up' }, 503);
      const type = req.headers.get('content-type') ?? 'audio/webm';
      const audio = await req.arrayBuffer();
      if (audio.byteLength === 0) return json({ error: 'empty recording' }, 400);
      if (audio.byteLength > 6_000_000) return json({ error: 'recording too long' }, 413);
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('file', new Blob([audio], { type }), `answer.${ext}`);
      form.append('model_id', 'scribe_v2');
      form.append('language_code', 'eng');
      form.append('tag_audio_events', 'false');
      const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
        body: form,
      });
      if (!res.ok) {
        console.log('ElevenLabs speech-to-text failed', res.status, (await res.text()).slice(0, 300));
        return json({ error: 'transcription failed' }, 502);
      }
      const data = (await res.json()) as { text?: string };
      return json({ text: (data.text ?? '').trim() });
    }

    // POST /api/speak  { "text": "..." } -> audio/mpeg
    // Text to speech with a standard ElevenLabs voice (Flash v2.5: fast and cheap).
    if (path === '/api/speak' && req.method === 'POST') {
      if (!env.ELEVENLABS_API_KEY) return json({ error: 'voice is not set up' }, 503);
      const body = (await req.json().catch(() => null)) as { text?: string } | null;
      const text = body?.text?.trim().slice(0, 900);
      if (!text) return json({ error: 'need text' }, 400);
      const voice = env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': env.ELEVENLABS_API_KEY,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
        },
      );
      if (!res.ok || !res.body) {
        console.log('ElevenLabs text-to-speech failed', res.status, (await res.text()).slice(0, 300));
        return json({ error: 'speech failed' }, 502);
      }
      return new Response(res.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
