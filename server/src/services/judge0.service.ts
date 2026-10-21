import { env } from '../config/env.js';
import { judge0IdFor } from '../config/languages.js';
import { ApiError } from '../utils/apiError.js';

export type Judge0TestStatus =
  | 'ACCEPTED'
  | 'WRONG_ANSWER'
  | 'COMPILE_ERROR'
  | 'TIME_LIMIT_EXCEEDED'
  | 'RUNTIME_ERROR'
  | 'JUDGE_ERROR';

export interface Judge0TestOutcome {
  passed: boolean;
  status: Judge0TestStatus;
  stdout: string;
  stderr: string | null;
  timeMs: number | null;
}

export interface RunBatchInput {
  language: string;
  code: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  tests: { stdin: string; expectedOutput: string }[];
}

// Judge0's numeric status ids. 3 = Accepted (its own stdout-vs-expected_output diff passed),
// 4 = Wrong Answer, 5 = TLE, 6 = Compilation Error, 7-12 = the various runtime-error signals.
// See https://ce.judge0.com/#statuses-and-languages-status-get.
const STATUS_MAP: Record<number, Judge0TestStatus> = {
  3: 'ACCEPTED',
  4: 'WRONG_ANSWER',
  5: 'TIME_LIMIT_EXCEEDED',
  6: 'COMPILE_ERROR',
  7: 'RUNTIME_ERROR',
  8: 'RUNTIME_ERROR',
  9: 'RUNTIME_ERROR',
  10: 'RUNTIME_ERROR',
  11: 'RUNTIME_ERROR',
  12: 'RUNTIME_ERROR',
};

interface Judge0BatchResultItem {
  status: { id: number; description: string };
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  time: string | null; // seconds, as a decimal string
}

const toBase64 = (value: string): string => Buffer.from(value, 'utf-8').toString('base64');
const fromBase64 = (value: string | null | undefined): string =>
  value ? Buffer.from(value, 'base64').toString('utf-8') : '';

/**
 * Runs one submission's code against every given test case via Judge0's batch endpoint, using
 * `wait=true` so the call resolves synchronously with results instead of requiring us to poll.
 * Judge0 does the stdout-vs-expected_output comparison itself (status 3/4), which is exactly
 * the stdin/stdout judging model our problems are authored against.
 */
export const runBatch = async (input: RunBatchInput): Promise<Judge0TestOutcome[]> => {
  if (!env.JUDGE0_API_URL) {
    throw ApiError.internal(
      'JUDGE0_NOT_CONFIGURED',
      'The code judge is not configured on this server yet.'
    );
  }

  const languageId = judge0IdFor(input.language);
  const body = {
    submissions: input.tests.map((test) => ({
      language_id: languageId,
      source_code: toBase64(input.code),
      stdin: toBase64(test.stdin),
      expected_output: toBase64(test.expectedOutput),
      cpu_time_limit: input.timeLimitMs / 1000,
      memory_limit: input.memoryLimitMb * 1024,
    })),
  };

  const url =
    `${env.JUDGE0_API_URL.replace(/\/$/, '')}/submissions/batch` +
    '?base64_encoded=true&wait=true&fields=status,stdout,stderr,compile_output,time';

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.JUDGE0_API_KEY && {
          'X-RapidAPI-Key': env.JUDGE0_API_KEY,
          'X-RapidAPI-Host': env.JUDGE0_API_HOST,
        }),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw ApiError.internal('JUDGE0_UNREACHABLE', "Couldn't reach the code judge. Try again.");
  }

  if (!res.ok) {
    throw ApiError.internal('JUDGE0_REQUEST_FAILED', `Judge0 request failed (${res.status}).`);
  }

  const results = (await res.json()) as Judge0BatchResultItem[];
  return results.map((result) => {
    if (result.compile_output) {
      return {
        passed: false,
        status: 'COMPILE_ERROR',
        stdout: '',
        stderr: fromBase64(result.compile_output),
        timeMs: null,
      };
    }
    return {
      passed: result.status.id === 3,
      status: STATUS_MAP[result.status.id] ?? 'JUDGE_ERROR',
      stdout: fromBase64(result.stdout),
      stderr: fromBase64(result.stderr),
      timeMs: result.time ? Math.round(parseFloat(result.time) * 1000) : null,
    };
  });
};
