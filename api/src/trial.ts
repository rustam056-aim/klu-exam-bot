// The trial feedback form (the 16 questions from the feedback plan agreed with Prof. Meuer and
// Danielle Thibodeau). It opens right after a practice oral exam. Anonymous: no name, no IP, just
// the answers. Saved in KV FEEDBACK under "trial:<time>:<id>" (as the value: too big for metadata).
// Read at /api/trial/list?admin=<ADMIN_CODE>.

type KV = {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  list(o: { prefix: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
};

// Statements rated 1-5 (strongly disagree ... strongly agree), in the order of the plan.
export const TRIAL_SCALES: Record<string, { label: string; low: string; high: string }> = {
  q1: { label: '1. It asked one clear question at a time', low: 'Strongly disagree', high: 'Strongly agree' },
  q2: { label: '2. When I asked to repeat, it repeated the same question', low: 'Strongly disagree', high: 'Strongly agree' },
  q3: { label: '3. I had enough time to think before answering', low: 'Strongly disagree', high: 'Strongly agree' },
  q4: { label: '4. The voice and manner felt calm and pleasant', low: 'Strongly disagree', high: 'Strongly agree' },
  q5: { label: '5. The questions were relevant and at exam level', low: 'Strongly disagree', high: 'Strongly agree' },
  q6: { label: '6. Its answers and corrections were correct', low: 'Strongly disagree', high: 'Strongly agree' },
  q7: { label: '7. The exam felt fair', low: 'Strongly disagree', high: 'Strongly agree' },
  q8: { label: '8. It tested understanding, not how fast or smooth my English is', low: 'Strongly disagree', high: 'Strongly agree' },
  q9: { label: '9. Compared to a written exam, this was', low: 'Much less stressful', high: 'Much more stressful' },
  q10: { label: '10. Compared to an oral exam with a human examiner, this was', low: 'Much worse', high: 'Much better' },
};

export const TRIAL_CHOICES: Record<string, { label: string; values: Record<string, string> }> = {
  q2na: { label: '2. Didn’t ask to repeat', values: { yes: 'I didn’t ask' } },
  q11: { label: '11. Something went wrong technically', values: { no: 'No', yes: 'Yes' } },
  q12: { label: '12. Privacy concerns', values: { no: 'No', some: 'A few', yes: 'Yes' } },
  q12v: { label: '12. OK with video recording in a real exam', values: { yes: 'Yes', maybe: 'Not sure', no: 'No' } },
  q13: { label: '13. Would like to record myself (own device)', values: { yes: 'Yes', maybe: 'Maybe', no: 'No' } },
  q14: { label: '14. Would use it to practise', values: { yes: 'Yes', maybe: 'Maybe', no: 'No' } },
  q15: { label: '15. Preferred exam format', values: { written: 'Written', human: 'Oral with a human', bot: 'Oral with the SusLogBot' } },
};

export const TRIAL_TEXTS: Record<string, string> = {
  c1: '1. A moment it asked more than one thing',
  c4: '4. Anything to change (tone, speed)',
  c6: '6. Which answer or correction was wrong',
  c9: '9. What caused or eased the stress',
  c10: '10. What was different from a human examiner',
  c11: '11. What went wrong',
  c12: '12. Privacy: what worries you',
  c15: '15. Why that format',
  c16: '16. Anything else / the one thing to improve',
};

export type TrialAnswers = { at: string; scales: Record<string, number>; choices: Record<string, string>; texts: Record<string, string> };

// Keeps only known questions and valid answers.
export function cleanTrial(body: unknown): TrialAnswers | null {
  const b = (body && typeof body === 'object' ? body : {}) as { scales?: unknown; choices?: unknown; texts?: unknown };
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const scales: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(b.scales))) {
    const n = Number(v);
    if (k in TRIAL_SCALES && Number.isInteger(n) && n >= 1 && n <= 5) scales[k] = n;
  }
  const choices: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(b.choices))) {
    if (k in TRIAL_CHOICES && typeof v === 'string' && v in TRIAL_CHOICES[k].values) choices[k] = v;
  }
  const texts: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(b.texts))) {
    if (k in TRIAL_TEXTS && typeof v === 'string' && v.trim()) texts[k] = v.trim().slice(0, 400);
  }
  if (!Object.keys(scales).length && !Object.keys(choices).length && !Object.keys(texts).length) return null;
  return { at: new Date().toISOString(), scales, choices, texts };
}

