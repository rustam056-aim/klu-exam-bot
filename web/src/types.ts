export type Difficulty = 'easy' | 'medium' | 'hard'

export type PublicQuestion = {
  id: string
  session: number
  sessionLabel?: string
  topic: string
  type: 'MC' | 'Open'
  difficulty: Difficulty
  question: string
  options: Record<string, string> | null
}

export type NextResponse =
  | { done: true }
  | { done: false; question: PublicQuestion; remaining: number }

export type McResult = {
  id: string
  type: 'MC'
  verdict: 'correct' | 'wrong'
  correctOption: string
  explanation: string
  source: string
}

export type OpenResult = {
  id: string
  type: 'Open'
  // 'not_graded_yet' until Claude grading is switched on in the backend
  verdict: 'not_graded_yet' | 'correct' | 'partly' | 'wrong'
  keyPoints: string[]
  modelAnswer: string
  source: string
  pointsHit?: string[]
  pointsMissed?: string[]
  feedback?: string
}

export type AnswerResult = McResult | OpenResult

export type Verdict = 'correct' | 'partly' | 'wrong' | 'skipped'

export type Attempt = {
  question: PublicQuestion
  verdict: Verdict
  source: string
  hintsUsed: number
}

export type Settings = {
  session: string // 'all' or a session number
  difficulty: 'mixed' | Difficulty
  length: number
}
