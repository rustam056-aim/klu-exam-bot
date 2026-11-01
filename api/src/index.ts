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
    if (path === '/api/question/next' && req.method === 'GET') {
      const session = url.searchParams.get('session');
      const difficulty = url.searchParams.get('difficulty');
      const exclude = new Set((url.searchParams.get('exclude') ?? '').split(',').filter(Boolean));
      let pool = qs.filter((q) => !exclude.has(q.id));
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

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