export async function saveTrial(kv: KV | undefined, answers: TrialAnswers) {
  console.log('Trial feedback:', JSON.stringify(answers).slice(0, 2000));
  if (!kv) return;
  await kv.put(`trial:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, JSON.stringify(answers));
}

// The overview page for Prof. Meuer: averages per statement, counts per choice, then every answer.
export async function trialPage(kv: KV): Promise<string> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: 'trial:', limit: 1000, cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const all = (await Promise.all(keys.map((k) => kv.get(k))))
    .map((v) => {
      try {
        return v ? (JSON.parse(v) as TrialAnswers) : null;
      } catch {
        return null;
      }
    })
    .filter((a): a is TrialAnswers => a !== null)
    .reverse();
  const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const scaleRows = Object.entries(TRIAL_SCALES)
    .map(([k, q]) => {
      const given = all.map((a) => a.scales[k]).filter((n): n is number => typeof n === 'number');
      const avg = given.length ? (given.reduce((s, n) => s + n, 0) / given.length).toFixed(1) : '–';
      const spread = [1, 2, 3, 4, 5].map((n) => given.filter((g) => g === n).length).join(' / ');
      return `<tr><td>${esc(q.label)}</td><td><b>${avg}</b></td><td>${given.length}</td><td>${spread}</td><td class="s">1 = ${esc(q.low)}, 5 = ${esc(q.high)}</td></tr>`;
    })
    .join('');
  const choiceRows = Object.entries(TRIAL_CHOICES)
    .map(([k, q]) => {
      const counts = Object.entries(q.values)
        .map(([v, label]) => `${esc(label)}: <b>${all.filter((a) => a.choices[k] === v).length}</b>`)
        .join(', ');
      return `<tr><td>${esc(q.label)}</td><td>${counts}</td></tr>`;
    })
    .join('');
  const answerRows = all
    .map((a) => {
      const scales = Object.keys(TRIAL_SCALES)
        .map((k) => `<td>${a.scales[k] ?? ''}</td>`)
        .join('');
      const choices = Object.entries(TRIAL_CHOICES)
        .map(([k, q]) => `<td>${esc(q.values[a.choices[k] ?? ''] ?? '')}</td>`)
        .join('');
      const texts = Object.entries(TRIAL_TEXTS)
        .filter(([k]) => a.texts[k])
        .map(([k, label]) => `<div><span class="s">${esc(label)}:</span> ${esc(a.texts[k])}</div>`)
        .join('');
      return `<tr><td>${esc(a.at.slice(0, 16).replace('T', ' '))}</td>${scales}${choices}<td class="t">${texts}</td></tr>`;
    })
    .join('');
  const scaleHeads = Object.keys(TRIAL_SCALES)
    .map((k) => `<th>${k.slice(1)}</th>`)
    .join('');
  const choiceHeads = Object.keys(TRIAL_CHOICES)
    .map((k) => `<th>${esc(k.replace('q', ''))}</th>`)
    .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Trial feedback</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse;margin:8px 0 28px}td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}th{background:#f4f4f4}.s{color:#777;font-size:13px}.t{min-width:320px}h2{margin-top:28px}</style></head><body>
<h1>Trial feedback</h1><p>${all.length} answer${all.length === 1 ? '' : 's'}, newest first. Anonymous: no names, no IP addresses.</p>
<h2>Statements (1 to 5)</h2><table><tr><th>Statement</th><th>Average</th><th>Answers</th><th>How many gave 1 / 2 / 3 / 4 / 5</th><th>Scale</th></tr>${scaleRows}</table>
<h2>Choices</h2><table>${choiceRows}</table>
<h2>Every answer</h2><table><tr><th>When</th>${scaleHeads}${choiceHeads}<th>Comments</th></tr>${answerRows}</table>
</body></html>`;
}
