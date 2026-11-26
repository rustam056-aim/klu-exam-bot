import { useState } from 'react'
import { accessHeaders } from './access'

// The trial feedback form: the 16 questions from the feedback plan (Prof. Meuer, with Danielle
// Thibodeau's additions). Shown right after a practice oral exam, while it's fresh. Anonymous.
// The keys must match api/src/trial.ts.

const AGREE = { low: 'Strongly disagree', high: 'Strongly agree' }

const STATEMENTS: { key: string; label: string; comment?: { key: string; label: string; when: (n?: number) => boolean } }[] = [
  {
    key: 'q1',
    label: 'It asked one clear question at a time.',
    comment: { key: 'c1', label: 'Describe a moment it asked more than one thing', when: (n) => !!n && n <= 3 },
  },
  { key: 'q2', label: 'When I asked to repeat, it repeated the same question and didn’t change it.' },
  { key: 'q3', label: 'I had enough time to think before answering.' },
  {
    key: 'q4',
    label: 'The voice and manner felt calm and pleasant.',
    comment: { key: 'c4', label: 'Anything you would change (tone, speed)? (optional)', when: (n) => !!n },
  },
  { key: 'q5', label: 'The questions were relevant to the lectures and at the level I’d expect in the exam.' },
  {
    key: 'q6',
    label: 'Its answers and corrections were correct.',
    comment: { key: 'c6', label: 'Which one was wrong?', when: (n) => !!n && n <= 3 },
  },
  { key: 'q7', label: 'The exam felt fair: I don’t think others would get easier or harder questions.' },
  { key: 'q8', label: 'It tested what I understand, not how fast or smooth I can speak English.' },
]

type Answers = { scales: Record<string, number>; choices: Record<string, string>; texts: Record<string, string> }

