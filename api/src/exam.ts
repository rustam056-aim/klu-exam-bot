import { knowledge } from './chat';
import type { ChatQuestion } from './chat';
import { withRetry } from './retry';

// After the practice oral exam: a practice grade on the KLU scale (1.0 best, 4.0 pass, 5.0 fail),
// judged against the course material, with a short comment per answer. Clearly an estimate,
// never the real grade.

export type ExamTurnIn = { question: string; answer: string };
export type ExamGrade = {
  grade: number;
  verdict: string;
  answers: { result: 'right' | 'partly' | 'wrong' | 'beyond' | 'skip'; comment: string; module: string; topic: string }[];
};

const GRADES = [1.0, 1.3, 1.7, 2.0, 2.3, 2.7, 3.0, 3.3, 3.7, 4.0, 5.0];

// The course modules ("Session 2", "Guest lecture: MAN (eTrucks)", ...), so the class overview can
// show where students struggle.
export function modulesOf(questions: ChatQuestion[]): string[] {
  return [...new Set(questions.map((q) => q.session_label ?? `Session ${q.session}`))];
}

const gradeTool = (modules: string[]) => ({
  name: 'record_exam_grade',
  description: 'Record the practice grade for this oral exam and a short assessment of each answer.',
  input_schema: {
    type: 'object',
    properties: {
      answers: {
        type: 'array',
        description: 'One entry per answer, in order.',
        items: {
          type: 'object',
          properties: {
            result: {
              type: 'string',
              enum: ['right', 'partly', 'wrong', 'beyond', 'skip'],
              description: "Against the course material. 'beyond' = mostly content that isn't in the material (to be checked by the professor). 'skip' = not an answer at all (asked to repeat or rephrase, asked something back, noise).",
            },
            comment: { type: 'string', description: 'One short sentence: what was good or what was missing, from the material.' },
            module: { type: 'string', enum: [...modules, 'Other'], description: 'The course module the question is about.' },
            topic: { type: 'string', description: 'The topic of the question in 2 to 4 words, e.g. "Scope 3 emissions".' },
          },
          required: ['result', 'comment', 'module', 'topic'],
        },
      },
      grade: {
        type: 'number',
        enum: GRADES,
        description: 'Practice grade on the German scale: 1.0 excellent ... 4.0 just passed, 5.0 failed.',
      },
      verdict: {
        type: 'string',
        description: 'Two or three sentences to the student, in the first person as the professor: overall impression and what to review.',
      },
    },
    required: ['answers', 'grade', 'verdict'],
  },
});

const RUBRIC = `You grade a PRACTICE oral exam in the KLU course "Sustainable Logistics" (Prof. Johannes Meuer).
Judge every answer only against the course material below. Be fair but realistic: students tend to think they know more than they do.
- right: the key ideas from the material are there and correct. partly: some of it, or vague. wrong: wrong or no real answer ("I don't know" counts as wrong).
- skip: the student didn't try to answer: they asked to repeat or rephrase the question, asked something back, or it's just noise. Not counted for or against them.
- beyond: the answer is mostly about things that aren't in the material (they may still be correct; the professor checks them and may give extra credit). Don't count these against the student.
- The grade (German scale) reflects the whole exam: how many questions were answered well, depth in follow-ups, precision with facts (ranges, rankings and what matters most count; exact figures are not expected). Very short exams with few answers can't get a top grade.
- The verdict is spoken by the professor to the student ("you", first person "my lectures"), clearly a practice estimate.`;

export async function gradeExam(
  turns: ExamTurnIn[],
  questions: ChatQuestion[],
  env: { ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL?: string; ANTHROPIC_CHAT_MODEL?: string },
): Promise<ExamGrade> {
  const modules = modulesOf(questions);
  const transcript = turns
    .map((t, i) => `Q${i + 1}: ${t.question.slice(0, 1200)}\nA${i + 1}: ${t.answer.slice(0, 2000)}`)
    .join('\n\n');
  const res = await withRetry(() => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_CHAT_MODEL || env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: 2000,
      system: [
        { type: 'text', text: RUBRIC },
        { type: 'text', text: knowledge(questions), cache_control: { type: 'ephemeral' } },
      ],
      tools: [gradeTool(modules)],
      tool_choice: { type: 'tool', name: 'record_exam_grade' },
      messages: [{ role: 'user', content: `The exam (${turns.length} answers):\n\n${transcript}\n\nGrade it.` }],
    }),
  }), 'Exam grade: Claude');
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content?: { type: string; input?: Partial<ExamGrade> & { answers?: unknown } }[] };
  const input = data.content?.find((c) => c.type === 'tool_use')?.input;
  if (!input) throw new Error('Claude returned no grade');
  const nearest = (g: number) => GRADES.reduce((a, b) => (Math.abs(b - g) < Math.abs(a - g) ? b : a));
  const answers = (Array.isArray(input.answers) ? input.answers : [])
    .slice(0, turns.length)
    .map((a: { result?: unknown; comment?: unknown; module?: unknown; topic?: unknown }) => ({
      result: (['right', 'partly', 'wrong', 'beyond', 'skip'].includes(String(a?.result)) ? a.result : 'partly') as ExamGrade['answers'][number]['result'],
      comment: typeof a?.comment === 'string' ? a.comment.slice(0, 400) : '',
      module: modules.includes(String(a?.module)) ? String(a.module) : 'Other',
      topic: typeof a?.topic === 'string' ? a.topic.slice(0, 40) : '',
    }));
  return {
    grade: nearest(Number(input.grade) || 5),
    verdict: typeof input.verdict === 'string' ? input.verdict.slice(0, 800) : '',
    answers,
  };
}
