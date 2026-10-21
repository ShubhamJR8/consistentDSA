import type { Difficulty } from './commitment';

export interface JudgeExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface JudgeStarterCode {
  language: string;
  code: string;
}

export interface JudgeSampleTest {
  input: string;
  expectedOutput: string;
}

export interface JudgeProblemDetail {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  topic: string;
  url: string;
  source: string;
  order: number;
  judgeEnabled: boolean;
  statement: string;
  constraints: string[];
  examples: JudgeExample[];
  starterCode: JudgeStarterCode[];
  sampleTests: JudgeSampleTest[];
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface RunSubmissionInput {
  language: string;
  code: string;
}

export interface RunResultItem {
  index: number;
  passed: boolean;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  stderr: string | null;
}

export interface RunResult {
  results: RunResultItem[];
  allPassed: boolean;
}

export type SubmissionStatus =
  | 'ACCEPTED'
  | 'WRONG_ANSWER'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIME_LIMIT_EXCEEDED'
  | 'JUDGE_ERROR';

export interface SubmitResultItem {
  index: number;
  isSample: boolean;
  passed: boolean;
  // Only present for sample cases — hidden-test I/O is withheld by the server.
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  stderr?: string | null;
}

export interface SubmitResult {
  id: string;
  status: SubmissionStatus;
  passedCount: number;
  totalCount: number;
  results: SubmitResultItem[];
  markedComplete: boolean;
}
