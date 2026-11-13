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
- Root: `npm run setup` once (installs everything), then `npm run dev` starts backend + frontend in one terminal.
- `web/`  React + TypeScript + Vite (what students see). `npm run dev` -> http://localhost:5173. `/api` is proxied to the backend.
- `api/`  Cloudflare Worker in TypeScript. `npm run dev` -> http://localhost:8787
- `api/data/questions_s1_s2_2026.json`  question bank, Sessions 1-2 of 2026 (57 questions, all `draft`)
- `api/data/questions_videos_2026.json`  27 questions from Alan McKinnon's 16 video lectures (session 100, session_label "Alan McKinnon videos", source "Video NN")
- `api/data/questions_readings_2026.json`  assigned readings, sessions 200+ (200 = Elkington 2018, 10 questions, source "Elkington 2018 pN"). GSLS report goes here next as 201.

## Deploy
- Cloudflare Worker `klu-exam-practice` serves web/dist as static assets and /api/* from api/src/index.ts.
- Root: `npm run deploy` (builds web, then wrangler deploy). Keys in production: `npx wrangler secret put ANTHROPIC_API_KEY` / `ELEVENLABS_API_KEY` (run in api/).

## API (api/src/index.ts)
- `GET  /api/health`
- `GET  /api/sessions`  -> question count per session
- `GET  /api/question/next?session=1&difficulty=easy&exclude=S1-01,S1-02&only=...`  -> a question without the answer (`only` = practise these again)
- `GET  /api/hint?id=S1-03&level=1|2`
- `POST /api/transcribe` (audio body) -> {text}, ElevenLabs Scribe v2
- `POST /api/speak {text}` -> audio/mpeg, ElevenLabs Flash v2.5, standard voice (ELEVENLABS_VOICE_ID optional)
- `POST /api/answer {id, answer}`  -> MC: verdict + explanation + source. Open: `not_graded_yet` (Claude grading is the next step)

## Question format
id, session, year, topic, type (MC|Open), difficulty (easy|medium|hard = about 1/2/3 min, like the exam),
question, options {A..D} | null, correct | null, key_points[], model_answer, hint1, hint2, source_pages ("S1 p28" = PDF page), status.

## Timeline
- Fri 6 Nov 2026: working trial of A for Johannes (built on test accounts if his aren't ready).
- Tue 10 Nov 2026: invoice. Budget about 50 h at 20 EUR/h.
- Course sessions continue until 3 Dec; add questions for each new deck as it arrives.

## Next steps
1. DONE: quiz page in `web/` (start screen, route-line progress, MC + open answers, hints, feedback, review list, practise again). Open answers use a key-point self-check until step 2.
2. DONE: Claude grading for open answers (`gradeWithClaude` in api/src/index.ts, model claude-haiku-5-5 via tool call). Claude only picks covered key points + writes feedback; verdict = all/some/none of the points. Falls back to self-check if no key or an error.
3. DONE: voice. Mic button for open answers (web/src/MicButton.tsx), Read aloud switch + Listen links (web/src/voice.ts).
4. DONE: access code (secret ACCESS_CODE; header x-access-code; web/src/access.ts) and deploy (https://klu-exam-practice.rustam-klu.workers.dev). Still open: daily cap per student.
5. Alan McKinnon lectures: `node scripts/transcribe-materials.mjs` -> materials/alan-transcripts (git-ignored), then write questions from them.
5. DONE (5 Nov): Quick 5 (MC only, `type=MC` on /api/question/next), voice mode (dark scene, big mic dock, auto-check after talking, spoken MC letters via web/src/spokenChoice.ts, shared recorder in web/src/useRecorder.ts), "See the slide" under feedback (web/public/slides/S1-28.webp etc., only pages the questions cite; served through the Worker at /slides/* behind the access code `?c=`), progress per session in localStorage (web/src/progress.ts) with "Practise the N you missed", question count fits the chosen session.
   New slides for a session: render only the cited PDF pages to web/public/slides/S<n>-<page>.webp (1200 px wide).
6. DONE (5 Nov, later): one design everywhere (cards, pill buttons in two sizes, chips in steel when picked), logo in the top bar goes back to the start, same bottom bar on every question (Hint/Skip left, big round mic/check/next in the middle). "Hear it from Alan" under feedback for video questions: web/public/alan/NN.m4a (mono 48 kbps, made from materials/alan-audio with ffmpeg), served through the Worker at /alan/* behind the access code, with byte-range support for Safari; start times per question in api/data/video_times_2026.json (estimated from the transcripts).
   web/public/alan/ is in .gitignore (Alan's lectures never go to GitHub), so deploy from this Mac only.
7. KLU / GSLS look (5 Nov): white page, GSLS-green cards (#e3f8df), KLU burgundy #590e2c for main buttons, KLU red #d83e22 accents, burgundy top band with the KLU logo (web/public/klu-logo.png, taken from the course slides) + red "Sustainable Logistics / Exam practice" tag; logo goes back to the start. Font: Hanken Grotesk (free stand-in for KLU's Saans, which is a paid font) via @fontsource-variable/hanken-grotesk.
8. Session 3 + guest lectures (8 Nov): api/data/questions_s3_guests_2026.json, 54 questions. Session 3 (Air cargo, Kay Simon) = session 3; guest lectures MAN = 31, Tecvia = 32, Fraport = 33, Sovereign Speed = 34; GSLS interview = 201 (reading). Sources "S3 p18", "MAN p16", "TEC p30", "FRA p12", "SOV p14", "GSLS interview"; slide images web/public/slides/<CODE>-<page>.webp; deck names in GUEST_DECKS in web/src/format.ts. Review list for Johannes: docs/Practice questions - Session 3 and guest lectures.xlsx.
9. "Talk to Johannes" conversation mode (13 Nov): card on the start screen -> web/src/ChatView.tsx (type or tap the mic; a spoken question gets a spoken answer; "Where this comes from" shows the slide / Alan clip). API: POST /api/chat { messages } -> { reply, sources } in api/src/chat.ts. Claude (tool call `reply`, model ANTHROPIC_CHAT_MODEL || ANTHROPIC_MODEL || claude-haiku-5-5) gets the whole course in the system prompt with prompt caching: api/data/course_notes_2026.json (slide text per page for S1, S2, S3, MAN, TEC, FRA, SOV + the GSLS interview, made with pdftotext) plus the question bank with model answers. Rules: only course material, 2-4 spoken sentences, follow-ups, "quiz me", says it is an AI tutor. Nothing is stored; the last 16 turns are sent each time.
   New material: add the deck's page text to course_notes_2026.json (and questions to the bank); the chat picks it up on the next deploy.
   Still open before students get it: daily cap per student, cached audio for questions, feedback form.
10. Conversation, second round (13 Nov): ChatView has two views sharing one conversation. Talk = "call" screen (big tutor, his words as subtitles, slide shown inline, one big button; hands-free: after he finishes the mic opens by itself and closes when the student stops talking, see web/src/vad.ts and the autoStop option in useRecorder.ts; tap the button to interrupt him). Type = chat with text box. "Wrap up" (API flag wrapUp) gives a recap with up to four slides to reread. "Talk it through with Johannes" under a wrong/partly answer opens the conversation with that question (App.talkThrough; the answer is counted and the next question is lined up for "Back to practice"). Starter "Give me a mock oral exam".
    Voice: one shared audio player, unlocked during a tap (unlockAudio) so replies can start by themselves on iPhones; replies are split in two (first sentence, rest) so he starts sooner, with previous_text/next_text for a smooth join; course terms are respelled for the voice (sayable in index.ts); long text is cut at a sentence end. Optional secret ELEVENLABS_CHAT_MODEL=eleven_flash_v2_5 = faster and half the credits for the conversation only.
    Check caching: `npx wrangler tail` while chatting shows "Chat tokens: new ..., cached ..."; cached should be about 50,000 from the second message on.
    Not tested on a real iPhone or with the real Claude/ElevenLabs yet (only with stand-ins in a test browser).
11. Two modes + more natural talking (13 Nov, evening): the home screen now offers just two things: "Talk to Johannes" and "Practise by module" (StartScreen with screen = home | practice; App phase 'practice'). The practice screen lists every module (sessions, guest lectures, videos, readings) as a row with its progress bar; tapping a row starts it; difficulty / questions per round / typing or talking sit under "Options"; Quick 5 and "Practise the N you missed" are here too.
    Talking is tracked too: when the tutor asked a question and the student answered, Claude adds `check` { result, source } to its reply; the API returns check { result, session }; the browser keeps it (progress.ts, talk-progress-v1). Shown as "2 of 3 right" in the conversation, on the home card, and as "With Johannes: ..." on the module row.
    Sounding less robotic: the chat prompt now asks for spoken language (contractions, natural openers, reacting first); the conversation voice uses its own settings (stability 0.3, style 0.45, speed 0.95 via ELEVENLABS_CHAT_SPEED). ELEVENLABS_CHAT_MODEL can be any ElevenLabs model id; if the model refuses the settings or isn't available, /api/speak retries with bare text and then falls back to the standard model, so a test can't leave the tutor mute.
12. After Prof. Meuer's first test (13 Nov, night). His points and what changed:
    - "follow-up questions instead of one question at a time": the tutor now examines like an oral examiner: after an answer it digs deeper on the same point once or twice before changing topic (chat.ts rules).
    - "when to press the mic": "Hands-free" is now called "Auto mic" and explained on the first screen; the label under the tutor says whose turn it is ("Your turn, I'm listening" / "Johannes is talking"); a soft two-note tone plays when the mic opens (chime in voice.ts).
    - "why do I see the slides?": in the Talk view the slide only appears after tapping "Show the slide".
    - "some deeper answers are not entirely correct": stricter rule to take facts word for word from the material and to judge answers against the material. Still needs his examples. Stronger model for the conversation only: secret ANTHROPIC_CHAT_MODEL (e.g. claude-sonnet-5-5), costs more per message.
    - "what grade would I get": a practice estimate in words (solid pass / pass, with gaps / not there yet), never a numeric grade, clearly not official. His real grading scale can replace this later.
    - Feedback box ("What should be better?") on the home screen, the practice summary and after a wrap-up: POST /api/feedback (anonymous: stars, text, which part). Stored in Cloudflare KV binding FEEDBACK; read at /api/feedback/list?admin=<ADMIN_CODE secret>. Without the KV binding it only goes to the Worker logs.
      One-time setup: `cd api && npx wrangler kv namespace create FEEDBACK` (let Wrangler add it to wrangler.jsonc), `echo -n "<a long random word>" | npx wrangler secret put ADMIN_CODE`, then deploy.
    Still open: daily cap per student; video avatar; grading with his scale; choosing topic blocks in the conversation.
13. Hands-free conversation (13 Nov, late): in the Talk view the mic now stays on for the whole call ("Hands-free" switch, on by default, localStorage 'alwaysListening'). web/src/liveMic.ts (useLiveMic) keeps one Web Audio stream open, learns the room level, and cuts each thing the student says into a 16 kHz WAV clip (0.5 s pre-roll, ends after 1.4 s of quiet) that goes to /api/transcribe. While Johannes speaks it only reacts to clear, sustained speech (strict mode); then he pauses (pauseSpeaking in voice.ts), and if the clip was real he stops and answers, if it was noise or his own voice (soundsLikeEcho) he carries on (resumeSpeaking). Mic is muted while waiting for his reply. Big button: while you talk = send now; while he talks = stop him; otherwise = pause/resume the mic. Switch off = old tap-to-talk (useRecorder). Headphones work best on laptops (echo).
    Chat errors: chat.ts retries once on 429/5xx or an empty reply, and falls back from ANTHROPIC_CHAT_MODEL to ANTHROPIC_MODEL on 400/403/404. The error message shows a code ("That didn't go through (code 404)"); the Worker log line starts with "Chat failed:" (see it with `cd api && npx wrangler tail`). The greeting ("be hungry") is now known to the tutor, so "I'm not hungry" gets a sensible answer.

