# KLU exam practice bot

Exam-practice tool for Prof. Johannes Meuer's course "Sustainable Logistics" (Kühne Logistics University, Fall 2026).
Students open a web page, get questions on the course, answer by typing or speaking, and get feedback.
Built by Rustam Shurupov (frontend dev: React, TypeScript, Vite; comfortable with Python).

## Rules that never change
- Answers and feedback come ONLY from the question bank in `api/data/*.json` (built from the course slides). No outside knowledge.
- Prof. Meuer's real exam questions are never added to the tool.
- Multiple choice is checked by code. Open answers are graded by Claude against the question's `key_points` only.
- API keys live only in the backend (`api/.dev.vars` locally, Cloudflare secrets in production). Never in `web/`, never in git.
- Only questions with `status: "approved"` reach students (set `ONLY_APPROVED=true` before launch).
- All accounts (Claude API, ElevenLabs, Cloudflare) end up in Johannes's/KLU's name.

## Scope (Option A, agreed with Johannes)
Voice + text practice, feedback against course material, review list at the end, standard AI voice, no face.
Later, only if agreed: B = session summary + admin page for uploads/approval; C = Johannes's cloned voice + animated photo.
Keep A extensible: questions in data (later a database), voice behind `transcribe()` / `speak()`, an empty presenter slot in the layout.

## Structure
- `web/`  React + TypeScript + Vite (what students see). `npm run dev` -> http://localhost:5173. `/api` is proxied to the backend.
- `api/`  Cloudflare Worker in TypeScript. `npm run dev` -> http://localhost:8787
- `api/data/questions_s1_s2_2026.json`  question bank, Sessions 1-2 of 2026 (57 questions, all `draft`)

## API (api/src/index.ts)
- `GET  /api/health`
- `GET  /api/sessions`  -> question count per session
- `GET  /api/question/next?session=1&difficulty=easy&exclude=S1-01,S1-02`  -> a question without the answer
- `GET  /api/hint?id=S1-03&level=1|2`
- `POST /api/answer {id, answer}`  -> MC: verdict + explanation + source. Open: `not_graded_yet` (Claude grading is the next step)

## Question format
id, session, year, topic, type (MC|Open), difficulty (easy|medium|hard = about 1/2/3 min, like the exam),
question, options {A..D} | null, correct | null, key_points[], model_answer, hint1, hint2, source_pages ("S1 p28" = PDF page), status.

## Timeline
- Fri 6 Nov 2026: working trial of A for Johannes (built on test accounts if his aren't ready).
- Tue 10 Nov 2026: invoice. Budget about 50 h at 20 EUR/h.
- Course sessions continue until 3 Dec; add questions for each new deck as it arrives.

## Next steps
1. Quiz page in `web/`: pick session, show question, MC buttons / text box, feedback card, hints, review list at the end.
2. Claude grading for open answers in `/api/answer` (verdict correct/partly/wrong, points hit, points missed, max 3 sentences).
3. Voice: ElevenLabs speech-to-text for answers, text-to-speech for feedback (sentence by sentence).
4. Access code + daily cap per student; deploy to Cloudflare.