function Scale({
  label,
  value,
  low,
  high,
  onPick,
}: {
  label: string
  value?: number
  low: string
  high: string
  onPick: (n?: number) => void
}) {
  return (
    <fieldset className="fb-q">
      <legend>{label}</legend>
      <div className="fb-scale" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={n === 1 ? `1, ${low}` : n === 5 ? `5, ${high}` : String(n)}
            className="fb-choice fb-num"
            onClick={() => onPick(value === n ? undefined : n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="fb-ends" aria-hidden="true">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  )
}

function Choices({
  label,
  options,
  value,
  onPick,
}: {
  label: string
  options: [string, string][]
  value?: string
  onPick: (v?: string) => void
}) {
  return (
    <fieldset className="fb-q">
      <legend>{label}</legend>
      <div className="fb-choices" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            className="fb-choice"
            onClick={() => onPick(value === v ? undefined : v)}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function Text({ label, value, onChange }: { label: string; value?: string; onChange: (t: string) => void }) {
  return (
    <label className="open fb-q">
      <span className="fb-legend fb-sub">{label}</span>
      <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={400} />
    </label>
  )
}

export function TrialForm() {
  const [a, setA] = useState<Answers>({ scales: {}, choices: {}, texts: {} })
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const scale = (key: string) => (n?: number) =>
    setA((p) => {
      const scales = { ...p.scales }
      if (n === undefined) delete scales[key]
      else scales[key] = n
      return { ...p, scales }
    })
  const choice = (key: string) => (v?: string) =>
    setA((p) => {
      const choices = { ...p.choices }
      if (v === undefined) delete choices[key]
      else choices[key] = v
      return { ...p, choices }
    })
  const text = (key: string) => (t: string) => setA((p) => ({ ...p, texts: { ...p.texts, [key]: t } }))

  if (state === 'sent') {
    return (
      <p className="feedback-thanks" role="status">
        Thank you! Your feedback went to Prof. Meuer’s team, anonymously.
      </p>
    )
  }

  const answered = Object.keys(a.scales).length + Object.keys(a.choices).length + Object.values(a.texts).filter((t) => t.trim()).length

  return (
    <form
      className="card feedback-box trial-form"
      onSubmit={(e) => {
        e.preventDefault()
        setState('sending')
        fetch('/api/trial', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...accessHeaders() },
          body: JSON.stringify(a),
        })
          .then((r) => setState(r.ok ? 'sent' : 'failed'))
          .catch(() => setState('failed'))
      }}
    >
      <h2>Your feedback on this trial (3 min)</h2>
      <p className="note">
        This helps decide whether and how a tool like this can be used at KLU. It’s anonymous: no name, nothing that
        shows who you are. Skip anything you don’t want to answer.
      </p>

      <h3 className="fb-part">How much do you agree?</h3>
      {STATEMENTS.map((s) => (
        <div key={s.key} className="fb-item">
          <Scale label={s.label} value={a.scales[s.key]} {...AGREE} onPick={scale(s.key)} />
          {s.key === 'q2' && (
            <Choices
              label=""
              options={[['yes', 'I didn’t ask to repeat']]}
              value={a.choices.q2na}
              onPick={choice('q2na')}
            />
          )}
          {s.comment && s.comment.when(a.scales[s.key]) && (
            <Text label={s.comment.label} value={a.texts[s.comment.key]} onChange={text(s.comment.key)} />
          )}
        </div>
      ))}

      <h3 className="fb-part">Compared to other exams</h3>
      <Scale
        label="Compared to a written exam, this was…"
        value={a.scales.q9}
        low="Much less stressful"
        high="Much more stressful"
        onPick={scale('q9')}
      />
      <Text label="What caused or eased the stress?" value={a.texts.c9} onChange={text('c9')} />
      <Scale
        label="Compared to an oral exam with a human examiner, this was…"
        value={a.scales.q10}
        low="Much worse"
        high="Much better"
        onPick={scale('q10')}
      />
      <Text label="What was different?" value={a.texts.c10} onChange={text('c10')} />

      <h3 className="fb-part">A few more</h3>
      <Choices
        label="Did anything go wrong technically (mishearing, lag, being cut off, video)?"
        options={[
          ['no', 'No'],
          ['yes', 'Yes'],
        ]}
        value={a.choices.q11}
        onPick={choice('q11')}
      />
      {a.choices.q11 === 'yes' && <Text label="What went wrong?" value={a.texts.c11} onChange={text('c11')} />}

      <Choices
        label="Do you have privacy concerns about using it (your voice, your answers, the AI providers)?"
        options={[
          ['no', 'No'],
          ['some', 'A few'],
          ['yes', 'Yes'],
        ]}
        value={a.choices.q12}
        onPick={choice('q12')}
      />
      {(a.choices.q12 === 'some' || a.choices.q12 === 'yes') && (
        <Text label="What worries you?" value={a.texts.c12} onChange={text('c12')} />
      )}
      <Choices
        label="In this trial nothing is recorded: no video or audio of you is saved, your speech is only turned into text. If this were used for a real exam, it would probably need video recording for exam integrity. Would you be OK with that?"
        options={[
          ['yes', 'Yes'],
          ['maybe', 'Not sure'],
          ['no', 'No'],
        ]}
        value={a.choices.q12v}
        onPick={choice('q12v')}
      />
      <Choices
        label="For practice only: would you like the option to record yourself on video (saved only on your own device) to watch your performance afterwards?"
        options={[
          ['yes', 'Yes'],
          ['maybe', 'Maybe'],
          ['no', 'No'],
        ]}
        value={a.choices.q13}
        onPick={choice('q13')}
      />
      <Choices
        label="Would you use it to practise for the exam, even if the real exam stays with a human?"
        options={[
          ['yes', 'Yes'],
          ['maybe', 'Maybe'],
          ['no', 'No'],
        ]}
        value={a.choices.q14}
        onPick={choice('q14')}
      />
      <Choices
        label="For your next exam, which format would you prefer?"
        options={[
          ['written', 'Written'],
          ['human', 'Oral with a human'],
          ['bot', 'Oral with this AI'],
        ]}
        value={a.choices.q15}
        onPick={choice('q15')}
      />
      <Text label="Why?" value={a.texts.c15} onChange={text('c15')} />
      <Text
        label="Anything we didn’t ask: concerns, ideas, or the one thing that would improve it most?"
        value={a.texts.c16}
        onChange={text('c16')}
      />

      {state === 'failed' && (
        <p className="error" role="alert">
          That didn’t go through. Try again.
        </p>
      )}
      <div className="actions">
        <button className="btn primary" type="submit" disabled={state === 'sending' || answered === 0}>
          {state === 'sending' ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </form>
  )
}
